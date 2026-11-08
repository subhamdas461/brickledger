import { APP_NAME } from '@brickledger/shared/web';
import {
  ArrowRight,
  BookOpen,
  CalendarRange,
  ChartColumn,
  CircleCheck,
  FileDown,
  HardHat,
  Package,
  PiggyBank,
  Receipt,
  ShieldCheck,
  Smartphone,
  Users,
  WifiOff,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PricingCards } from '../../components/pricing';
import { ButtonLink } from '../../components/ui/button';

const features: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <PiggyBank />, title: 'Budget vs actual', body: 'Your budget is split across 14 standard construction heads. See what is paid, what is due and what is left - per category and overall.' },
  { icon: <Receipt />, title: 'Every bill & payment', body: 'Record expenses with vendor, phase, quantity and rate. Snap receipts, track unpaid bills and get reminders before they are overdue.' },
  { icon: <Package />, title: 'Materials & stock', body: 'Cement, steel, sand, bricks - log what arrives and what is used. Know what is in stock, what it cost and when to reorder.' },
  { icon: <HardHat />, title: 'Labour & wages', body: 'Mark daily attendance in seconds, add overtime and see each worker’s earned wages, payments and balance.' },
  { icon: <CalendarRange />, title: 'Schedule & tasks', body: 'Plan phases from foundation to handover, track progress and keep site tasks moving on a simple board.' },
  { icon: <BookOpen />, title: 'Site diary & photos', body: 'A daily record of work done, weather, labour count and issues - with photos - so nothing gets disputed later.' },
  { icon: <Users />, title: 'Your team, your rules', body: 'Invite your contractor, engineer, family or bank with the right role: manager, contributor or read-only viewer.' },
  { icon: <ChartColumn />, title: 'Reports that explain', body: 'Professional PDF cost reports and CSV exports for loan disbursements, audits and family updates.' },
  { icon: <WifiOff />, title: 'Works offline', body: 'The Android app saves everything on the phone and syncs when the site gets signal again.' },
];

const faqs: [string, string][] = [
  ['Who is BrickLedger for?', 'Anyone building a house: homeowners managing their own build, contractors running several sites, and architects or engineers who supervise projects. Families and financiers can follow along as viewers.'],
  ['Does it work without internet on site?', 'Yes. The Android app stores your data on the phone, so you can add expenses, attendance, stock and diary entries offline. Everything syncs automatically once you are back online.'],
  ['Can my contractor add entries without seeing everything else?', 'Contributors can add and edit entries but cannot change the budget, manage the team or delete other people’s entries. Viewers can only look. Every change is recorded in the activity log.'],
  ['What happens when the free trial ends?', 'Your workspace moves to the Starter plan. Nothing is deleted - you keep full access to your first project and can upgrade at any time.'],
  ['Can I export my data?', 'Yes. Download CSV files for expenses, budget, vendors, stock, labour, attendance and more on every plan, plus PDF reports on Pro and Business.'],
  ['Which currencies are supported?', 'Projects can use INR, USD, EUR, GBP, AED and 15 other currencies, with local number formatting (including lakh/crore for rupees).'],
];

function ProductPreview() {
  const months = [22, 57, 61, 61, 73, 34];
  return (
    <div aria-hidden="true" className="relative mx-auto w-full max-w-xl">
      <div className="absolute -inset-6 rounded-[40px] bg-gradient-to-tr from-brand-200/50 via-orange-100/40 to-sky-100/50 blur-2xl dark:from-brand-500/10 dark:via-transparent dark:to-sky-500/10" />
      <div className="relative rounded-3xl border border-stone-200 bg-white p-5 shadow-2xl shadow-stone-900/10 dark:border-stone-800 dark:bg-stone-900">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-stone-500">G+1 Villa · Whitefield</p>
            <p className="text-sm font-semibold text-stone-900 dark:text-white">Committed of budget</p>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20">On track</span>
        </div>
        <p className="mt-2 text-4xl font-bold tracking-tight text-stone-900 dark:text-white">
          ₹29.1L <span className="text-base font-medium text-stone-400">of ₹50L</span>
        </p>
        <div className="mt-3 flex h-7 gap-[2px]">
          <div className="flex items-center rounded-[4px] bg-[var(--series-1)] pl-2 text-xs font-semibold text-white" style={{ width: '55%' }}>55%</div>
          <div className="rounded-[4px] bg-[var(--series-2)]" style={{ width: '3%' }} />
          <div className="flex-1 rounded-[4px] bg-stone-100 dark:bg-stone-800" />
        </div>
        <div className="mt-2 flex gap-4 text-xs text-stone-500">
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--series-1)]" />Paid</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-[var(--series-2)]" />Due</span>
          <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-[3px] bg-stone-200 dark:bg-stone-700" />Remaining</span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-3">
          {[
            ['Paid', '₹27.6L'],
            ['Bills due', '₹1.4L'],
            ['Cash in hand', '₹7.4L'],
          ].map(([l, v]) => (
            <div key={l} className="rounded-2xl border border-stone-100 p-3 dark:border-stone-800">
              <p className="text-[11px] text-stone-500">{l}</p>
              <p className="text-base font-semibold text-stone-900 dark:text-white">{v}</p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex h-24 items-end gap-3 border-b border-[var(--baseline)] px-2">
          {months.map((h, i) => (
            <div key={i} className="flex h-full flex-1 items-end justify-center">
              <div className="w-5 rounded-t-[4px] bg-[var(--series-1)]" style={{ height: `${h}%` }} />
            </div>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {[
            ['Low stock: Cement - 40 bags left', 'bg-[var(--warning)]'],
            ['Plumbing bill overdue · ₹38,500', 'bg-[var(--critical)]'],
          ].map(([t, c]) => (
            <div key={t} className="flex items-center gap-2.5 rounded-xl bg-stone-50 px-3 py-2 text-xs text-stone-700 dark:bg-stone-800/60 dark:text-stone-300">
              <span className={`size-2 rounded-full ${c}`} />
              {t}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function Landing() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_20%_0%,rgb(253_186_116/0.25),transparent),radial-gradient(40%_40%_at_90%_10%,rgb(147_197_253/0.18),transparent)] dark:bg-[radial-gradient(60%_50%_at_20%_0%,rgb(234_88_12/0.15),transparent)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-brand-200 bg-brand-50 px-3 py-1 text-xs font-semibold text-brand-800 dark:border-brand-500/30 dark:bg-brand-500/10 dark:text-brand-300">
              <HardHat className="size-3.5" /> Made for house construction
            </span>
            <h1 className="mt-5 text-4xl font-bold tracking-tight text-stone-900 sm:text-5xl lg:text-[56px] lg:leading-[1.05] dark:text-white">
              Build your home without losing track of a single rupee.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-stone-600 dark:text-stone-300">
              {APP_NAME} keeps your budget, bills, materials, labour and site progress in one place - for owners, contractors and the family watching every brick go up.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink to="/register" size="lg" icon={<ArrowRight className="size-4" />} className="flex-row-reverse">
                Start free trial
              </ButtonLink>
              <ButtonLink to="/register?demo=1" size="lg" variant="secondary">
                Explore a sample project
              </ButtonLink>
            </div>
            <ul className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-sm text-stone-500 dark:text-stone-400">
              {['14-day Pro trial', 'No credit card required', 'Android app works offline'].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <CircleCheck className="size-4 text-[var(--good)]" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <ProductPreview />
        </div>
      </section>

      {/* Who it's for */}
      <section className="border-y border-stone-200/70 bg-stone-50/60 dark:border-stone-800 dark:bg-stone-950/50">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 sm:px-6 md:grid-cols-3">
          {[
            ['Homeowners', 'Building your own house? Know exactly where the money goes and what is still owed - without a messy notebook.'],
            ['Contractors & builders', 'Run several sites with clear costs, labour records and professional reports your clients trust.'],
            ['Families & financiers', 'Follow progress with read-only access: photos, spend and milestones, updated from the site.'],
          ].map(([t, b]) => (
            <div key={t}>
              <p className="font-semibold text-stone-900 dark:text-white">{t}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl dark:text-white">Everything a build needs tracking</h2>
          <p className="mt-3 text-stone-600 dark:text-stone-400">From the first approval fee to the final coat of paint.</p>
        </div>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-3xl border border-stone-200 bg-white p-6 transition hover:-translate-y-0.5 hover:shadow-lg hover:shadow-stone-900/5 dark:border-stone-800 dark:bg-stone-900">
              <div className="flex size-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400 [&>svg]:size-5">{f.icon}</div>
              <h3 className="mt-4 font-semibold text-stone-900 dark:text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Mobile */}
      <section className="bg-stone-900 text-white dark:bg-stone-950">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-20 sm:px-6 md:grid-cols-2">
          <div>
            <Smartphone className="size-8 text-brand-400" />
            <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Built for the site, not just the office</h2>
            <p className="mt-4 text-stone-300">
              The Android app is fast, light and works without signal. Mark attendance for the whole gang in a few taps, photograph a bill as it arrives, and log today’s work before you leave the site.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-stone-200">
              {[
                'Offline-first: everything saved on the phone, synced in the background',
                'Receipt and site photos compressed before upload to save data',
                'Reminders for payments due, low stock and overdue tasks',
              ].map((t) => (
                <li key={t} className="flex gap-2.5">
                  <CircleCheck className="mt-0.5 size-4 shrink-0 text-brand-400" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto w-64 rounded-[40px] border-[10px] border-stone-700 bg-stone-50 p-3 text-stone-900 shadow-2xl">
            <p className="px-1 text-xs font-semibold text-stone-500">Attendance · Today</p>
            <div className="mt-2 space-y-2">
              {[
                ['Ravi Shankar', 'Mason', 'P'],
                ['Lakshmi', 'Helper', 'P'],
                ['Ganesh', 'Bar bender', '½'],
                ['Prakash', 'Carpenter', 'P'],
                ['Shivu', 'Helper', 'A'],
              ].map(([n, t, s]) => (
                <div key={n} className="flex items-center justify-between rounded-2xl bg-white px-3 py-2 shadow-sm">
                  <div>
                    <p className="text-xs font-semibold">{n}</p>
                    <p className="text-[10px] text-stone-500">{t}</p>
                  </div>
                  <span className={`flex size-7 items-center justify-center rounded-full text-xs font-bold ${s === 'P' ? 'bg-emerald-100 text-emerald-800' : s === 'A' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{s}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 rounded-2xl bg-brand-600 py-2 text-center text-xs font-semibold text-white">Save attendance</div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl dark:text-white">Up and running in minutes</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {[
            ['Set your budget', 'Create a project with your total budget and dates. We split it across standard heads and phases - adjust anything.'],
            ['Record from site', 'Add bills, deliveries, attendance and photos as they happen, from the web or the Android app.'],
            ['Share & report', 'Invite your contractor or family, and download PDF reports for your bank or records.'],
          ].map(([t, b], i) => (
            <div key={t} className="relative rounded-3xl border border-stone-200 p-6 dark:border-stone-800">
              <span className="flex size-9 items-center justify-center rounded-full bg-stone-900 text-sm font-bold text-white dark:bg-white dark:text-stone-900">{i + 1}</span>
              <h3 className="mt-4 font-semibold text-stone-900 dark:text-white">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{b}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 bg-stone-50 dark:bg-stone-950/60">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="mx-auto mb-10 max-w-2xl text-center">
            <h2 className="text-3xl font-bold tracking-tight text-stone-900 sm:text-4xl dark:text-white">Simple pricing</h2>
            <p className="mt-3 text-stone-600 dark:text-stone-400">Start free. Upgrade when your build - or your business - grows.</p>
          </div>
          <PricingCards />
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-stone-900 dark:text-white">Questions</h2>
        <div className="mt-10 divide-y divide-stone-200 rounded-3xl border border-stone-200 bg-white dark:divide-stone-800 dark:border-stone-800 dark:bg-stone-900">
          {faqs.map(([q, a]) => (
            <details key={q} className="group px-6 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium text-stone-900 dark:text-white">
                {q}
                <span className="text-xl text-stone-400 transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-stone-600 dark:text-stone-400">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="px-4 pb-20 sm:px-6">
        <div className="mx-auto max-w-6xl overflow-hidden rounded-[36px] bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-14 text-center text-white sm:px-12">
          <ShieldCheck className="mx-auto size-9 text-brand-200" />
          <h2 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">Your home deserves better than a notebook.</h2>
          <p className="mx-auto mt-3 max-w-xl text-brand-100">Start your 14-day Pro trial. Bring your contractor and family along.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <ButtonLink to="/register" size="lg" className="bg-white text-brand-800 hover:bg-brand-50">
              Create free account
            </ButtonLink>
            <ButtonLink to="/pricing" size="lg" variant="ghost" className="text-white hover:bg-white/10 hover:text-white" icon={<FileDown className="size-4" />}>
              Compare plans
            </ButtonLink>
          </div>
        </div>
      </section>
    </main>
  );
}

export function PricingPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h1 className="text-4xl font-bold tracking-tight text-stone-900 dark:text-white">Plans for every build</h1>
        <p className="mt-3 text-stone-600 dark:text-stone-400">Every plan includes the full web app and the offline Android app.</p>
      </div>
      <PricingCards />
      <div className="mx-auto mt-16 max-w-3xl overflow-hidden rounded-3xl border border-stone-200 dark:border-stone-800">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left dark:bg-stone-900">
            <tr>
              <th className="px-4 py-3 font-semibold">Compare</th>
              <th className="px-4 py-3 font-semibold">Starter</th>
              <th className="px-4 py-3 font-semibold">Pro</th>
              <th className="px-4 py-3 font-semibold">Business</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100 dark:divide-stone-800">
            {[
              ['Projects', '1', '5', 'Unlimited'],
              ['People', '3', '15', 'Unlimited'],
              ['Storage', '500 MB', '10 GB', '100 GB'],
              ['Expenses, budget, materials, labour, diary', '✓', '✓', '✓'],
              ['Offline Android app', '✓', '✓', '✓'],
              ['CSV export', '✓', '✓', '✓'],
              ['PDF reports', '-', '✓', '✓'],
              ['Your branding on reports', '-', '-', '✓'],
              ['Priority support', '-', '-', '✓'],
            ].map((row) => (
              <tr key={row[0]}>
                {row.map((c, i) => (
                  <td key={i} className={i === 0 ? 'px-4 py-3 text-stone-700 dark:text-stone-300' : 'px-4 py-3 text-stone-900 dark:text-white'}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
