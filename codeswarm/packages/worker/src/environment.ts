import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
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
   * Priority: gitUrl > workspacePath (NFS) > projectPath (local copy)
   */
  async build(payload: TaskPayload): Promise<BuildResult> {
    console.log(`[Environment] ========== BUILD BEGIN ==========`);
    console.log(`[Environment] payload.taskId: ${payload.taskId}`);
    console.log(`[Environment] payload.workspacePath: ${payload.workspacePath}`);
    console.log(`[Environment] payload.projectPath: ${payload.projectPath}`);
    console.log(`[Environment] payload.gitUrl: ${payload.gitUrl}`);
    console.log(`[Environment] payload.gitRef: ${payload.gitRef}`);
    console.log(`[Environment] payload.skills: ${payload.skills?.join(', ') || 'none'}`);
    console.log(`[Environment] payload.agent: ${payload.agent}`);
    console.log(`[Environment] payload.instruction: "${payload.instruction?.substring(0, 50)}..."`);
    console.log(`[Environment] payload.model: ${payload.model}`);
    
    // NFS passthrough mode: use the provided workspace path directly
    // Apply path mapping for Windows local debugging (e.g., /home/icsl/Shared-workspace -> Z:/)
    // Read default_agent from opencode.json if agent not specified in payload
    if (payload.workspacePath) {
      console.log(`[Environment] Mode: NFS passthrough (workspacePath provided)`);
      const localWorkspacePath = mapRemotePathToLocal(payload.workspacePath);
      console.log(`[Environment] mapped path: ${payload.workspacePath} -> ${localWorkspacePath}`);
      console.log(`[Environment] PATH_MAPPING env: ${process.env.PATH_MAPPING || 'not set'}`);

      // Check workspace permissions for NFS passthrough mode
      this.checkWorkspacePermissions(localWorkspacePath);
      
      let actualWorkspacePath = localWorkspacePath;
      let resolvedAgent: string | undefined;
      let resolvedInstruction: string | undefined;
      let commandTemplate: string | undefined;
      
      // Step 1: Check if opencode.json exists directly in workspace
      console.log(`[Environment] Step 1: Checking opencode.json...`);
      const directOpencodeJsonPath = path.join(localWorkspacePath, 'opencode.json');
      console.log(`[Environment] direct opencode.json path: ${directOpencodeJsonPath}`);
      console.log(`[Environment] direct opencode.json exists: ${fs.existsSync(directOpencodeJsonPath)}`);
      
      if (fs.existsSync(directOpencodeJsonPath)) {
        // Root has opencode.json, use root as workspace
        try {
          const config = JSON.parse(fs.readFileSync(directOpencodeJsonPath, 'utf-8'));
          resolvedAgent = config.default_agent || config.defaultAgent;
          console.log(`[Environment] Found default_agent in root opencode.json: ${resolvedAgent}`);
          console.log(`[Environment] opencode.json config keys: ${Object.keys(config).join(', ')}`);
          if (resolvedAgent && config.command?.[resolvedAgent]?.template) {
            commandTemplate = config.command[resolvedAgent].template;
            console.log(`[Environment] Found command template for ${resolvedAgent}: "${commandTemplate?.substring(0, 50)}..."`);
          }
        } catch (e) {
          console.log(`[Environment] Failed to read root opencode.json: ${e}`);
        }
      } else {
        // Try to find a single subdirectory with opencode.json
        console.log(`[Environment] Step 1b: Checking subdirectories for opencode.json...`);
        const subdirs = fs.readdirSync(localWorkspacePath, { withFileTypes: true })
          .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
          .map(entry => entry.name);
        
        console.log(`[Environment] Found subdirs: ${subdirs.join(', ')}`);
        console.log(`[Environment] Subdirs count: ${subdirs.length}`);
        
        if (subdirs.length === 1) {
          const subdirPath = path.join(localWorkspacePath, subdirs[0]);
          const subdirOpencodeJsonPath = path.join(subdirPath, 'opencode.json');
          console.log(`[Environment] Checking subdir: ${subdirs[0]}`);
          console.log(`[Environment] subdir opencode.json path: ${subdirOpencodeJsonPath}`);
          console.log(`[Environment] subdir opencode.json exists: ${fs.existsSync(subdirOpencodeJsonPath)}`);
          if (fs.existsSync(subdirOpencodeJsonPath)) {
            actualWorkspacePath = subdirPath;
            console.log(`[Environment] Using subdirectory as workspace: ${subdirs[0]}`);
            try {
              const config = JSON.parse(fs.readFileSync(subdirOpencodeJsonPath, 'utf-8'));
              resolvedAgent = config.default_agent || config.defaultAgent;
              console.log(`[Environment] Found default_agent in subdirectory opencode.json: ${resolvedAgent}`);
              console.log(`[Environment] opencode.json config keys: ${Object.keys(config).join(', ')}`);
if (resolvedAgent && config.command?.[resolvedAgent]?.template) {
                 commandTemplate = config.command[resolvedAgent].template;
                 console.log(`[Environment] Found command template for ${resolvedAgent}: "${commandTemplate?.substring(0, 50)}..."`);
               }
            } catch (e) {
              console.log(`[Environment] Failed to read subdir opencode.json: ${e}`);
            }
          }
        } else if (subdirs.length > 1) {
          console.log(`[Environment] Multiple subdirs found, not auto-selecting`);
        }
      }
      
      // Step 2: Read instruction.txt from the determined workspace path (subdir or root)
      console.log(`[Environment] Step 2: Checking instruction.txt...`);
      const instructionPath = path.join(actualWorkspacePath, 'instruction.txt');
      console.log(`[Environment] instructionPath: ${instructionPath}`);
      console.log(`[Environment] instruction.txt exists: ${fs.existsSync(instructionPath)}`);
      const MIN_INSTRUCTION_LENGTH = 50;
      let instructionTooShort = false;
      
      if (fs.existsSync(instructionPath)) {
        try {
          const fileContent = fs.readFileSync(instructionPath, 'utf-8').trim();
          console.log(`[Environment] Read instruction.txt success, length: ${fileContent.length}`);
          console.log(`[Environment] instruction content: "${fileContent.substring(0, 100)}..."`);
          console.log(`[Environment] payload.instruction length: ${payload.instruction?.length || 0}`);
          if (fileContent.length < MIN_INSTRUCTION_LENGTH && (!payload.instruction || payload.instruction.length < MIN_INSTRUCTION_LENGTH)) {
            instructionTooShort = true;
            console.log(`[Environment] instruction too short, will use build agent`);
          }
          resolvedInstruction = fileContent;
        } catch (e) {
          console.log(`[Environment] Failed to read instruction.txt: ${e}`);
          resolvedInstruction = payload.instruction;
          if (!payload.instruction || payload.instruction.length < MIN_INSTRUCTION_LENGTH) {
            instructionTooShort = true;
          }
        }
      } else {
        console.log(`[Environment] instruction.txt not found at ${instructionPath}, checking root...`);
        // Check root as fallback
        const rootInstructionPath = path.join(localWorkspacePath, 'instruction.txt');
        if (fs.existsSync(rootInstructionPath)) {
          try {
            const fileContent = fs.readFileSync(rootInstructionPath, 'utf-8').trim();
            console.log(`[Environment] Read root instruction.txt success, length: ${fileContent.length}`);
            resolvedInstruction = fileContent;
            if (fileContent.length < MIN_INSTRUCTION_LENGTH && (!payload.instruction || payload.instruction.length < MIN_INSTRUCTION_LENGTH)) {
              instructionTooShort = true;
            }
          } catch (e) {
            console.log(`[Environment] Failed to read root instruction.txt: ${e}`);
            resolvedInstruction = payload.instruction;
            if (!payload.instruction || payload.instruction.length < MIN_INSTRUCTION_LENGTH) {
              instructionTooShort = true;
            }
          }
        } else {
          console.log(`[Environment] No instruction.txt found, using payload.instruction`);
          resolvedInstruction = payload.instruction;
          if (!payload.instruction || payload.instruction.length < MIN_INSTRUCTION_LENGTH) {
            instructionTooShort = true;
          }
        }
      }
      
      // If instruction too short and no agent resolved, use build agent
      if (instructionTooShort && !resolvedAgent) {
        console.log(`[Environment] instruction too short and no agent found, using build agent`);
        resolvedAgent = 'build';
      }
      
      console.log(`[Environment] ========== BUILD COMPLETE (NFS mode) ==========`);
      console.log(`[Environment] Result workspacePath: ${actualWorkspacePath}`);
      console.log(`[Environment] Result agent: ${resolvedAgent}`);
      console.log(`[Environment] Result instruction length: ${resolvedInstruction?.length}`);
      console.log(`[Environment] Result commandTemplate: ${commandTemplate ? 'present' : 'none'}`);
      return { workspacePath: actualWorkspacePath, agent: resolvedAgent, instruction: resolvedInstruction, commandTemplate };
    }

    // Local workspace mode
    const workspacePath = path.join(this.workspaceBasePath, payload.taskId);

    try {
      // Step 1: Create workspace directory
      fs.mkdirSync(workspacePath, { recursive: true });

      // Step 2: Populate workspace from git or local copy
      if (payload.gitUrl) {
        // Git clone mode: clone repo into a 'code' subdirectory
        const codeDir = path.join(workspacePath, 'code');
        this.gitClone(payload.gitUrl, codeDir, payload.gitRef);
      } else {
        // Local copy mode
        const projectPath = payload.projectPath;
        if (!projectPath || !fs.existsSync(projectPath)) {
          throw new Error(`Project path does not exist: ${projectPath}`);
        }
        fs.cpSync(projectPath, workspacePath, { recursive: true, filter: this.excludeNodeModulesFilter });
      }

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

      // Step 5: Generate opencode.json if model or MCP config or agent provided
      const opencodeConfig: Record<string, any> = {};
      if (payload.model) {
        opencodeConfig.model = payload.model;
      }
      if (payload.mcps && payload.mcps.length > 0) {
        opencodeConfig.mcp = this.normalizeMcpServices(payload.mcps);
      }
      if (payload.agent) {
        opencodeConfig.default_agent = payload.agent;
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
        fs.writeFileSync(
          path.join(workspacePath, 'instruction.txt'),
          payload.instruction || ''
        );
      }

      return { workspacePath, agent: payload.agent };
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
  private gitClone(gitUrl: string, targetDir: string, gitRef?: string): void {
    console.log(`[Environment] Cloning ${gitUrl} into ${targetDir}`);
    fs.mkdirSync(targetDir, { recursive: true });

    // Clone with depth 1 for efficiency, then checkout ref if specified
    const baseCmd = `git clone --depth 1 ${gitUrl} ${targetDir}`;
    try {
      execSync(baseCmd, { stdio: 'pipe', timeout: 120_000 });
    } catch {
      // Retry without --depth 1 in case the server doesn't support shallow clones
      console.warn('[Environment] Shallow clone failed, retrying full clone');
      execSync(`git clone ${gitUrl} ${targetDir}`, { stdio: 'pipe', timeout: 300_000 });
    }

    if (gitRef) {
      try {
        // Fetch the ref if it's not already available (needed for shallow clones)
        execSync(`git -C ${targetDir} fetch origin ${gitRef}`, { stdio: 'pipe', timeout: 60_000 });
      } catch {
        // ref may already be available locally
      }
      execSync(`git -C ${targetDir} checkout ${gitRef}`, { stdio: 'pipe', timeout: 30_000 });
    }

    console.log(`[Environment] Clone complete`);
  }

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
