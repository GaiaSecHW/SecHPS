/**
 * FSM 阶段验证器
 * 使用 Zod schemas 验证阶段输出数据契约
 */
import { z } from 'zod';
import { PhaseSchemas } from '../schemas/phase-schemas';
import { logger, LOG_MODULES } from '@/lib/logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * 验证阶段 YAML 输出
 */
export function validatePhaseOutput(
  phaseNumber: number,
  yamlContent: string
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // 解析 YAML (简单实现，实际应使用 yaml 解析库)
    const data = parseSimpleYaml(yamlContent);

    // 获取对应的 Schema
    const schema = PhaseSchemas[phaseNumber];
    if (!schema) {
      warnings.push(`No schema defined for phase ${phaseNumber}`);
      return { valid: true, errors, warnings };
    }

    // 执行验证
    const result = schema.safeParse(data);

    if (!result.success) {
      // 提取错误信息
      for (const issue of result.error.issues) {
        const path = issue.path.join('.');
        errors.push(`${path}: ${issue.message}`);
      }
    }

    // 验证门检查
    const gateValidation = validateGates(phaseNumber, data);
    errors.push(...gateValidation.errors);
    warnings.push(...gateValidation.warnings);

    return { valid: errors.length === 0, errors, warnings };

  } catch (error) {
    logger.error(LOG_MODULES.FSM, '操作失败', { details: { error: error instanceof Error ? error.message : String(error) } });
    errors.push(`Failed to parse YAML: ${error instanceof Error ? error.message : 'Unknown error'}`);
    return { valid: false, errors, warnings };
  }
}

/**
 * 验证门检查
 */
function validateGates(phaseNumber: number, data: Record<string, any>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  switch (phaseNumber) {
    case 1:
      // Gate 1: discovery_checklist 所有入口类型扫描完成
      if (data.P1?.discovery_checklist?.checklist) {
        const scannedCount = Object.values(data.P1.discovery_checklist.checklist)
          .filter((item: any) => item.scanned === true).length;
        const totalCount = Object.keys(data.P1.discovery_checklist.checklist).length;
        
        if (totalCount < 14) {
          warnings.push(`Discovery checklist has only ${totalCount} entry types (expected 14)`);
        }
        if (scannedCount < totalCount) {
          errors.push(`Discovery checklist incomplete: ${scannedCount}/${totalCount} scanned`);
        }
      }

      // Gate 2: l1_coverage.coverage_percentage == 100%
      if (data.P2?.l1_coverage?.coverage_percentage !== 100) {
        errors.push(`L1 coverage is ${data.P2?.l1_coverage?.coverage_percentage || 0}% (expected 100%)`);
      }
      break;

    case 2:
      // Gate: 所有 DFD 元素映射到信任边界
      if (data.P3?.boundaries && Array.isArray(data.P3.boundaries)) {
        if (data.P3.boundaries.length === 0) {
          warnings.push('No trust boundaries defined');
        }
      }
      break;

    case 3:
      // Gate 1: element_coverage_verification.coverage_percentage >= 80%
      if (data.P5?.element_coverage_verification?.coverage_percentage < 80) {
        errors.push(`Element coverage is ${data.P5?.element_coverage_verification?.coverage_percentage || 0}% (expected >= 80%)`);
      }

      // Gate 2: 计数守恒
      if (data.P6?.risk_summary) {
        const { verified, theoretical, pending, excluded } = data.P6.risk_summary;
        const total = verified + theoretical + pending + excluded;
        const p5Total = data.P5?.summary?.total || 0;

        if (total !== p5Total) {
          errors.push(`Count conservation violated: P5 total (${p5Total}) != risk sum (${total})`);
        }
      }
      break;

    case 4:
      // Gate: 每个 VR-xxx 都有对应的 MIT-xxx
      // 这需要在实际数据中验证
      warnings.push('Mitigation coverage validation requires full data analysis');
      break;
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * 简单 YAML 解析器 (生产环境应使用 yaml 库)
 */
function parseSimpleYaml(yaml: string): Record<string, any> {
  // 这是一个简化实现
  // 实际应使用 yaml 或 js-yaml 库
  
  const result: Record<string, any> = {};
  const lines = yaml.split('\n');
  
  let currentKey = '';
  let currentSection: any = null;
  let depth = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    
    if (trimmed.startsWith('#') || trimmed === '') continue;
    
    // 计算深度
    const indent = line.length - line.trimStart().length;
    
    // 检查是否是新的 section
    if (!trimmed.includes(':')) continue;
    
    const [key, value] = trimmed.split(':').map(s => s.trim());
    
    if (indent === 0) {
      // 顶层 key
      currentKey = key;
      if (value === '' || value === undefined) {
        result[currentKey] = {};
        currentSection = result[currentKey];
        depth = 1;
      } else {
        result[currentKey] = parseValue(value);
      }
    } else if (indent > 0 && currentSection) {
      // 嵌套 key
      if (value === '' || value === undefined) {
        currentSection[key] = [];
      } else {
        currentSection[key] = parseValue(value);
      }
    }
  }

  return result;
}

/**
 * 解析 YAML 值
 */
function parseValue(value: string): any {
  // 数字
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10);
  }
  if (/^\d+\.\d+$/.test(value)) {
    return parseFloat(value);
  }
  
  // 布尔
  if (value === 'true') return true;
  if (value === 'false') return false;
  
  // 字符串
  return value;
}

/**
 * 验证 P1 输出
 */
export function validatePhase1(yamlContent: string): ValidationResult {
  return validatePhaseOutput(1, yamlContent);
}

/**
 * 验证 P2 输出
 */
export function validatePhase2(yamlContent: string): ValidationResult {
  return validatePhaseOutput(2, yamlContent);
}

/**
 * 验证 P3 输出
 */
export function validatePhase3(yamlContent: string): ValidationResult {
  return validatePhaseOutput(3, yamlContent);
}

/**
 * 验证 P4 输出
 */
export function validatePhase4(yamlContent: string): ValidationResult {
  return validatePhaseOutput(4, yamlContent);
}

export default {
  validatePhaseOutput,
  validatePhase1,
  validatePhase2,
  validatePhase3,
  validatePhase4,
};