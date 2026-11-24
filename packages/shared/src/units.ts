/**
 * Units a material can be counted in. Units in the same family convert into each other, so sand
 * tracked in cft can be shown or entered in m³ or brass. Codes are what's stored; `short` is what
 * people see (cubic metre is stored as `cum` and shown as m³).
 */
export type UnitFamily = 'volume' | 'weight' | 'area' | 'length';

export interface UnitInfo {
  short: string;
  name: string;
  family?: UnitFamily;
  /** How many of the family's base unit (cft, kg, sqft, rft) one of this unit is. */
  inBase?: number;
}

const FT = 0.3048;

export const UNITS: Record<string, UnitInfo> = {
  cft: { short: 'cft', name: 'cubic feet', family: 'volume', inBase: 1 },
  cum: { short: 'm³', name: 'cubic metre', family: 'volume', inBase: 1 / FT ** 3 }, // 35.3147 cft
  brass: { short: 'brass', name: '100 cubic feet', family: 'volume', inBase: 100 },
  kg: { short: 'kg', name: 'kilogram', family: 'weight', inBase: 1 },
  qtl: { short: 'quintal', name: '100 kg', family: 'weight', inBase: 100 },
  ton: { short: 'ton', name: 'tonne, 1000 kg', family: 'weight', inBase: 1000 },
  sqft: { short: 'sqft', name: 'square feet', family: 'area', inBase: 1 },
  sqm: { short: 'm²', name: 'square metre', family: 'area', inBase: 1 / FT ** 2 }, // 10.7639 sqft
  rft: { short: 'rft', name: 'running feet', family: 'length', inBase: 1 },
  rmt: { short: 'rmt', name: 'running metre', family: 'length', inBase: 1 / FT }, // 3.2808 rft
  bags: { short: 'bags', name: 'bags' },
  nos: { short: 'nos', name: 'pieces' },
  ltr: { short: 'ltr', name: 'litres' },
  trip: { short: 'trip', name: 'truck trips' },
  box: { short: 'box', name: 'boxes' },
  set: { short: 'set', name: 'sets' },
};

/** What people see: "m³" for cum, "m²" for sqm; anything else as typed. */
export function unitShort(code: string | null | undefined): string {
  return (code && UNITS[code]?.short) || code || '';
}

/** For pickers: "m³ · cubic metre". */
export function unitLabel(code: string): string {
  const u = UNITS[code];
  return u ? `${u.short} · ${u.name}` : code;
}

/** Units this one converts into (itself first). A unit outside any family only matches itself. */
export function compatibleUnits(code: string): string[] {
  const family = UNITS[code]?.family;
  if (!family) return [code];
  return [code, ...Object.keys(UNITS).filter((c) => c !== code && UNITS[c]!.family === family)];
}

export function unitFamily(code: string): UnitFamily | undefined {
  return UNITS[code]?.family;
}

/** A quantity in `from` expressed in `to` (unchanged when they don't convert). */
export function convertQty(value: number, from: string, to: string): number {
  const a = UNITS[from];
  const b = UNITS[to];
  if (from === to || !a?.family || a.family !== b?.family) return value;
  return (value * a.inBase!) / b.inBase!;
}

/** A price per `from` expressed per `to`: ₹50 per cft is ₹1,765.73 per m³. */
export function convertRate(rate: number, from: string, to: string): number {
  return convertQty(rate, to, from);
}
