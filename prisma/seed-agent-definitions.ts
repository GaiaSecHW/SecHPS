import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

// Frontmatter parser for markdown files
function parseFrontmatter(content: string): Record<string, any> | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const frontmatterStr = frontmatterMatch[1];
  const result: Record<string, any> = {};

  frontmatterStr.split('\n').forEach(line => {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      let value = line.slice(colonIndex + 1).trim();

      // Parse JSON arrays
      if (value.startsWith('[') && value.endsWith(']')) {
        try {
          value = JSON.parse(value);
        } catch {
          // Keep as string if parse fails
        }
      }

      // Parse booleans
      if (value === 'true') value = true;
      else if (value === 'false') value = false;

      result[key] = value;
    }
  });

  return result;
}

// Get system prompt (content after frontmatter)
function getSystemPrompt(content: string): string {
  const frontmatterEnd = content.indexOf('\n---\n', 4);
  if (frontmatterEnd === -1) return content;

  // Find the second --- marker
  const secondMarker = content.indexOf('\n---', frontmatterEnd + 5);
  if (secondMarker === -1) return content;

  return content.slice(secondMarker + 5).trim();
}

async function main() {
  console.log('🌱 开始 AgentDefinition 种子数据初始化...');

  const agentsDir = path.join(process.cwd(), 'data', 'agents');

  // Check if agents directory exists
  if (!fs.existsSync(agentsDir)) {
    console.log('⚠️  data/agents 目录不存在，跳过种子数据');
    return;
  }

  // Read all markdown files
  const files = fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'));

  if (files.length === 0) {
    console.log('⚠️  data/agents 目录中没有 markdown 文件');
    return;
  }

  console.log(`📋 发现 ${files.length} 个 Agent 定义文件`);

  for (const file of files) {
    const filePath = path.join(agentsDir, file);
    const content = fs.readFileSync(filePath, 'utf-8');

    const frontmatter = parseFrontmatter(content);
    if (!frontmatter) {
      console.log(`⚠️  ${file} 缺少 frontmatter，跳过`);
      continue;
    }

    const systemPrompt = getSystemPrompt(content);

    // Validate required fields
    if (!frontmatter.name || !frontmatter.displayName) {
      console.log(`⚠️  ${file} 缺少必要字段 (name, displayName)，跳过`);
      continue;
    }

    // Create or update AgentDefinition
    try {
      const agentData = {
        name: frontmatter.name as string,
        displayName: frontmatter.displayName as string,
        description: (frontmatter.description as string) || '',
        category: (frontmatter.category as string) || 'general',
        model: (frontmatter.model as string) || 'sonnet',
        systemPrompt: systemPrompt,
        allowedTools: frontmatter.tools ? JSON.stringify(frontmatter.tools) : null,
        isActive: true,
        isBuiltin: (frontmatter.isBuiltin as boolean) ?? true,
        userId: null, // Built-in agents have no userId
      };

      await prisma.agentDefinition.upsert({
        where: { name: agentData.name },
        update: agentData,
        create: agentData,
      });

      console.log(`✅ 已创建/更新 Agent: ${agentData.displayName} (${agentData.name})`);
    } catch (error) {
      console.log(`❌ 创建 Agent ${file} 失败:`, error);
    }
  }

  // Verify created agents
  const createdAgents = await prisma.agentDefinition.findMany({
    where: { isBuiltin: true },
  });

  console.log(`\n🎉 AgentDefinition 种子数据初始化完成！`);
  console.log(`   已创建 ${createdAgents.length} 个内置 Agent`);

  for (const agent of createdAgents) {
    console.log(`   - ${agent.displayName} (${agent.name}) [${agent.model}]`);
  }
}

main()
  .catch((e) => {
    console.error('❌ 初始化失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });