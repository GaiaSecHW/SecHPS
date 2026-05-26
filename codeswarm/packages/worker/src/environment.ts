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
  model?: string;
  engine?: 'opencode' | 'claudecode';
}

export type BuildProgressCallback = (message: string) => void;

/**
 * Derive a provider ID from a model name.
 * - "alibaba-cn/MiniMax/MiniMax-M2.7" → "alibaba-cn"
 * - "MiniMax/MiniMax-M2.5" → "MiniMax"
 * - "MiniMax-M2.7" (no slash) → "minimax" (first word, lowercase)
 * - "DeepSeek-V3" → "deepseek"
 */
function deriveProviderId(model: string): string {
  if (model.includes('/')) {
    return model.split('/')[0];
  }
  // Bare model name: extract first word segment as provider ID
  const firstWord = model.split(/[-._]/)[0];
  return firstWord.toLowerCase();
}

/**
 * Extract the model ID from a possibly prefixed model name.
 * - "minimax/MiniMax-M2.7" → "MiniMax-M2.7"
 * - "MiniMax-M2.7" → "MiniMax-M2.7" (bare name, unchanged)
 */
function extractModelId(model: string): string {
  if (model.includes('/')) {
    return model.slice(model.indexOf('/') + 1);
  }
  return model;
}

/**
 * Build the opencode.json model/provider config for a given model, apiKey, and apiBaseUrl.
 * Returns a partial config object to merge into the opencode.json.
 *
 * When apiBaseUrl is provided, we create a custom provider using @ai-sdk/openai-compatible
 * so opencode can route to arbitrary OpenAI-compatible endpoints.
 * The provider ID is prefixed with "custom-" to distinguish from built-in providers.
 *
 * Without apiBaseUrl, we just set the model and inject apiKey into the existing provider.
 */
function buildModelConfig(model: string, apiKey?: string, apiBaseUrl?: string): Record<string, any> {
  const config: Record<string, any> = {};
  if (!model) return config;

  if (apiBaseUrl) {
    const customProviderId = `custom-${deriveProviderId(model)}`;
    const modelId = extractModelId(model);
    // Model reference format: "provider_id/model_key" where provider_id = customProviderId,
    // model_key = raw model name (e.g. "MiniMax/MiniMax-M2.5").
    // opencode resolves this as: provider "custom-MiniMax", model key "MiniMax/MiniMax-M2.5"
    // This matches examples like "alibaba-cn/MiniMax/MiniMax-M2.7" from opencode models list.
    config.model = `${customProviderId}/${model}`;
    if (apiKey) {
      config.provider = {
        ...(config.provider || {}),
        [customProviderId]: {
          npm: '@ai-sdk/openai-compatible',
          name: deriveProviderId(model),
          models: {
            // Key = raw model name for opencode model lookup; name = display name (modelId only)
            [model]: { name: modelId },
          },
          options: {
            apiKey,
            baseURL: apiBaseUrl,
          },
        },
      };
    }
  } else {
    // For built-in providers, provider ID must match opencode's naming convention (lowercase)
    const providerId = deriveProviderId(model).toLowerCase();
    const modelId = extractModelId(model);
    config.model = `${providerId}/${modelId}`;
    if (apiKey) {
      if (providerId) {
        config.provider = {
          ...(config.provider || {}),
          [providerId]: {
            ...(config.provider?.[providerId] || {}),
            options: {
              ...(config.provider?.[providerId]?.options || {}),
              apiKey,
            },
          },
        };
      }
    }
  }
  return config;
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
   * Priority: workspacePath (NFS) > projectPath (local copy)
   */
  async build(payload: TaskPayload, onProgress?: BuildProgressCallback, engine?: 'opencode' | 'claudecode'): Promise<BuildResult> {
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

      // opencode.json is opencode-specific config; skip for claudecode engine
      if (engine !== 'claudecode') {
        progress(`Step 2: 检查 opencode.json...`);
        const directOpencodeJsonPath = path.join(localWorkspacePath, 'opencode.json');
        progress(`opencode.json exists: ${fs.existsSync(directOpencodeJsonPath)}`);
        if (fs.existsSync(directOpencodeJsonPath)) {
          progress(`找到 opencode.json，读取配置...`);
          try {
            const rawConfig = fs.readFileSync(directOpencodeJsonPath, 'utf-8').replace(/^﻿/, '');
            const config: Record<string, any> = JSON.parse(rawConfig);
            resolvedAgent = config.default_agent || config.defaultAgent;
            progress(`default_agent: ${resolvedAgent}`);
            if (resolvedAgent && config.command?.[resolvedAgent]?.template) {
              commandTemplate = config.command[resolvedAgent].template;
              progress(`command template: ${commandTemplate?.substring(0, 50)}...`);
            }

            if (payload.model || payload.apiKey || payload.apiBaseUrl) {
              progress(`注入模型配置: model=${payload.model}, apiKey=${!!payload.apiKey}, apiBaseUrl=${payload.apiBaseUrl || 'none'}`);
              const modelConfig = buildModelConfig(payload.model || '', payload.apiKey, payload.apiBaseUrl);
              Object.assign(config, modelConfig);
              if (modelConfig.model) progress(`配置模型: ${modelConfig.model} (from ${payload.model})`);
              if (modelConfig.provider) {
                const providerKeys = Object.keys(modelConfig.provider);
                progress(`配置 provider: ${providerKeys.join(', ')}`);
              }
              fs.writeFileSync(directOpencodeJsonPath, JSON.stringify(config, null, 2));
              progress(`opencode.json 已更新模型配置`);
            }
          } catch (e) {
            progress(`读取 opencode.json 失败: ${e}`);
          }
        } else {
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
                const config: Record<string, any> = JSON.parse(fs.readFileSync(subdirOpencodeJsonPath, 'utf-8').replace(/^﻿/, ''));
                resolvedAgent = config.default_agent || config.defaultAgent;
                progress(`default_agent: ${resolvedAgent}`);
                if (resolvedAgent && config.command?.[resolvedAgent]?.template) {
                  commandTemplate = config.command[resolvedAgent].template;
                  progress(`command template: ${commandTemplate?.substring(0, 50)}...`);
                }

                if (payload.model || payload.apiKey || payload.apiBaseUrl) {
                  progress(`注入模型配置(subdir): model=${payload.model}, apiKey=${!!payload.apiKey}, apiBaseUrl=${payload.apiBaseUrl || 'none'}`);
                  const modelConfig = buildModelConfig(payload.model || '', payload.apiKey, payload.apiBaseUrl);
                  Object.assign(config, modelConfig);
                  if (modelConfig.model) progress(`配置模型(subdir): ${modelConfig.model} (from ${payload.model})`);
                  fs.writeFileSync(subdirOpencodeJsonPath, JSON.stringify(config, null, 2));
                  progress(`子目录 opencode.json 已更新模型配置`);
                }
              } catch (e) {
                progress(`读取子目录 opencode.json 失败: ${e}`);
              }
            }
} else if (subdirs.length > 1) {
            progress(`多个子目录，不自动选择`);
          }
          // If no opencode.json was found in workspace, auto-generate one with model config
          if (payload.model && !fs.existsSync(path.join(actualWorkspacePath, 'opencode.json'))) {
            progress(`No opencode.json found in workspace, auto-generating with model config`);
            const autoConfig: Record<string, any> = {
              "$schema": "https://opencode.ai/config.json",
            };
            const modelConfig = buildModelConfig(payload.model, payload.apiKey, payload.apiBaseUrl);
            Object.assign(autoConfig, modelConfig);
            if (payload.agent) {
              autoConfig.default_agent = payload.agent;
            }
            const autoConfigPath = path.join(localWorkspacePath, 'opencode.json');
            fs.writeFileSync(autoConfigPath, JSON.stringify(autoConfig, null, 2));
            progress(`自动生成 opencode.json: model=${autoConfig.model}, agent=${payload.agent || 'none'}`);
          }
        }
      } else {
        progress(`Step 2: 跳过 opencode.json 检查 (claudecode engine)`);
      }

      // Write .opencode/.npmrc (offline=true) — prevent opencode from installing npm packages
      const opencodeDir = path.join(actualWorkspacePath, '.opencode');
      fs.mkdirSync(opencodeDir, { recursive: true });
      fs.writeFileSync(path.join(opencodeDir, '.npmrc'), 'offline=true\n');
      progress(`写入 .opencode/.npmrc (offline=true)`);

      progress(`BUILD COMPLETE (NFS mode) - workspace: ${actualWorkspacePath}, agent: ${resolvedAgent}`);
      return { workspacePath: actualWorkspacePath, agent: resolvedAgent, instruction: resolvedInstruction, commandTemplate, model: payload.model };
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

      // Write .opencode/.npmrc (offline=true) — prevent opencode from installing npm packages
      fs.writeFileSync(path.join(workspacePath, '.opencode', '.npmrc'), 'offline=true\n');

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

// Step 5: Generate opencode.json (opencode engine only)
      if (engine !== 'claudecode') {
        const opencodeConfig: Record<string, any> = {};
        if (payload.model) {
          const modelConfig = buildModelConfig(payload.model, payload.apiKey, payload.apiBaseUrl);
          Object.assign(opencodeConfig, modelConfig);
          if (modelConfig.model) progress(`配置模型: ${modelConfig.model} (from ${payload.model})`);
          if (modelConfig.provider) {
            const providerKeys = Object.keys(modelConfig.provider);
            progress(`配置 provider: ${providerKeys.join(', ')}`);
          }
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
      } else {
        progress(`Step 5: 跳过 opencode.json 生成 (claudecode engine)`);
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
