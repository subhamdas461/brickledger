/**
 * Starter data applied to new projects. Budget shares follow a typical
 * residential build cost split and are only a starting point - users adjust them.
 */

export interface CategoryTemplate {
  name: string;
  /** Percentage of the total budget suggested for this category. */
  share: number;
  icon: string;
}

export const DEFAULT_CATEGORIES: CategoryTemplate[] = [
  { name: 'Permits & approvals', share: 3, icon: 'stamp' },
  { name: 'Design & consultancy', share: 4, icon: 'ruler' },
  { name: 'Excavation & foundation', share: 9, icon: 'shovel' },
  { name: 'RCC structure', share: 18, icon: 'columns' },
  { name: 'Masonry & plaster', share: 9, icon: 'brick' },
  { name: 'Labour & wages', share: 12, icon: 'hardhat' },
  { name: 'Roofing & waterproofing', share: 3, icon: 'roof' },
  { name: 'Doors & windows', share: 7, icon: 'door' },
  { name: 'Electrical', share: 6, icon: 'bolt' },
  { name: 'Plumbing & sanitary', share: 6, icon: 'droplet' },
  { name: 'Flooring & tiling', share: 9, icon: 'grid' },
  { name: 'Painting & finishing', share: 5, icon: 'paint' },
  { name: 'Fixtures & fittings', share: 5, icon: 'lamp' },
  { name: 'Miscellaneous & contingency', share: 4, icon: 'box' },
];

/** Name of the template category that wage payments default to. */
export const LABOUR_CATEGORY_NAME = 'Labour & wages';

export interface PhaseTemplate {
  name: string;
  /** Relative duration weight, used to spread planned dates between start and target end. */
  weight: number;
}

export const DEFAULT_PHASES: PhaseTemplate[] = [
  { name: 'Planning & approvals', weight: 6 },
  { name: 'Site preparation & excavation', weight: 3 },
  { name: 'Foundation', weight: 7 },
  { name: 'Plinth & DPC', weight: 3 },
  { name: 'Superstructure (columns, beams, slabs)', weight: 14 },
  { name: 'Brickwork / masonry', weight: 8 },
  { name: 'Roofing & waterproofing', weight: 4 },
  { name: 'Electrical & plumbing rough-in', weight: 5 },
  { name: 'Plastering', weight: 6 },
  { name: 'Flooring & tiling', weight: 6 },
  { name: 'Doors, windows & carpentry', weight: 6 },
  { name: 'Painting', weight: 5 },
  { name: 'Fixtures, fittings & finishing', weight: 5 },
  { name: 'Handover & snagging', weight: 2 },
];

export interface MaterialTemplate {
  name: string;
  unit: string;
  category: string;
}

export const DEFAULT_MATERIALS: MaterialTemplate[] = [
  { name: 'Cement (OPC/PPC)', unit: 'bags', category: 'cement' },
  { name: 'TMT steel bars', unit: 'kg', category: 'steel' },
  { name: 'Sand (M-sand / river)', unit: 'cft', category: 'sand' },
  { name: 'Aggregate 20mm', unit: 'cft', category: 'aggregate' },
  { name: 'Bricks / blocks', unit: 'nos', category: 'bricks_blocks' },
];

/**
 * Splits [start, end] across phases proportionally to their weights.
 * Dates are ISO yyyy-mm-dd strings. Returns null dates when either bound is missing.
 */
export function spreadPhaseDates(
  start: string | null | undefined,
  end: string | null | undefined,
  phases: PhaseTemplate[] = DEFAULT_PHASES,
): { plannedStart: string | null; plannedEnd: string | null }[] {
  if (!start || !end) return phases.map(() => ({ plannedStart: null, plannedEnd: null }));
  const s = Date.parse(`${start}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (!(e > s)) return phases.map(() => ({ plannedStart: null, plannedEnd: null }));
  const totalDays = Math.round((e - s) / 86_400_000);
  const totalWeight = phases.reduce((sum, p) => sum + p.weight, 0);
  const day = (n: number) => new Date(s + n * 86_400_000).toISOString().slice(0, 10);
  let cursor = 0;
  return phases.map((p, i) => {
    const span = i === phases.length - 1 ? totalDays - cursor : Math.max(1, Math.round((p.weight / totalWeight) * totalDays));
    const from = cursor;
    const to = Math.min(totalDays, cursor + span);
    cursor = to;
    return { plannedStart: day(from), plannedEnd: day(to) };
  });
}
