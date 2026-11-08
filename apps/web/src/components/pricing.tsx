import { formatMoney, type BillingInterval, type PlanDef, type PlanId } from '@brickledger/shared/web';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { cn } from '../lib/cn';
import { usePlans } from '../lib/queries';
import { Button, ButtonLink } from './ui/button';
import { Segmented } from './ui/form';
import { Skeleton } from './ui/surface';

export function PricingCards({
  current,
  onChoose,
  busyPlan,
}: {
  /** When set, renders billing actions for a signed-in workspace instead of sign-up links. */
  current?: PlanId;
  onChoose?: (plan: Exclude<PlanId, 'free'>, interval: BillingInterval) => void;
  busyPlan?: string | null;
}) {
  const { data } = usePlans();
  const [interval, setInterval] = useState<BillingInterval>('year');
  if (!data) {
    return (
      <div className="grid gap-5 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-96" />
        ))}
      </div>
    );
  }
  const price = (p: PlanDef) => p.price[data.currency][interval];
  return (
    <div>
      <div className="mb-8 flex justify-center">
        <Segmented
          aria-label="Billing interval"
          value={interval}
          onChange={setInterval}
          options={[
            { value: 'month', label: 'Monthly' },
            { value: 'year', label: 'Yearly · 2 months free' },
          ]}
        />
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {data.plans.map((p) => {
          const isCurrent = current === p.id;
          const amount = price(p);
          return (
            <div
              key={p.id}
              className={cn(
                'relative flex flex-col rounded-3xl border bg-white p-6 dark:bg-stone-900',
                p.recommended ? 'border-brand-500 shadow-xl shadow-brand-900/10 ring-1 ring-brand-500' : 'border-stone-200 dark:border-stone-800',
              )}
            >
              {p.recommended && (
                <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">Most popular</span>
              )}
              <h3 className="text-lg font-semibold text-stone-900 dark:text-white">{p.name}</h3>
              <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">{p.tagline}</p>
              <div className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight text-stone-900 dark:text-white">{amount === 0 ? 'Free' : formatMoney(amount, data.currency)}</span>
                {amount > 0 && <span className="text-sm text-stone-500">/{interval === 'month' ? 'month' : 'year'}</span>}
              </div>
              <p className="mt-1 h-5 text-xs text-stone-500">
                {amount > 0 && interval === 'year' ? `≈ ${formatMoney(Math.round(amount / 12), data.currency)}/month, billed yearly` : amount === 0 ? 'Free forever' : 'Billed monthly'}
              </p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm">
                {p.highlights.map((h) => (
                  <li key={h} className="flex gap-2.5 text-stone-700 dark:text-stone-300">
                    <Check className="mt-0.5 size-4 shrink-0 text-brand-600" />
                    {h}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {onChoose ? (
                  isCurrent ? (
                    <Button variant="secondary" className="w-full" disabled>
                      Current plan
                    </Button>
                  ) : p.id === 'free' ? (
                    <Button variant="secondary" className="w-full" disabled>
                      Included
                    </Button>
                  ) : (
                    <Button
                      className="w-full"
                      variant={p.recommended ? 'primary' : 'secondary'}
                      loading={busyPlan === p.id}
                      onClick={() => onChoose(p.id as Exclude<PlanId, 'free'>, interval)}
                    >
                      Upgrade to {p.name}
                    </Button>
                  )
                ) : (
                  <ButtonLink to={`/register?plan=${p.id}`} className="w-full" variant={p.recommended ? 'primary' : 'secondary'}>
                    {p.id === 'free' ? 'Start free' : `Start ${data.trialDays}-day trial`}
                  </ButtonLink>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-stone-500">
        Prices in {data.currency}{data.currency === 'INR' ? ', inclusive of GST where applicable' : ''}. Cancel anytime - your data stays yours.
      </p>
    </div>
  );
}
