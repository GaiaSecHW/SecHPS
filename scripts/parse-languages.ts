/**
 * 解析 languages 目录文件
 * 生成 .sisyphus/parsed/languages.json
 */
import { promises as fs } from 'fs';
import * as path from 'path';

const SOURCE_DIR = 'E:\\NAZHUA-main\\opencode\\skills\\code-audit\\references\\languages';
const OUTPUT_FILE = '.sisyphus\\parsed\\languages.json';

// 语言映射
const LANGUAGE_MAP: Record<string, string> = {
  'java': 'java',
  'python': 'python',
  'php': 'php',
  'javascript': 'javascript',
  'go': 'go',
  'dotnet': 'dotnet',
  'ruby': 'ruby',
  'rust': 'rust',
  'c_cpp': 'cpp',
};

// 漏洞模式映射
const VULN_PATTERN_MAP: Record<string, { category: string; pattern: string }> = {
  'deserialization': { category: 'deserialization', pattern: 'deserialization' },
  'fastjson': { category: 'deserialization', pattern: 'fastjson-deserialization' },
  'gadget_chains': { category: 'deserialization', pattern: 'java-gadget-chains' },
  'jndi_injection': { category: 'injection', pattern: 'jndi-injection' },
  'script_engines': { category: 'injection', pattern: 'script-engine-injection' },
  'xxe': { category: 'injection', pattern: 'xxe' },
  'practical': { category: '', pattern: '' }, // 通用实战，无特定漏洞模式
  'security': { category: '', pattern: '' }, // 安全特性，无特定漏洞模式
};

interface ParsedSkill {
  sourceFile: string;
  techStack: string;
  vulnCategory: string | null;
  vulnPattern: string | null;
  name: string;
  displayName: string;
  content: string;
}

function parseFileName(fileName: string): { techStack: string; vulnPattern: string | null; vulnCategory: string | null } {
  const baseName = fileName.replace('.md', '');
  
  // 检查是否是语言特定漏洞文件 (如 java_jndi_injection)
  const parts = baseName.split('_');
  
  if (parts.length > 1) {
    const lang = parts[0];
    const vulnKey = parts.slice(1).join('_');
    const vulnInfo = VULN_PATTERN_MAP[vulnKey];
    
    return {
      techStack: LANGUAGE_MAP[lang] || lang,
      vulnPattern: vulnInfo?.pattern || vulnKey,
      vulnCategory: vulnInfo?.category || null,
    };
  }
  
  // 纯语言文件 (如 java.md)
  return {
    techStack: LANGUAGE_MAP[baseName] || baseName,
    vulnPattern: null,
    vulnCategory: null,
  };
}

function generateSkillName(techStack: string, vulnPattern: string | null): string {
  if (vulnPattern) {
    return `${techStack}-${vulnPattern}`;
  }
  return `${techStack}-security-audit`;
}

function generateDisplayName(techStack: string, vulnPattern: string | null): string {
  const techNames: Record<string, string> = {
    'java': 'Java',
    'python': 'Python',
    'php': 'PHP',
    'javascript': 'JavaScript',
    'go': 'Go',
    'dotnet': '.NET',
    'ruby': 'Ruby',
    'rust': 'Rust',
    'cpp': 'C/C++',
  };
  
  const patternNames: Record<string, string> = {
    'deserialization': '反序列化',
    'fastjson-deserialization': 'Fastjson 反序列化',
    'java-gadget-chains': 'Gadget 链',
    'jndi-injection': 'JNDI 注入',
    'script-engine-injection': '脚本引擎注入',
    'xxe': 'XXE 注入',
  };
  
  const techName = techNames[techStack] || techStack;
  
  if (vulnPattern) {
    const patternName = patternNames[vulnPattern] || vulnPattern;
    return `${techName} ${patternName}`;
  }
  
  return `${techName} 安全审计`;
}

async function parseLanguages() {
  console.log('开始解析 languages 目录...');
  
  const files = await fs.readdir(SOURCE_DIR);
  const mdFiles = files.filter(f => f.endsWith('.md'));
  
  const results: ParsedSkill[] = [];
  
  for (const file of mdFiles) {
    const filePath = path.join(SOURCE_DIR, file);
    const content = await fs.readFile(filePath, 'utf-8');
    
    const { techStack, vulnPattern, vulnCategory } = parseFileName(file);
    const name = generateSkillName(techStack, vulnPattern);
    const displayName = generateDisplayName(techStack, vulnPattern);
    
    results.push({
      sourceFile: file,
      techStack,
      vulnCategory,
      vulnPattern,
      name,
      displayName,
      content,
    });
    
    console.log(`  ✓ ${file} → ${name}`);
  }
  
  // 写入 JSON
  await fs.writeFile(OUTPUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  
  console.log(`\n✓ 解析完成，共 ${results.length} 个文件`);
  console.log(`✓ 输出到 ${OUTPUT_FILE}`);
}

parseLanguages().catch(console.error);
