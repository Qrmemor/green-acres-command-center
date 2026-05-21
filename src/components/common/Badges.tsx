import { Badge } from '@/components/ui/Badge';

export function UrgencyBadge({ urgency }: { urgency: string }) {
  return <Badge tone={urgency.includes('Urgent') ? 'red' : 'blue'}>{urgency}</Badge>;
}

export function SourceBadge({ source }: { source: string }) {
  const tone = source === 'Quo' ? 'green' : source === 'Gmail' ? 'blue' : source === 'HomeWorks' ? 'purple' : 'slate';
  return <Badge tone={tone}>{source}</Badge>;
}

export function StatusBadge({ status }: { status: string }) {
  const tone = status === 'Resolved' || status === 'Closed' ? 'green' : status.includes('Bradley') ? 'amber' : status === 'Not a Fit' ? 'slate' : 'blue';
  return <Badge tone={tone}>{status}</Badge>;
}
