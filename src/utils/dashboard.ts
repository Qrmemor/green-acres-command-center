import { isResolvedStatus, toInputDate } from '@/lib/utils';
import type { DashboardStats, Escalation } from '@/types';

export function calculateDashboardStats(escalations: Escalation[]): DashboardStats {
  const today = toInputDate();
  const open = escalations.filter((item) => !isResolvedStatus(item.status));

  return {
    totalOpen: open.length,
    urgent: open.filter((item) => item.urgency === 'Urgent / Customer-Sensitive').length,
    standard: open.filter((item) => item.urgency === 'Standard / Non-Urgent').length,
    waitingOnBradley: open.filter((item) => item.status === 'Waiting on Bradley' || item.status === 'Needs Bradley').length,
    waitingOnCustomer: open.filter((item) => item.status === 'Waiting on Customer').length,
    resolvedToday: escalations.filter((item) => item.resolved_at?.startsWith(today)).length
  };
}
