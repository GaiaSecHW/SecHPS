/**
 * VulnerabilityPattern 种子数据
 * 16 个漏洞分类 + 40+ 个漏洞模式
 */
import { prisma } from '../src/lib/prisma';

const vulnerabilityPatterns = [
  // === 注入类 (injection) ===
  { id: 'vp_sqli', name: 'sql-injection', displayName: 'SQL 注入', category: 'injection', cwe: 'CWE-89', languages: 'java,python,php,javascript,go,dotnet,ruby', description: 'SQL 注入漏洞检测' },
  { id: 'vp_xss', name: 'xss', displayName: 'XSS 跨站脚本', category: 'injection', cwe: 'CWE-79', languages: 'java,python,php,javascript,go,dotnet,ruby', description: 'XSS 跨站脚本漏洞检测' },
  { id: 'vp_cmdi', name: 'command-injection', displayName: '命令注入', category: 'injection', cwe: 'CWE-78', languages: 'java,python,php,javascript,go,ruby', description: '命令注入漏洞检测' },
  { id: 'vp_xxe', name: 'xxe', displayName: 'XXE 外部实体注入', category: 'injection', cwe: 'CWE-611', languages: 'java,python,php,javascript', description: 'XXE 外部实体注入漏洞检测' },
  { id: 'vp_jndi', name: 'jndi-injection', displayName: 'JNDI 注入', category: 'injection', cwe: 'CWE-917', languages: 'java', description: 'JNDI 注入漏洞检测' },
  { id: 'vp_ssrf', name: 'ssrf', displayName: 'SSRF 服务端请求伪造', category: 'injection', cwe: 'CWE-918', languages: 'java,python,php,javascript,go', description: 'SSRF 服务端请求伪造漏洞检测' },
  { id: 'vp_script_engine', name: 'script-engine-injection', displayName: '脚本引擎注入', category: 'injection', cwe: 'CWE-94', languages: 'java', description: '脚本引擎注入漏洞检测' },
  { id: 'vp_mybatis', name: 'mybatis-injection', displayName: 'MyBatis 注入', category: 'injection', cwe: 'CWE-89', languages: 'java', description: 'MyBatis SQL 注入漏洞检测' },
  
  // === 反序列化类 (deserialization) ===
  { id: 'vp_java_deser', name: 'java-deserialization', displayName: 'Java 反序列化', category: 'deserialization', cwe: 'CWE-502', languages: 'java', description: 'Java 反序列化漏洞检测' },
  { id: 'vp_fastjson_deser', name: 'fastjson-deserialization', displayName: 'Fastjson 反序列化', category: 'deserialization', cwe: 'CWE-502', languages: 'java', description: 'Fastjson 反序列化漏洞检测' },
  { id: 'vp_java_gadget', name: 'java-gadget-chains', displayName: 'Java Gadget 链', category: 'deserialization', cwe: 'CWE-502', languages: 'java', description: 'Java Gadget 链漏洞检测' },
  { id: 'vp_python_deser', name: 'python-deserialization', displayName: 'Python 反序列化', category: 'deserialization', cwe: 'CWE-502', languages: 'python', description: 'Python 反序列化漏洞检测' },
  { id: 'vp_php_deser', name: 'php-deserialization', displayName: 'PHP 反序列化', category: 'deserialization', cwe: 'CWE-502', languages: 'php', description: 'PHP 反序列化漏洞检测' },
  
  // === 认证授权类 (auth) ===
  { id: 'vp_auth_bypass', name: 'auth-bypass', displayName: '认证绕过', category: 'auth', cwe: 'CWE-287', languages: 'java,python,php,javascript,go,dotnet,ruby', description: '认证绕过漏洞检测' },
  { id: 'vp_idor', name: 'idor', displayName: 'IDOR 越权访问', category: 'auth', cwe: 'CWE-639', languages: 'java,python,php,javascript,go,dotnet,ruby', description: 'IDOR 越权访问漏洞检测' },
  { id: 'vp_unauth', name: 'unauthorized-access', displayName: '未授权访问', category: 'auth', cwe: 'CWE-862', languages: 'java,python,php,javascript,go,dotnet,ruby', description: '未授权访问漏洞检测' },
  { id: 'vp_oauth', name: 'oauth-security', displayName: 'OAuth 安全', category: 'auth', cwe: 'CWE-287', languages: 'java,python,php,javascript', description: 'OAuth 安全漏洞检测' },
  { id: 'vp_cross_service', name: 'cross-service-trust', displayName: '跨服务信任', category: 'auth', cwe: 'CWE-287', languages: 'java,python,javascript,go', description: '跨服务信任漏洞检测' },
  
  // === 文件操作类 (file) ===
  { id: 'vp_file_upload', name: 'file-upload', displayName: '文件上传漏洞', category: 'file', cwe: 'CWE-434', languages: 'java,python,php,javascript,go', description: '文件上传漏洞检测' },
  { id: 'vp_file_ops', name: 'file-operations', displayName: '文件操作安全', category: 'file', cwe: 'CWE-73', languages: 'java,python,php,javascript,go', description: '文件操作安全漏洞检测' },
  
  // === 路径遍历类 (traversal) ===
  { id: 'vp_path_traversal', name: 'path-traversal', displayName: '路径遍历', category: 'traversal', cwe: 'CWE-22', languages: 'java,python,php,javascript,go,dotnet', description: '路径遍历漏洞检测' },
  
  // === 业务逻辑类 (logic) ===
  { id: 'vp_logic_flaw', name: 'logic-flaw', displayName: '业务逻辑漏洞', category: 'logic', cwe: 'CWE-840', languages: 'java,python,php,javascript,go,dotnet,ruby', description: '业务逻辑漏洞检测' },
  { id: 'vp_business_logic', name: 'business-logic', displayName: '业务逻辑安全', category: 'logic', cwe: 'CWE-840', languages: 'java,python,php,javascript,go', description: '业务逻辑安全漏洞检测' },
  { id: 'vp_race', name: 'race-condition', displayName: '竞态条件', category: 'logic', cwe: 'CWE-362', languages: 'java,python,php,javascript,go', description: '竞态条件漏洞检测' },
  { id: 'vp_scheduled', name: 'scheduled-task-security', displayName: '定时任务安全', category: 'logic', cwe: 'CWE-862', languages: 'java,python,php', description: '定时任务安全漏洞检测' },
  
  // === 信息泄露类 (info) ===
  { id: 'vp_info_disclosure', name: 'info-disclosure', displayName: '信息泄露', category: 'info', cwe: 'CWE-200', languages: 'java,python,php,javascript,go,dotnet,ruby', description: '信息泄露漏洞检测' },
  { id: 'vp_logging', name: 'logging-security', displayName: '日志安全', category: 'info', cwe: 'CWE-532', languages: 'java,python,php,javascript,go', description: '日志安全漏洞检测' },
  
  // === 加密类 (crypto) ===
  { id: 'vp_weak_crypto', name: 'weak-crypto', displayName: '弱加密算法', category: 'crypto', cwe: 'CWE-327', languages: 'java,python,php,javascript,go', description: '弱加密算法漏洞检测' },
  
  // === API 安全类 (api) ===
  { id: 'vp_api_security', name: 'api-security', displayName: 'API 安全', category: 'api', cwe: 'CWE-287', languages: 'java,python,php,javascript,go', description: 'API 安全漏洞检测' },
  { id: 'vp_graphql', name: 'graphql-security', displayName: 'GraphQL 安全', category: 'api', cwe: 'CWE-287', languages: 'java,python,javascript', description: 'GraphQL 安全漏洞检测' },
  
  // === 供应链类 (supply-chain) ===
  { id: 'vp_dependency', name: 'dependency-vuln', displayName: '依赖漏洞', category: 'supply-chain', cwe: 'CWE-1035', languages: 'java,python,php,javascript,go', description: '依赖漏洞检测' },
  { id: 'vp_infra_supply', name: 'infra-supply-chain', displayName: '基础设施供应链', category: 'supply-chain', cwe: 'CWE-1035', languages: 'java,python,javascript', description: '基础设施供应链漏洞检测' },
  
  // === AI/LLM 类 (ai) ===
  { id: 'vp_llm', name: 'llm-security', displayName: 'LLM 安全', category: 'ai', cwe: 'CWE-94', languages: 'python,javascript', description: 'LLM 安全漏洞检测' },
  
  // === 基础设施类 (infra) ===
  { id: 'vp_serverless', name: 'serverless-security', displayName: 'Serverless 安全', category: 'infra', cwe: 'CWE-862', languages: 'python,javascript,go', description: 'Serverless 安全漏洞检测' },
  { id: 'vp_api_gateway', name: 'api-gateway-security', displayName: 'API 网关安全', category: 'infra', cwe: 'CWE-287', languages: 'java,python,javascript,go', description: 'API 网关安全漏洞检测' },
  { id: 'vp_cache', name: 'cache-poisoning', displayName: '缓存投毒', category: 'infra', cwe: 'CWE-444', languages: 'java,python,php,javascript', description: '缓存投毒漏洞检测' },
  { id: 'vp_http_smuggle', name: 'http-smuggling', displayName: 'HTTP 走私', category: 'infra', cwe: 'CWE-444', languages: 'java,python,javascript', description: 'HTTP 走私漏洞检测' },
  { id: 'vp_mq', name: 'message-queue-security', displayName: '消息队列安全', category: 'infra', cwe: 'CWE-862', languages: 'java,python,javascript,go', description: '消息队列安全漏洞检测' },
  { id: 'vp_realtime', name: 'realtime-security', displayName: '实时协议安全', category: 'infra', cwe: 'CWE-287', languages: 'java,python,javascript', description: '实时协议安全漏洞检测' },
  
  // === 移动类 (mobile) ===
  { id: 'vp_mobile', name: 'mobile-security', displayName: '移动安全', category: 'mobile', cwe: 'CWE-862', languages: 'java,javascript', description: '移动安全漏洞检测' },
  
  // === 前端类 (frontend) ===
  { id: 'vp_frontend', name: 'frontend-security', displayName: '前端安全', category: 'frontend', cwe: 'CWE-79', languages: 'javascript', description: '前端安全漏洞检测' },
  
  // === 内存安全类 (memory) ===
  { id: 'vp_memory', name: 'memory-safety', displayName: '内存安全', category: 'memory', cwe: 'CWE-119', languages: 'cpp,rust', description: '内存安全漏洞检测' },
  { id: 'vp_binary', name: 'binary-security', displayName: '二进制安全', category: 'memory', cwe: 'CWE-119', languages: 'cpp', description: '二进制安全漏洞检测' },
  
  // === 输入验证类 (input-validation) ===
  { id: 'vp_input', name: 'input-validation', displayName: '输入验证', category: 'injection', cwe: 'CWE-20', languages: 'java,python,php,javascript,go', description: '输入验证漏洞检测' },
];

async function seedVulnPattern() {
  console.log('开始导入 VulnerabilityPattern...');
  const now = new Date();
  
  try {
    for (const vp of vulnerabilityPatterns) {
      await prisma.vulnerabilityPattern.upsert({
        where: { name: vp.name },
        update: { ...vp, updatedAt: now },
        create: {
          ...vp,
          patterns: '[]',
          isActive: true,
          isBuiltin: true,
          updatedAt: now,
          createdAt: now,
        },
      });
    }
    
    const count = await prisma.vulnerabilityPattern.count();
    console.log(`✓ 导入完成，共 ${count} 条记录`);
    
    // 统计各分类数量
    const categories = await prisma.vulnerabilityPattern.groupBy({
      by: ['category'],
      _count: true,
    });
    console.log('\n分类统计:');
    categories.forEach(c => console.log(`  ${c.category}: ${c._count}`));
  } catch (error) {
    console.error('导入失败:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

seedVulnPattern();
