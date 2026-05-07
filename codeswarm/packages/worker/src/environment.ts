import fs from 'node:fs';
import path from 'node:path';
import type { TaskPayload, MCPService } from '@codeswarm/types';

export interface EnvironmentFactoryConfig {
  workspaceBasePath?: string;
  skillsRegistryPath?: string;
}

export class EnvironmentFactory {
  private readonly workspaceBasePath: string;
  private readonly skillsRegistryPath: string;

  constructor(config: EnvironmentFactoryConfig = {}) {
    this.workspaceBasePath = path.resolve(config.workspaceBasePath || './data/task_workspaces');
    this.skillsRegistryPath = path.resolve(config.skillsRegistryPath || './shared/skills_registry');
  }

  /**
   * Build an isolated workspace for a task.
   * If payload.workspacePath is provided (NFS mode), skip copying and use it directly.
   * @param payload - Task payload containing project path, skills, and configuration
   * @returns Path to the workspace
   */
  async build(payload: TaskPayload): Promise<string> {
    // NFS passthrough mode: use the provided workspace path directly
    if (payload.workspacePath) {
      // Ensure instruction.txt exists
      fs.writeFileSync(
        path.join(payload.workspacePath, 'instruction.txt'),
        payload.instruction
      );
      return payload.workspacePath;
    }

    // Local workspace mode: copy project files
    const workspacePath = path.join(this.workspaceBasePath, payload.taskId);

    try {
      // Step 1: Create workspace directory
      fs.mkdirSync(workspacePath, { recursive: true });

      // Step 2: Copy project files
      const projectPath = payload.projectPath;
      if (!fs.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`);
      }
      fs.cpSync(projectPath, workspacePath, { recursive: true, filter: this.excludeNodeModulesFilter });

      // Step 3: Create .opencode/skills/ subdirectory
      const skillsDir = path.join(workspacePath, '.opencode', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      // Step 4: Copy skill files
      if (payload.skills && payload.skills.length > 0) {
        for (const skillId of payload.skills) {
          const sourceSkillPath = path.join(this.skillsRegistryPath, skillId, 'latest', 'SKILL.md');
          const destSkillPath = path.join(skillsDir, skillId);

          if (!fs.existsSync(sourceSkillPath)) {
            console.warn(`Skill file not found: ${sourceSkillPath}`);
            continue;
          }

          fs.mkdirSync(destSkillPath, { recursive: true });
          fs.copyFileSync(sourceSkillPath, path.join(destSkillPath, 'SKILL.md'));
        }
      }

      // Step 5: Generate opencode.json if model or MCP config provided
      const opencodeConfig: Record<string, any> = {};
      if (payload.model) {
        opencodeConfig.model = payload.model;
      }
      if (payload.mcps && payload.mcps.length > 0) {
        opencodeConfig.mcp = this.normalizeMcpServices(payload.mcps);
      }
      if (Object.keys(opencodeConfig).length > 0) {
        opencodeConfig["$schema"] = "https://opencode.ai/config.json";
        fs.writeFileSync(
          path.join(workspacePath, 'opencode.json'),
          JSON.stringify(opencodeConfig, null, 2)
        );
      }

      // Step 6: Write instruction.txt
      fs.writeFileSync(
        path.join(workspacePath, 'instruction.txt'),
        payload.instruction
      );

      return workspacePath;
    } catch (error) {
      // Clean up partial workspace on error
      if (fs.existsSync(workspacePath)) {
        this.cleanup(workspacePath);
      }
      throw error;
    }
  }

  /**
   * Clean up a workspace directory.
   * Skips cleanup if the path is not under the local workspaceBasePath (NFS paths).
   */
  async cleanup(workspacePath: string): Promise<void> {
    // Never delete NFS paths
    const resolved = path.resolve(workspacePath);
    const base = path.resolve(this.workspaceBasePath);
    if (!resolved.startsWith(base)) {
      return;
    }
    if (fs.existsSync(resolved)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }

  private normalizeMcpServices(mcps: MCPService[]): Record<string, any> {
    const record: Record<string, any> = {};
    for (let i = 0; i < mcps.length; i++) {
      const mcp = mcps[i];
      const key = `mcp-${i}`;
      const entry: Record<string, any> = { enabled: true };
      if (mcp.type === 'local') {
        entry.type = 'local';
        entry.command = mcp.command;
        if (mcp.environment) entry.environment = mcp.environment;
      } else {
        entry.type = 'remote';
        entry.url = mcp.url;
        if (mcp.headers) entry.headers = mcp.headers;
      }
      record[key] = entry;
    }
    return record;
  }

  private excludeNodeModulesFilter(src: string, dest: string): boolean {
    const relativePath = path.relative(process.cwd(), src);
    return !relativePath.includes('node_modules');
  }
}
