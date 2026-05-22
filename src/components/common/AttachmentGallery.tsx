import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, Image as ImageIcon, Trash2, X } from 'lucide-react';
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
  const items = useMemo(() => attachments ?? [], [attachments]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (!items.length) return null;

  const visibleItems = compact ? items.slice(0, 4) : items;
  const remaining = items.length - visibleItems.length;

  const openViewer = (attachment: EscalationAttachment) => {
    const index = items.findIndex((item) => item.id === attachment.id);
    setActiveIndex(index >= 0 ? index : 0);
  };

  return (
    <>
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
              <button
                type="button"
                onClick={() => openViewer(attachment)}
                className="group block w-full text-left focus:outline-none focus:ring-2 focus:ring-ga-500 focus:ring-offset-2"
                aria-label={`Open ${attachment.file_name}`}
              >
                <img
                  src={attachment.file_url}
                  alt={attachment.file_name}
                  className="h-32 w-full object-cover transition group-hover:scale-[1.02]"
                  loading="lazy"
                />
              </button>
              {!compact ? (
                <div className="space-y-2 p-3">
                  <div>
                    <p className="break-words text-xs font-semibold text-slate-800 [overflow-wrap:anywhere]">{attachment.file_name}</p>
                    <p className="text-xs text-slate-500">{formatFileSize(attachment.file_size)}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="flex-1"
                      leftIcon={<ExternalLink className="h-3.5 w-3.5" />}
                      onClick={() => openViewer(attachment)}
                    >
                      View
                    </Button>
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

      {activeIndex !== null ? (
        <ImageLightbox
          items={items}
          activeIndex={activeIndex}
          title={title}
          onChange={setActiveIndex}
          onClose={() => setActiveIndex(null)}
        />
      ) : null}
    </>
  );
}

function ImageLightbox({
  items,
  activeIndex,
  title,
  onChange,
  onClose
}: {
  items: EscalationAttachment[];
  activeIndex: number;
  title: string;
  onChange: (index: number) => void;
  onClose: () => void;
}) {
  const active = items[activeIndex];
  const hasMultiple = items.length > 1;

  const goPrevious = () => {
    onChange(activeIndex === 0 ? items.length - 1 : activeIndex - 1);
  };

  const goNext = () => {
    onChange(activeIndex === items.length - 1 ? 0 : activeIndex + 1);
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && hasMultiple) goPrevious();
      if (event.key === 'ArrowRight' && hasMultiple) goNext();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, hasMultiple]);

  if (!active) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-4" onClick={onClose}>
      <div
        className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{title}</p>
            <h3 className="mt-1 truncate text-lg font-bold text-slate-950">{active.file_name}</h3>
            <p className="mt-1 text-xs text-slate-500">
              Image {activeIndex + 1} of {items.length}{active.file_size ? ` · ${formatFileSize(active.file_size)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close image viewer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center bg-slate-950 p-3 sm:p-5">
          {hasMultiple ? (
            <button
              type="button"
              onClick={goPrevious}
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-900 shadow-lg transition hover:bg-white"
              aria-label="Previous image"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          ) : null}

          <img
            src={active.file_url}
            alt={active.file_name}
            className="max-h-[68vh] w-auto max-w-full rounded-xl object-contain"
          />

          {hasMultiple ? (
            <button
              type="button"
              onClick={goNext}
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-900 shadow-lg transition hover:bg-white"
              aria-label="Next image"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          ) : null}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-slate-100 p-3">
          <a href={active.file_url} target="_blank" rel="noreferrer">
            <Button type="button" variant="secondary" size="sm" leftIcon={<ExternalLink className="h-4 w-4" />}>
              Open full size
            </Button>
          </a>
          {hasMultiple ? (
            <div className="flex max-w-[70%] gap-2 overflow-x-auto pb-1">
              {items.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onChange(index)}
                  className={`h-14 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                    index === activeIndex ? 'border-ga-600' : 'border-transparent opacity-70 hover:opacity-100'
                  }`}
                  aria-label={`View image ${index + 1}`}
                >
                  <img src={item.file_url} alt={item.file_name} className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
