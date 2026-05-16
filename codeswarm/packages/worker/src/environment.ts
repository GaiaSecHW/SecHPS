import fs from 'node:fs';
import path from 'node:path';
import type { TaskPayload, MCPService } from '@codeswarm/types';

export interface EnvironmentFactoryConfig {
  workspaceBasePath?: string;
  skillsRegistryPath?: string;
}

export interface BuildResult {
  workspacePath: string;
  agent?: string;
  instruction?: string;
  commandTemplate?: string;
}

export type BuildProgressCallback = (message: string) => void;

function mapRemotePathToLocal(remotePath: string): string {
  const pathMapping = process.env.PATH_MAPPING;
  if (!pathMapping) {
    return remotePath;
  }
  const [remotePrefix, localPrefix] = pathMapping.split('=');
  if (!remotePrefix || !localPrefix) {
    return remotePath;
  }
  if (remotePath.startsWith(remotePrefix)) {
    return remotePath.replace(remotePrefix, localPrefix);
  }
  return remotePath;
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
   * Priority: workspacePath (NFS) > projectPath (local copy)
   */
  async build(payload: TaskPayload, onProgress?: BuildProgressCallback): Promise<BuildResult> {
    const progress = (msg: string) => {
      console.log(`[Environment] ${msg}`);
      onProgress?.(msg);
    };
    progress(`========== BUILD BEGIN ==========`);
    console.log(`[Environment] payload.taskId: ${payload.taskId}`);
    console.log(`[Environment] payload.workspacePath: ${payload.workspacePath}`);
    console.log(`[Environment] payload.projectPath: ${payload.projectPath}`);
    console.log(`[Environment] payload.skills: ${payload.skills?.join(', ') || 'none'}`);
    console.log(`[Environment] payload.agent: ${payload.agent}`);
    console.log(`[Environment] payload.instruction: "${payload.instruction?.substring(0, 50)}..."`);
    console.log(`[Environment] payload.model: ${payload.model}`);
    
    // NFS passthrough mode: use the provided workspace path directly
    // Apply path mapping for Windows local debugging (e.g., /home/icsl/Shared-workspace -> Z:/)
    // Read default_agent from opencode.json if agent not specified in payload
    if (payload.workspacePath) {
      progress(`Mode: NFS passthrough (workspacePath=${payload.workspacePath})`);
      const localWorkspacePath = mapRemotePathToLocal(payload.workspacePath);
      progress(`路径映射: ${payload.workspacePath} -> ${localWorkspacePath}`);

      // Check workspace permissions for NFS passthrough mode
      this.checkWorkspacePermissions(localWorkspacePath);

      let actualWorkspacePath = localWorkspacePath;
      let resolvedAgent: string | undefined;
      let resolvedInstruction: string | undefined;
      let commandTemplate: string | undefined;

      // Read instruction.txt from root directory
      progress(`Step 1: 检查 instruction.txt...`);
      const instructionPath = path.join(localWorkspacePath, 'instruction.txt');
      progress(`instruction.txt exists: ${fs.existsSync(instructionPath)}`);

      if (fs.existsSync(instructionPath)) {
        try {
          const fileContent = fs.readFileSync(instructionPath, 'utf-8').trim();
          console.log(`[Environment] Read instruction.txt success, length: ${fileContent.length}`);
          console.log(`[Environment] instruction content: "${fileContent.substring(0, 100)}..."`);
          resolvedInstruction = fileContent;
        } catch (e) {
          console.log(`[Environment] Failed to read instruction.txt: ${e}`);
          resolvedInstruction = payload.instruction ?? undefined;
        }
      } else {
        console.log(`[Environment] instruction.txt not found, using payload.instruction`);
        resolvedInstruction = payload.instruction ?? undefined;
      }

      // Always read opencode.json to resolve agent (regardless of instruction length)
      progress(`Step 2: 检查 opencode.json...`);
      const directOpencodeJsonPath = path.join(localWorkspacePath, 'opencode.json');
      progress(`opencode.json exists: ${fs.existsSync(directOpencodeJsonPath)}`);
      if (fs.existsSync(directOpencodeJsonPath)) {
        progress(`找到 opencode.json，读取配置...`);
        try {
          const rawConfig = fs.readFileSync(directOpencodeJsonPath, 'utf-8').replace(/^﻿/, '');
          const config = JSON.parse(rawConfig);
          resolvedAgent = config.default_agent || config.defaultAgent;
          progress(`default_agent: ${resolvedAgent}`);
          if (resolvedAgent && config.command?.[resolvedAgent]?.template) {
            commandTemplate = config.command[resolvedAgent].template;
            progress(`command template: ${commandTemplate?.substring(0, 50)}...`);
          }
        } catch (e) {
          progress(`读取 opencode.json 失败: ${e}`);
        }
      } else {
        // Try to find a single subdirectory with opencode.json
        progress(`Step 2b: 检查子目录...`);
        const subdirs = fs.readdirSync(localWorkspacePath, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
          .map(entry => entry.name);

        progress(`子目录列表: ${subdirs.join(', ')} (${subdirs.length}个)`);

        if (subdirs.length === 1) {
          const subdirPath = path.join(localWorkspacePath, subdirs[0]);
          const subdirOpencodeJsonPath = path.join(subdirPath, 'opencode.json');
          progress(`检查子目录: ${subdirs[0]}`);
          if (fs.existsSync(subdirOpencodeJsonPath)) {
            actualWorkspacePath = subdirPath;
            progress(`使用子目录作为工作区: ${subdirs[0]}`);
            try {
              const config = JSON.parse(fs.readFileSync(subdirOpencodeJsonPath, 'utf-8').replace(/^﻿/, ''));
              resolvedAgent = config.default_agent || config.defaultAgent;
              progress(`default_agent: ${resolvedAgent}`);
              if (resolvedAgent && config.command?.[resolvedAgent]?.template) {
                commandTemplate = config.command[resolvedAgent].template;
                progress(`command template: ${commandTemplate?.substring(0, 50)}...`);
              }
            } catch (e) {
              progress(`读取子目录 opencode.json 失败: ${e}`);
            }
          }
        } else if (subdirs.length > 1) {
          progress(`多个子目录，不自动选择`);
        }
      }

      progress(`BUILD COMPLETE (NFS mode) - workspace: ${actualWorkspacePath}, agent: ${resolvedAgent}`);
      return { workspacePath: actualWorkspacePath, agent: resolvedAgent, instruction: resolvedInstruction, commandTemplate };
    }

    // Local workspace mode
    progress(`Mode: 本地构建 (projectPath=${payload.projectPath})`);
    const workspacePath = path.join(this.workspaceBasePath, payload.taskId);

    try {
      progress(`Step 1: 创建工作区目录`);
      fs.mkdirSync(workspacePath, { recursive: true });

      // Step 2: Populate workspace from local copy
      const projectPath = payload.projectPath;
      if (!projectPath || !fs.existsSync(projectPath)) {
        throw new Error(`Project path does not exist: ${projectPath}`);
      }
      progress(`Step 2: 拷贝项目文件...`);
      fs.cpSync(projectPath, workspacePath, { recursive: true, filter: this.excludeNodeModulesFilter });

      // Step 3: Create .opencode/skills/ subdirectory
      progress(`Step 3: 创建技能目录`);
      const skillsDir = path.join(workspacePath, '.opencode', 'skills');
      fs.mkdirSync(skillsDir, { recursive: true });

      // Step 4: Copy skill files
      if (payload.skills && payload.skills.length > 0) {
        progress(`Step 4: 拷贝技能文件 (${payload.skills.length}个)`);
        for (const skillId of payload.skills) {
          const sourceSkillPath = path.join(this.skillsRegistryPath, skillId, 'latest', 'SKILL.md');
          const destSkillPath = path.join(skillsDir, skillId);

          if (!fs.existsSync(sourceSkillPath)) {
            progress(`技能文件未找到: ${sourceSkillPath}`);
            continue;
          }

          fs.mkdirSync(destSkillPath, { recursive: true });
          fs.copyFileSync(sourceSkillPath, path.join(destSkillPath, 'SKILL.md'));
          progress(`已拷贝技能: ${skillId}`);
        }
      }

      // Step 5: Generate opencode.json if model or MCP config or agent provided
      const opencodeConfig: Record<string, any> = {};
      if (payload.model) {
        opencodeConfig.model = payload.model;
        progress(`配置模型: ${payload.model}`);
      }
      if (payload.mcps && payload.mcps.length > 0) {
        const mcpObjects = payload.mcps.filter((m): m is Exclude<typeof m, string> => typeof m !== 'string');
        if (mcpObjects.length > 0) {
          opencodeConfig.mcp = this.normalizeMcpServices(mcpObjects);
        }
        progress(`配置 MCP: ${payload.mcps.length}个`);
      }
      if (payload.agent) {
        opencodeConfig.default_agent = payload.agent;
        progress(`配置 agent: ${payload.agent}`);
      }
      if (Object.keys(opencodeConfig).length > 0) {
        opencodeConfig["$schema"] = "https://opencode.ai/config.json";
        fs.writeFileSync(
          path.join(workspacePath, 'opencode.json'),
          JSON.stringify(opencodeConfig, null, 2)
        );
      }

      // Step 6: Write instruction.txt
      if (payload.instruction) {
        progress(`写入 instruction.txt`);
        fs.writeFileSync(
          path.join(workspacePath, 'instruction.txt'),
          payload.instruction || ''
        );
      }

      progress(`BUILD COMPLETE (local mode) - workspace: ${workspacePath}`);
      return { workspacePath, agent: payload.agent };
    } catch (error) {
      // Clean up partial workspace on error
      progress(`BUILD FAILED: ${error}`);
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
    // Never delete mapped remote paths (they come from NFS/remote server)
    const pathMapping = process.env.PATH_MAPPING;
    if (pathMapping) {
      const localPrefix = pathMapping.split('=')[1];
      if (localPrefix && workspacePath.startsWith(localPrefix)) {
        return;
      }
    }
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

  /** Clone a git repository into the target directory, optionally checking out a specific ref. */
  private excludeNodeModulesFilter(src: string, dest: string): boolean {
    const relativePath = path.relative(process.cwd(), src);
    return !relativePath.includes('node_modules');
  }

  /**
   * Check workspace permissions and log warnings if access is limited.
   * This is critical for NFS passthrough mode where the worker needs execute permissions.
   */
  private checkWorkspacePermissions(workspacePath: string): void {
    const checks = [
      { name: 'read', bit: fs.constants.R_OK },
      { name: 'write', bit: fs.constants.W_OK },
      { name: 'execute/search', bit: fs.constants.X_OK },
    ];

    let allOk = true;
    for (const check of checks) {
      try {
        fs.accessSync(workspacePath, check.bit);
      } catch {
        console.warn(`[Environment] ⚠️ 工作区 ${workspacePath} 缺少 ${check.name} 权限 (${check.bit})`);
        allOk = false;
      }
    }

    if (allOk) {
      console.log(`[Environment] ✓ 工作区权限检查通过: ${workspacePath}`);
    }
  }
}
