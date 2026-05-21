import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'green' | 'red' | 'amber' | 'blue' | 'slate' | 'purple';
}

const tones = {
  green: 'border-ga-200 bg-ga-50 text-ga-800',
  red: 'border-red-200 bg-red-50 text-red-700',
  amber: 'border-amber-200 bg-amber-50 text-amber-800',
  blue: 'border-blue-200 bg-blue-50 text-blue-700',
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  purple: 'border-purple-200 bg-purple-50 text-purple-700'
};

export function Badge({ tone = 'slate', className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold leading-none',
        tones[tone],
        className
      )}
      {...props}
    />
  );
}
