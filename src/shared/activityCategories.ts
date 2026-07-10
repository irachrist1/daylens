import type { AppCategory } from './types'

export const ACTIVITY_CATEGORY_LABELS: Record<AppCategory, string> = {
  development: 'Development',
  communication: 'Communication',
  research: 'Research',
  writing: 'Writing',
  aiTools: 'AI tools',
  design: 'Design',
  browsing: 'Browsing',
  meetings: 'Meetings',
  entertainment: 'Entertainment',
  email: 'Email',
  productivity: 'Productivity',
  social: 'Social',
  system: 'System',
  uncategorized: 'Other',
}

export const ALL_ACTIVITY_CATEGORY_OPTIONS = (Object.keys(ACTIVITY_CATEGORY_LABELS) as AppCategory[])
  .map((value) => ({ value, label: ACTIVITY_CATEGORY_LABELS[value] }))

export const EDITABLE_BLOCK_CATEGORY_OPTIONS = ALL_ACTIVITY_CATEGORY_OPTIONS
  .filter(({ value }) => value !== 'system' && value !== 'uncategorized')

export function activityCategoryLabel(
  category: AppCategory,
  options: { uncategorized?: string } = {},
): string {
  if (category === 'uncategorized' && options.uncategorized) return options.uncategorized
  return ACTIVITY_CATEGORY_LABELS[category] ?? String(category)
}
