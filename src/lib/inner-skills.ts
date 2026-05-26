/**
 * 内置 Skill 管理
 *
 * inner_skills/ 目录存放平台基础设施 skill，随项目 git 版本控制。
 * 这些 skill 不依赖 Gitea 仓库同步，不参与进化/治理流程。
 *
 * 用途：
 * - Worker 回调触发报告解析时，将内置 skill 拷贝到工作区 .opencode/skills/
 * - 确保 Worker 环境无需预装 skill，平台自带即可使用
 */

import path from 'node:path';
import fs from 'node:fs';

/**
 * 获取 inner_skills 目录的绝对路径
 * 基于 process.cwd()（Next.js 项目根目录）定位
 */
export function getInnerSkillsDir(): string {
  // Next.js standalone 模式：server.js 在 .next/standalone/ 下，需要往上找项目根
  // 开发模式：process.cwd() 就是项目根
  const projectRoot = process.cwd();
  return path.join(projectRoot, 'inner_skills');
}

/**
 * 获取所有内置 skill 名称列表
 * 扫描 inner_skills/ 目录下的子文件夹
 */
export function getInnerSkillNames(): string[] {
  const dir = getInnerSkillsDir();
  if (!fs.existsSync(dir)) {
    console.warn('[InnerSkills] inner_skills 目录不存在:', dir);
    return [];
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries
    .filter(e => e.isDirectory())
    .map(e => e.name)
    .filter(name => {
      // 必须包含 SKILL.md 才是有效 skill
      const skillMd = path.join(dir, name, 'SKILL.md');
      return fs.existsSync(skillMd);
    });
}

/**
 * 将内置 skill 拷贝到目标工作区的 .opencode/skills/ 目录
 *
 * @param workspacePath - Worker 工作区路径（opencode run 的 cwd）
 * @param skillNames - 要拷贝的 skill 名称列表，默认全部
 * @returns 拷贝结果：成功数、失败数、拷贝的 skill 列表
 */
export function copyInnerSkillsToWorkspace(
  workspacePath: string,
  skillNames?: string[]
): { success: number; failed: number; copiedSkills: string[] } {
  const innerDir = getInnerSkillsDir();
  const targetDir = path.join(workspacePath, '.opencode', 'skills');
  const names = skillNames || getInnerSkillNames();

  const result = { success: 0, failed: 0, copiedSkills: [] as string[] };

  if (names.length === 0) {
    console.warn('[InnerSkills] 无内置 skill 可拷贝');
    return result;
  }

  // 安全验证：防止路径遍历
  if (!isPathSafe(workspacePath)) {
    console.error('[InnerSkills] workspacePath 包含不安全的路径字符');
    result.failed = names.length;
    return result;
  }

  // 确保 .opencode/skills 目录存在
  fs.mkdirSync(targetDir, { recursive: true });

  // 写入 .opencode/.npmrc（offline=true），防止 opencode 尝试安装 npm 包
  const npmrcDir = path.join(workspacePath, '.opencode');
  const npmrcPath = path.join(npmrcDir, '.npmrc');
  fs.mkdirSync(npmrcDir, { recursive: true });
  fs.writeFileSync(npmrcPath, 'offline=true\n');

  for (const name of names) {
    const sourceSkillDir = path.join(innerDir, name);
    const targetSkillDir = path.join(targetDir, name);

    if (!fs.existsSync(sourceSkillDir)) {
      console.warn(`[InnerSkills] 源 skill 目录不存在: ${name}`);
      result.failed++;
      continue;
    }

    try {
      // 递归拷贝整个 skill 目录（含 SKILL.md 及可能的 knowledge/、phases/ 等子目录）
      fs.cpSync(sourceSkillDir, targetSkillDir, { recursive: true, force: true });
      result.success++;
      result.copiedSkills.push(name);
      console.log(`[InnerSkills] 拷贝内置 skill: ${name} → ${path.relative(workspacePath, targetSkillDir)}`);
    } catch (err) {
      console.error(`[InnerSkills] 拷贝失败: ${name}`, err instanceof Error ? err.message : String(err));
      result.failed++;
    }
  }

  console.log(`[InnerSkills] 拷贝完成: ${result.success} 成功, ${result.failed} 失败`);
  return result;
}

/**
 * 仅拷贝单个内置 skill 到工作区
 * 用于精细控制：只拷贝报告解析需要的 skill
 */
export function copySingleInnerSkill(
  workspacePath: string,
  skillName: string
): boolean {
  const res = copyInnerSkillsToWorkspace(workspacePath, [skillName]);
  return res.success > 0;
}

/**
 * 构建报告解析的 Phase 1 指令
 * 从 inner_skills/ 动态获取 skill 名称，而非硬编码
 *
 * @returns Phase 1 指令字符串，或 null 如果 skill 不存在
 */
export function buildReportParseInstruction(): string | null {
  const names = getInnerSkillNames();

  // 查找 audit-report-parser skill
  const reportParser = names.find(n => n === 'audit-report-parser');
  if (!reportParser) {
    console.warn('[InnerSkills] audit-report-parser skill 不存在于 inner_skills/ 目录');
    return null;
  }

  return `执行 ${reportParser} skill 解析漏洞报告`;
}

/**
 * 路径安全检查
 * 防止路径遍历攻击
 */
function isPathSafe(p: string): boolean {
  const normalized = path.normalize(p);
  // 不允许包含 ..
  if (normalized.includes('..')) return false;
  // 必须是绝对路径
  if (!path.isAbsolute(normalized)) return false;
  return true;
}