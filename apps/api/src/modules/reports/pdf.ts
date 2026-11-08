import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APP_NAME,
  FundSources,
  WorkerTrades,
  currencyLocale,
  formatDate,
  formatMonth,
  formatNumber,
  type ProjectReport,
} from '@brickledger/shared';
import PDFDocument from 'pdfkit';

// Chart/brand tokens (light surface).
const INK = '#0b0b0b';
const INK_2 = '#52514e';
const MUTED = '#898781';
const HAIRLINE = '#e1e0d9';
const TRACK = '#ecebe6';
const SERIES = '#2a78d6';
const DUE = '#eb6834';
const CRITICAL = '#d03b3b';
const BRAND = '#c2410c';

function fontPaths() {
  const dirs = [
    resolve(process.cwd(), 'assets/fonts'),
    fileURLToPath(new URL('../../../assets/fonts', import.meta.url)),
    fileURLToPath(new URL('../assets/fonts', import.meta.url)),
  ];
  for (const dir of dirs) {
    const regular = resolve(dir, 'NotoSans-Regular.ttf');
    const bold = resolve(dir, 'NotoSans-Bold.ttf');
    if (existsSync(regular) && existsSync(bold)) return { regular, bold };
  }
  return null;
}

/**
 * Renders the project cost report as an A4 PDF. Uses Noto Sans when available
 * (it has the ₹ glyph); otherwise falls back to Helvetica with ISO currency codes.
 */
export function renderReportPdf(report: ProjectReport, opts: { branded: boolean; orgName: string }): Promise<Buffer> {
  const fonts = fontPaths();
  const currency = report.project.currency;
  const locale = currencyLocale(currency);
  const moneyFmt = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: fonts ? 'symbol' : 'code',
    maximumFractionDigits: 0,
  });
  const money = (n: number | null | undefined) => (n == null ? '-' : moneyFmt.format(Math.round(n)));

  const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true, info: { Title: `${report.project.name} - Cost report`, Author: opts.branded ? opts.orgName : APP_NAME } });
  if (fonts) {
    doc.registerFont('Body', fonts.regular);
    doc.registerFont('Bold', fonts.bold);
  } else {
    doc.registerFont('Body', 'Helvetica');
    doc.registerFont('Bold', 'Helvetica-Bold');
  }

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolvePdf, reject) => {
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const bottom = () => doc.page.height - doc.page.margins.bottom - 24;
  const ensure = (h: number) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  // ------------------------------------------------------------ header
  const p = report.project;
  const tt = report.totals;
  doc.font('Bold').fontSize(10).fillColor(BRAND).text(opts.branded ? opts.orgName : APP_NAME, left, 40);
  doc.font('Bold').fontSize(20).fillColor(INK).text(p.name, left, 58, { width });
  const sub = [p.address, p.city].filter(Boolean).join(', ');
  doc.font('Body').fontSize(9.5).fillColor(INK_2).text(
    [sub, `Cost report as of ${formatDate(report.generatedAt.slice(0, 10))}`, `Currency ${currency}`].filter(Boolean).join('  ·  '),
    { width },
  );
  doc.moveDown(1);

  // ------------------------------------------------------------ KPI tiles
  const tiles: [string, string, string?][] = [
    ['Budget', money(tt.budget)],
    ['Committed (spent + due)', money(tt.committed), tt.budget > 0 ? `${Math.round((tt.committed / tt.budget) * 100)}% of budget` : undefined],
    ['Remaining', money(tt.remaining), tt.remaining < 0 ? 'Over budget' : undefined],
    ['Paid so far', money(tt.spent)],
    ['Bills due', money(tt.due), tt.overdue > 0 ? `${money(tt.overdue)} overdue` : undefined],
    ['Funds received', money(tt.fundsReceived), `Cash in hand ${money(tt.cashInHand)}`],
  ];
  const tileW = (width - 16) / 3;
  const tileH = 54;
  const tilesTop = doc.y;
  tiles.forEach(([label, value, note], i) => {
    const x = left + (i % 3) * (tileW + 8);
    const y = tilesTop + Math.floor(i / 3) * (tileH + 8);
    doc.roundedRect(x, y, tileW, tileH, 6).lineWidth(0.75).strokeColor(HAIRLINE).stroke();
    doc.font('Body').fontSize(8).fillColor(INK_2).text(label, x + 10, y + 8, { width: tileW - 20 });
    doc.font('Bold').fontSize(14).fillColor(INK).text(value, x + 10, y + 20, { width: tileW - 20 });
    if (note) doc.font('Body').fontSize(7.5).fillColor(label === 'Remaining' ? CRITICAL : MUTED).text(note, x + 10, y + 39, { width: tileW - 20 });
  });
  doc.y = tilesTop + 2 * (tileH + 8) + 4;

  // Budget meter: paid / due / remaining.
  if (tt.budget > 0) {
    const y = doc.y + 4;
    const paidW = Math.min(1, tt.spent / tt.budget) * width;
    const dueW = Math.min(1 - paidW / width, tt.due / tt.budget) * width;
    doc.roundedRect(left, y, width, 8, 4).fillColor(TRACK).fill();
    if (paidW > 0) doc.roundedRect(left, y, paidW, 8, 4).fillColor(SERIES).fill();
    if (dueW > 2) doc.rect(left + paidW + 2, y, Math.max(0, dueW - 2), 8).fillColor(DUE).fill();
    const legendY = y + 14;
    doc.rect(left, legendY + 2, 8, 8).fillColor(SERIES).fill();
    doc.font('Body').fontSize(8).fillColor(INK_2).text('Paid', left + 12, legendY + 1);
    doc.rect(left + 50, legendY + 2, 8, 8).fillColor(DUE).fill();
    doc.fillColor(INK_2).text('Due', left + 62, legendY + 1);
    const facts = [
      `Progress ${tt.progress}%`,
      tt.costPerArea != null ? `${money(tt.costPerArea)} per ${p.areaUnit === 'sqm' ? 'sq m' : 'sq ft'}` : null,
      tt.daysTotal ? `Day ${tt.daysElapsed ?? 0} of ${tt.daysTotal}` : null,
    ].filter(Boolean);
    doc.fillColor(INK_2).text(facts.join('  ·  '), left + 110, legendY + 1, { width: width - 110, align: 'right' });
    doc.y = legendY + 22;
  }

  // ------------------------------------------------------------ helpers
  /** Section heading; `need` keeps the heading on the same page as the first content block. */
  const section = (title: string, need = 60) => {
    ensure(need + 30);
    doc.moveDown(0.6);
    doc.font('Bold').fontSize(12).fillColor(INK).text(title, left, doc.y);
    doc.moveDown(0.3);
  };

  type Col = { label: string; w: number; align?: 'left' | 'right' };
  const table = (cols: Col[], rows: string[][], opts2: { meter?: (i: number) => { value: number; over: boolean } | null } = {}) => {
    const totalW = cols.reduce((s, c) => s + c.w, 0);
    const scale = width / totalW;
    const xs: number[] = [];
    cols.reduce((x, c) => (xs.push(x), x + c.w * scale), left);
    const header = () => {
      const y = doc.y;
      doc.font('Bold').fontSize(8).fillColor(MUTED);
      cols.forEach((c, i) => doc.text(c.label.toUpperCase(), xs[i]! + 2, y, { width: c.w * scale - 4, align: c.align ?? 'left' }));
      doc.y = y + 14;
      doc.moveTo(left, doc.y - 3).lineTo(left + width, doc.y - 3).lineWidth(0.5).strokeColor(HAIRLINE).stroke();
    };
    header();
    rows.forEach((row, ri) => {
      const meter = opts2.meter?.(ri) ?? null;
      const rowH = meter ? 24 : 16;
      if (doc.y + rowH > bottom()) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      doc.font('Body').fontSize(8.5).fillColor(INK);
      row.forEach((cell, i) => doc.text(cell, xs[i]! + 2, y + 2, { width: cols[i]!.w * scale - 4, align: cols[i]!.align ?? 'left', lineBreak: false, ellipsis: true }));
      if (meter) {
        const mw = cols[0]!.w * scale - 8;
        doc.roundedRect(xs[0]! + 2, y + 15, mw, 4, 2).fillColor(TRACK).fill();
        // Nothing spent = empty track; tiny amounts keep a visible sliver.
        if (meter.value > 0) {
          doc.roundedRect(xs[0]! + 2, y + 15, Math.max(2, Math.min(1, meter.value) * mw), 4, 2).fillColor(meter.over ? CRITICAL : SERIES).fill();
        }
      }
      doc.y = y + rowH;
      doc.moveTo(left, doc.y - 1).lineTo(left + width, doc.y - 1).lineWidth(0.3).strokeColor(HAIRLINE).stroke();
    });
    doc.y += 4;
  };

  // ------------------------------------------------------------ budget vs actual
  if (report.categories.length) {
    section('Budget vs actual by category');
    table(
      [
        { label: 'Category', w: 190 },
        { label: 'Planned', w: 80, align: 'right' },
        { label: 'Paid', w: 80, align: 'right' },
        { label: 'Due', w: 70, align: 'right' },
        { label: 'Used', w: 50, align: 'right' },
      ],
      report.categories.map((c) => [
        c.name,
        money(c.planned),
        money(c.spent),
        c.due ? money(c.due) : '-',
        c.planned > 0 ? `${Math.round(((c.spent + c.due) / c.planned) * 100)}%` : '-',
      ]),
      {
        meter: (i) => {
          const c = report.categories[i]!;
          if (c.planned <= 0) return null;
          const used = (c.spent + c.due) / c.planned;
          return { value: used, over: used > 1 };
        },
      },
    );
  }

  // ------------------------------------------------------------ monthly spending (single series column chart)
  const months = report.monthly.slice(-12);
  if (months.some((m) => m.amount > 0)) {
    section(`Monthly spending (paid, ${currency})`, 150);
    const chartTop = doc.y + 6;
    const chartH = 110;
    const axisW = 56;
    const plotW = width - axisW;
    const max = Math.max(...months.map((m) => m.amount));
    const step = niceStep(max / 4);
    const top = step * Math.ceil(max / step);
    doc.font('Body').fontSize(7).fillColor(MUTED);
    for (let v = 0; v <= top + 1e-6; v += step) {
      const y = chartTop + chartH - (v / top) * chartH;
      doc.moveTo(left + axisW, y).lineTo(left + width, y).lineWidth(0.5).strokeColor(v === 0 ? '#c3c2b7' : HAIRLINE).stroke();
      doc.text(compact(v, locale), left, y - 4, { width: axisW - 6, align: 'right' });
    }
    const band = plotW / months.length;
    const barW = Math.min(24, band * 0.6);
    months.forEach((m, i) => {
      const h = top > 0 ? (m.amount / top) * chartH : 0;
      const x = left + axisW + i * band + (band - barW) / 2;
      if (h > 0) {
        const y = chartTop + chartH - h;
        // 4px rounded data end, square at the baseline.
        const r = Math.min(4, h, barW / 2);
        doc.save();
        doc.moveTo(x, chartTop + chartH).lineTo(x, y + r).quadraticCurveTo(x, y, x + r, y).lineTo(x + barW - r, y).quadraticCurveTo(x + barW, y, x + barW, y + r).lineTo(x + barW, chartTop + chartH).closePath().fillColor(SERIES).fill();
        doc.restore();
      }
      doc.font('Body').fontSize(7).fillColor(MUTED).text(formatMonth(m.month), x - 10, chartTop + chartH + 4, { width: barW + 20, align: 'center' });
    });
    doc.y = chartTop + chartH + 22;
  }

  // ------------------------------------------------------------ vendors
  if (report.vendors.length) {
    section('Vendors & contractors');
    table(
      [
        { label: 'Vendor', w: 200 },
        { label: 'Contract', w: 80, align: 'right' },
        { label: 'Paid', w: 80, align: 'right' },
        { label: 'Due', w: 70, align: 'right' },
        { label: 'Balance', w: 80, align: 'right' },
      ],
      report.vendors.map((v) => [v.name, money(v.contractAmount), money(v.paid), v.due ? money(v.due) : '-', v.balance == null ? '-' : money(v.balance)]),
    );
  }

  // ------------------------------------------------------------ materials
  if (report.materials.length) {
    section('Materials & stock');
    table(
      [
        { label: 'Material', w: 180 },
        { label: 'Received', w: 75, align: 'right' },
        { label: 'Used', w: 75, align: 'right' },
        { label: 'In stock', w: 75, align: 'right' },
        { label: 'Value', w: 85, align: 'right' },
      ],
      report.materials.map((m) => [
        `${m.name} (${m.unit})`,
        formatNumber(m.received),
        formatNumber(m.used),
        formatNumber(m.stock),
        money(m.value),
      ]),
    );
  }

  // ------------------------------------------------------------ labour
  if (report.labour.length) {
    section('Labour');
    table(
      [
        { label: 'Worker', w: 140 },
        { label: 'Trade', w: 80 },
        { label: 'Days', w: 50, align: 'right' },
        { label: 'Earned', w: 80, align: 'right' },
        { label: 'Paid', w: 80, align: 'right' },
        { label: 'Balance', w: 80, align: 'right' },
      ],
      report.labour.map((l) => [
        l.name,
        WorkerTrades.label(l.trade),
        formatNumber(l.presentDays + l.halfDays / 2, 1),
        money(l.earned),
        money(l.paid),
        money(l.balance),
      ]),
    );
  }

  // ------------------------------------------------------------ funding
  if (report.funds.length) {
    section('Funding');
    table(
      [
        { label: 'Source', w: 300 },
        { label: 'Amount', w: 120, align: 'right' },
      ],
      [...report.funds.map((f) => [FundSources.label(f.source), money(f.amount)]), ['Total received', money(tt.fundsReceived)]],
    );
  }

  // ------------------------------------------------------------ footer on every page
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    // Writing inside the bottom margin would make PDFKit add a page; lift the margin while drawing the footer.
    const savedBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const y = doc.page.height - savedBottom + 12;
    doc.font('Body').fontSize(7.5).fillColor(MUTED);
    const brand = opts.branded ? opts.orgName : `Generated with ${APP_NAME}`;
    doc.text(`${brand}  ·  ${p.name}`, left, y, { width: width / 2, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`, left + width / 2, y, { width: width / 2, align: 'right', lineBreak: false });
    doc.page.margins.bottom = savedBottom;
  }
  doc.end();
  return done;
}

function niceStep(raw: number): number {
  if (raw <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
}

/** Compact axis tick (12L / 1.2Cr for en-IN, 12K / 1.2M elsewhere). Currency is named in the section title. */
function compact(v: number, locale: string): string {
  if (v === 0) return '0';
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(v);
}
