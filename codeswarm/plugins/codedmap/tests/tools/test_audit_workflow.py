from __future__ import annotations

import importlib.util
import json
import sys
from argparse import Namespace
from pathlib import Path


def _load_module():
    root = Path(__file__).resolve().parents[2]
    mod_path = root / "tools" / "audit_workflow.py"
    spec = importlib.util.spec_from_file_location("audit_workflow", mod_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def _sample_agent(mod):
    return mod.AgentRole(
        id="map-surveyor",
        phase=1,
        depends_on=["system-analyst"],
        timeout_minutes=45,
        source_file=Path(".claude/agents/01-map-surveyor.md"),
        system_prompt="# Map Surveyor\n\n你是地图勘测员。",
    )


def _load_agent_by_id(mod, agent_id: str):
    agents = mod.load_agents(Path(".claude/agents"))
    for agent in agents:
        if agent.id == agent_id:
            return agent
    raise AssertionError(f"agent not found: {agent_id}")


def test_codex_prompt_includes_role_definition_and_upstream_outputs():
    mod = _load_module()
    agent = _sample_agent(mod)
    upstream = mod.AgentRole(
        id="system-analyst",
        phase=0,
        depends_on=[],
        timeout_minutes=30,
        source_file=Path(".claude/agents/03-system-analyst.md"),
        summary="已识别 3 个关键入口点。",
    )
    adapter = mod.CodexBackendAdapter()

    prompt = adapter.render_prompt(
        agent=agent,
        source_path=Path("/repo/src"),
        audit_target=mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db"),
        completed_agents={"system-analyst": upstream},
    )

    assert "# Role Definition" in prompt
    assert "你是地图勘测员" in prompt
    assert "# Upstream Outputs" in prompt
    assert "已识别 3 个关键入口点" in prompt
    assert "=== AGENT_SUMMARY ===" in prompt


def test_codex_command_uses_exec_with_workspace_and_output_file(tmp_path):
    mod = _load_module()
    adapter = mod.CodexBackendAdapter()

    command = adapter.build_command(
        prompt="test prompt",
        source_path=Path("/repo/src"),
        output_path=tmp_path / "codex-last.txt",
        audit_target=mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db"),
    )

    assert command[:6] == [
        "codex",
        "-a",
        "never",
        "-s",
        "workspace-write",
        "exec",
    ]
    assert "-C" in command
    assert "/repo/src" in command
    assert "-o" in command
    assert str(tmp_path / "codex-last.txt") in command
    assert command[-1] == "-"


def test_codex_remote_command_uses_unsandboxed_exec_for_remote_mode(tmp_path):
    mod = _load_module()
    adapter = mod.CodexBackendAdapter()

    command = adapter.build_command(
        prompt="test prompt",
        source_path=Path("/repo/src"),
        output_path=tmp_path / "codex-last.txt",
        audit_target=mod.AuditTargetConfig(
            mode="remote",
            label="127.0.0.1:8000",
            cpg_server="http://127.0.0.1:8000",
        ),
    )

    assert command[:3] == [
        "codex",
        "--dangerously-bypass-approvals-and-sandbox",
        "exec",
    ]
    assert "-a" not in command
    assert "--ask-for-approval" not in command
    assert "-s" not in command
    assert "-c" not in command


def test_build_subprocess_env_for_remote_target_sets_server_and_agent_id():
    mod = _load_module()
    agent = _sample_agent(mod)
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
        cpg_api_key="secret",
    )

    env = mod.build_subprocess_env(agent, target, campaign_id="cmp_123")

    assert env["CPG_SERVER"] == "http://127.0.0.1:8000"
    assert env["CPG_API_KEY"] == "secret"
    assert env["CPG_AGENT_ID"] == "map-surveyor"
    assert env["CPG_CAMPAIGN_ID"] == "cmp_123"
    assert "CDM_DB" not in env


def test_generate_campaign_id_uses_utc_date_prefix():
    mod = _load_module()
    campaign_id = mod.generate_campaign_id()
    assert campaign_id.startswith("cmp_")


def test_resolve_campaign_id_new_run_creates_campaign_dir_and_updates_latest(tmp_path):
    mod = _load_module()
    root = tmp_path / "state-root"

    campaign_id = mod.resolve_campaign_id(root, resume=False)

    assert campaign_id.startswith("cmp_")
    assert (root / "latest_campaign.txt").read_text(encoding="utf-8").strip() == campaign_id
    assert (root / campaign_id).is_dir()


def test_resolve_campaign_id_resume_uses_latest_campaign(tmp_path):
    mod = _load_module()
    root = tmp_path / "state-root"
    root.mkdir(parents=True)
    (root / "cmp_old").mkdir()
    (root / "cmp_new").mkdir()
    (root / "latest_campaign.txt").write_text("cmp_new\n", encoding="utf-8")

    campaign_id = mod.resolve_campaign_id(root, resume=True)

    assert campaign_id == "cmp_new"


def test_resolve_campaign_id_resume_campaign_uses_explicit_campaign(tmp_path):
    mod = _load_module()
    root = tmp_path / "state-root"
    root.mkdir(parents=True)
    (root / "cmp_old").mkdir()
    (root / "cmp_target").mkdir()
    (root / "latest_campaign.txt").write_text("cmp_old\n", encoding="utf-8")

    campaign_id = mod.resolve_campaign_id(root, resume=True, resume_campaign="cmp_target")

    assert campaign_id == "cmp_target"
    assert (root / "latest_campaign.txt").read_text(encoding="utf-8").strip() == "cmp_old"


def test_campaign_state_files_are_isolated_per_campaign(tmp_path):
    mod = _load_module()
    root = tmp_path / "state-root"
    agent = _sample_agent(mod)

    cmp_a = mod.campaign_state_dir(root, "cmp_a")
    cmp_b = mod.campaign_state_dir(root, "cmp_b")

    agent.status = "done"
    agent.summary = "campaign a"
    mod.save_agent_state(cmp_a, agent)

    other = _sample_agent(mod)
    other.status = "done"
    other.summary = "campaign b"
    mod.save_agent_state(cmp_b, other)

    loaded_a = _sample_agent(mod)
    loaded_b = _sample_agent(mod)

    assert mod.load_agent_state(cmp_a, loaded_a) is True
    assert mod.load_agent_state(cmp_b, loaded_b) is True
    assert loaded_a.summary == "campaign a"
    assert loaded_b.summary == "campaign b"


def test_list_campaign_ids_returns_sorted_campaign_directories(tmp_path):
    mod = _load_module()
    root = tmp_path / "state-root"
    root.mkdir(parents=True)
    (root / "cmp_20260408T010000Z").mkdir()
    (root / "cmp_20260408T030000Z").mkdir()
    (root / "cmp_20260408T020000Z").mkdir()
    (root / "latest_campaign.txt").write_text("cmp_20260408T030000Z\n", encoding="utf-8")
    (root / "notes.txt").write_text("ignore", encoding="utf-8")

    campaigns = mod.list_campaign_ids(root)

    assert campaigns == [
        "cmp_20260408T010000Z",
        "cmp_20260408T020000Z",
        "cmp_20260408T030000Z",
    ]


def test_build_task_context_mentions_current_campaign():
    mod = _load_module()
    target = mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db")
    context = mod.build_task_context(
        Path("/repo/src"),
        target,
        campaign_id="cmp_123",
    )
    assert "cmp_123" in context
    assert "scope=campaign" not in context


def test_build_execution_contract_centralizes_campaign_runtime_rules():
    mod = _load_module()

    contract = mod.build_execution_contract(campaign_id="cmp_123")

    assert "cmp_123" in contract
    assert "scope=campaign" in contract
    assert "CPG_CAMPAIGN_ID" in contract
    assert "不要自行发明、覆盖或重写" in contract


def test_build_execution_contract_centralizes_workspace_and_backend_runtime_rules():
    mod = _load_module()

    contract = mod.build_execution_contract(campaign_id="cmp_123")

    assert "cwd" in contract
    assert "源码根目录" in contract
    assert "cdm-local" not in contract
    assert "workflow 提供的 CDM 访问方式" in contract


def test_agent_role_definitions_do_not_encode_runtime_backend_or_cwd_rules():
    mod = _load_module()

    for agent_id in [
        "map-surveyor",
        "map-repairer",
        "system-analyst",
        "stride-analyst",
        "vuln-hunter",
    ]:
        agent = _load_agent_by_id(mod, agent_id)
        prompt = agent.system_prompt
        assert "默认 cwd 为被审计项目的源码根目录" not in prompt
        assert "cdm-local skill" not in prompt
        assert "cdm skill" not in prompt


def test_validate_cli_args_requires_audit_target():
    mod = _load_module()
    args = Namespace(db=None, cpg_server=None, cpg_api_key=None)

    try:
        mod.resolve_audit_target(args)
    except ValueError as exc:
        assert "one of --db or --cpg-server" in str(exc).lower()
    else:
        raise AssertionError("expected missing audit target to be rejected")


def test_validate_cli_args_builds_remote_target_without_db():
    mod = _load_module()
    args = Namespace(db=None, cpg_server="http://127.0.0.1:8000", cpg_api_key=None)

    target = mod.resolve_audit_target(args)

    assert target.mode == "remote"
    assert target.db_path is None
    assert target.cpg_server == "http://127.0.0.1:8000"
    assert "127.0.0.1" in target.label


def test_codex_remote_prompt_forbids_build_and_upload_operations():
    mod = _load_module()
    agent = _sample_agent(mod)
    adapter = mod.CodexBackendAdapter()

    prompt = adapter.render_prompt(
        agent=agent,
        source_path=Path("/repo/src"),
        audit_target=mod.AuditTargetConfig(
            mode="remote",
            label="127.0.0.1:8000",
            cpg_server="http://127.0.0.1:8000",
        ),
        completed_agents={},
    )

    lowered = prompt.lower()
    assert "build start" in lowered
    assert "build enhance" in lowered
    assert "upload" in lowered
    assert "禁止" in prompt


def test_claude_command_uses_agent_flag_and_text_output():
    mod = _load_module()
    agent = _sample_agent(mod)
    adapter = mod.ClaudeBackendAdapter()

    command = adapter.build_command(
        prompt="workflow prompt",
        source_path=Path("/repo/src"),
        output_path=Path("/tmp/ignored.txt"),
        agent=agent,
    )

    assert command[:3] == ["claude", "-p", "workflow prompt"]
    assert "--agent" in command
    assert "map-surveyor" in command
    assert "--output-format" in command
    assert "text" in command


def test_create_backend_adapter_rejects_unknown_backend():
    mod = _load_module()

    try:
        mod.create_backend_adapter("unknown")
    except ValueError as exc:
        assert "unknown backend" in str(exc).lower()
    else:
        raise AssertionError("expected create_backend_adapter to reject unknown backend")


def test_run_workflow_prints_phase_summary_after_phase_completion(tmp_path, capsys, monkeypatch):
    mod = _load_module()
    agent = mod.AgentRole(
        id="map-surveyor",
        phase=1,
        depends_on=[],
        timeout_minutes=30,
        source_file=Path(".claude/agents/01-map-surveyor.md"),
        system_prompt="# Map Surveyor",
    )
    target = mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db")

    def fake_run_agent(agent, source_path, audit_target, completed_agents, sdir, backend):
        del source_path, audit_target, completed_agents, sdir, backend
        agent.status = "done"
        agent.summary = "完成 2 次查询\n写入 1 条 note"
        return agent

    monkeypatch.setattr(mod, "run_agent", fake_run_agent)

    completed = mod.run_workflow(
        agents=[agent],
        source_path=tmp_path,
        audit_target=target,
        sdir=tmp_path,
        backend=mod.CodexBackendAdapter(),
    )

    assert completed["map-surveyor"].summary == "完成 2 次查询\n写入 1 条 note"
    stdout = capsys.readouterr().out
    assert "--- Phase 1: map-surveyor ---" in stdout
    assert "[+] Phase 1 摘要" in stdout
    assert "[+] map-surveyor (done)" in stdout
    assert "完成 2 次查询" in stdout


def test_map_surveyor_prompt_mentions_public_api_surface_for_library_projects():
    mod = _load_module()
    agent = _load_agent_by_id(mod, "map-surveyor")
    adapter = mod.CodexBackendAdapter()

    prompt = adapter.render_prompt(
        agent=agent,
        source_path=Path("/repo/src"),
        audit_target=mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db"),
        completed_agents={},
    )

    assert "SEMANTIC:API:PUBLIC_EXPORTED" in prompt
    assert "Public_API_Inventory" in prompt
    assert "library / sdk" in prompt


def test_system_analyst_prompt_mentions_public_api_inventory():
    mod = _load_module()
    agent = _load_agent_by_id(mod, "system-analyst")
    adapter = mod.CodexBackendAdapter()

    prompt = adapter.render_prompt(
        agent=agent,
        source_path=Path("/repo/src"),
        audit_target=mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db"),
        completed_agents={},
    )

    assert "Public_API_Inventory" in prompt
    assert "SEMANTIC:API:PUBLIC_" in prompt
    assert "HOST_APPLICATION" in prompt
    assert "不要把 STATE:" in prompt
    assert "SEMANTIC:VULN:" in prompt


def test_vuln_hunter_prompt_mentions_public_api_hotspot_sweep():
    mod = _load_module()
    agent = _load_agent_by_id(mod, "vuln-hunter")
    adapter = mod.CodexBackendAdapter()

    prompt = adapter.render_prompt(
        agent=agent,
        source_path=Path("/repo/src"),
        audit_target=mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db"),
        completed_agents={},
    )

    assert "Public_API_Inventory" in prompt
    assert "API hotspot" in prompt
    assert "SEMANTIC:API:STATEFUL_MUTATOR" in prompt
    assert "STATE:REVIEWED" in prompt
    assert "证伪上游嫌疑" in prompt
    assert "Hunter 审计摘要" in prompt
    assert "绑定为 node_ids" in prompt
    assert "Public_API_Inventory" in prompt
    assert "历史 STATE:" in prompt
    assert "helper" in prompt


def test_stride_analyst_prompt_mentions_public_api_inventory_and_library_branch():
    mod = _load_module()
    agent = _load_agent_by_id(mod, "stride-analyst")
    adapter = mod.CodexBackendAdapter()

    prompt = adapter.render_prompt(
        agent=agent,
        source_path=Path("/repo/src"),
        audit_target=mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db"),
        completed_agents={},
    )

    assert "Public_API_Inventory" in prompt
    assert "PUBLIC_API" in prompt
    assert "先判断项目更像 library / sdk" in prompt


def test_phase_summary_prints_error_when_agent_fails(tmp_path, capsys, monkeypatch):
    mod = _load_module()
    agent = mod.AgentRole(
        id="map-repairer",
        phase=2,
        depends_on=[],
        timeout_minutes=30,
        source_file=Path(".claude/agents/02-map-repairer.md"),
        system_prompt="# Map Repairer",
    )
    target = mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db")

    def fake_run_agent(agent, source_path, audit_target, completed_agents, sdir, backend):
        del source_path, audit_target, completed_agents, sdir, backend
        agent.status = "failed"
        agent.error = "DB_CONNECTION_ERROR"
        return agent

    monkeypatch.setattr(mod, "run_agent", fake_run_agent)

    mod.run_workflow(
        agents=[agent],
        source_path=tmp_path,
        audit_target=target,
        sdir=tmp_path,
        backend=mod.CodexBackendAdapter(),
    )

    stdout = capsys.readouterr().out
    assert "[+] Phase 2 摘要" in stdout
    assert "[!] map-repairer (failed)" in stdout
    assert "ERROR: DB_CONNECTION_ERROR" in stdout


def test_run_agent_marks_remote_zero_write_summary_as_failed(tmp_path, monkeypatch):
    mod = _load_module()
    agent = _sample_agent(mod)
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    class StubBackend(mod.BackendAdapter):
        name = "stub"

        def render_prompt(self, agent, source_path, audit_target, completed_agents):
            del agent, source_path, audit_target, completed_agents
            return "prompt"

        def build_command(self, prompt, source_path, output_path, agent=None, audit_target=None):
            del prompt, source_path, output_path, agent, audit_target
            return ["fake-cmd"]

    def fake_run(cmd, input=None, capture_output=None, text=None, timeout=None, cwd=None, env=None):
        del cmd, input, capture_output, text, timeout, cwd, env
        return mod.subprocess.CompletedProcess(
            args=["fake-cmd"],
            returncode=0,
            stdout=(
                "=== AGENT_SUMMARY ===\n"
                "所有调用均因 DB_CONNECTION_ERROR 失败，未能把任何模块、标签、规则或笔记写入 CDM 数据库。\n"
                "本次没有执行成功的 CDM 写操作，因此模块数、标签数、规则数、修复断链数均为 0。\n"
                "=== END_SUMMARY ===\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(mod.subprocess, "run", fake_run)

    result = mod.run_agent(
        agent=agent,
        source_path=tmp_path,
        audit_target=target,
        completed_agents={},
        sdir=tmp_path,
        backend=StubBackend(),
    )

    assert result.status == "failed"
    assert "CDM write" in result.error


def test_run_agent_allows_remote_note_writes_even_when_repair_writes_fail(tmp_path, monkeypatch):
    mod = _load_module()
    agent = _sample_agent(mod)
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    class StubBackend(mod.BackendAdapter):
        name = "stub"

        def render_prompt(self, agent, source_path, audit_target, completed_agents):
            del agent, source_path, audit_target, completed_agents
            return "prompt"

        def build_command(self, prompt, source_path, output_path, agent=None, audit_target=None):
            del prompt, source_path, output_path, agent, audit_target
            return ["fake-cmd"]

    def fake_run(cmd, input=None, capture_output=None, text=None, timeout=None, cwd=None, env=None):
        del cmd, input, capture_output, text, timeout, cwd, env
        return mod.subprocess.CompletedProcess(
            args=["fake-cmd"],
            returncode=0,
            stdout=(
                "=== AGENT_SUMMARY ===\n"
                "repair link 受阻，未能写入 repair 记录。\n"
                "但我已新增 2 条 COORDINATION notes：REPAIR_UNCERTAIN_CALLNODE_GAP 和 Repairer_Report。\n"
                "=== END_SUMMARY ===\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(mod.subprocess, "run", fake_run)

    result = mod.run_agent(
        agent=agent,
        source_path=tmp_path,
        audit_target=target,
        completed_agents={},
        sdir=tmp_path,
        backend=StubBackend(),
    )

    assert result.status == "done"
    assert result.error is None


def test_run_agent_clears_stale_resume_error_after_successful_rerun(tmp_path, monkeypatch):
    mod = _load_module()
    agent = _sample_agent(mod)
    agent.error = "resume validation failed: map-repairer missing required note: Repairer_Report"
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    class StubBackend(mod.BackendAdapter):
        name = "stub"

        def render_prompt(self, agent, source_path, audit_target, completed_agents):
            del agent, source_path, audit_target, completed_agents
            return "prompt"

        def build_command(self, prompt, source_path, output_path, agent=None, audit_target=None):
            del prompt, source_path, output_path, agent, audit_target
            return ["fake-cmd"]

    def fake_run(cmd, input=None, capture_output=None, text=None, timeout=None, cwd=None, env=None):
        del cmd, input, capture_output, text, timeout, cwd, env
        return mod.subprocess.CompletedProcess(
            args=["fake-cmd"],
            returncode=0,
            stdout=(
                "=== AGENT_SUMMARY ===\n"
                "新增 2 条 COORDINATION notes：REPAIR_AST_GAPS 和 Repairer_Report。\n"
                "=== END_SUMMARY ===\n"
            ),
            stderr="",
        )

    monkeypatch.setattr(mod.subprocess, "run", fake_run)

    result = mod.run_agent(
        agent=agent,
        source_path=tmp_path,
        audit_target=target,
        completed_agents={},
        sdir=tmp_path,
        backend=StubBackend(),
    )

    assert result.status == "done"
    assert result.error is None


def test_run_agent_persists_subprocess_diagnostics(tmp_path, monkeypatch):
    mod = _load_module()
    agent = _sample_agent(mod)
    target = mod.AuditTargetConfig(mode="local", label="audit.db", db_path="audit.db")

    class StubBackend(mod.BackendAdapter):
        name = "stub"

        def render_prompt(self, agent, source_path, audit_target, completed_agents):
            del agent, source_path, audit_target, completed_agents
            return "prompt"

        def build_command(self, prompt, source_path, output_path, agent=None, audit_target=None):
            del prompt, source_path, output_path, agent, audit_target
            return ["fake-cmd"]

        def extract_response_text(self, result, output_path):
            del output_path
            return result.stdout + "\nFROM_EXTRACTOR"

    def fake_run(cmd, input=None, capture_output=None, text=None, timeout=None, cwd=None, env=None):
        del cmd, input, capture_output, text, timeout, cwd, env
        return mod.subprocess.CompletedProcess(
            args=["fake-cmd"],
            returncode=1,
            stdout="tool stdout",
            stderr="tool stderr",
        )

    monkeypatch.setattr(mod.subprocess, "run", fake_run)

    mod.run_agent(
        agent=agent,
        source_path=tmp_path,
        audit_target=target,
        completed_agents={},
        sdir=tmp_path,
        backend=StubBackend(),
    )

    assert (tmp_path / "map-surveyor.stub.stdout.txt").read_text(encoding="utf-8") == "tool stdout"
    assert (tmp_path / "map-surveyor.stub.stderr.txt").read_text(encoding="utf-8") == "tool stderr"
    assert (tmp_path / "map-surveyor.stub.response.txt").read_text(encoding="utf-8") == "tool stdout\nFROM_EXTRACTOR"


def test_run_workflow_stops_after_phase_when_agent_has_no_cdm_writes(tmp_path, monkeypatch):
    mod = _load_module()
    first = mod.AgentRole(
        id="map-surveyor",
        phase=1,
        depends_on=[],
        timeout_minutes=30,
        source_file=Path(".claude/agents/01-map-surveyor.md"),
        system_prompt="# Map Surveyor",
    )
    second = mod.AgentRole(
        id="map-repairer",
        phase=2,
        depends_on=["map-surveyor"],
        timeout_minutes=30,
        source_file=Path(".claude/agents/02-map-repairer.md"),
        system_prompt="# Map Repairer",
    )
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    seen: list[str] = []

    def fake_run_agent(agent, source_path, audit_target, completed_agents, sdir, backend):
        del source_path, audit_target, completed_agents, sdir, backend
        seen.append(agent.id)
        if agent.id == "map-surveyor":
            agent.status = "failed"
            agent.error = "Remote agent finished without any successful CDM write operations."
            return agent
        raise AssertionError("phase 2 must not start when phase 1 has no CDM writes")

    monkeypatch.setattr(mod, "run_agent", fake_run_agent)

    completed = mod.run_workflow(
        agents=[first, second],
        source_path=tmp_path,
        audit_target=target,
        sdir=tmp_path,
        backend=mod.CodexBackendAdapter(),
    )

    assert seen == ["map-surveyor"]
    assert completed["map-surveyor"].status == "failed"
    assert "map-repairer" not in completed


def test_validate_system_analyst_outputs_requires_public_api_inventory_for_library(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    notes = {
        ("ARCHITECTURE", "System_Overview"): {
            "content": json.dumps({"deployment_context": "library"})
        },
        ("ARCHITECTURE", "Entry_Inventory"): {"content": "{}"},
        ("ARCHITECTURE", "Asset_Inventory"): {"content": "{}"},
        ("SECURITY_BOUNDARY", "Trust_Map"): {"content": "{}"},
    }

    monkeypatch.setattr(
        mod,
        "fetch_note_by_title",
        lambda audit_target, category, title, campaign_id=None: notes.get((category, title)),
    )

    error = mod.validate_system_analyst_outputs(target)

    assert "Public_API_Inventory" in error


def test_validate_stride_analyst_outputs_requires_public_api_rows_for_library(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    stride_note = {
        "content": json.dumps(
            {
                "elements": [
                    {"element_type": "ENTRY", "name": "png_read_info"},
                    {"element_type": "ASSET", "name": "global_state"},
                ]
            }
        )
    }

    monkeypatch.setattr(
        mod,
        "fetch_note_by_title",
        lambda audit_target, category, title, campaign_id=None: stride_note,
    )
    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")

    error = mod.validate_stride_analyst_outputs(target)

    assert "PUBLIC_API" in error


def test_validate_stride_analyst_outputs_allows_partial_public_api_coverage_for_library(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    stride_note = {
        "content": json.dumps(
            {
                "elements": [
                    {
                        "element_type": "PUBLIC_API",
                        "name": "png_set_PLTE",
                        "node_ids": [202],
                    }
                ]
            }
        )
    }
    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                        {"node_id": 202, "name": "png_set_PLTE"},
                    ]
                }
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "STRIDE_Matrix"):
            return stride_note
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        return {"content": "{}"}

    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")

    error = mod.validate_stride_analyst_outputs(target)

    assert error is None


def test_run_workflow_stops_after_phase_when_hard_validation_fails(tmp_path, monkeypatch):
    mod = _load_module()
    first = mod.AgentRole(
        id="system-analyst",
        phase=1,
        depends_on=[],
        timeout_minutes=30,
        source_file=Path(".claude/agents/03-system-analyst.md"),
        system_prompt="# System Analyst",
    )
    second = mod.AgentRole(
        id="stride-analyst",
        phase=2,
        depends_on=["system-analyst"],
        timeout_minutes=30,
        source_file=Path(".claude/agents/04-stride-analyst.md"),
        system_prompt="# STRIDE Analyst",
    )
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    seen: list[str] = []

    def fake_run_agent(agent, source_path, audit_target, completed_agents, sdir, backend):
        del source_path, audit_target, completed_agents, sdir, backend
        seen.append(agent.id)
        agent.status = "done"
        agent.summary = "写入了产物"
        return agent

    monkeypatch.setattr(mod, "run_agent", fake_run_agent)
    monkeypatch.setattr(
        mod,
        "validate_agent_outputs",
        lambda agent, audit_target, campaign_id=None: "missing required note" if agent.id == "system-analyst" else None,
    )

    completed = mod.run_workflow(
        agents=[first, second],
        source_path=tmp_path,
        audit_target=target,
        sdir=tmp_path,
        backend=mod.CodexBackendAdapter(),
    )

    assert seen == ["system-analyst"]
    assert completed["system-analyst"].status == "failed"
    assert "required note" in completed["system-analyst"].error
    assert "stride-analyst" not in completed


def test_validate_vuln_hunter_outputs_requires_public_api_note_overlap_for_library(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                    ]
                }
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        return {"content": "{}"}

    def fake_notes(audit_target, category, campaign_id=None):
        del audit_target
        if category == "COORDINATION":
            return [
                {
                    "title": "Hunter 审计摘要",
                    "source": "hunter_codex@note:add",
                    "node_ids": [202],
                }
            ]
        return []

    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")
    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "fetch_notes_by_category", fake_notes)
    monkeypatch.setattr(mod, "fetch_tagged_node_ids", lambda audit_target, tag: set())

    error = mod.validate_vuln_hunter_outputs(target)

    assert "Public_API_Inventory nodes" in error


def test_validate_vuln_hunter_outputs_accepts_hunter_note_on_public_api_node(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                    ]
                }
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        return {"content": "{}"}

    def fake_notes(audit_target, category, campaign_id=None):
        del audit_target
        if category == "COORDINATION":
            return [
                {
                    "title": "Hunter 审计摘要",
                    "source": "hunter_codex@note:add",
                    "node_ids": [101],
                }
            ]
        return []

    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")
    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "fetch_notes_by_category", fake_notes)
    monkeypatch.setattr(mod, "fetch_tagged_node_ids", lambda audit_target, tag: set())

    error = mod.validate_vuln_hunter_outputs(target)

    assert error is None


def test_validate_vuln_hunter_outputs_accepts_state_tags_on_public_api_nodes(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                        {"node_id": 202, "name": "png_set_PLTE"},
                    ]
                }
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        return {"content": "{}"}

    def fake_notes(audit_target, category, campaign_id=None):
        del audit_target, category, campaign_id
        return []

    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")
    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "fetch_notes_by_category", fake_notes)
    monkeypatch.setattr(
        mod,
        "fetch_tagged_node_ids",
        lambda audit_target, tag: {101, 202} if tag == "STATE:FALSE_POSITIVE" else set(),
    )

    error = mod.validate_vuln_hunter_outputs(target)

    assert error is None


def test_validate_vuln_hunter_outputs_allows_partial_public_api_review_coverage(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                        {"node_id": 202, "name": "png_set_PLTE"},
                    ]
                }
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        return {"content": "{}"}

    def fake_notes(audit_target, category, campaign_id=None):
        del audit_target, campaign_id
        if category == "COORDINATION":
            return [
                {
                    "title": "Hunter 审计摘要",
                    "source": "hunter_codex@note:add",
                    "node_ids": [202],
                }
            ]
        return []

    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")
    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "fetch_notes_by_category", fake_notes)
    monkeypatch.setattr(mod, "fetch_tagged_node_ids", lambda audit_target, tag: set())

    error = mod.validate_vuln_hunter_outputs(target)

    assert error is None


def test_validate_vuln_hunter_outputs_ignores_state_tags_outside_current_campaign(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                        {"node_id": 202, "name": "png_set_PLTE"},
                    ]
                }
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        return {"content": "{}"}

    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")
    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "fetch_notes_by_category", lambda audit_target, category, campaign_id=None: [])
    monkeypatch.setattr(
        mod,
        "fetch_tagged_node_ids",
        lambda audit_target, tag, campaign_id=None: {101, 202} if campaign_id is None else set(),
    )

    error = mod.validate_vuln_hunter_outputs(target, campaign_id="cmp_20260408T080355Z")

    assert "missing CDM evidence" in error


def test_validate_map_surveyor_outputs_allows_nonempty_coverage_gap_as_handoff_metadata(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    survey_handoff = {
        "content": json.dumps(
            {
                "target_nodes": [],
                "message": json.dumps(
                    {
                        "coverage_gap": "public export baseline not fully reconciled",
                        "investigation_candidates": [],
                    }
                ),
            }
        )
    }

    monkeypatch.setattr(
        mod,
        "fetch_note_by_title",
        lambda audit_target, category, title, campaign_id=None: survey_handoff
        if (category, title) == ("COORDINATION", "Survey_Handoff")
        else {"content": "{}"},
    )

    error = mod.validate_agent_outputs(
        mod.AgentRole(
            id="map-surveyor",
            phase=1,
            depends_on=[],
            timeout_minutes=30,
            source_file=Path(".claude/agents/01-map-surveyor.md"),
        ),
        target,
    )

    assert error is None


def test_run_workflow_appends_note_diagnostics_when_map_surveyor_handoff_is_missing(tmp_path, monkeypatch):
    mod = _load_module()
    agent = mod.AgentRole(
        id="map-surveyor",
        phase=1,
        depends_on=[],
        timeout_minutes=30,
        source_file=Path(".claude/agents/01-map-surveyor.md"),
        system_prompt="# Map Surveyor",
    )
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    def fake_run_agent(agent, source_path, audit_target, completed_agents, sdir, backend, campaign_id="cmp_default"):
        del source_path, audit_target, completed_agents, backend, campaign_id
        (sdir / "map-surveyor.codex.response.txt").write_text(
            (
                "note add returned OK for Survey_Handoff with scope=campaign campaign_id=cmp_123\n"
                "note list returned notes_total: 0 for same campaign\n"
            ),
            encoding="utf-8",
        )
        agent.status = "done"
        agent.summary = "写入了标签和规则"
        return agent

    monkeypatch.setattr(mod, "run_agent", fake_run_agent)
    monkeypatch.setattr(
        mod,
        "validate_agent_outputs",
        lambda agent, audit_target, campaign_id=None: "map-surveyor missing required note: Survey_Handoff"
        if agent.id == "map-surveyor"
        else None,
    )

    completed = mod.run_workflow(
        agents=[agent],
        source_path=tmp_path,
        audit_target=target,
        sdir=tmp_path,
        backend=mod.CodexBackendAdapter(),
        campaign_id="cmp_123",
    )

    assert completed["map-surveyor"].status == "failed"
    assert "missing required note" in completed["map-surveyor"].error
    assert "note add returned OK" in completed["map-surveyor"].error
    assert "notes_total: 0" in completed["map-surveyor"].error


def test_validate_vuln_hunter_outputs_rejects_inconsistent_hunter_summary_metrics(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                        {"node_id": 202, "name": "png_set_PLTE"},
                    ]
                }
            }
        )
    }

    hunter_summary = {
        "content": json.dumps(
            {
                "schema_version": "1.0",
                "status": "DONE",
                "owner": "vuln-hunter",
                "message": "Audited two targets.",
                "target_nodes": [],
                "metrics": {
                    "audited_targets_total": 2,
                    "confirmed_vulns_high": 1,
                    "confirmed_vulns_critical": 0,
                    "confirmed_vulns_medium": 0,
                    "confirmed_vulns_low": 0,
                    "reviewed_clean_count": 0,
                    "false_positive_count": 0,
                    "suspicious_count": 0,
                },
            }
        ),
        "node_ids": [101, 202],
        "title": "Hunter 审计摘要",
        "source": "hunter_codex@note:add",
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        if (category, title) == ("COORDINATION", "Hunter 审计摘要"):
            return hunter_summary
        return {"content": "{}"}

    def fake_notes(audit_target, category, campaign_id=None):
        del audit_target, campaign_id
        if category == "COORDINATION":
            return [hunter_summary]
        return []

    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")
    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "fetch_notes_by_category", fake_notes)
    monkeypatch.setattr(mod, "fetch_tagged_node_ids", lambda audit_target, tag: set())

    error = mod.validate_vuln_hunter_outputs(target)

    assert "Hunter 审计摘要 metrics" in error


def test_validate_vuln_hunter_outputs_allows_missing_zero_value_severity_bucket(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    public_api_inventory = {
        "content": json.dumps(
            {
                "consumer_profiles": {
                    "HOST_APPLICATION": [
                        {"node_id": 101, "name": "png_set_quantize"},
                    ]
                }
            }
        )
    }

    hunter_summary = {
        "content": json.dumps(
            {
                "schema_version": "1.0",
                "status": "DONE",
                "owner": "vuln-hunter",
                "message": "Audited one target.",
                "target_nodes": [],
                "metrics": {
                    "audited_targets_total": 1,
                    "confirmed_vulns_high": 1,
                    "confirmed_vulns_medium": 0,
                    "confirmed_vulns_low": 0,
                    "reviewed_clean_count": 0,
                    "false_positive_count": 0,
                    "suspicious_count": 0,
                },
            }
        ),
        "node_ids": [101],
        "title": "Hunter 审计摘要",
        "source": "hunter_codex@note:add",
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return public_api_inventory
        if (category, title) == ("COORDINATION", "Hunter 审计摘要"):
            return hunter_summary
        return {"content": "{}"}

    def fake_notes(audit_target, category, campaign_id=None):
        del audit_target, campaign_id
        if category == "COORDINATION":
            return [hunter_summary]
        return []

    monkeypatch.setattr(mod, "detect_project_kind", lambda audit_target, campaign_id=None: "library")
    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)
    monkeypatch.setattr(mod, "fetch_notes_by_category", fake_notes)
    monkeypatch.setattr(mod, "fetch_tagged_node_ids", lambda audit_target, tag: set())

    error = mod.validate_vuln_hunter_outputs(target)

    assert error is None


def test_validate_system_analyst_outputs_rejects_review_or_vuln_tags_in_public_api_inventory(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "System_Overview"):
            return {"content": json.dumps({"deployment_context": "library"})}
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return {
                "content": json.dumps(
                    {
                        "consumer_profiles": {
                            "HOST_APPLICATION": [
                                {
                                    "node_id": 101,
                                    "name": "api_a",
                                    "tags": [
                                        "SEMANTIC:API:PUBLIC_EXPORTED",
                                        "SEMANTIC:API:STATEFUL_MUTATOR",
                                        "STATE:FALSE_POSITIVE",
                                    ],
                                }
                            ]
                        }
                    }
                )
            }
        return {"content": "{}"}

    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)

    error = mod.validate_system_analyst_outputs(target)

    assert "Public_API_Inventory" in error
    assert "STATE:FALSE_POSITIVE" in error


def test_validate_system_analyst_outputs_allows_survey_handoff_gap_for_high_risk_public_api_nodes(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    survey_handoff = {
        "content": json.dumps(
            {
                "target_nodes": [
                    {"node_id": 202, "target_type": "API_HOTSPOT", "reason": "covered elsewhere"}
                ],
                "message": json.dumps(
                    {
                        "investigation_candidates": [
                            {"node_id": 202, "location": "a.c:1", "observed_traits": ["bulk data processor"]}
                        ]
                    }
                ),
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "System_Overview"):
            return {"content": json.dumps({"deployment_context": "library"})}
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return {
                "content": json.dumps(
                    {
                        "consumer_profiles": {
                            "HOST_APPLICATION": [
                                {
                                    "node_id": 101,
                                    "name": "api_a",
                                    "tags": [
                                        "SEMANTIC:API:PUBLIC_EXPORTED",
                                        "SEMANTIC:API:STATEFUL_MUTATOR",
                                    ],
                                },
                                {
                                    "node_id": 202,
                                    "name": "api_b",
                                    "tags": [
                                        "SEMANTIC:API:PUBLIC_EXPORTED",
                                        "SEMANTIC:API:BULK_DATA_PROCESSOR",
                                    ],
                                },
                            ]
                        }
                    }
                )
            }
        if (category, title) == ("COORDINATION", "Survey_Handoff"):
            return survey_handoff
        return {"content": "{}"}

    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)

    error = mod.validate_system_analyst_outputs(target)

    assert error is None


def test_validate_system_analyst_outputs_allows_missing_hotspots_when_survey_handoff_records_coverage_gap(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    survey_handoff = {
        "content": json.dumps(
            {
                "target_nodes": [],
                "message": json.dumps(
                    {
                        "coverage_gap": (
                            "exported API baseline had unresolved declaration-node gaps; "
                            "remaining high-risk APIs were documented for downstream review"
                        ),
                        "investigation_candidates": [],
                    }
                ),
            }
        )
    }

    def fake_fetch(audit_target, category, title, campaign_id=None):
        del audit_target, campaign_id
        if (category, title) == ("ARCHITECTURE", "System_Overview"):
            return {"content": json.dumps({"deployment_context": "library"})}
        if (category, title) == ("ARCHITECTURE", "Public_API_Inventory"):
            return {
                "content": json.dumps(
                    {
                        "consumer_profiles": {
                            "HOST_APPLICATION": [
                                {
                                    "node_id": 101,
                                    "name": "api_a",
                                    "tags": [
                                        "SEMANTIC:API:PUBLIC_EXPORTED",
                                        "SEMANTIC:API:STATEFUL_MUTATOR",
                                    ],
                                }
                            ]
                        }
                    }
                )
            }
        if (category, title) == ("COORDINATION", "Survey_Handoff"):
            return survey_handoff
        return {"content": "{}"}

    monkeypatch.setattr(mod, "fetch_note_by_title", fake_fetch)

    error = mod.validate_system_analyst_outputs(target)

    assert error is None


def test_should_resume_skip_agent_requires_remote_outputs_to_still_exist(tmp_path, monkeypatch):
    mod = _load_module()
    agent = mod.AgentRole(
        id="map-surveyor",
        phase=1,
        depends_on=[],
        timeout_minutes=30,
        source_file=Path(".claude/agents/01-map-surveyor.md"),
        system_prompt="# Map Surveyor",
        status="done",
        summary="已完成",
    )
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )

    monkeypatch.setattr(
        mod,
        "fetch_note_by_title",
        lambda audit_target, category, title, campaign_id=None: None,
    )

    should_skip = mod.should_resume_skip_agent(
        agent,
        target,
        campaign_id="cmp_20260408T080355Z",
    )

    assert should_skip is False
    assert agent.status == "pending"
    assert "resume validation failed" in agent.error


def test_fetch_note_by_title_prefers_current_campaign(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )
    calls: list[list[str]] = []

    def fake_run(audit_target, args):
        del audit_target
        calls.append(args)
        if args[:3] == ["note", "list", "--category"]:
            assert "--scope" in args
            assert "--campaign-id" in args
            return {
                "result": {
                    "content": {
                        "notes": [
                            {
                                "note_id": "7447488473742708736",
                                "title": "System_Overview",
                                "status": "active",
                            }
                        ]
                    }
                }
            }
        if args[:2] == ["note", "show"]:
            return {
                "result": {
                    "content": {
                        "note": {
                            "id": 7447488473742708736,
                            "title": "System_Overview",
                            "content": "{}",
                        }
                    }
                }
            }
        raise AssertionError(f"unexpected args: {args}")

    monkeypatch.setattr(mod, "run_cdm_read_command", fake_run)

    note = mod.fetch_note_by_title(
        target,
        "ARCHITECTURE",
        "System_Overview",
        campaign_id="cmp_20260408T031112Z",
    )

    assert note is not None
    assert note["title"] == "System_Overview"
    assert any("--campaign-id" in call for call in calls)


def test_fetch_note_by_title_paginates_until_match(monkeypatch):
    mod = _load_module()
    target = mod.AuditTargetConfig(
        mode="remote",
        label="127.0.0.1:8000",
        cpg_server="http://127.0.0.1:8000",
    )
    offsets: list[str] = []

    def fake_run(audit_target, args):
        del audit_target
        if args[:3] == ["note", "list", "--category"]:
            offset = args[args.index("--offset") + 1]
            offsets.append(offset)
            if offset == "0":
                return {
                    "result": {
                        "content": {
                            "notes": [
                                {
                                    "note_id": "111",
                                    "title": "Other",
                                    "status": "active",
                                }
                            ]
                        }
                    },
                    "metadata": {"has_more": True},
                }
            return {
                "result": {
                    "content": {
                        "notes": [
                            {
                                "note_id": "222",
                                "title": "System_Overview",
                                "status": "active",
                            }
                        ]
                    }
                },
                "metadata": {"has_more": False},
            }
        if args[:2] == ["note", "show"]:
            return {
                "result": {
                    "content": {
                        "note": {
                            "id": 222,
                            "title": "System_Overview",
                            "content": "{}",
                        }
                    }
                }
            }
        raise AssertionError(f"unexpected args: {args}")

    monkeypatch.setattr(mod, "run_cdm_read_command", fake_run)

    note = mod.fetch_note_by_title(target, "ARCHITECTURE", "System_Overview")

    assert note is not None
    assert offsets == ["0", "500"]


def test_main_list_campaigns_prints_existing_campaigns(tmp_path, capsys, monkeypatch):
    mod = _load_module()
    root = tmp_path / ".audit_state" / "repo_audit"
    root.mkdir(parents=True)
    (root / "cmp_20260408T010000Z").mkdir()
    (root / "cmp_20260408T020000Z").mkdir()
    (root / "latest_campaign.txt").write_text("cmp_20260408T020000Z\n", encoding="utf-8")

    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "audit_workflow.py",
            str(tmp_path / "repo"),
            "--db",
            str(tmp_path / "audit.db"),
            "--list-campaigns",
        ],
    )

    mod.main()

    stdout = capsys.readouterr().out
    assert "cmp_20260408T010000Z" in stdout
    assert "cmp_20260408T020000Z" in stdout
