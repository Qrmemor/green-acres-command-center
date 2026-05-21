import { RESOLVED_STATUSES } from '@/lib/constants';
import type { Escalation } from '@/types';

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(' ');
}

export function formatDate(date?: string | null) {
  if (!date) return 'No date';
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(parsed);
}

export function formatDateTime(value?: string | null) {
  if (!value) return 'No date';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

export function toInputDate(value: Date = new Date()) {
  const offset = value.getTimezoneOffset();
  const localDate = new Date(value.getTime() - offset * 60_000);
  return localDate.toISOString().split('T')[0];
}

export function isResolvedStatus(status: string) {
  return RESOLVED_STATUSES.includes(status);
}

export function isToday(date?: string | null) {
  if (!date) return false;
  return date === toInputDate();
}

export function isOverdue(date?: string | null) {
  if (!date) return false;
  return date < toInputDate();
}

export function isDueOrOverdue(escalation: Escalation) {
  return !isResolvedStatus(escalation.status) && Boolean(escalation.follow_up_date) && escalation.follow_up_date! <= toInputDate();
}

export function sortEscalations(a: Escalation, b: Escalation) {
  const urgencyWeight = (item: Escalation) => (item.urgency === 'Urgent / Customer-Sensitive' ? 0 : 1);
  const dueWeight = (item: Escalation) => (isDueOrOverdue(item) ? 0 : 1);
  const dateA = a.follow_up_date ?? '9999-12-31';
  const dateB = b.follow_up_date ?? '9999-12-31';

  return urgencyWeight(a) - urgencyWeight(b) || dueWeight(a) - dueWeight(b) || dateA.localeCompare(dateB);
}

export function truncate(value: string, length = 150) {
  if (!value) return '';
  return value.length > length ? `${value.slice(0, length).trim()}...` : value;
}
