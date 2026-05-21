import { useEffect, useMemo, useState } from 'react';
import { FilterBar } from '@/components/common/FilterBar';
import { EscalationCard } from '@/components/common/EscalationCard';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { deleteEscalation, listEscalations } from '@/services/escalations';
import { fallbackOptions, getWorkspaceOptions, type WorkspaceOptions } from '@/services/settingsOptions';
import { filterEscalations } from '@/utils/filterEscalations';
import { useAuth } from '@/context/AuthContext';
import type { Escalation, EscalationFilters } from '@/types';

export function ResolvedEscalationsPage() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [options, setOptions] = useState<WorkspaceOptions>(fallbackOptions);
  const [filters, setFilters] = useState<EscalationFilters>({ resolved: true });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { profile } = useAuth();
  const canManageResolved = profile?.role === 'carl' || profile?.role === 'admin';

  useEffect(() => {
    Promise.all([listEscalations(), getWorkspaceOptions()])
      .then(([nextItems, nextOptions]) => {
        setItems(nextItems);
        setOptions(nextOptions);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Unable to load resolved escalations.'))
      .finally(() => setLoading(false));
  }, []);

  const visible = useMemo(() => filterEscalations(items, { ...filters, resolved: true }), [items, filters]);

  const handleDelete = async (id: string) => {
    const item = items.find((entry) => entry.id === id);
    const customerName = item?.customer_name ?? 'this resolved escalation';
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete ${customerName}? This will remove the resolved item, comments, and activity history from the dashboard.`
    );

    if (!confirmed) return;

    setDeletingId(id);
    setError('');

    try {
      await deleteEscalation(id);
      setItems((current) => current.filter((entry) => entry.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to delete resolved escalation.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="page-shell space-y-6">
      <div>
        <p className="section-title">Closed work</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Resolved Escalations</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">Review handled, closed, archived, and not-a-fit items.</p>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {loading ? <LoadingState label="Loading resolved items..." /> : (
        <>
          <FilterBar filters={filters} onChange={(next) => setFilters({ ...next, resolved: true })} sources={options.sources} topics={options.topics} statuses={options.statuses} />
          <div className="space-y-3">
            {visible.length ? visible.map((item) => (
              <EscalationCard
                key={item.id}
                escalation={item}
                compact
                onDelete={canManageResolved ? handleDelete : undefined}
                deleting={deletingId === item.id}
                canOpen={canManageResolved}
                canEdit={canManageResolved}
                showStatusActions={false}
              />
            )) : <EmptyState title="No resolved items found" description="Resolved items will appear here once Bradley or Carl closes them." />}
          </div>
        </>
      )}
    </div>
  );
}
