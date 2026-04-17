/**
 * 批量解析脚本 - 解析所有剩余目录
 * Task 5: wooyun (需拆分)
 * Task 6: security (需拆分)
 * Task 7: frameworks
 * Task 8: checklists
 * Task 9: adapters (YAML转JSON)
 * Task 10: core
 */
import { promises as fs } from 'fs';
import * as path from 'path';

const BASE_DIR = 'E:\\NAZHUA-main\\opencode\\skills\\code-audit\\references';
const OUTPUT_DIR = '.sisyphus\\parsed';

// 支持的语言列表
const LANGUAGES = ['java', 'python', 'php', 'javascript', 'go', 'dotnet', 'ruby', 'rust', 'cpp'];

// 框架映射
const FRAMEWORK_MAP: Record<string, { techStack: string; language: string }> = {
  'spring': { techStack: 'spring', language: 'java' },
  'django': { techStack: 'django', language: 'python' },
  'flask': { techStack: 'flask', language: 'python' },
  'express': { techStack: 'express', language: 'javascript' },
  'fastapi': { techStack: 'fastapi', language: 'python' },
  'gin': { techStack: 'gin', language: 'go' },
  'laravel': { techStack: 'laravel', language: 'php' },
  'rails': { techStack: 'rails', language: 'ruby' },
  'koa': { techStack: 'koa', language: 'javascript' },
  'nest_fastify': { techStack: 'nestjs', language: 'javascript' },
  'mybatis_security': { techStack: 'mybatis', language: 'java' },
  'java_web_framework': { techStack: 'java-web', language: 'java' },
  'dotnet': { techStack: 'dotnet-web', language: 'dotnet' },
  'rust_web': { techStack: 'rust-web', language: 'rust' },
};

// 漏洞模式映射 (wooyun)
const WOOYUN_PATTERNS: Record<string, { pattern: string; category: string }> = {
  'sql-injection': { pattern: 'sql-injection', category: 'injection' },
  'xss': { pattern: 'xss', category: 'injection' },
  'command-execution': { pattern: 'command-injection', category: 'injection' },
  'file-upload': { pattern: 'file-upload', category: 'file' },
  'file-traversal': { pattern: 'path-traversal', category: 'traversal' },
  'logic-flaws': { pattern: 'logic-flaw', category: 'logic' },
  'unauthorized-access': { pattern: 'unauthorized-access', category: 'auth' },
  'info-disclosure': { pattern: 'info-disclosure', category: 'info' },
};

// security 目录漏洞模式
const SECURITY_PATTERNS: Record<string, { pattern: string; category: string }> = {
  'api_security': { pattern: 'api-security', category: 'api' },
  'authentication_authorization': { pattern: 'auth-bypass', category: 'auth' },
  'business_logic': { pattern: 'business-logic', category: 'logic' },
  'cryptography': { pattern: 'weak-crypto', category: 'crypto' },
  'file_operations': { pattern: 'file-operations', category: 'file' },
  'input_validation': { pattern: 'input-validation', category: 'injection' },
  'race_conditions': { pattern: 'race-condition', category: 'logic' },
  'dependencies': { pattern: 'dependency-vuln', category: 'supply-chain' },
  'llm_security': { pattern: 'llm-security', category: 'ai' },
  'serverless': { pattern: 'serverless-security', category: 'infra' },
  'oauth_oidc_saml': { pattern: 'oauth-security', category: 'auth' },
  'graphql': { pattern: 'graphql-security', category: 'api' },
  'mobile_security': { pattern: 'mobile-security', category: 'mobile' },
  'message_queue_async': { pattern: 'message-queue-security', category: 'infra' },
  'scheduled_tasks': { pattern: 'scheduled-task-security', category: 'logic' },
  'logging_security': { pattern: 'logging-security', category: 'info' },
  'frontend_frameworks': { pattern: 'frontend-security', category: 'frontend' },
  'api_gateway_proxy': { pattern: 'api-gateway-security', category: 'infra' },
  'cache_host_header': { pattern: 'cache-poisoning', category: 'infra' },
  'cross_service_trust': { pattern: 'cross-service-trust', category: 'auth' },
  'http_smuggling': { pattern: 'http-smuggling', category: 'infra' },
  'infra_supply_chain': { pattern: 'infra-supply-chain', category: 'supply-chain' },
  'memory_native': { pattern: 'memory-safety', category: 'memory' },
  'realtime_protocols': { pattern: 'realtime-security', category: 'infra' },
};

interface ParsedSkill {
  sourceFile: string;
  techStack: string | null;
  vulnCategory: string | null;
  vulnPattern: string | null;
  name: string;
  displayName: string;
  content: string;
  targetLanguage?: string;
}

// 解析 frameworks
async function parseFrameworks() {
  console.log('\n=== Task 7: 解析 frameworks ===');
  const dir = path.join(BASE_DIR, 'frameworks');
  const files = await fs.readdir(dir);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  
  const results: ParsedSkill[] = [];
  
  for (const file of mdFiles) {
    const baseName = file.replace('.md', '');
    const content = await fs.readFile(path.join(dir, file), 'utf-8');
    const info = FRAMEWORK_MAP[baseName] || { techStack: baseName, language: 'general' };
    
    results.push({
      sourceFile: file,
      techStack: info.techStack,
      vulnCategory: null,
      vulnPattern: null,
      name: `${info.techStack}-security-audit`,
      displayName: `${info.techStack} 安全审计`,
      content,
    });
    console.log(`  ✓ ${file} → ${info.techStack}-security-audit`);
  }
  
  await fs.writeFile(path.join(OUTPUT_DIR, 'frameworks.json'), JSON.stringify(results, null, 2));
  console.log(`✓ frameworks.json: ${results.length} 条`);
  return results.length;
}

// 解析 checklists
async function parseChecklists() {
  console.log('\n=== Task 8: 解析 checklists ===');
  const dir = path.join(BASE_DIR, 'checklists');
  const files = await fs.readdir(dir);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  
  const results: ParsedSkill[] = [];
  
  for (const file of mdFiles) {
    const baseName = file.replace('.md', '');
    const content = await fs.readFile(path.join(dir, file), 'utf-8');
    const techStack = LANGUAGES.includes(baseName) ? baseName : null;
    
    // 跳过 universal.md 和 coverage_matrix.md
    if (baseName === 'universal' || baseName === 'coverage_matrix') {
      continue;
    }
    
    results.push({
      sourceFile: file,
      techStack,
      vulnCategory: null,
      vulnPattern: null,
      name: techStack ? `${techStack}-checklist` : `${baseName}-checklist`,
      displayName: techStack ? `${techStack} 检查清单` : `${baseName} 检查清单`,
      content,
    });
    console.log(`  ✓ ${file} → ${techStack || baseName}-checklist`);
  }
  
  await fs.writeFile(path.join(OUTPUT_DIR, 'checklists.json'), JSON.stringify(results, null, 2));
  console.log(`✓ checklists.json: ${results.length} 条`);
  return results.length;
}

// 解析 adapters (YAML)
async function parseAdapters() {
  console.log('\n=== Task 9: 解析 adapters ===');
  const dir = path.join(BASE_DIR, 'adapters');
  const files = await fs.readdir(dir);
  const yamlFiles = files.filter(f => f.endsWith('.yaml'));
  
  const results: ParsedSkill[] = [];
  
  for (const file of yamlFiles) {
    const baseName = file.replace('.yaml', '');
    const content = await fs.readFile(path.join(dir, file), 'utf-8');
    
    // 简单 YAML 解析
    const lines = content.split('\n');
    let name = baseName;
    let displayName = baseName;
    
    for (const line of lines) {
      if (line.startsWith('name:')) name = line.split(':')[1].trim();
      if (line.startsWith('display_name:') || line.startsWith('displayName:')) {
        displayName = line.split(':')[1].trim();
      }
    }
    
    results.push({
      sourceFile: file,
      techStack: baseName,
      vulnCategory: null,
      vulnPattern: null,
      name: `${baseName}-adapter`,
      displayName: `${displayName} 适配器`,
      content: `# ${displayName} 适配器\n\n\`\`\`yaml\n${content}\n\`\`\``,
    });
    console.log(`  ✓ ${file} → ${baseName}-adapter`);
  }
  
  await fs.writeFile(path.join(OUTPUT_DIR, 'adapters.json'), JSON.stringify(results, null, 2));
  console.log(`✓ adapters.json: ${results.length} 条`);
  return results.length;
}

// 解析 core (方法论)
async function parseCore() {
  console.log('\n=== Task 10: 解析 core ===');
  const dir = path.join(BASE_DIR, 'core');
  const files = await fs.readdir(dir);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  
  const results: ParsedSkill[] = [];
  
  for (const file of mdFiles) {
    const baseName = file.replace('.md', '');
    const content = await fs.readFile(path.join(dir, file), 'utf-8');
    
    // 提取标题
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1] : baseName;
    
    // 生成方法名
    const methodName = baseName
      .replace(/_/g, '-')
      .replace(/([a-z])([A-Z])/g, '$1-$2')
      .toLowerCase();
    
    results.push({
      sourceFile: file,
      techStack: null, // 方法论无特定技术栈
      vulnCategory: 'methodology',
      vulnPattern: null,
      name: methodName,
      displayName: title,
      content,
    });
    console.log(`  ✓ ${file} → ${methodName}`);
  }
  
  await fs.writeFile(path.join(OUTPUT_DIR, 'core.json'), JSON.stringify(results, null, 2));
  console.log(`✓ core.json: ${results.length} 条`);
  return results.length;
}

// 解析 wooyun (需按语言拆分)
async function parseWooyun() {
  console.log('\n=== Task 5: 解析 wooyun 并拆分 ===');
  const dir = path.join(BASE_DIR, 'wooyun');
  const files = await fs.readdir(dir);
  const mdFiles = files.filter(f => f.endsWith('.md') && f !== 'INDEX.md');
  
  const results: ParsedSkill[] = [];
  
  for (const file of mdFiles) {
    const baseName = file.replace('.md', '');
    const content = await fs.readFile(path.join(dir, file), 'utf-8');
    const patternInfo = WOOYUN_PATTERNS[baseName];
    
    if (!patternInfo) {
      console.log(`  ⚠ ${file} - 未匹配漏洞模式，跳过`);
      continue;
    }
    
    // 检测内容中涉及的语言
    const detectedLanguages: string[] = [];
    for (const lang of LANGUAGES) {
      const langPatterns: Record<string, RegExp> = {
        java: /```java|Java|JSP|Servlet|Spring|MyBatis|Hibernate/i,
        python: /```python|Python|Django|Flask|FastAPI/i,
        php: /```php|PHP|Laravel|WordPress/i,
        javascript: /```javascript|```js|Node\.js|Express|JavaScript/i,
        go: /```go|Golang|Go\s+语言/i,
        dotnet: /```csharp|\.NET|ASP\.NET|C#/i,
        ruby: /```ruby|Ruby|Rails/i,
      };
      
      const pattern = langPatterns[lang];
      if (pattern && pattern.test(content)) {
        detectedLanguages.push(lang);
      }
    }
    
    // 如果没有检测到语言，默认支持所有主要语言
    const targetLanguages = detectedLanguages.length > 0 ? detectedLanguages : ['java', 'python', 'php', 'javascript', 'go'];
    
    for (const lang of targetLanguages) {
      results.push({
        sourceFile: file,
        techStack: lang,
        vulnCategory: patternInfo.category,
        vulnPattern: patternInfo.pattern,
        name: `${lang}-${patternInfo.pattern}`,
        displayName: `${lang} ${patternInfo.pattern}`,
        content, // 原始内容，后续LLM处理时拆分
        targetLanguage: lang,
      });
    }
    
    console.log(`  ✓ ${file} → ${targetLanguages.length} 个语言变体 (${targetLanguages.join(', ')})`);
  }
  
  await fs.writeFile(path.join(OUTPUT_DIR, 'wooyun-split.json'), JSON.stringify(results, null, 2));
  console.log(`✓ wooyun-split.json: ${results.length} 条`);
  return results.length;
}

// 解析 security (需按语言拆分)
async function parseSecurity() {
  console.log('\n=== Task 6: 解析 security 并拆分 ===');
  const dir = path.join(BASE_DIR, 'security');
  const files = await fs.readdir(dir);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  
  const results: ParsedSkill[] = [];
  
  for (const file of mdFiles) {
    const baseName = file.replace('.md', '');
    const content = await fs.readFile(path.join(dir, file), 'utf-8');
    const patternInfo = SECURITY_PATTERNS[baseName];
    
    if (!patternInfo) {
      console.log(`  ⚠ ${file} - 未匹配漏洞模式，跳过`);
      continue;
    }
    
    // 检测内容中涉及的语言
    const detectedLanguages: string[] = [];
    for (const lang of LANGUAGES) {
      const langPatterns: Record<string, RegExp> = {
        java: /```java|Java|Spring|Servlet|@RestController|@Controller/i,
        python: /```python|Python|Django|Flask|@app\.route|def\s+\w+\(/i,
        php: /```php|PHP|Laravel|\$request|public\s+function/i,
        javascript: /```javascript|```js|Node|Express|app\.get|app\.post|router\./i,
        go: /```go|func\s+\w+\(|gin\.Context|http\.Handler/i,
        dotnet: /```csharp|\.NET|ASP\.NET|public\s+\w+\s+\w+\s*\(/i,
        ruby: /```ruby|Ruby|Rails|def\s+\w+|end\s*$/i,
        rust: /```rust|Rust|fn\s+\w+|impl\s+\w+|pub\s+fn/i,
        cpp: /```cpp|```c|C\+\+|#include|void\s+\w+|int\s+main/i,
      };
      
      const pattern = langPatterns[lang];
      if (pattern && pattern.test(content)) {
        detectedLanguages.push(lang);
      }
    }
    
    // 如果没有检测到语言，根据漏洞类型推断支持语言
    let targetLanguages = detectedLanguages;
    if (targetLanguages.length === 0) {
      // 默认支持主流语言
      if (['llm_security', 'frontend_frameworks'].includes(baseName)) {
        targetLanguages = ['python', 'javascript'];
      } else if (['mobile_security'].includes(baseName)) {
        targetLanguages = ['java', 'javascript'];
      } else if (['memory_native'].includes(baseName)) {
        targetLanguages = ['cpp', 'rust'];
      } else {
        targetLanguages = ['java', 'python', 'php', 'javascript', 'go'];
      }
    }
    
    for (const lang of targetLanguages) {
      results.push({
        sourceFile: file,
        techStack: lang,
        vulnCategory: patternInfo.category,
        vulnPattern: patternInfo.pattern,
        name: `${lang}-${patternInfo.pattern}`,
        displayName: `${lang} ${patternInfo.pattern}`,
        content,
        targetLanguage: lang,
      });
    }
    
    console.log(`  ✓ ${file} → ${targetLanguages.length} 个语言变体`);
  }
  
  await fs.writeFile(path.join(OUTPUT_DIR, 'security-split.json'), JSON.stringify(results, null, 2));
  console.log(`✓ security-split.json: ${results.length} 条`);
  return results.length;
}

// 主函数
async function main() {
  console.log('=== 开始批量解析 ===\n');
  
  const counts = {
    frameworks: await parseFrameworks(),
    checklists: await parseChecklists(),
    adapters: await parseAdapters(),
    core: await parseCore(),
    wooyun: await parseWooyun(),
    security: await parseSecurity(),
  };
  
  console.log('\n=== 解析统计 ===');
  console.log(`frameworks: ${counts.frameworks}`);
  console.log(`checklists: ${counts.checklists}`);
  console.log(`adapters: ${counts.adapters}`);
  console.log(`core: ${counts.core}`);
  console.log(`wooyun: ${counts.wooyun}`);
  console.log(`security: ${counts.security}`);
  console.log(`\n总计: ${Object.values(counts).reduce((a, b) => a + b, 0)} 条`);
}

main().catch(console.error);
