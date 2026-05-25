import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Inbox,
  MessageSquare,
  Pencil,
  ShieldAlert,
  UserCheck,
  UserRound,
  UserRoundCheck,
  X
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/common/EmptyState';
import { FilterBar } from '@/components/common/FilterBar';
import { LoadingState } from '@/components/common/LoadingState';
import { StatCard } from '@/components/common/StatCard';
import { SourceBadge, StatusBadge, UrgencyBadge } from '@/components/common/Badges';
import { AttachmentGallery } from '@/components/common/AttachmentGallery';
import { listEscalations, updateEscalationStatus } from '@/services/escalations';
import { getWorkspaceOptions, type WorkspaceOptions, fallbackOptions } from '@/services/settingsOptions';
import { calculateDashboardStats } from '@/utils/dashboard';
import { filterEscalations } from '@/utils/filterEscalations';
import { formatDate, sortEscalations, truncate } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import type { Escalation, EscalationFilters } from '@/types';

function getEstimateAttachments(item: Escalation) {
  return (item.attachments ?? []).filter((attachment) => (attachment.attachment_category ?? 'estimate') === 'estimate');
}

function getNeedsMoreInfoScreenshots(item: Escalation) {
  return (item.attachments ?? []).filter((attachment) => attachment.attachment_category === 'needs_more_info');
}

export function DashboardPage() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [options, setOptions] = useState<WorkspaceOptions>(fallbackOptions);
  const [filters, setFilters] = useState<EscalationFilters>({ resolved: false });
  const [selectedItem, setSelectedItem] = useState<Escalation | null>(null);
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
    const resolvedAt = status === 'Resolved' ? new Date().toISOString() : undefined;

    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status,
              resolved_at: resolvedAt ?? item.resolved_at
            }
          : item
      )
    );

    setSelectedItem((current) =>
      current?.id === id
        ? {
            ...current,
            status,
            resolved_at: resolvedAt ?? current.resolved_at
          }
        : current
    );

    try {
      await updateEscalationStatus(id, status);
      await load();
      if (status === 'Resolved') setSelectedItem(null);
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
          <p className="mt-2 max-w-2xl text-sm text-slate-500">
            One place for Carl to organize Quo, HomeWorks, and team@ escalations so Bradley only sees what needs a decision.
          </p>
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
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-ga-700">
                    <UserCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-semibold text-ga-950">
                      Carl has {carlWorkQueue.length} item{carlWorkQueue.length === 1 ? '' : 's'} ready to work.
                    </p>
                    <p className="text-sm text-ga-800">Open Carl Review to copy Bradley notes, open the reply thread, and mark replies done.</p>
                  </div>
                </div>
                <Link to="/carl-review">
                  <Button variant="secondary">Open Carl Review</Button>
                </Link>
              </div>
            </div>
          ) : null}

          {!isBradley ? (
            <DashboardSection
              title="Carl Work Queue"
              description="Items Bradley has approved or handed back to Carl with instructions."
              items={carlWorkQueue}
              onOpenItem={setSelectedItem}
            />
          ) : null}
          <DashboardSection
            title="Urgent / Customer-Sensitive"
            description="Highest priority items Bradley should see first."
            items={urgent}
            onOpenItem={setSelectedItem}
          />
          <DashboardSection
            title="Standard / Non-Urgent"
            description="Still important, but not customer-sensitive."
            items={standard}
            onOpenItem={setSelectedItem}
          />
          <DashboardSection
            title="Waiting on Bradley"
            description="The ball is currently on Bradley’s side."
            items={waitingBradley}
            onOpenItem={setSelectedItem}
          />
          {!isBradley ? (
            <DashboardSection
              title="Open Loops"
              description="Items Carl should keep tracking until closed."
              items={openLoops}
              onOpenItem={setSelectedItem}
            />
          ) : null}
        </>
      )}

      {selectedItem ? (
        <DashboardDetailModal
          item={selectedItem}
          isBradley={isBradley}
          onClose={() => setSelectedItem(null)}
          onStatusChange={handleStatusChange}
        />
      ) : null}
    </div>
  );
}

function DashboardSection({
  title,
  description,
  items,
  onOpenItem
}: {
  title: string;
  description: string;
  items: Escalation[];
  onOpenItem: (item: Escalation) => void;
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
        <div className="grid gap-3 xl:grid-cols-2">
          {items.map((item) => (
            <DashboardPreviewCard key={item.id} item={item} onClick={() => onOpenItem(item)} />
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

function DashboardPreviewCard({ item, onClick }: { item: Escalation; onClick: () => void }) {
  const estimateCount = getEstimateAttachments(item).length;
  const needsMoreInfoCount = getNeedsMoreInfoScreenshots(item).length;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-ga-200 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-ga-600/30"
    >
      <div className="flex flex-wrap items-center gap-2">
        <UrgencyBadge urgency={item.urgency} />
        <SourceBadge source={item.source} />
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.topic}</span>
        <StatusBadge status={item.status} />
        <span className="ml-auto rounded-full bg-ga-50 px-2.5 py-1 text-xs font-semibold text-ga-700">{formatDate(item.follow_up_date)}</span>
      </div>

      <div className="mt-4">
        <h3 className="text-xl font-bold text-slate-950 transition group-hover:text-ga-800">{item.customer_name}</h3>
        {item.address ? <p className="mt-1 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{item.address}</p> : null}
      </div>

      <p className="mt-3 text-sm leading-6 text-slate-600">{truncate(item.situation, 150)}</p>

      <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold">
        {estimateCount ? <span className="rounded-full bg-ga-50 px-2.5 py-1 text-ga-700">{estimateCount} photo{estimateCount === 1 ? '' : 's'}</span> : null}
        {needsMoreInfoCount ? <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{needsMoreInfoCount} screenshot{needsMoreInfoCount === 1 ? '' : 's'}</span> : null}
        <span className="text-slate-500">Click customer to review details.</span>
      </div>
    </button>
  );
}

function DashboardDetailModal({
  item,
  isBradley,
  onClose,
  onStatusChange
}: {
  item: Escalation;
  isBradley: boolean;
  onClose: () => void;
  onStatusChange: (id: string, status: string) => void;
}) {
  const estimateAttachments = getEstimateAttachments(item);
  const needsMoreInfoScreenshots = getNeedsMoreInfoScreenshots(item);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-4xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-white p-5">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap gap-2">
              <UrgencyBadge urgency={item.urgency} />
              <SourceBadge source={item.source} />
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.topic}</span>
              <StatusBadge status={item.status} />
              <span className="rounded-full bg-ga-50 px-2.5 py-1 text-xs font-semibold text-ga-700">{formatDate(item.follow_up_date)}</span>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-slate-950">{item.customer_name}</h3>
              {item.address ? <p className="mt-1 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{item.address}</p> : null}
              <p className="mt-1 text-xs font-medium text-slate-500">Review full dashboard details without leaving this page.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close dashboard details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-132px)] overflow-y-auto p-5">
          <div className="space-y-4 text-sm">
            <DashboardField label="Decision needed" value={item.proposed_next_step} strong />
            <DashboardField label="Why Bradley is needed" value={item.reason_for_escalation} />
            <DashboardField label="Situation" value={item.situation} />

            <AttachmentGallery attachments={estimateAttachments} title="Estimate photos / reference images" compact />

            {needsMoreInfoScreenshots.length ? (
              <AttachmentGallery attachments={needsMoreInfoScreenshots} title="Needs More Info screenshots / conversation context" compact />
            ) : null}

            {item.bradley_note ? <DashboardField label="Bradley note for Carl" value={item.bradley_note} strong /> : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <DashboardField label="Continue in" value={item.where_to_continue || item.source_detail || item.source} />
              <DashboardField label="Escalated date" value={formatDate(item.follow_up_date)} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <DashboardField label="Last touch" value={item.last_touch} />
              <DashboardField label="Owner next action" value={item.owner_next_action} />
            </div>
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4">
            {isBradley ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-xs text-slate-500">For Direct Reply, Reply Needed, or Needs More Info workflow actions, use Bradley Review.</p>
                <div className="flex flex-wrap gap-2">
                  <Link to="/bradley-review">
                    <Button variant="secondary" size="sm" leftIcon={<ExternalLink className="h-4 w-4" />}>Open Bradley Review</Button>
                  </Link>
                  <Button size="sm" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onStatusChange(item.id, 'Resolved')}>
                    Resolved
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-5">
                <Link to={`/escalations/${item.id}`} className="sm:col-span-1">
                  <Button variant="secondary" size="sm" className="w-full justify-center" leftIcon={<ExternalLink className="h-4 w-4" />}>Open</Button>
                </Link>
                <Link to={`/escalations/${item.id}?edit=true`} className="sm:col-span-1">
                  <Button variant="secondary" size="sm" className="w-full justify-center" leftIcon={<Pencil className="h-4 w-4" />}>Edit</Button>
                </Link>
                <Button variant="secondary" size="sm" className="w-full justify-center" leftIcon={<MessageSquare className="h-4 w-4" />} onClick={() => onStatusChange(item.id, 'Waiting on Customer')}>
                  Waiting Customer
                </Button>
                <Button variant="secondary" size="sm" className="w-full justify-center" leftIcon={<Clock3 className="h-4 w-4" />} onClick={() => onStatusChange(item.id, 'Waiting on Bradley')}>
                  Waiting Bradley
                </Button>
                <Button size="sm" className="w-full justify-center" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onStatusChange(item.id, 'Resolved')}>
                  Resolve
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DashboardField({ label, value, strong = false }: { label: string; value?: string | null; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${strong ? 'font-medium text-slate-950' : 'text-slate-800'}`}>
        {value || 'Not provided'}
      </p>
    </div>
  );
}
