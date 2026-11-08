import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/cn';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceStep(raw: number) {
  if (raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

function Tooltip({ x, y, children }: { x: number; y: number; children: ReactNode }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-stone-900 px-2.5 py-1.5 text-xs text-white shadow-lg dark:bg-stone-100 dark:text-stone-900"
      style={{ left: x, top: y - 8 }}
    >
      {children}
    </div>
  );
}

export interface ColumnDatum {
  key: string;
  label: string;
  value: number;
}

/**
 * Single-series column chart (one colour = slot 1, no legend: the card title names
 * the series). Hairline solid grid, compact ticks, bars <= 24px with a 4px rounded
 * data end, per-bar hover/focus tooltip.
 */
export function ColumnChart({
  data,
  height = 220,
  format,
  formatTick,
  ariaLabel,
}: {
  data: ColumnDatum[];
  height?: number;
  format: (n: number) => string;
  formatTick: (n: number) => string;
  ariaLabel: string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const axisW = 48;
  const bottom = 24;
  const top = 10;
  const plotH = height - bottom - top;
  const plotW = Math.max(0, width - axisW);
  const max = Math.max(0, ...data.map((d) => d.value));
  const step = niceStep(max / 4 || 1);
  const ceiling = Math.max(step, step * Math.ceil(max / step));
  const ticks: number[] = [];
  for (let v = 0; v <= ceiling + 1e-9; v += step) ticks.push(v);
  const band = data.length ? plotW / data.length : 0;
  const barW = Math.min(24, Math.max(4, band * 0.62));
  const labelEvery = band < 34 ? Math.ceil(34 / Math.max(band, 1)) : 1;
  const y = (v: number) => top + plotH - (v / ceiling) * plotH;

  const activeBar = active !== null ? data[active] : null;
  return (
    <div ref={ref} className="relative w-full select-none" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={ariaLabel} className="overflow-visible">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={axisW} x2={width} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--baseline)' : 'var(--grid)'} strokeWidth={1} shapeRendering="crispEdges" />
              <text x={axisW - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tabular fill-[var(--ink-muted)] text-[11px]">
                {formatTick(t)}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = axisW + i * band + (band - barW) / 2;
            const h = Math.max(0, y(0) - y(d.value));
            const r = Math.min(4, h, barW / 2);
            const yTop = y(0) - h;
            const path =
              h > 0
                ? `M${x},${y(0)} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${y(0)} Z`
                : '';
            return (
              <g key={d.key}>
                {path && <path d={path} fill="var(--series-1)" opacity={active === null || active === i ? 1 : 0.55} className="transition-opacity" />}
                {/* Hit target: the whole band, larger than the mark. */}
                <rect
                  x={axisW + i * band}
                  y={top}
                  width={band}
                  height={plotH}
                  fill="transparent"
                  tabIndex={0}
                  aria-label={`${d.label}: ${format(d.value)}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="cursor-default outline-none"
                />
                {i % labelEvery === 0 && (
                  <text x={axisW + i * band + band / 2} y={height - 6} textAnchor="middle" className="fill-[var(--ink-muted)] text-[11px]">
                    {d.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
      {activeBar && active !== null && (
        <Tooltip x={axisW + active * band + band / 2} y={y(activeBar.value)}>
          <span className="font-semibold">{format(activeBar.value)}</span>
          <span className="ml-1.5 opacity-70">{activeBar.label}</span>
        </Tooltip>
      )}
    </div>
  );
}

export interface SegmentPart {
  label: string;
  value: number;
  color: string;
  /** Text colour inside the block: white by default, near-black on light fills (yellow/warning). */
  dark?: boolean;
}

/**
 * Tall segmented bar: one whole split into <= 6 parts, 28px, 4px corners, 2px
 * surface gaps, share printed inside only when it fits, legend in block order.
 */
export function SegmentedBar({ parts, format, total: totalProp, ariaLabel }: { parts: SegmentPart[]; format: (n: number) => string; total?: number; ariaLabel: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const visible = parts.filter((p) => p.value > 0);
  const total = totalProp ?? visible.reduce((s, p) => s + p.value, 0);
  const gaps = Math.max(0, visible.length - 1) * 2;
  return (
    <div>
      <div ref={ref} className="relative flex h-7 w-full gap-[2px]" role="img" aria-label={ariaLabel}>
        {total > 0 &&
          visible.map((p, i) => {
            const share = p.value / total;
            const px = Math.max(0, (width - gaps) * share);
            const text = `${Math.round(share * 100)}%`;
            const fits = px > text.length * 7.5 + 14;
            return (
              <div
                key={p.label}
                tabIndex={0}
                aria-label={`${p.label}: ${format(p.value)} (${text})`}
                onPointerEnter={() => setActive(i)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                className="relative flex h-full items-center rounded-[4px] outline-none transition-opacity focus-visible:ring-2 focus-visible:ring-stone-900/40"
                style={{ width: px, background: p.color, opacity: active === null || active === i ? 1 : 0.6 }}
              >
                {fits && <span className={cn('tabular pl-2 text-xs font-semibold', p.dark ? 'text-[#0b0b0b]' : 'text-white')}>{text}</span>}
                {active === i && (
                  <Tooltip x={px / 2} y={0}>
                    <span className="font-semibold">{format(p.value)}</span>
                    <span className="ml-1.5 opacity-70">
                      {p.label} · {text}
                    </span>
                  </Tooltip>
                )}
              </div>
            );
          })}
        {total <= 0 && <div className="h-full w-full rounded-[4px] bg-stone-100 dark:bg-stone-800" />}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {visible.map((p) => (
          <li key={p.label} className="flex items-center gap-1.5 text-xs text-stone-600 dark:text-stone-300">
            <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
            {p.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Meter: for budgets/limits the fill carries severity (accent -> warning at 90% ->
 * critical over 100%); for progress, more is good and the fill stays the accent.
 * The track is a lighter step of the same ramp.
 */
export function Meter({ value, max, className, thin, kind = 'budget' }: { value: number; max: number; className?: string; thin?: boolean; kind?: 'budget' | 'progress' }) {
  const ratio = max > 0 ? value / max : value > 0 ? 1.01 : 0;
  const tone = kind === 'progress' ? 'accent' : ratio > 1.0001 ? 'critical' : ratio >= 0.9 ? 'warning' : 'accent';
  const fill = tone === 'critical' ? 'var(--critical)' : tone === 'warning' ? 'var(--warning)' : 'var(--series-1)';
  const track = tone === 'critical' ? 'rgb(208 59 59 / 0.16)' : tone === 'warning' ? 'rgb(250 178 25 / 0.2)' : 'var(--meter-track)';
  return (
    <div
      className={cn('w-full overflow-hidden rounded-full', thin ? 'h-1.5' : 'h-2', className)}
      style={{ background: track }}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, ratio * 100)}%`, background: fill }} />
    </div>
  );
}

/** Categorical slots in fixed order (identity follows the entity, never its rank in a filtered view). */
export const SERIES = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)', 'var(--series-4)', 'var(--series-5)', 'var(--series-6)'];
export const SERIES_DARK_TEXT = [false, false, false, true, false, false];
