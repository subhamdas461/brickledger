import { formatDate } from '@brickledger/shared/web';
import { Activity } from 'lucide-react';
import { useState } from 'react';
import { useProjectCtx } from '../../components/layout';
import { Button } from '../../components/ui/button';
import { Avatar, Card, EmptyState, PageHeader, Spinner } from '../../components/ui/surface';
import { useActivity } from '../../lib/queries';

function time(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ActivityPage() {
  const { pid } = useProjectCtx();
  const [limit, setLimit] = useState(60);
  const { data, isFetching } = useActivity(pid, limit);
  if (!data) return <Spinner />;
  const groups = new Map<string, typeof data>();
  for (const a of data) {
    const day = new Date(a.createdAt).toLocaleDateString('en-CA');
    groups.set(day, [...(groups.get(day) ?? []), a]);
  }
  return (
    <>
      <PageHeader title="Activity" description="Every change, by whom and when - a shared, tamper-evident trail for owners and contractors." />
      {data.length === 0 ? (
        <Card>
          <EmptyState icon={<Activity />} title="No activity yet" />
        </Card>
      ) : (
        <div className="space-y-6">
          {[...groups.entries()].map(([day, items]) => (
            <section key={day}>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-400">{formatDate(day)}</h2>
              <Card className="divide-y divide-stone-100 dark:divide-stone-800">
                {items.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <Avatar name={a.user?.name ?? '?'} className="size-7 text-[10px]" />
                    <p className="flex-1 text-sm text-stone-700 dark:text-stone-300">
                      <span className="font-semibold text-stone-900 dark:text-white">{a.user?.name ?? 'Someone'}</span> {a.summary.charAt(0).toLowerCase() + a.summary.slice(1)}
                    </p>
                    <span className="tabular shrink-0 text-xs text-stone-400">{time(a.createdAt)}</span>
                  </div>
                ))}
              </Card>
            </section>
          ))}
          {data.length >= limit && (
            <div className="flex justify-center">
              <Button variant="secondary" loading={isFetching} onClick={() => setLimit((l) => l + 60)}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
