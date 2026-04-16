/**
 * Validation utility functions for API input validation
 */

/**
 * Validation result type
 */
export type ValidationResult = { valid: boolean; error?: string };

/**
 * Validate JSON string field
 * @param value - The JSON string to validate (null/undefined allowed)
 * @param fieldName - The field name for error messages
 * @returns ValidationResult indicating if the value is valid
 */
export function validateJsonField(
  value: string | null | undefined,
  fieldName: string
): ValidationResult {
  if (!value) return { valid: true }; // null/undefined allowed
  try {
    JSON.parse(value);
    return { valid: true };
  } catch {
    return { valid: false, error: `${fieldName} 格式无效，必须是合法的 JSON` };
  }
}

/**
 * Validate JSON object field (already parsed)
 * @param value - The value to validate (null/undefined allowed)
 * @param fieldName - The field name for error messages
 * @returns ValidationResult indicating if the value is valid
 */
export function validateJsonObject(
  value: unknown,
  fieldName: string
): ValidationResult {
  if (value === undefined || value === null) return { valid: true };
  if (typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, error: `${fieldName} 格式无效，必须是 JSON 对象` };
  }
  return { valid: true };
}

/**
 * Validate required field
 * @param value - The value to validate
 * @param fieldName - The field name for error messages
 * @returns ValidationResult indicating if the value is valid
 */
export function validateRequired(
  value: unknown,
  fieldName: string
): ValidationResult {
  if (value === undefined || value === null || value === '') {
    return { valid: false, error: `${fieldName} 是必需的` };
  }
  return { valid: true };
}