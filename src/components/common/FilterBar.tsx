import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { EscalationFilters } from '@/types';

interface FilterBarProps {
  filters: EscalationFilters;
  onChange: (filters: EscalationFilters) => void;
  sources: string[];
  topics: string[];
  statuses: string[];
}

export function FilterBar({ filters, onChange, sources, topics, statuses }: FilterBarProps) {
  const set = (key: keyof EscalationFilters, value: string) => onChange({ ...filters, [key]: value });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-soft">
      <div className="grid gap-3 md:grid-cols-[1.5fr_1fr_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            className="pl-9"
            placeholder="Search customer, topic, situation..."
            value={filters.search ?? ''}
            onChange={(event) => set('search', event.target.value)}
          />
        </div>
        <Select options={sources} placeholder="All sources" value={filters.source ?? ''} onChange={(event) => set('source', event.target.value)} />
        <Select
          options={['Urgent / Customer-Sensitive', 'Standard / Non-Urgent']}
          placeholder="All urgency"
          value={filters.urgency ?? ''}
          onChange={(event) => set('urgency', event.target.value)}
        />
        <Select options={statuses} placeholder="All statuses" value={filters.status ?? ''} onChange={(event) => set('status', event.target.value)} />
        <Select options={topics} placeholder="All topics" value={filters.topic ?? ''} onChange={(event) => set('topic', event.target.value)} />
        <Button variant="secondary" onClick={() => onChange({})} leftIcon={<X className="h-4 w-4" />}>
          Clear
        </Button>
      </div>
    </div>
  );
}
