import { DEFAULT_CATEGORIES, DEFAULT_MATERIALS, DEFAULT_PHASES, spreadPhaseDates } from '@brickledger/shared';
import type { Executor } from '../../db/client';
import { categories, materials, phases } from '../../db/schema';

/** Splits the budget across categories by template share; the last category absorbs rounding. */
export function splitBudget(budget: number): number[] {
  const step = budget >= 100_000 ? 100 : 1;
  const amounts = DEFAULT_CATEGORIES.map((c) => Math.round((budget * c.share) / 100 / step) * step);
  const diff = Math.round((budget - amounts.reduce((a, b) => a + b, 0)) * 100) / 100;
  amounts[amounts.length - 1] = Math.max(0, (amounts[amounts.length - 1] ?? 0) + diff);
  return amounts;
}

export async function seedProjectTemplates(
  db: Executor,
  opts: { projectId: string; userId: string; budget: number; startDate?: string | null; targetEndDate?: string | null },
) {
  const by = { createdBy: opts.userId, updatedBy: opts.userId, projectId: opts.projectId };
  const planned = splitBudget(opts.budget);
  const insertedCategories = await db
    .insert(categories)
    .values(DEFAULT_CATEGORIES.map((c, i) => ({ ...by, name: c.name, icon: c.icon, plannedAmount: planned[i] ?? 0, sortOrder: i })))
    .returning();
  const dates = spreadPhaseDates(opts.startDate, opts.targetEndDate);
  const insertedPhases = await db
    .insert(phases)
    .values(DEFAULT_PHASES.map((p, i) => ({ ...by, name: p.name, sortOrder: i, ...dates[i] })))
    .returning();
  const insertedMaterials = await db
    .insert(materials)
    .values(DEFAULT_MATERIALS.map((m) => ({ ...by, name: m.name, unit: m.unit, category: m.category })))
    .returning();
  return { categories: insertedCategories, phases: insertedPhases, materials: insertedMaterials };
}
