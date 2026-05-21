import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/Card';

export function StatCard({ label, value, icon, helper }: { label: string; value: number; icon: ReactNode; helper?: string }) {
  return (
    <Card className="overflow-hidden">
      <CardContent className="flex items-center gap-4 p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-ga-50 text-ga-700">
          {icon}
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-950">{value}</p>
          {helper ? <p className="mt-1 text-xs text-slate-500">{helper}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
