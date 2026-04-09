// prisma/seed-skills-simple.ts
// 简化版 Skills 种子数据 - 不解析 content，直接存储 Markdown

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 生成 Skill content 的辅助函数
function generateSkillContent(data: {
  name: string;
  description: string;
  severity: string;
  cwe?: string;
  systemPrompt: string;
  userPrompt: string;
  tools?: string[];
}): string {
  const sections = [
    `# ${data.name}`,
    '',
    '## 描述',
    data.description,
    '',
    '## 严重程度',
    data.severity,
  ];

  if (data.cwe) {
    sections.push('', '## CWE 编号', data.cwe);
  }

  sections.push('', '## 系统提示词', data.systemPrompt);
  sections.push('', '## 用户提示词', data.userPrompt);

  if (data.tools && data.tools.length > 0) {
    sections.push('', '## 工具');
    data.tools.forEach(tool => {
      sections.push(`- ${tool}`);
    });
  }

  return sections.join('\n');
}

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
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 SQL 注入漏洞。\n\n你的任务是分析代码中的 SQL 注入风险，包括但不限于：\n1. 字符串拼接构建 SQL 语句\n2. 用户输入直接拼接到 SQL 中\n3. 使用不安全的数据库操作方法\n4. 动态表名、列名构造\n\n请仔细分析每一段代码，找出潜在的 SQL 注入点，并提供修复建议。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 SQL 注入漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'xss-detection',
    displayName: 'XSS 漏洞扫描',
    description: '检测跨站脚本漏洞，包括反射型、存储型和 DOM 型 XSS',
    category: 'code-audit',
    cwe: 'CWE-79',
    severity: 'medium',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 XSS 跨站脚本漏洞。\n\n你的任务是分析代码中的 XSS 风险，包括：\n1. 用户输入未经转义直接输出到 HTML\n2. 危险的 DOM 操作（innerHTML、document.write）\n3. 不安全的 URL 参数处理\n4. 缺少内容安全策略（CSP）\n\n请仔细分析每一段代码，找出潜在的 XSS 漏洞。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 XSS 漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'command-injection',
    displayName: '命令注入检测',
    description: '检测操作系统命令注入漏洞',
    category: 'code-audit',
    cwe: 'CWE-78',
    severity: 'critical',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测命令注入漏洞。\n\n你的任务是分析代码中可能存在的命令注入风险，包括：\n1. 用户输入拼接系统命令\n2. 不安全的 exec、system、shell 等调用\n3. 文件路径拼接导致的命令注入\n4. 环境变量注入\n\n请仔细分析代码，找出潜在的命令注入点。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的命令注入漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'path-traversal',
    displayName: '路径遍历检测',
    description: '检测文件路径遍历漏洞',
    category: 'code-audit',
    cwe: 'CWE-22',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测路径遍历漏洞。\n\n你的任务是分析代码中可能存在的路径遍历风险，包括：\n1. 用户输入直接用于文件路径\n2. 未对 ../ 等路径序列进行过滤\n3. 符号链接攻击\n4. 文件扩展名验证不足\n\n请仔细分析代码，找出潜在的路径遍历漏洞。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的路径遍历漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'xxe-detection',
    displayName: 'XXE 漏洞检测',
    description: '检测 XML 外部实体注入漏洞',
    category: 'code-audit',
    cwe: 'CWE-611',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 XXE 漏洞。\n\n你的任务是分析代码中可能存在的 XXE 风险，包括：\n1. 不安全的 XML 解析器配置\n2. 允许外部实体引用\n3. 允许 DTD 处理\n4. 未禁用实体扩展\n\n请仔细分析代码，找出潜在的 XXE 漏洞。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 XXE 漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'ssrf-detection',
    displayName: 'SSRF 漏洞检测',
    description: '检测服务端请求伪造漏洞',
    category: 'code-audit',
    cwe: 'CWE-918',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 SSRF 漏洞。\n\n你的任务是分析代码中可能存在的 SSRF 风险，包括：\n1. 用户输入直接用于 URL 构建\n2. 未验证目标地址\n3. 可访问内网资源\n4. 未限制协议和端口\n\n请仔细分析代码，找出潜在的 SSRF 漏洞。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 SSRF 漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  
  // ========== 认证鉴权类 ==========
  {
    name: 'auth-bypass',
    displayName: '认证绕过检测',
    description: '检测身份认证绕过漏洞',
    category: 'auth',
    cwe: 'CWE-287',
    severity: 'critical',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测认证绕过漏洞。\n\n你的任务是分析代码中可能存在的认证绕过风险，包括：\n1. 缺少认证检查\n2. 认证逻辑缺陷\n3. 会话管理问题\n4. 权限提升漏洞\n\n请仔细分析代码，找出潜在的认证绕过点。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的认证绕过漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'session-management',
    displayName: '会话管理检测',
    description: '检测会话管理相关的安全问题',
    category: 'auth',
    cwe: 'CWE-384',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测会话管理问题。\n\n你的任务是分析代码中可能存在的会话管理风险，包括：\n1. 会话固定攻击\n2. 会话超时设置不当\n3. 会话未正确销毁\n4. 会话 ID 可预测\n\n请仔细分析代码，找出潜在的会话管理问题。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的会话管理问题，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'jwt-security',
    displayName: 'JWT 安全检测',
    description: '检测 JWT 实现中的安全问题',
    category: 'auth',
    cwe: 'CWE-287',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 JWT 安全问题。\n\n你的任务是分析代码中可能存在的 JWT 风险，包括：\n1. 使用弱密钥或空密钥\n2. 未验证签名\n3. 算法混淆攻击\n4. 敏感信息泄露\n\n请仔细分析代码，找出潜在的 JWT 安全问题。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 JWT 安全问题，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  
  // ========== 敏感信息泄露类 ==========
  {
    name: 'hardcoded-secrets',
    displayName: '硬编码密钥检测',
    description: '检测代码中硬编码的密钥、密码、API Key 等敏感信息',
    category: 'sensitive',
    cwe: 'CWE-798',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测硬编码的敏感信息。\n\n你的任务是分析代码中可能存在的硬编码敏感信息，包括：\n1. API Keys 和 Tokens\n2. 数据库密码\n3. 加密密钥\n4. 认证凭据\n5. 私钥文件\n\n请仔细分析代码，找出所有硬编码的敏感信息。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的硬编码敏感信息，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'info-disclosure',
    displayName: '信息泄露检测',
    description: '检测可能泄露敏感信息的代码',
    category: 'sensitive',
    cwe: 'CWE-200',
    severity: 'medium',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测信息泄露问题。\n\n你的任务是分析代码中可能存在的信息泄露风险，包括：\n1. 详细错误信息暴露\n2. 调试信息泄露\n3. 版本信息暴露\n4. 内部路径泄露\n\n请仔细分析代码，找出潜在的信息泄露点。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的信息泄露问题，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  
  // ========== API 安全类 ==========
  {
    name: 'api-broken-auth',
    displayName: 'API 认证缺陷检测',
    description: '检测 API 认证机制中的安全问题',
    category: 'api',
    cwe: 'CWE-287',
    severity: 'critical',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 API 认证问题。\n\n你的任务是分析代码中可能存在的 API 认证风险，包括：\n1. 缺少认证机制\n2. 认证令牌不安全\n3. 认证绕过\n4. 弱密码策略\n\n请仔细分析代码，找出潜在的 API 认证问题。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 API 认证问题，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  {
    name: 'api-idor',
    displayName: 'IDOR 漏洞检测',
    description: '检测不安全的直接对象引用漏洞',
    category: 'api',
    cwe: 'CWE-639',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 IDOR 漏洞。\n\n你的任务是分析代码中可能存在的 IDOR 风险，包括：\n1. 未验证资源所有权\n2. 可预测的资源 ID\n3. 缺少访问控制检查\n4. 批量操作未授权\n\n请仔细分析代码，找出潜在的 IDOR 漏洞。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 IDOR 漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  
  // ========== 配置安全类 ==========
  {
    name: 'insecure-config',
    displayName: '不安全配置检测',
    description: '检测应用程序配置中的安全问题',
    category: 'config',
    cwe: 'CWE-16',
    severity: 'medium',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测配置安全问题。\n\n你的任务是分析代码中可能存在的配置风险，包括：\n1. 调试模式未关闭\n2. 不安全的默认配置\n3. 敏感配置硬编码\n4. 不安全的 CORS 配置\n\n请仔细分析代码，找出潜在的配置安全问题。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的配置安全问题，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  
  // ========== 加密解密类 ==========
  {
    name: 'weak-crypto',
    displayName: '弱加密检测',
    description: '检测使用弱加密算法或不安全的加密实践',
    category: 'crypto',
    cwe: 'CWE-327',
    severity: 'high',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测加密问题。\n\n你的任务是分析代码中可能存在的加密风险，包括：\n1. 使用弱加密算法（DES、RC4 等）\n2. 使用不安全的模式（ECB）\n3. 硬编码密钥\n4. 缺少完整性验证\n\n请仔细分析代码，找出潜在的加密问题。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的加密问题，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
  
  // ========== Web 安全类 ==========
  {
    name: 'csrf',
    displayName: 'CSRF 漏洞检测',
    description: '检测跨站请求伪造漏洞',
    category: 'web',
    cwe: 'CWE-352',
    severity: 'medium',
    systemPrompt: '你是一个专业的安全代码审计专家，专注于检测 CSRF 漏洞。\n\n你的任务是分析代码中可能存在的 CSRF 风险，包括：\n1. 缺少 CSRF Token\n2. 验证不足\n3. 状态改变操作未保护\n4. CORS 配置不当\n\n请仔细分析代码，找出潜在的 CSRF 漏洞。',
    userPrompt: '请分析以下代码文件：\n\n文件路径：{{filePath}}\n\n代码内容：\n```{{language}}\n{{code}}\n```\n\n请检测其中的 CSRF 漏洞，输出 JSON 格式的结果。',
    tools: ['read_file', 'search_pattern'],
  },
];

async function main() {
  console.log('开始种子 Skills 数据...');

  let created = 0;
  let skipped = 0;

  for (const skillData of skillsData) {
    // 内置 Skills 的 userId 为 null，使用 name 作为唯一标识
    const existing = await prisma.skill.findFirst({
      where: {
        userId: null,
        name: skillData.name,
      },
    });

    if (existing) {
      console.log(`Skill "${skillData.name}" 已存在，跳过`);
      skipped++;
      continue;
    }

    // 生成完整的 content
    const content = generateSkillContent(skillData);

    await prisma.skill.create({
      data: {
        name: skillData.name,
        displayName: skillData.displayName,
        description: skillData.description,
        category: skillData.category,
        cwe: skillData.cwe || null,
        severity: skillData.severity,
        content, // 完整的 Markdown 内容
        isBuiltin: true,
        userId: null, // 内置 Skills 没有用户关联
      },
    });
    console.log(`创建 Skill "${skillData.name}"`);
    created++;
  }

  console.log(`\nSkills 种子数据完成！创建: ${created}, 跳过: ${skipped}, 总计: ${skillsData.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
