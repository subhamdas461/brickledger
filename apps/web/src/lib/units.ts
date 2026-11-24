import { compatibleUnits, unitFamily, type UnitFamily } from '@brickledger/shared/web';
import { useCallback, useState } from 'react';
import { storage } from './storage';

const KEY = 'bl-unit-view';

function read(): Partial<Record<UnitFamily, string>> {
  try {
    return JSON.parse(storage.get(KEY) ?? '{}');
  } catch {
    return {};
  }
}

/**
 * Which unit to show quantities in, per family (e.g. volumes in m³), remembered in this browser.
 * Unset means each material in the unit it's recorded in.
 */
export function useUnitView() {
  const [prefs, setPrefs] = useState(read);
  const setView = useCallback((family: UnitFamily, unit: string) => {
    setPrefs((p) => {
      const next = { ...p, [family]: unit || undefined };
      storage.set(KEY, JSON.stringify(next));
      return next;
    });
  }, []);
  /** The unit to show a material recorded in `unit` in. */
  const shown = useCallback(
    (unit: string) => {
      const family = unitFamily(unit);
      const pref = family ? prefs[family] : undefined;
      return pref && compatibleUnits(unit).includes(pref) ? pref : unit;
    },
    [prefs],
  );
  return { prefs, setView, shown };
}

export const round3 = (n: number) => Math.round(n * 1000) / 1000;
/** Stock rates keep 4 decimals (stored that way), so ₹1,800/m³ comes back as ₹1,800, not ₹1,799.99. */
export const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
