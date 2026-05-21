import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Alert({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900', className)} {...props} />;
}
