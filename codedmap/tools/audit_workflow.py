#!/usr/bin/env python3
"""
CodeDMap Audit Workflow — 审计编排脚本

通过 Claude 或 Codex 子进程调度多个角色 Agent 执行代码审计工作流。
角色定义使用单一来源（.claude/agents/*.md），编排脚本只负责：
  - 读取 frontmatter 中的编排元数据（phase、depends_on、timeout）
  - 组织上下游依赖和并行 wave
  - 为子进程注入本地 DB 或远程 CPG server 运行时环境

本脚本不负责构建数据库；构建请使用 tools/build_map.py。

用法:
    # 审计本地数据库
    python3 tools/audit_workflow.py /path/to/source --db audit.db

    # 审计远程 CPG server
    python3 tools/audit_workflow.py /path/to/source --cpg-server http://127.0.0.1:8000

    # 只跑指定角色
    python3 tools/audit_workflow.py /path/to/source --cpg-server http://127.0.0.1:8000 --only map-surveyor

    # 从断点恢复
    python3 tools/audit_workflow.py /path/to/source --db audit.db --resume

    # 清除状态重新开始
    python3 tools/audit_workflow.py /path/to/source --db audit.db --clean

角色文件格式 (.claude/agents/*.md):
    Claude Code 原生 agent 格式，编排脚本读取 frontmatter 中的额外字段:
    ---
    name: map-surveyor
    description: 代码地图勘察员...
    model: sonnet
    # --- 编排字段（供 audit_workflow.py 读取）---
    phase: 1
    depends_on: []
    timeout: 60
    ---
    # 角色 prompt 内容...

============================================================
迁移契约 (Migration Contract) — 迁 LangGraph 时务必保持
============================================================

本脚本是 orchestrator 原型。目标迁移方案：**LangGraph 编排 + 节点内部
继续使用 `claude -p --agent <name>` 子进程**（路线 A），不切 API。
这条路线几乎零迁移风险，因为 system prompt / skill / 内置工具仍由
Claude Code 自动加载——迁移时只需替换编排层。

需要在新框架里显式保持的约定：

1. 节点执行器不变
   - 每个 LangGraph 节点内部就是调用 `run_agent()`（或其等价实现），
     后者起 `claude -p --agent <id>` 子进程。system prompt、skill、
     Read/Write/Grep 等内置工具全部由 CC 自动处理，不需要迁移。
   - AgentRole.system_prompt 字段已显式解析保存，仅作"契约可见性"
     用途：让你在迁移时能一眼看到每个 agent 的 body 长度和依赖，
     不会被隐式加载蒙蔽。

2. 共享状态载体 = CDM（本地 DB 或远程 server，不是内存 dict / LangGraph State）
   - Agent 之间真正传递的是 CDM DB 中的节点/tag/note。
   - orchestrator 内存里只保存 summary 文本供下游 prompt 参考。
   - LangGraph State 只应放 {source_path, audit_target, completed_summaries,
     failed}，绝不要把 CDM 数据搬进 State。

3. Agent I/O 契约（每个 agent 必须遵守）
   输入：
     - source_path（作为 subprocess cwd）
     - audit_target（本地 DB 路径或远程 server URL）
     - 上游 agent 的 summary 文本（通过 build_task_prompt 拼接）
   输出：
     - 副作用：写入 CDM（通过 cdm-local 或 cdm skill / CLI）
     - stdout：必须包含 === AGENT_SUMMARY === / === END_SUMMARY ===
       块，供 extract_summary() 提取给下游

4. 工作目录契约
   - subagent 的 cwd = source_path（审计目标项目根），grep/find/git
     都相对目标项目。LangGraph 节点在启动 `claude -p` 时必须同样
     传 cwd=source_path，否则 agent 会在错误目录搜索。
   - 注意副作用：cwd 下的 CLAUDE.md 会被 CC 自动加载——目标项目
     若有 CLAUDE.md 会影响 agent 行为，这是特性不是 bug。

5. 并发与 checkpoint
   - 现在：按 phase 分 wave，wave 内用 ThreadPoolExecutor；状态存
     .audit_state/<name>/*.json。
   - LangGraph：phase 映射为 StateGraph 层，同层节点从 START fan-out
     并发；checkpoint 换成 SqliteSaver，--resume 免写。
   - 并发合并 State 时，completed 字段要用 Annotated reducer
     (operator.or_)，否则并行节点会互相覆盖。

6. 允许的 Bash 工具白名单（见 run_agent 的 --allowedTools）
   迁 LangGraph 后调用 `claude -p` 仍要传同一份白名单，保持 agent
   行为一致。白名单本身是契约的一部分。
============================================================
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from abc import ABC, abstractmethod
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


# ---------------------------------------------------------------------------
# Agent role definition
# ---------------------------------------------------------------------------

@dataclass
class AgentRole:
    """从 .claude/agents/*.md frontmatter 解析出的编排信息"""
    id: str               # agent name（对应 --agent 参数）
    phase: int
    depends_on: list[str]
    timeout_minutes: int
    source_file: Path

    # 迁移契约 #1：.md body 作为 system prompt。现阶段 claude -p --agent 会
    # 自动加载，本字段不直接使用；保留供迁 LangGraph/裸 API 时显式注入。
    system_prompt: str = ""

    # runtime state
    status: str = "pending"       # pending | running | done | failed | skipped
    started_at: str | None = None
    finished_at: str | None = None
    error: str | None = None
    summary: str | None = None


@dataclass(frozen=True)
class AuditTargetConfig:
    """Resolved audit target for local DB mode or remote server mode."""
    mode: str                 # local | remote
    label: str
    db_path: str | None = None
    cpg_server: str | None = None
    cpg_api_key: str | None = None


@dataclass(frozen=True)
class PromptEnvelope:
    """Structured prompt sections for backend-specific rendering."""
    role_definition: str = ""
    task_context: str = ""
    upstream_outputs: str = ""
    execution_contract: str = ""
    backend_notes: str = ""
    output_format: str = ""

    def render(self) -> str:
        sections: list[tuple[str, str]] = [
            ("Role Definition", self.role_definition),
            ("Task Context", self.task_context),
            ("Upstream Outputs", self.upstream_outputs),
            ("Execution Contract", self.execution_contract),
            ("Backend Notes", self.backend_notes),
            ("Output Format", self.output_format),
        ]
        rendered: list[str] = []
        for title, content in sections:
            content = content.strip()
            if not content:
                continue
            rendered.append(f"# {title}\n{content}")
        return "\n\n".join(rendered)


class BackendAdapter(ABC):
    """Backend-specific prompt rendering and subprocess command builder."""

    name: str

    @abstractmethod
    def render_prompt(self, agent: AgentRole, source_path: Path, audit_target: AuditTargetConfig,
                      completed_agents: dict[str, AgentRole], campaign_id: str = "cmp_default") -> str:
        """Build the task prompt for a backend."""

    @abstractmethod
    def build_command(self, prompt: str, source_path: Path, output_path: Path,
                      agent: AgentRole | None = None,
                      audit_target: AuditTargetConfig | None = None) -> list[str]:
        """Build the subprocess command for a backend."""

    def extract_response_text(self, result: subprocess.CompletedProcess[str],
                              output_path: Path) -> str:
        """Extract agent output text from a subprocess result."""
        del output_path
        return result.stdout


class ClaudeBackendAdapter(BackendAdapter):
    """Use Claude native agent loading via --agent."""

    name = "claude"

    def render_prompt(self, agent: AgentRole, source_path: Path, audit_target: AuditTargetConfig,
                      completed_agents: dict[str, AgentRole], campaign_id: str = "cmp_default") -> str:
        return build_workflow_context(agent, source_path, audit_target, completed_agents, campaign_id)

    def build_command(self, prompt: str, source_path: Path, output_path: Path,
                      agent: AgentRole | None = None,
                      audit_target: AuditTargetConfig | None = None) -> list[str]:
        del source_path, output_path, audit_target
        if agent is None:
            raise ValueError("Claude backend requires an agent definition")
        return [
            "claude",
            "-p", prompt,
            "--agent", agent.id,
            "--output-format", "text",
            "--allowedTools", ",".join([
                "Bash(python3:*)",
                "Bash(cdm:*)",
                "Bash(uv:*)",
                "Bash(export:*)",
                "Bash(cat:*)",
                "Bash(head:*)",
                "Bash(tail:*)",
                "Bash(ls:*)",
                "Bash(mkdir:*)",
                "Bash(wc:*)",
                "Bash(grep:*)",
                "Bash(find:*)",
                "Bash(rg:*)",
                "Bash(git:*)",
                "Read", "Write", "Edit", "Glob", "Grep", "Skill",
            ]),
        ]


class CodexBackendAdapter(BackendAdapter):
    """Use Codex CLI and explicitly inject the role definition into the prompt."""

    name = "codex"

    def render_prompt(self, agent: AgentRole, source_path: Path, audit_target: AuditTargetConfig,
                      completed_agents: dict[str, AgentRole], campaign_id: str = "cmp_default") -> str:
        envelope = PromptEnvelope(
            role_definition=agent.system_prompt,
            task_context=build_task_context(source_path, audit_target, campaign_id),
            upstream_outputs=build_upstream_outputs(agent, completed_agents),
            execution_contract=build_execution_contract(),
            backend_notes=(
                "The role definition above comes from a Claude-style agent file and is "
                "being explicitly injected by the orchestrator for Codex execution."
            ),
            output_format=build_output_format_instructions(),
        )
        return envelope.render()

    def build_command(self, prompt: str, source_path: Path, output_path: Path,
                      agent: AgentRole | None = None,
                      audit_target: AuditTargetConfig | None = None) -> list[str]:
        del prompt, agent
        if audit_target and audit_target.mode == "remote":
            # Codex sandbox blocks Python/httpx loopback TCP in this workflow,
            # so remote CDM mode must run unsandboxed to reach the local server.
            return [
                "codex",
                "--dangerously-bypass-approvals-and-sandbox",
                "exec",
                "-C", str(source_path),
                "--skip-git-repo-check",
                "-o", str(output_path),
                "-",
            ]
        return [
            "codex",
            "-a", "never",
            "-s", "workspace-write",
            "exec",
            "-C", str(source_path),
            "--skip-git-repo-check",
            "-o", str(output_path),
            "-",
        ]

    def extract_response_text(self, result: subprocess.CompletedProcess[str],
                              output_path: Path) -> str:
        if output_path.exists():
            return output_path.read_text(encoding="utf-8", errors="replace")
        return result.stdout


class OpencodeBackendAdapter(BackendAdapter):
    """Use opencode CLI with explicit role injection."""

    name = "opencode"

    def render_prompt(self, agent: AgentRole, source_path: Path, audit_target: AuditTargetConfig,
                      completed_agents: dict[str, AgentRole], campaign_id: str = "cmp_default") -> str:
        envelope = PromptEnvelope(
            role_definition=agent.system_prompt,
            task_context=build_task_context(source_path, audit_target, campaign_id),
            upstream_outputs=build_upstream_outputs(agent, completed_agents),
            execution_contract=build_execution_contract(campaign_id),
            backend_notes=(
                "The role definition above comes from a Claude-style agent file and is "
                "being explicitly injected by the orchestrator for opencode execution."
            ),
            output_format=build_output_format_instructions(),
        )
        return envelope.render()

    def build_command(self, prompt: str, source_path: Path, output_path: Path,
                      agent: AgentRole | None = None,
                      audit_target: AuditTargetConfig | None = None) -> list[str]:
        del agent, audit_target, output_path
        return [
            "opencode", "run",
            "--dir", str(source_path),
            prompt,
        ]


def create_backend_adapter(backend: str) -> BackendAdapter:
    normalized = backend.strip().lower()
    if normalized == "claude":
        return ClaudeBackendAdapter()
    if normalized == "codex":
        return CodexBackendAdapter()
    if normalized == "opencode":
        return OpencodeBackendAdapter()
    raise ValueError(f"Unknown backend: {backend}")


def parse_agent_file(text: str) -> tuple[dict, str]:
    """解析 agent .md 文件，返回 (frontmatter metadata, body 内容)。

    body 即 agent 的 system prompt。当前 orchestrator 不直接使用它
    （由 claude -p --agent 隐式加载），但显式解析出来供未来迁移使用。
    """
    m = re.match(r'^---\s*\n(.*?)\n---\s*\n(.*)$', text, re.DOTALL)
    if not m:
        return {}, text

    fm_text, body = m.group(1), m.group(2).strip()
    meta: dict = {}
    for line in fm_text.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if ':' in line:
            key, _, val = line.partition(':')
            val = val.strip()
            if val.startswith('[') and val.endswith(']'):
                items = [x.strip().strip('"').strip("'") for x in val[1:-1].split(',')]
                meta[key.strip()] = [x for x in items if x]
            elif val.isdigit():
                meta[key.strip()] = int(val)
            else:
                meta[key.strip()] = val.strip('"').strip("'")
    return meta, body


def load_agents(agents_dir: Path) -> list[AgentRole]:
    """从 .claude/agents/ 目录加载带编排元数据的 agent 文件"""
    agents = []
    if not agents_dir.exists():
        print(f"[ERROR] agents 目录不存在: {agents_dir}")
        sys.exit(1)

    for f in sorted(agents_dir.glob("*.md")):
        text = f.read_text(encoding="utf-8")
        meta, body = parse_agent_file(text)

        # 必须有 name（Claude Code agent ID）和 phase（编排阶段）
        if "name" not in meta or "phase" not in meta:
            continue

        agents.append(AgentRole(
            id=meta["name"],
            phase=int(meta["phase"]),
            depends_on=meta.get("depends_on", []),
            timeout_minutes=int(meta.get("timeout", 30)),
            source_file=f,
            system_prompt=body,
        ))

    return agents


# ---------------------------------------------------------------------------
# State persistence (断点恢复)
# ---------------------------------------------------------------------------

def _sanitize_state_fragment(value: str) -> str:
    sanitized = re.sub(r"[^a-zA-Z0-9._-]+", "_", value.strip())
    return sanitized.strip("_") or "default"


def resolve_audit_target(args: argparse.Namespace) -> AuditTargetConfig:
    db_path = getattr(args, "db", None)
    cpg_server = getattr(args, "cpg_server", None)
    cpg_api_key = getattr(args, "cpg_api_key", None)

    if db_path and cpg_server:
        raise ValueError("--db and --cpg-server are mutually exclusive")
    if not db_path and not cpg_server:
        raise ValueError("One of --db or --cpg-server is required")

    if cpg_server:
        label = _sanitize_state_fragment(cpg_server.replace("://", "_"))
        return AuditTargetConfig(
            mode="remote",
            label=label,
            cpg_server=cpg_server,
            cpg_api_key=cpg_api_key,
        )

    return AuditTargetConfig(
        mode="local",
        label=_sanitize_state_fragment(Path(db_path).stem),
        db_path=db_path,
    )


def state_dir_for(source_path: Path, audit_target: AuditTargetConfig) -> Path:
    name = f"{source_path.name}_{audit_target.label}"
    d = Path(".audit_state") / name
    d.mkdir(parents=True, exist_ok=True)
    return d


def state_root_for(source_path: Path, audit_target: AuditTargetConfig) -> Path:
    return state_dir_for(source_path, audit_target)


def campaign_state_dir(root: Path, campaign_id: str) -> Path:
    sdir = root / campaign_id
    sdir.mkdir(parents=True, exist_ok=True)
    return sdir


def latest_campaign_file(root: Path) -> Path:
    return root / "latest_campaign.txt"


def list_campaign_ids(root: Path) -> list[str]:
    if not root.exists():
        return []
    return sorted(
        path.name
        for path in root.iterdir()
        if path.is_dir() and path.name.startswith("cmp_")
    )


def generate_campaign_id(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    return f"cmp_{current.strftime('%Y%m%dT%H%M%SZ')}"


def resolve_campaign_id(
    root: Path,
    resume: bool = False,
    resume_campaign: str | None = None,
) -> str:
    root.mkdir(parents=True, exist_ok=True)

    if resume_campaign:
        campaign_dir = root / resume_campaign
        if not campaign_dir.is_dir():
            raise ValueError(f"Campaign not found: {resume_campaign}")
        return resume_campaign

    campaign_file = latest_campaign_file(root)
    if resume and campaign_file.exists():
        campaign_id = campaign_file.read_text(encoding="utf-8").strip()
        if campaign_id and (root / campaign_id).is_dir():
            return campaign_id
        raise ValueError(f"Latest campaign not found: {campaign_id}")

    campaign_id = generate_campaign_id()
    campaign_state_dir(root, campaign_id)
    campaign_file.write_text(f"{campaign_id}\n", encoding="utf-8")
    return campaign_id


def save_agent_state(sdir: Path, agent: AgentRole):
    state = {
        "id": agent.id,
        "status": agent.status,
        "started_at": agent.started_at,
        "finished_at": agent.finished_at,
        "error": agent.error,
        "summary": agent.summary,
    }
    (sdir / f"{agent.id}.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def load_agent_state(sdir: Path, agent: AgentRole) -> bool:
    f = sdir / f"{agent.id}.json"
    if not f.exists():
        return False
    state = json.loads(f.read_text(encoding="utf-8"))
    if state.get("status") == "done":
        agent.status = "done"
        agent.summary = state.get("summary")
        agent.started_at = state.get("started_at")
        agent.finished_at = state.get("finished_at")
        return True
    return False


# ---------------------------------------------------------------------------
# Agent execution — backend-specific adapters
# ---------------------------------------------------------------------------

def build_task_context(source_path: Path, audit_target: AuditTargetConfig, campaign_id: str = "cmp_default") -> str:
    parts = [f"- 审计目标源码目录: {source_path}"]
    if audit_target.mode == "remote":
        parts.append(f"- 远程 CPG server: {audit_target.cpg_server}")
        parts.append("- 使用 cdm skill 操作远程 server")
        parts.append("- 远程图谱已由用户预先准备；禁止执行 build start、build enhance 或任何 upload 动作")
    else:
        parts.append(f"- 本地 CDM 数据库路径: {audit_target.db_path}")
        parts.append("- 使用 cdm-local skill 操作本地数据库")
    parts.append(f"- 当前审计轮次 campaign_id: {campaign_id}")
    return "\n".join(parts)


def build_upstream_outputs(agent: AgentRole,
                           completed_agents: dict[str, AgentRole]) -> str:
    deps = [completed_agents[d] for d in agent.depends_on if d in completed_agents]
    if not deps:
        return ""

    parts: list[str] = []
    for dep in deps:
        parts.append(f"## {dep.id}")
        parts.append(dep.summary or "(无摘要)")
        parts.append("")
    return "\n".join(parts).strip()


def build_execution_contract(campaign_id: str = "cmp_default") -> str:
    return "\n".join([
        "严格按照角色定义中的标准工作流逐步执行。",
        "当前 subprocess 的 cwd 就是被审计项目的源码根目录；所有 Read / Grep / git / 文件搜索都以该工作目录为准。",
        "CDM 的具体访问后端由 workflow 提供的运行时环境决定；直接使用当前会话可用的 workflow 提供的 CDM 访问方式，不要在角色层自行分支远程/本地实现。",
        "每个步骤都通过 CDM 工具完成实际操作，并将产出物写入 CDM 数据库。",
        "不要只做分析或建议，必须完成实际审计动作。",
        f"当前运行的 campaign_id 为 {campaign_id}，这是 workflow 注入的运行时上下文，不是角色定义的一部分。",
        "新增审计 note 默认写入 scope=campaign，并绑定当前 campaign_id。",
        "远端模式下编排器会注入 CPG_AGENT_ID / CPG_CAMPAIGN_ID；本地模式下会注入 CDM_AGENT_ID / CDM_CAMPAIGN_ID。",
        "使用这些已注入的运行时上下文完成写入，不要自行发明、覆盖或重写 campaign_id / agent_id。",
        "远程 CDM 模式优先使用 cdm client / discover 暴露的 schema 契约，不要手写 REST body；若必须手写请求，先核对字段名和类型。",
        "不要把数组字段序列化成字符串；例如 node_ids 必须是真实数组，不是 JSON 字符串。",
        "禁止执行 build start、build enhance 或任何 upload 动作；如果远程图谱缺失或不可用，应直接报告阻塞原因，不要自行建库。",
        "在工作流结束时输出摘要块，供编排脚本传递给下游 Agent。",
        "",
        "请开始执行你的标准工作流。",
    ])


def build_output_format_instructions() -> str:
    return "\n".join([
        "所有工作流步骤执行完毕后，在最后附上文本摘要：",
        "```",
        "=== AGENT_SUMMARY ===",
        "（1-5 句话概述你实际执行了哪些操作和具体产出物，用数量说明工作量）",
        "=== END_SUMMARY ===",
        "```",
    ])


def build_subprocess_env(agent: AgentRole, audit_target: AuditTargetConfig, campaign_id: str = "cmp_default") -> dict[str, str]:
    env = dict(os.environ)
    if audit_target.mode == "remote":
        if audit_target.cpg_server:
            env["CPG_SERVER"] = audit_target.cpg_server
        if audit_target.cpg_api_key:
            env["CPG_API_KEY"] = audit_target.cpg_api_key
        env["CPG_AGENT_ID"] = agent.id
        env["CPG_CAMPAIGN_ID"] = campaign_id
        env.pop("CDM_DB", None)
        env.pop("CDM_BACKEND", None)
        env.pop("CDM_AGENT_ID", None)
        env.pop("CDM_CAMPAIGN_ID", None)
    else:
        if audit_target.db_path:
            env["CDM_DB"] = audit_target.db_path
        env.setdefault("CDM_BACKEND", "sqlite")
        env["CDM_AGENT_ID"] = agent.id
        env["CDM_CAMPAIGN_ID"] = campaign_id
        env.pop("CPG_SERVER", None)
        env.pop("CPG_API_KEY", None)
        env.pop("CPG_AGENT_ID", None)
        env.pop("CPG_CAMPAIGN_ID", None)
    return env


def build_workflow_context(agent: AgentRole, source_path: Path, audit_target: AuditTargetConfig,
                           completed_agents: dict[str, AgentRole], campaign_id: str = "cmp_default") -> str:
    """Claude backend prompt: runtime context only, role body is loaded via --agent."""
    parts = [
        "## 审计任务上下文",
        "",
        build_task_context(source_path, audit_target, campaign_id),
    ]

    upstream_outputs = build_upstream_outputs(agent, completed_agents)
    if upstream_outputs:
        parts.extend(["", "## 已完成 Agent 摘要"])
        parts.append(upstream_outputs)

    parts.extend([
        "",
        "## 执行要求",
        build_execution_contract(campaign_id),
        "",
        "## 摘要格式",
        build_output_format_instructions(),
    ])
    return "\n".join(parts)


def _call_render_prompt(
    backend: BackendAdapter,
    agent: AgentRole,
    source_path: Path,
    audit_target: AuditTargetConfig,
    completed_agents: dict[str, AgentRole],
    campaign_id: str,
) -> str:
    try:
        return backend.render_prompt(agent, source_path, audit_target, completed_agents, campaign_id)
    except TypeError:
        return backend.render_prompt(agent, source_path, audit_target, completed_agents)


def _call_run_agent(
    agent: AgentRole,
    source_path: Path,
    audit_target: AuditTargetConfig,
    completed_agents: dict[str, AgentRole],
    sdir: Path,
    backend: BackendAdapter,
    campaign_id: str,
) -> AgentRole:
    try:
        return run_agent(agent, source_path, audit_target, completed_agents, sdir, backend, campaign_id)
    except TypeError:
        return run_agent(agent, source_path, audit_target, completed_agents, sdir, backend)


def extract_summary(output: str) -> str:
    m = re.search(r'=== AGENT_SUMMARY ===(.*?)=== END_SUMMARY ===', output, re.DOTALL)
    if m:
        return m.group(1).strip()
    return output[-500:].strip() if output else "(无输出)"


def remote_write_failure_reason(summary: str, output: str) -> str | None:
    """Return a failure reason when remote workflow produced no successful CDM writes."""
    text = "\n".join(part for part in (summary, output) if part).lower()
    zero_write_markers = [
        "db_connection_error",
        "没有执行成功的 cdm 写操作",
        "实际数据库产出为 0",
        "模块数、标签数、规则数、修复断链数均为 0",
        "漏洞标签 0、状态标签 0、审计笔记 0、协调摘要 0",
    ]
    zero_write_regexes = [
        r"未能把任何[^。\n]*写入",
        r"未能写入任何[^。\n]*",
    ]
    success_markers = [
        "新增",
        "写入当前 campaign",
        "写入 campaign",
        "写入 note",
        "写入 notes",
        "新增 note",
        "新增 notes",
        "新增 coordination note",
        "新增 coordination notes",
        "新增标签",
        "新增 module",
        "新增 repair",
        "已添加",
        "成功写入",
        "落库",
    ]

    has_zero_write_marker = any(marker.lower() in text for marker in zero_write_markers) or any(
        re.search(pattern, text) for pattern in zero_write_regexes
    )
    has_success_marker = any(marker.lower() in text for marker in success_markers)

    if has_zero_write_marker and not has_success_marker:
        return "Remote agent finished without any successful CDM write operations."
    return None


def persist_subprocess_diagnostics(
    sdir: Path,
    agent: AgentRole,
    backend_name: str,
    stdout_text: str,
    stderr_text: str,
    response_text: str,
) -> None:
    base_name = f"{agent.id}.{backend_name}"
    (sdir / f"{base_name}.stdout.txt").write_text(stdout_text, encoding="utf-8")
    (sdir / f"{base_name}.stderr.txt").write_text(stderr_text, encoding="utf-8")
    (sdir / f"{base_name}.response.txt").write_text(response_text, encoding="utf-8")


def map_surveyor_note_diagnostics(sdir: Path) -> str | None:
    patterns = (
        "note add",
        "note list",
        "notes_total",
        "campaign_id",
        "survey_handoff",
        "scope=campaign",
    )
    snippets: list[str] = []

    for path in sorted(sdir.glob("map-surveyor.*.response.txt")) + sorted(sdir.glob("map-surveyor.*.stdout.txt")):
        text = path.read_text(encoding="utf-8", errors="ignore")
        for line in text.splitlines():
            lowered = line.lower()
            if any(pattern in lowered for pattern in patterns):
                clean = line.strip()
                if clean and clean not in snippets:
                    snippets.append(clean)
            if len(snippets) >= 3:
                break
        if len(snippets) >= 3:
            break

    if not snippets:
        return None
    return "note diagnostics: " + " | ".join(snippets[:3])


def run_cdm_read_command(audit_target: AuditTargetConfig, args: list[str]) -> dict:
    """Run a read-only CDM command and return parsed JSON."""
    if audit_target.mode == "remote":
        cmd = [
            "python3",
            "tools/cdm_client.py",
            *args,
            "--remote",
            str(audit_target.cpg_server),
        ]
        env = dict(os.environ)
        if audit_target.cpg_api_key:
            env["CPG_API_KEY"] = audit_target.cpg_api_key
    else:
        if not audit_target.db_path:
            raise ValueError("Local audit target requires db_path")
        cmd = [
            "python3",
            "-m",
            "codedmap.cli",
            *args,
            "--db",
            str(audit_target.db_path),
            "--output",
            "json",
        ]
        env = dict(os.environ)

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(f"CDM read command failed: {' '.join(cmd)} :: {detail[:300]}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"CDM read command returned invalid JSON: {' '.join(cmd)}") from exc


def fetch_note_by_title(
    audit_target: AuditTargetConfig,
    category: str,
    title: str,
    campaign_id: str | None = None,
) -> dict | None:
    limit = 500
    offset = 0

    while True:
        args = [
            "note", "list",
            "--category", category,
            "--limit", str(limit),
            "--offset", str(offset),
        ]
        if campaign_id:
            args.extend(["--scope", "campaign", "--campaign-id", campaign_id])

        payload = run_cdm_read_command(audit_target, args)
        notes = payload.get("result", {}).get("content", {}).get("notes", [])
        for note in notes:
            if note.get("title") != title:
                continue
            if note.get("status", "active") != "active":
                continue
            note_id = note.get("note_id") or note.get("id")
            if note_id is None:
                continue
            shown = run_cdm_read_command(audit_target, ["note", "show", "--note-id", str(note_id)])
            return shown.get("result", {}).get("content", {}).get("note")

        metadata = payload.get("metadata", {})
        if not metadata.get("has_more"):
            return None
        offset += limit
    return None


def fetch_notes_by_category(
    audit_target: AuditTargetConfig,
    category: str,
    campaign_id: str | None = None,
) -> list[dict]:
    args = ["note", "list", "--category", category, "--limit", "500", "--offset", "0"]
    if campaign_id:
        args.extend(["--scope", "campaign", "--campaign-id", campaign_id])
    payload = run_cdm_read_command(audit_target, args)
    return payload.get("result", {}).get("content", {}).get("notes", [])


def fetch_tagged_node_ids(
    audit_target: AuditTargetConfig,
    tag: str,
    campaign_id: str | None = None,
) -> set[int]:
    if campaign_id:
        # Tags are currently graph-global in the client schema. Without a campaign
        # discriminator on tag records, they cannot be attributed to a specific
        # workflow run safely, so resume/validation must rely on campaign-scoped
        # notes instead of historical tag residue.
        return set()

    limit = 500
    offset = 0
    node_ids: set[int] = set()

    while True:
        payload = run_cdm_read_command(
            audit_target,
            ["tag", "find", "--tag", tag, "--limit", str(limit), "--offset", str(offset)],
        )
        result = payload.get("result", {})
        content = result.get("content")
        nodes = content if isinstance(content, list) else result.get("nodes", [])
        if not isinstance(nodes, list):
            nodes = []

        for node in nodes:
            if isinstance(node, dict) and isinstance(node.get("node_id"), int):
                node_ids.add(node["node_id"])

        metadata = payload.get("metadata", {})
        if not metadata.get("has_more"):
            return node_ids
        offset += limit


def detect_project_kind(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> str:
    note = fetch_note_by_title(audit_target, "ARCHITECTURE", "System_Overview", campaign_id=campaign_id)
    if note is None:
        return "unknown"
    content = note.get("content", "")
    try:
        parsed = json.loads(content) if content else {}
    except json.JSONDecodeError:
        return "unknown"
    deployment = str(parsed.get("deployment_context", "")).lower()
    if any(token in deployment for token in ("library", "sdk", "embeddable")):
        return "library"
    return "program"


def _parse_note_content_json(note: dict | None) -> dict:
    if note is None:
        return {}
    content = note.get("content", "")
    if not content:
        return {}
    try:
        parsed = json.loads(content)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _public_api_inventory_entries(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> list[dict]:
    note = fetch_note_by_title(
        audit_target,
        "ARCHITECTURE",
        "Public_API_Inventory",
        campaign_id=campaign_id,
    )
    parsed = _parse_note_content_json(note)
    entries: list[dict] = []
    consumer_profiles = parsed.get("consumer_profiles", {})
    if not isinstance(consumer_profiles, dict):
        return entries

    for profile_entries in consumer_profiles.values():
        if not isinstance(profile_entries, list):
            continue
        for entry in profile_entries:
            if isinstance(entry, dict):
                entries.append(entry)
    return entries


def _invalid_public_api_inventory_tags(entries: list[dict]) -> list[tuple[int, str]]:
    invalid: list[tuple[int, str]] = []
    for entry in entries:
        node_id = entry.get("node_id")
        tags = entry.get("tags", [])
        if not isinstance(node_id, int) or not isinstance(tags, list):
            continue
        for tag in tags:
            if not isinstance(tag, str):
                continue
            if tag.startswith("STATE:") or tag.startswith("SEMANTIC:VULN:"):
                invalid.append((node_id, tag))
    return invalid


def _high_risk_public_api_node_ids(entries: list[dict]) -> set[int]:
    public_prefixes = (
        "SEMANTIC:API:PUBLIC_EXPORTED",
        "SEMANTIC:API:PUBLIC_DECLARED",
        "SEMANTIC:API:DOCUMENTED_HOST_API",
    )
    functional_tags = {
        "SEMANTIC:API:CONFIGURATION",
        "SEMANTIC:API:STATEFUL_MUTATOR",
        "SEMANTIC:API:BULK_DATA_PROCESSOR",
        "SEMANTIC:API:CALLBACK_REGISTRATION",
    }

    node_ids: set[int] = set()
    for entry in entries:
        node_id = entry.get("node_id")
        tags = entry.get("tags", [])
        if not isinstance(node_id, int) or not isinstance(tags, list):
            continue
        tag_set = {tag for tag in tags if isinstance(tag, str)}
        if any(existing_tag.startswith(prefix) for existing_tag in tag_set for prefix in public_prefixes) and functional_tags & tag_set:
            node_ids.add(node_id)
    return node_ids


def _survey_handoff_hotspot_node_ids(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> set[int]:
    note = fetch_note_by_title(
        audit_target,
        "COORDINATION",
        "Survey_Handoff",
        campaign_id=campaign_id,
    )
    parsed = _parse_note_content_json(note)
    node_ids: set[int] = set()

    for item in parsed.get("target_nodes", []):
        if not isinstance(item, dict):
            continue
        if item.get("target_type") != "API_HOTSPOT":
            continue
        node_id = item.get("node_id")
        if isinstance(node_id, int):
            node_ids.add(node_id)

    message = parsed.get("message")
    if isinstance(message, str):
        try:
            message_parsed = json.loads(message)
        except json.JSONDecodeError:
            message_parsed = {}
        if isinstance(message_parsed, dict):
            for item in message_parsed.get("investigation_candidates", []):
                if not isinstance(item, dict):
                    continue
                node_id = item.get("node_id")
                if isinstance(node_id, int):
                    node_ids.add(node_id)

    return node_ids


def _nonempty_coverage_gap_from_survey_handoff(
    audit_target: AuditTargetConfig,
    campaign_id: str | None = None,
) -> str | None:
    note = fetch_note_by_title(
        audit_target,
        "COORDINATION",
        "Survey_Handoff",
        campaign_id=campaign_id,
    )
    parsed = _parse_note_content_json(note)
    message = parsed.get("message")
    if not isinstance(message, str):
        return None

    try:
        message_parsed = json.loads(message)
    except json.JSONDecodeError:
        return None
    if not isinstance(message_parsed, dict):
        return None

    coverage_gap = message_parsed.get("coverage_gap")
    if isinstance(coverage_gap, str) and coverage_gap.strip():
        return coverage_gap.strip()
    if isinstance(coverage_gap, list) and coverage_gap:
        return json.dumps(coverage_gap, ensure_ascii=False)
    if isinstance(coverage_gap, dict) and coverage_gap:
        return json.dumps(coverage_gap, ensure_ascii=False)
    return None


def validate_map_surveyor_outputs(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> str | None:
    note = fetch_note_by_title(
        audit_target,
        "COORDINATION",
        "Survey_Handoff",
        campaign_id=campaign_id,
    )
    if note is None:
        return "map-surveyor missing required note: Survey_Handoff"
    return None


def _hunter_summary_note(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> dict | None:
    note = fetch_note_by_title(
        audit_target,
        "COORDINATION",
        "Hunter 审计摘要",
        campaign_id=campaign_id,
    )
    if not isinstance(note, dict) or note.get("title") != "Hunter 审计摘要":
        return None
    return note


def _validate_hunter_summary_metrics(hunter_summary: dict | None) -> str | None:
    if hunter_summary is None:
        return None
    parsed = _parse_note_content_json(hunter_summary)
    metrics = parsed.get("metrics", {})
    if not isinstance(metrics, dict):
        return "vuln-hunter Hunter 审计摘要 metrics missing or invalid"

    if not isinstance(metrics.get("audited_targets_total"), int):
        return "vuln-hunter Hunter 审计摘要 metrics missing integer field: audited_targets_total"

    normalized_metrics = dict(metrics)
    count_fields = [
        "confirmed_vulns_critical",
        "confirmed_vulns_high",
        "confirmed_vulns_medium",
        "confirmed_vulns_low",
        "reviewed_clean_count",
        "false_positive_count",
        "suspicious_count",
    ]
    for field in count_fields:
        value = normalized_metrics.get(field, 0)
        if not isinstance(value, int):
            return f"vuln-hunter Hunter 审计摘要 metrics missing integer field: {field}"
        normalized_metrics[field] = value

    audited_total = normalized_metrics["audited_targets_total"] = metrics["audited_targets_total"]
    accounted_total = (
        normalized_metrics["confirmed_vulns_critical"]
        + normalized_metrics["confirmed_vulns_high"]
        + normalized_metrics["confirmed_vulns_medium"]
        + normalized_metrics["confirmed_vulns_low"]
        + normalized_metrics["reviewed_clean_count"]
        + normalized_metrics["false_positive_count"]
        + normalized_metrics["suspicious_count"]
    )
    if accounted_total != audited_total:
        return (
            "vuln-hunter Hunter 审计摘要 metrics are inconsistent: "
            f"audited_targets_total={audited_total}, accounted_total={accounted_total}"
        )

    note_node_ids = hunter_summary.get("node_ids", []) if isinstance(hunter_summary, dict) else []
    unique_note_node_ids = {
        node_id for node_id in note_node_ids
        if isinstance(node_id, int)
    }
    if unique_note_node_ids and len(unique_note_node_ids) < audited_total:
        return (
            "vuln-hunter Hunter 审计摘要 node_ids do not cover audited_targets_total: "
            f"node_ids={len(unique_note_node_ids)}, audited_targets_total={audited_total}"
        )
    return None


def validate_system_analyst_outputs(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> str | None:
    required = [
        ("ARCHITECTURE", "System_Overview"),
        ("ARCHITECTURE", "Entry_Inventory"),
        ("ARCHITECTURE", "Asset_Inventory"),
        ("SECURITY_BOUNDARY", "Trust_Map"),
    ]
    for category, title in required:
        if fetch_note_by_title(audit_target, category, title, campaign_id=campaign_id) is None:
            return f"system-analyst missing required note: {title}"

    if detect_project_kind(audit_target, campaign_id=campaign_id) == "library":
        public_api_note = fetch_note_by_title(
            audit_target,
            "ARCHITECTURE",
            "Public_API_Inventory",
            campaign_id=campaign_id,
        )
        if public_api_note is None:
            return "system-analyst missing required note for library project: Public_API_Inventory"

        public_api_entries = _public_api_inventory_entries(audit_target, campaign_id=campaign_id)
        invalid_tags = _invalid_public_api_inventory_tags(public_api_entries)
        if invalid_tags:
            node_id, tag = invalid_tags[0]
            return (
                "system-analyst Public_API_Inventory must remain semantic-only and "
                f"must not carry review/vulnerability tags: node {node_id} has {tag}"
            )

        expected_hotspots = _high_risk_public_api_node_ids(public_api_entries)
        covered_hotspots = _survey_handoff_hotspot_node_ids(audit_target, campaign_id=campaign_id)
        missing_hotspots = sorted(expected_hotspots - covered_hotspots)
        if missing_hotspots:
            # Survey_Handoff hotspot overlap is useful audit hygiene, but it should not
            # block the workflow once System Analyst has produced the required artifacts.
            # Downstream Hunter validation still enforces CDM evidence on these APIs.
            return None
    return None


def validate_stride_analyst_outputs(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> str | None:
    note = fetch_note_by_title(audit_target, "ARCHITECTURE", "STRIDE_Matrix", campaign_id=campaign_id)
    if note is None:
        return "stride-analyst missing required note: STRIDE_Matrix"

    content = note.get("content", "")
    try:
        parsed = json.loads(content) if content else {}
    except json.JSONDecodeError:
        return "stride-analyst produced invalid STRIDE_Matrix JSON"

    if detect_project_kind(audit_target, campaign_id=campaign_id) == "library":
        elements = parsed.get("elements", [])
        has_public_api = any(
            element.get("element_type") == "PUBLIC_API"
            for element in elements
            if isinstance(element, dict)
        )
        if not has_public_api:
            return "stride-analyst missing PUBLIC_API rows in STRIDE_Matrix for library project"
    return None


def _public_api_node_ids(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> set[int]:
    note = fetch_note_by_title(
        audit_target,
        "ARCHITECTURE",
        "Public_API_Inventory",
        campaign_id=campaign_id,
    )
    if note is None:
        return set()
    content = note.get("content", "")
    try:
        parsed = json.loads(content) if content else {}
    except json.JSONDecodeError:
        return set()

    node_ids: set[int] = set()
    consumer_profiles = parsed.get("consumer_profiles", {})
    if isinstance(consumer_profiles, dict):
        for entries in consumer_profiles.values():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if isinstance(entry, dict) and isinstance(entry.get("node_id"), int):
                    node_ids.add(entry["node_id"])
    return node_ids


def validate_vuln_hunter_outputs(audit_target: AuditTargetConfig, campaign_id: str | None = None) -> str | None:
    if detect_project_kind(audit_target, campaign_id=campaign_id) != "library":
        return None

    public_api_nodes = _public_api_node_ids(audit_target, campaign_id=campaign_id)
    if not public_api_nodes:
        return "vuln-hunter validation blocked: Public_API_Inventory has no API nodes"

    summary_error = _validate_hunter_summary_metrics(
        _hunter_summary_note(audit_target, campaign_id=campaign_id)
    )
    if summary_error:
        return summary_error

    hunter_notes: list[dict] = []
    for category in ("COORDINATION", "VULNERABILITY"):
        for note in fetch_notes_by_category(audit_target, category, campaign_id=campaign_id):
            source = str(note.get("source", "")).lower()
            title = str(note.get("title", ""))
            if "hunter" in source or "Hunter" in title:
                hunter_notes.append(note)

    covered_public_api_nodes: set[int] = set()
    for note in hunter_notes:
        note_node_ids = {
            node_id for node_id in note.get("node_ids", [])
            if isinstance(node_id, int)
        }
        covered_public_api_nodes.update(public_api_nodes & note_node_ids)

    for state_tag in (
        "STATE:CONFIRMED_VULN",
        "STATE:SUSPICIOUS",
        "STATE:FALSE_POSITIVE",
        "STATE:REVIEWED",
    ):
        try:
            tagged_node_ids = fetch_tagged_node_ids(audit_target, state_tag, campaign_id=campaign_id)
        except TypeError:
            tagged_node_ids = fetch_tagged_node_ids(audit_target, state_tag)
        covered_public_api_nodes.update(
            public_api_nodes & tagged_node_ids
        )

    if not covered_public_api_nodes:
        return (
            "vuln-hunter missing CDM evidence on Public_API_Inventory nodes for library project"
        )
    return None


def validate_agent_outputs(
    agent: AgentRole,
    audit_target: AuditTargetConfig,
    campaign_id: str | None = None,
) -> str | None:
    if agent.id == "map-surveyor" and audit_target.mode == "remote":
        return validate_map_surveyor_outputs(audit_target, campaign_id=campaign_id)
    if agent.id == "system-analyst":
        return validate_system_analyst_outputs(audit_target, campaign_id=campaign_id)
    if agent.id == "stride-analyst":
        return validate_stride_analyst_outputs(audit_target, campaign_id=campaign_id)
    if agent.id == "vuln-hunter":
        return validate_vuln_hunter_outputs(audit_target, campaign_id=campaign_id)
    return None


def resume_validation_error(
    agent: AgentRole,
    audit_target: AuditTargetConfig,
    campaign_id: str,
) -> str | None:
    if agent.id == "map-surveyor":
        if fetch_note_by_title(audit_target, "COORDINATION", "Survey_Handoff", campaign_id=campaign_id) is None:
            return "map-surveyor missing required note: Survey_Handoff"
        return None
    if agent.id == "map-repairer":
        if fetch_note_by_title(audit_target, "COORDINATION", "Repairer_Report", campaign_id=campaign_id) is None:
            return "map-repairer missing required note: Repairer_Report"
        return None
    if agent.id == "system-analyst":
        validation_error = validate_system_analyst_outputs(audit_target, campaign_id=campaign_id)
        if validation_error:
            return validation_error
        if fetch_note_by_title(audit_target, "COORDINATION", "SystemAnalysis_Handoff", campaign_id=campaign_id) is None:
            return "system-analyst missing required note: SystemAnalysis_Handoff"
        return None
    if agent.id == "stride-analyst":
        validation_error = validate_stride_analyst_outputs(audit_target, campaign_id=campaign_id)
        if validation_error:
            return validation_error
        if fetch_note_by_title(audit_target, "COORDINATION", "Stride_Handoff", campaign_id=campaign_id) is None:
            return "stride-analyst missing required note: Stride_Handoff"
        return None
    if agent.id == "vuln-hunter":
        validation_error = validate_vuln_hunter_outputs(audit_target, campaign_id=campaign_id)
        if validation_error:
            return validation_error
        if fetch_note_by_title(audit_target, "COORDINATION", "Hunter 审计摘要", campaign_id=campaign_id) is None:
            return "vuln-hunter missing required note: Hunter 审计摘要"
        return None
    return None


def should_resume_skip_agent(
    agent: AgentRole,
    audit_target: AuditTargetConfig,
    campaign_id: str,
) -> bool:
    if agent.status != "done":
        return False

    if audit_target.mode != "remote":
        return True

    validation_error = resume_validation_error(agent, audit_target, campaign_id)
    if validation_error is None:
        return True

    agent.status = "pending"
    agent.error = f"resume validation failed: {validation_error}"
    agent.finished_at = None
    return False


def run_agent(agent: AgentRole, source_path: Path, audit_target: AuditTargetConfig,
              completed_agents: dict[str, AgentRole], sdir: Path,
              backend: BackendAdapter, campaign_id: str = "cmp_default") -> AgentRole:
    """Run one agent through the selected backend."""
    agent.status = "running"
    agent.started_at = datetime.now(timezone.utc).isoformat()
    save_agent_state(sdir, agent)

    task_prompt = _call_render_prompt(
        backend, agent, source_path, audit_target, completed_agents, campaign_id
    )
    output_path = sdir / f"{agent.id}.{backend.name}.last_message.txt"
    cmd = backend.build_command(
        task_prompt,
        source_path,
        output_path,
        agent,
        audit_target,
    )
    child_env = build_subprocess_env(agent, audit_target, campaign_id)
    print(f"[{agent.id}] 启动 (phase={agent.phase}, backend={backend.name})")

    try:
        result = subprocess.run(
            cmd,
            input=task_prompt if backend.name == "codex" else None,
            capture_output=True, text=True,
            timeout=agent.timeout_minutes * 60,
            cwd=str(source_path),
            env=child_env,
        )

        agent.finished_at = datetime.now(timezone.utc).isoformat()
        response_text = backend.extract_response_text(result, output_path)
        persist_subprocess_diagnostics(
            sdir,
            agent,
            backend.name,
            result.stdout or "",
            result.stderr or "",
            response_text or "",
        )

        if result.returncode == 0:
            agent.summary = extract_summary(response_text)
            write_failure = None
            if audit_target.mode == "remote":
                write_failure = remote_write_failure_reason(agent.summary, response_text)

            if write_failure:
                agent.status = "failed"
                agent.error = write_failure
                print(f"[{agent.id}] 失败: {agent.error[:200]}")
            else:
                agent.status = "done"
                agent.error = None
                print(f"[{agent.id}] 完成")
        else:
            agent.status = "failed"
            failure_text = result.stderr[-500:] if result.stderr else response_text[-500:]
            agent.error = failure_text
            print(f"[{agent.id}] 失败: {agent.error[:200]}")

    except subprocess.TimeoutExpired:
        agent.status = "failed"
        agent.error = f"超时 ({agent.timeout_minutes}min)"
        agent.finished_at = datetime.now(timezone.utc).isoformat()
        print(f"[{agent.id}] 超时")

    save_agent_state(sdir, agent)
    return agent


# ---------------------------------------------------------------------------
# Workflow orchestration
# ---------------------------------------------------------------------------

def resolve_execution_order(agents: list[AgentRole]) -> list[list[AgentRole]]:
    phases: dict[int, list[AgentRole]] = {}
    for a in agents:
        phases.setdefault(a.phase, []).append(a)
    return [phases[p] for p in sorted(phases.keys())]


def run_workflow(agents: list[AgentRole], source_path: Path, audit_target: AuditTargetConfig,
                 sdir: Path, backend: BackendAdapter, campaign_id: str = "cmp_default", max_parallel: int = 3,
                 check_deps: bool = True):
    completed: dict[str, AgentRole] = {}
    waves = resolve_execution_order(agents)

    print(f"\n{'='*60}")
    print(f"工作流启动: {len(agents)} 个 Agent, {len(waves)} 个阶段")
    print(f"campaign_id: {campaign_id}")
    if not check_deps:
        print("(--only 模式: 跳过依赖检查)")
    print(f"{'='*60}\n")

    for i, wave in enumerate(waves):
        active = [a for a in wave if a.status != "done"]
        skipped = [a for a in wave if a.status == "done"]

        for a in skipped:
            completed[a.id] = a
            print(f"[{a.id}] 跳过（已完成）")

        if not active:
            continue

        if check_deps:
            for a in active:
                missing = [d for d in a.depends_on if d not in completed]
                if missing:
                    a.status = "skipped"
                    a.error = f"缺少依赖: {missing}"
                    save_agent_state(sdir, a)
                    print(f"[{a.id}] 跳过（依赖未满足: {missing}）")

        runnable = [a for a in active if a.status == "pending"]
        if not runnable:
            continue

        phase_num = runnable[0].phase
        print(f"\n--- Phase {phase_num}: {', '.join(a.id for a in runnable)} ---\n")

        if len(runnable) == 1:
            agent = _call_run_agent(
                runnable[0], source_path, audit_target, completed, sdir, backend, campaign_id
            )
            completed[agent.id] = agent
        else:
            with ThreadPoolExecutor(max_workers=min(len(runnable), max_parallel)) as pool:
                futures = {
                    pool.submit(
                        _call_run_agent,
                        a,
                        source_path,
                        audit_target,
                        completed,
                        sdir,
                        backend,
                        campaign_id,
                    ): a
                    for a in runnable
                }
                for future in as_completed(futures):
                    agent = future.result()
                    completed[agent.id] = agent

        phase_results = [completed[a.id] for a in runnable if a.id in completed]
        for agent in phase_results:
            if agent.status != "done":
                continue
            validation_error = validate_agent_outputs(
                agent,
                audit_target,
                campaign_id=campaign_id,
            )
            if validation_error:
                agent.status = "failed"
                agent.error = validation_error
                if agent.id == "map-surveyor" and "Survey_Handoff" in validation_error:
                    diagnostics = map_surveyor_note_diagnostics(sdir)
                    if diagnostics:
                        agent.error = f"{validation_error} [{diagnostics}]"
                save_agent_state(sdir, agent)
        print_phase_summary(phase_num, phase_results)
        if any(agent.status != "done" for agent in phase_results):
            print(f"\n[STOP] Phase {phase_num} 未全部成功完成，工作流终止。")
            break

    return completed


def print_phase_summary(phase_num: int, agents: list[AgentRole]):
    print(f"\n[+] Phase {phase_num} 摘要")
    for agent in agents:
        icon = {"done": "+", "failed": "!", "skipped": "-"}.get(agent.status, "?")
        print(f"    [{icon}] {agent.id} ({agent.status})")
        if agent.summary:
            for line in agent.summary.splitlines()[:3]:
                print(f"        {line}")
        if agent.error:
            print(f"        ERROR: {agent.error[:200]}")


def print_report(completed: dict[str, AgentRole]):
    print(f"\n{'='*60}")
    print("审计工作流报告")
    print(f"{'='*60}\n")

    for agent in sorted(completed.values(), key=lambda a: a.id):
        icon = {"done": "+", "failed": "!", "skipped": "-"}.get(agent.status, "?")
        print(f"[{icon}] {agent.id} ({agent.status})")
        if agent.summary:
            for line in agent.summary.splitlines()[:3]:
                print(f"    {line}")
        if agent.error:
            print(f"    ERROR: {agent.error[:200]}")
        print()

    done = sum(1 for a in completed.values() if a.status == "done")
    total = len(completed)
    print(f"完成: {done}/{total}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="CodeDMap 多 Agent 审计工作流",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("source", type=Path, help="审计目标源码目录")
    parser.add_argument("--db", help="本地 CDM 数据库路径")
    parser.add_argument("--cpg-server", help="远程 CPG server 地址，例如 http://127.0.0.1:8000")
    parser.add_argument("--cpg-api-key", help="远程 CPG server API key（可选）")
    parser.add_argument("--agents-dir", type=Path, default=Path(".claude/agents"),
                        help="角色定义目录 (默认: .claude/agents/)")
    parser.add_argument("--backend", choices=["claude", "codex", "opencode"], default="claude",
                        help="执行后端 (默认: claude)")
    parser.add_argument("--only", nargs="+", help="只运行指定角色")
    parser.add_argument("--resume", action="store_true", help="从断点恢复")
    parser.add_argument("--resume-campaign", help="恢复指定 campaign_id")
    parser.add_argument("--list-campaigns", action="store_true", help="列出当前 source+target 的已有 campaigns")
    parser.add_argument("--clean", action="store_true", help="清除状态重新开始")
    parser.add_argument("--parallel", type=int, default=3, help="最大并行 Agent 数")
    parser.add_argument("--dry-run", action="store_true", help="只打印执行计划不实际运行")

    args = parser.parse_args()
    source_path = args.source.resolve()
    backend = create_backend_adapter(args.backend)
    try:
        audit_target = resolve_audit_target(args)
    except ValueError as exc:
        parser.error(str(exc))

    root = state_root_for(source_path, audit_target)

    if args.list_campaigns:
        campaigns = list_campaign_ids(root)
        if not campaigns:
            print("[INFO] 当前 source+target 下没有可恢复的 campaign")
            return
        latest = latest_campaign_file(root).read_text(encoding="utf-8").strip() if latest_campaign_file(root).exists() else None
        print(f"Campaigns for {source_path.name} / {audit_target.label}:")
        for campaign in campaigns:
            marker = " (latest)" if campaign == latest else ""
            print(f"  {campaign}{marker}")
        return

    try:
        campaign_id = resolve_campaign_id(
            root,
            resume=args.resume,
            resume_campaign=args.resume_campaign,
        )
    except ValueError as exc:
        parser.error(str(exc))

    sdir = campaign_state_dir(root, campaign_id)

    if args.clean and sdir.exists():
        import shutil
        shutil.rmtree(sdir)
        campaign_state_dir(root, campaign_id)
        print(f"[CLEAN] 已清除 campaign 状态: {campaign_id}")

    # 加载角色（只读 frontmatter 中的编排字段）
    agents = load_agents(args.agents_dir)
    if not agents:
        print(f"[ERROR] 在 {args.agents_dir} 中未找到角色文件")
        print("角色文件需要 YAML frontmatter，包含 name 和 phase 字段")
        sys.exit(1)

    if args.only:
        agents = [a for a in agents if a.id in args.only]
        if not agents:
            print(f"[ERROR] 未找到指定角色: {args.only}")
            sys.exit(1)

    if args.resume or args.resume_campaign:
        for a in agents:
            if load_agent_state(sdir, a):
                if should_resume_skip_agent(a, audit_target, campaign_id):
                    print(f"[RESUME] {a.id} 已完成，跳过")
                else:
                    save_agent_state(sdir, a)
                    print(f"[RESUME] {a.id} 远端产物校验失败，改为重跑")

    if args.dry_run:
        waves = resolve_execution_order(agents)
        print(f"\n执行计划: {len(agents)} 个 Agent, {len(waves)} 个阶段\n")
        if audit_target.mode == "remote":
            print(f"审计目标: remote server {audit_target.cpg_server}\n")
        else:
            print(f"审计目标: local db {audit_target.db_path}\n")
        for wave in waves:
            phase = wave[0].phase
            names = ", ".join(f"{a.id}(timeout={a.timeout_minutes}m)" for a in wave)
            deps = set()
            for a in wave:
                deps.update(a.depends_on)
            dep_str = f" [依赖: {', '.join(deps)}]" if deps else ""
            print(f"  Phase {phase}: {names}{dep_str}")
        if backend.name == "claude":
            print("\n每个 Agent 通过 `claude -p --agent <name>` 调用")
        elif backend.name == "opencode":
            print("\n每个 Agent 通过 `opencode -p` 调用，并由编排器显式注入角色定义")
        else:
            print("\n每个 Agent 通过 `codex exec` 调用，并由编排器显式注入角色定义")
        return

    check_deps = not bool(args.only)  # --only 模式跳过依赖检查
    completed = run_workflow(agents, source_path, audit_target, sdir, backend, campaign_id, args.parallel, check_deps)
    print_report(completed)


if __name__ == "__main__":
    main()
