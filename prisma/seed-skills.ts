// prisma/seed-skills.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 预定义 Skills 数据
const skillsData = [
  // ========== 代码安全审计类 ==========
  {
    name: 'sql-injection',
    displayName: 'SQL 注入检测',
    description: '检测代码中的 SQL 注入漏洞，包括字符串拼接、不安全的参数传递等',
    category: 'code-audit',
    cwe: 'CWE-89',
    severity: 'high',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测 SQL 注入漏洞。

你的任务是分析代码中的 SQL 注入风险，包括但不限于：
1. 字符串拼接构建 SQL 语句
2. 用户输入直接拼接到 SQL 中
3. 使用不安全的数据库操作方法
4. 动态表名、列名构造

请仔细分析每一段代码，找出潜在的 SQL 注入点，并提供修复建议。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的 SQL 注入漏洞，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
      language: { type: 'string', required: false, description: '编程语言' },
    }),
  },
  {
    name: 'xss-detection',
    displayName: 'XSS 漏洞扫描',
    description: '检测跨站脚本漏洞，包括反射型、存储型和 DOM 型 XSS',
    category: 'code-audit',
    cwe: 'CWE-79',
    severity: 'medium',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测 XSS 跨站脚本漏洞。

你的任务是分析代码中的 XSS 风险，包括：
1. 用户输入未经转义直接输出到 HTML
2. 危险的 DOM 操作（innerHTML、document.write）
3. 不安全的 URL 参数处理
4. 缺少内容安全策略（CSP）

请仔细分析每一段代码，找出潜在的 XSS 漏洞。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的 XSS 漏洞，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  {
    name: 'command-injection',
    displayName: '命令注入检测',
    description: '检测操作系统命令注入漏洞',
    category: 'code-audit',
    cwe: 'CWE-78',
    severity: 'critical',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测命令注入漏洞。

你的任务是分析代码中可能存在的命令注入风险，包括：
1. 用户输入拼接系统命令
2. 不安全的 exec、system、shell 等调用
3. 文件路径拼接导致的命令注入
4. 环境变量注入

请仔细分析代码，找出潜在的命令注入点。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的命令注入漏洞，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  {
    name: 'path-traversal',
    displayName: '路径遍历检测',
    description: '检测文件路径遍历漏洞',
    category: 'code-audit',
    cwe: 'CWE-22',
    severity: 'high',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测路径遍历漏洞。

你的任务是分析代码中可能存在的路径遍历风险，包括：
1. 用户输入直接用于文件路径
2. 未对 ../ 等路径序列进行过滤
3. 符号链接攻击
4. 文件扩展名验证不足

请仔细分析代码，找出潜在的路径遍历漏洞。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的路径遍历漏洞，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  // ========== 认证与授权类 ==========
  {
    name: 'auth-bypass',
    displayName: '认证绕过检测',
    description: '检测身份认证和授权绕过漏洞',
    category: 'auth',
    cwe: 'CWE-287',
    severity: 'critical',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测认证和授权漏洞。

你的任务是分析代码中的认证和授权问题，包括：
1. 认证逻辑缺陷
2. 会话管理漏洞
3. 权限检查缺失
4. 越权访问风险

请仔细分析代码，找出潜在的认证和授权问题。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的认证和授权漏洞，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  {
    name: 'session-management',
    displayName: '会话管理检测',
    description: '检测会话管理相关安全问题',
    category: 'auth',
    cwe: 'CWE-384',
    severity: 'high',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测会话管理漏洞。

你的任务是分析代码中的会话管理问题，包括：
1. 会话 ID 可预测
2. 会话固定攻击
3. 会话超时设置不当
4. Cookie 安全属性缺失

请仔细分析代码，找出潜在的会话管理问题。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的会话管理漏洞，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  // ========== 敏感信息泄露类 ==========
  {
    name: 'hardcoded-secrets',
    displayName: '硬编码密钥检测',
    description: '检测代码中硬编码的敏感信息，如密码、API密钥等',
    category: 'sensitive',
    cwe: 'CWE-798',
    severity: 'high',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测硬编码的敏感信息。

你的任务是分析代码中可能存在的硬编码敏感信息，包括：
1. 硬编码的密码
2. API 密钥和 Token
3. 加密密钥
4. 数据库连接字符串
5. 私钥和证书

请仔细分析代码，找出潜在的硬编码敏感信息。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的硬编码敏感信息，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  {
    name: 'info-disclosure',
    displayName: '信息泄露检测',
    description: '检测可能导致敏感信息泄露的代码',
    category: 'sensitive',
    cwe: 'CWE-200',
    severity: 'medium',
    systemPrompt: `你是一个专业的安全代码审计专家，专注于检测信息泄露漏洞。

你的任务是分析代码中可能导致信息泄露的问题，包括：
1. 错误信息泄露敏感数据
2. 调试信息未移除
3. 日志记录敏感信息
4. 注释中的敏感信息

请仔细分析代码，找出潜在的信息泄露问题。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的信息泄露问题，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  // ========== API 安全类 ==========
  {
    name: 'api-broken-auth',
    displayName: 'API 认证检测',
    description: '检测 API 认证机制缺陷',
    category: 'api',
    cwe: 'CWE-306',
    severity: 'critical',
    systemPrompt: `你是一个专业的 API 安全专家，专注于检测 API 认证问题。

你的任务是分析 API 代码中的认证问题，包括：
1. 缺少认证检查
2. 认证机制缺陷
3. API 密钥管理不当
4. JWT 安全问题

请仔细分析代码，找出潜在的 API 认证问题。`,
    userPrompt: `请分析以下 API 代码：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的 API 认证问题，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  {
    name: 'api-rate-limit',
    displayName: 'API 限流检测',
    description: '检测 API 限流和滥用防护机制',
    category: 'api',
    cwe: 'CWE-770',
    severity: 'medium',
    systemPrompt: `你是一个专业的 API 安全专家，专注于检测 API 限流问题。

你的任务是分析 API 代码中的限流问题，包括：
1. 缺少速率限制
2. 限流机制可绕过
3. 资源消耗无限制
4. 批量请求攻击风险

请仔细分析代码，找出潜在的 API 限流问题。`,
    userPrompt: `请分析以下 API 代码：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的 API 限流问题，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  // ========== 加密与数据类 ==========
  {
    name: 'weak-crypto',
    displayName: '弱加密检测',
    description: '检测使用弱加密算法或不安全加密实践',
    category: 'crypto',
    cwe: 'CWE-327',
    severity: 'high',
    systemPrompt: `你是一个专业的密码学安全专家，专注于检测弱加密问题。

你的任务是分析代码中的加密问题，包括：
1. 使用弱加密算法（DES、RC4 等）
2. 使用不安全的加密模式（ECB）
3. 硬编码密钥
4. 缺少完整性验证

请仔细分析代码，找出潜在的加密安全问题。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的加密安全问题，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  {
    name: 'insecure-random',
    displayName: '不安全随机数检测',
    description: '检测使用不安全的随机数生成器',
    category: 'crypto',
    cwe: 'CWE-338',
    severity: 'medium',
    systemPrompt: `你是一个专业的密码学安全专家，专注于检测随机数安全问题。

你的任务是分析代码中的随机数问题，包括：
1. 使用伪随机数生成器生成安全敏感数据
2. 随机数种子可预测
3. 随机数范围不足
4. UUID 生成不安全

请仔细分析代码，找出潜在的随机数安全问题。`,
    userPrompt: `请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的随机数安全问题，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  // ========== 配置安全类 ==========
  {
    name: 'insecure-config',
    displayName: '不安全配置检测',
    description: '检测不安全的配置设置',
    category: 'config',
    cwe: 'CWE-16',
    severity: 'medium',
    systemPrompt: `你是一个专业的安全配置专家，专注于检测不安全配置问题。

你的任务是分析配置代码中的安全问题，包括：
1. 调试模式未关闭
2. 详细错误信息暴露
3. 默认密码未修改
4. 不安全的 CORS 配置
5. 安全头缺失

请仔细分析配置，找出潜在的安全问题。`,
    userPrompt: `请分析以下配置文件：\n\n文件路径：{{filePath}}\n\n配置内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的安全配置问题，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
  {
    name: 'dependency-vuln',
    displayName: '依赖漏洞检测',
    description: '检测有漏洞的依赖包',
    category: 'config',
    cwe: 'CWE-1035',
    severity: 'high',
    systemPrompt: `你是一个专业的供应链安全专家，专注于检测依赖漏洞问题。

你的任务是分析项目依赖中的安全问题，包括：
1. 已知漏洞的依赖版本
2. 过时的依赖包
3. 不安全的依赖配置
4. 依赖冲突

请仔细分析依赖文件，找出潜在的安全问题。`,
    userPrompt: `请分析以下依赖配置：\n\n文件路径：{{filePath}}\n\n内容：\n\`\`\`{{language}}\n{{code}}\n\`\`\`\n\n请检测其中的依赖安全问题，输出 JSON 格式的结果。`,
    tools: JSON.stringify(['read_file', 'search_pattern']),
    parameters: JSON.stringify({
      filePath: { type: 'string', required: true, description: '要分析的文件路径' },
    }),
  },
];

async function main() {
  console.log('开始种子 Skills 数据...');

  for (const skill of skillsData) {
    const existing = await prisma.skill.findUnique({
      where: { name: skill.name },
    });

    if (existing) {
      console.log(`Skill "${skill.name}" 已存在，跳过`);
      continue;
    }

    await prisma.skill.create({
      data: {
        ...skill,
        isBuiltin: true,
      },
    });
    console.log(`创建 Skill "${skill.name}"`);
  }

  console.log('Skills 种子数据完成！');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
