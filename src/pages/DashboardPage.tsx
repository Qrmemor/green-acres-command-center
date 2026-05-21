import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Clock3, Inbox, ShieldAlert, UserRoundCheck, UserCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { EscalationCard } from '@/components/common/EscalationCard';
import { FilterBar } from '@/components/common/FilterBar';
import { LoadingState } from '@/components/common/LoadingState';
import { StatCard } from '@/components/common/StatCard';
import { listEscalations, updateEscalationStatus } from '@/services/escalations';
import { getWorkspaceOptions, type WorkspaceOptions, fallbackOptions } from '@/services/settingsOptions';
import { calculateDashboardStats } from '@/utils/dashboard';
import { filterEscalations } from '@/utils/filterEscalations';
import { sortEscalations } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import type { Escalation, EscalationFilters } from '@/types';

export function DashboardPage() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [options, setOptions] = useState<WorkspaceOptions>(fallbackOptions);
  const [filters, setFilters] = useState<EscalationFilters>({ resolved: false });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const { profile } = useAuth();
  const isBradley = profile?.role === 'bradley';

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const [nextOptions, nextItems] = await Promise.all([getWorkspaceOptions(), listEscalations()]);
      setOptions(nextOptions);
      setItems(nextItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const stats = useMemo(() => calculateDashboardStats(items), [items]);
  const visible = useMemo(() => filterEscalations(items, { ...filters, resolved: false }).sort(sortEscalations), [items, filters]);
  const urgent = visible.filter((item) => item.urgency === 'Urgent / Customer-Sensitive');
  const standard = visible.filter((item) => item.urgency === 'Standard / Non-Urgent');
  const carlWorkQueue = visible.filter((item) => item.owner_next_action === 'Carl' && ['Ready for Carl', 'Approved', 'Follow-Up Needed'].includes(item.status));
  const waitingBradley = visible.filter((item) => item.status === 'Needs Bradley' || item.status === 'Waiting on Bradley');
  const openLoops = visible.filter((item) => item.status === 'Follow-Up Needed' || item.owner_next_action !== 'Bradley');

  const handleStatusChange = async (id: string, status: string) => {
    const previous = items;
    setItems((current) => current.map((item) => (item.id === id ? { ...item, status, resolved_at: status === 'Resolved' ? new Date().toISOString() : item.resolved_at } : item)));
    try {
      await updateEscalationStatus(id, status);
      await load();
    } catch (err) {
      setItems(previous);
      setError(err instanceof Error ? err.message : 'Unable to update status.');
    }
  };

  return (
    <div className="page-shell space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="section-title">Decision dashboard</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Green Acres Command Center</h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-500">One place for Carl to organize Quo, HomeWorks, and team@ escalations so Bradley only sees what needs a decision.</p>
        </div>
        {!isBradley ? (
          <Link to="/add">
            <Button>Add Escalation</Button>
          </Link>
        ) : null}
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}

      {loading ? (
        <LoadingState label="Loading command center..." />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Total Open" value={stats.totalOpen} icon={<Inbox className="h-5 w-5" />} />
            <StatCard label="Urgent" value={stats.urgent} icon={<ShieldAlert className="h-5 w-5" />} />
            <StatCard label="Standard" value={stats.standard} icon={<Clock3 className="h-5 w-5" />} />
            <StatCard label="Waiting Bradley" value={stats.waitingOnBradley} icon={<UserRoundCheck className="h-5 w-5" />} />
            <StatCard label="Waiting Customer" value={stats.waitingOnCustomer} icon={<AlertTriangle className="h-5 w-5" />} />
            <StatCard label="Resolved Today" value={stats.resolvedToday} icon={<CheckCircle2 className="h-5 w-5" />} />
          </div>

          <FilterBar filters={filters} onChange={(next) => setFilters({ ...next, resolved: false })} sources={options.sources} topics={options.topics} statuses={options.statuses} />

          {!isBradley && carlWorkQueue.length ? (
            <div className="rounded-2xl border border-ga-100 bg-ga-50 p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-ga-700"><UserCheck className="h-5 w-5" /></div>
                  <div>
                    <p className="font-semibold text-ga-950">Carl has {carlWorkQueue.length} item{carlWorkQueue.length === 1 ? '' : 's'} ready to work.</p>
                    <p className="text-sm text-ga-800">Open Carl Review to copy Bradley notes, open the reply thread, and mark replies done.</p>
                  </div>
                </div>
                <Link to="/carl-review"><Button variant="secondary">Open Carl Review</Button></Link>
              </div>
            </div>
          ) : null}

          {!isBradley ? (
            <DashboardSection title="Carl Work Queue" description="Items Bradley has approved or handed back to Carl with instructions." items={carlWorkQueue} onStatusChange={handleStatusChange} />
          ) : null}
          <DashboardSection title="Urgent / Customer-Sensitive" description="Highest priority items Bradley should see first." items={urgent} onStatusChange={handleStatusChange} readOnly={isBradley} />
          <DashboardSection title="Standard / Non-Urgent" description="Still important, but not customer-sensitive." items={standard} onStatusChange={handleStatusChange} readOnly={isBradley} />
          <DashboardSection title="Waiting on Bradley" description="The ball is currently on Bradley’s side." items={waitingBradley} onStatusChange={handleStatusChange} readOnly={isBradley} />
          {!isBradley ? (
            <DashboardSection title="Open Loops" description="Items Carl should keep tracking until closed." items={openLoops} onStatusChange={handleStatusChange} />
          ) : null}
        </>
      )}
    </div>
  );
}

function DashboardSection({
  title,
  description,
  items,
  onStatusChange,
  readOnly = false
}: {
  title: string;
  description: string;
  items: Escalation[];
  onStatusChange: (id: string, status: string) => void;
  readOnly?: boolean;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{items.length}</span>
      </div>
      {items.length ? (
        <div className="space-y-3">
          {items.map((item) => (
            <EscalationCard
              key={item.id}
              escalation={item}
              onStatusChange={onStatusChange}
              canOpen={!readOnly}
              canEdit={!readOnly}
              showStatusActions={!readOnly}
            />
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-4">
            <EmptyState title="No items here" description="Nothing currently matches this section." />
          </CardContent>
        </Card>
      )}
    </section>
  );
}
