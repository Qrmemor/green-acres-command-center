import { isResolvedStatus, toInputDate } from '@/lib/utils';
import type { Escalation, EscalationFilters } from '@/types';

export function filterEscalations(items: Escalation[], filters: EscalationFilters) {
  const search = filters.search?.toLowerCase().trim();
  const today = toInputDate();

  return items.filter((item) => {
    if (filters.resolved === true && !isResolvedStatus(item.status)) return false;
    if (filters.resolved === false && isResolvedStatus(item.status)) return false;
    if (filters.source && item.source !== filters.source) return false;
    if (filters.urgency && item.urgency !== filters.urgency) return false;
    if (filters.status && item.status !== filters.status) return false;
    if (filters.topic && item.topic !== filters.topic) return false;
    if (filters.followUp === 'today' && item.follow_up_date !== today) return false;
    if (filters.followUp === 'overdue' && (!item.follow_up_date || item.follow_up_date >= today || isResolvedStatus(item.status))) return false;
    if (filters.followUp === 'upcoming' && (!item.follow_up_date || item.follow_up_date <= today || isResolvedStatus(item.status))) return false;
    if (search) {
      const haystack = [item.customer_name, item.address, item.source, item.topic, item.situation, item.reason_for_escalation, item.proposed_next_step, item.status]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(search);
    }
    return true;
  });
}
