import { SOURCE_ORDER } from '@/lib/constants';
import { formatDate, isResolvedStatus } from '@/lib/utils';
import type { Escalation, ReportType } from '@/types';

function formatReportDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(parsed);
}

function itemLine(item: Escalation) {
  return `- ${item.customer_name} (${item.topic}) — ${item.situation}\n  Last touch: ${item.last_touch}\n  Needs Bradley because: ${item.reason_for_escalation}\n  Proposed next step: ${item.proposed_next_step}\n  Continue in: ${item.where_to_continue}\n  Follow-up: ${formatDate(item.follow_up_date)}`;
}

function sectionForSource(source: string, items: Escalation[]) {
  const sourceItems = items.filter((item) => item.source === source);
  if (sourceItems.length === 0) return 'No open items.';
  return sourceItems.map(itemLine).join('\n\n');
}

function openLoops(items: Escalation[]) {
  const unresolved = items.filter((item) => !isResolvedStatus(item.status));
  if (unresolved.length === 0) return 'No open loops. All tracked items are resolved or closed.';
  const ownerCarl = unresolved.filter((item) => item.owner_next_action === 'Carl');
  const ownerCustomer = unresolved.filter((item) => item.owner_next_action === 'Customer');
  const ownerBradley = unresolved.filter((item) => item.owner_next_action === 'Bradley');

  return [
    ownerCarl.length ? `- Carl will continue tracking: ${ownerCarl.map((item) => item.customer_name).join(', ')}.` : '',
    ownerBradley.length ? `- Waiting on Bradley direction: ${ownerBradley.map((item) => item.customer_name).join(', ')}.` : '',
    ownerCustomer.length ? `- Waiting on customer response: ${ownerCustomer.map((item) => item.customer_name).join(', ')}.` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

export function generateSodEodReport(reportType: ReportType, date: string, escalations: Escalation[]) {
  const unresolved = escalations.filter((item) => !isResolvedStatus(item.status));
  const urgent = unresolved.filter((item) => item.urgency === 'Urgent / Customer-Sensitive');
  const standard = unresolved.filter((item) => item.urgency === 'Standard / Non-Urgent');
  const formatted = formatReportDate(date);
  const greeting = reportType === 'SOD' ? `Good morning. Here is my SOD for ${formatted}.` : `Here is my EOD for ${formatted}.`;

  return `Hi Sir Bradley,\n\n${greeting}\n\nQUO\n\n${sectionForSource('Quo', unresolved)}\n\nGMAIL (team@)\n\n${sectionForSource('Gmail', unresolved)}\n\nHOMEWORKS\n\n${sectionForSource('HomeWorks', unresolved)}\n\nNEEDS BRADLEY / STILL OPEN\n\nURGENT / CUSTOMER-SENSITIVE\n\n${urgent.length ? urgent.map(itemLine).join('\n\n') : 'No urgent customer-sensitive items.'}\n\nSTANDARD / NON-URGENT\n\n${standard.length ? standard.map(itemLine).join('\n\n') : 'No standard non-urgent items.'}\n\nOPEN LOOPS\n\n${openLoops(unresolved)}\n\nThanks,\nCarl`;
}

export function sortBySourceOrder(a: Escalation, b: Escalation) {
  const ai = SOURCE_ORDER.indexOf(a.source);
  const bi = SOURCE_ORDER.indexOf(b.source);
  return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
}
