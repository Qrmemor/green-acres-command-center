import { ExternalLink, Image as ImageIcon, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { EscalationAttachment } from '@/types';

interface AttachmentGalleryProps {
  attachments?: EscalationAttachment[] | null;
  title?: string;
  compact?: boolean;
  onDelete?: (attachment: EscalationAttachment) => void;
}

function formatFileSize(size: number | null) {
  if (!size) return '';
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentGallery({ attachments, title = 'Estimate photos', compact = false, onDelete }: AttachmentGalleryProps) {
  const items = attachments ?? [];

  if (!items.length) return null;

  const visibleItems = compact ? items.slice(0, 4) : items;
  const remaining = items.length - visibleItems.length;

  return (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-ga-50 text-ga-700">
            <ImageIcon className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">{items.length} attached image{items.length === 1 ? '' : 's'}</p>
          </div>
        </div>
        {remaining > 0 ? <span className="text-xs font-medium text-slate-500">+{remaining} more</span> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {visibleItems.map((attachment) => (
          <div key={attachment.id} className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
            <a href={attachment.file_url} target="_blank" rel="noreferrer" className="block">
              <img
                src={attachment.file_url}
                alt={attachment.file_name}
                className="h-32 w-full object-cover transition hover:scale-[1.02]"
                loading="lazy"
              />
            </a>
            {!compact ? (
              <div className="space-y-2 p-3">
                <div>
                  <p className="break-words text-xs font-semibold text-slate-800 [overflow-wrap:anywhere]">{attachment.file_name}</p>
                  <p className="text-xs text-slate-500">{formatFileSize(attachment.file_size)}</p>
                </div>
                <div className="flex gap-2">
                  <a href={attachment.file_url} target="_blank" rel="noreferrer" className="flex-1">
                    <Button type="button" variant="secondary" size="sm" className="w-full" leftIcon={<ExternalLink className="h-3.5 w-3.5" />}>
                      Open
                    </Button>
                  </a>
                  {onDelete ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      leftIcon={<Trash2 className="h-3.5 w-3.5" />}
                      onClick={() => onDelete(attachment)}
                    >
                      Delete
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
