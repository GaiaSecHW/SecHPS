/**
 * Category label utility functions
 */

export interface Category {
  value: string;
  label: string;
}

/**
 * Get the display label for a category value
 * @param categoryValue - The category value to look up
 * @param categories - Array of categories with value and label
 * @returns The matching label, or the original value if not found
 */
export function getCategoryLabel(
  categoryValue: string,
  categories: Category[]
): string {
  const category = categories.find((c) => c.value === categoryValue);
  return category?.label ?? categoryValue;
}