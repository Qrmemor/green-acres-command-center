import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Copy, ExternalLink, Image as ImageIcon, Info, Mail, Reply, Search, ShieldAlert, X } from 'lucide-react';
import { BRADLEY_ACTIONS } from '@/lib/constants';
import { formatDate, sortEscalations, truncate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { SourceBadge, StatusBadge, UrgencyBadge } from '@/components/common/Badges';
import { AttachmentGallery } from '@/components/common/AttachmentGallery';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { listEscalations, updateBradleyAction } from '@/services/escalations';
import type { Escalation, OwnerNextAction } from '@/types';

const actionIcons: Record<string, JSX.Element> = {
  'Direct Reply': <ExternalLink className="h-4 w-4" />,
  'Reply Needed': <Reply className="h-4 w-4" />,
  'Okay Carl, Work This': <Check className="h-4 w-4" />,
  'Needs More Info': <ImageIcon className="h-4 w-4" />,
  Resolved: <ShieldAlert className="h-4 w-4" />
};

type HandoffMode = 'reply' | 'moreInfo';

const BRADLEY_QUO_HOME_URL = 'https://my.quo.com/inbox';

function findDirectLink(value?: string | null) {
  const trimmed = (value ?? '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/[),.]+$/, '');
  const match = trimmed.match(/https?:\/\/\S+/i);
  return match?.[0]?.replace(/[),.]+$/, '') ?? '';
}

function getCallLink(item: Escalation) {
  return findDirectLink(item.call_link);
}

function getReplyThreadLink(item: Escalation) {
  return findDirectLink(item.thread_link) || findDirectLink(item.where_to_continue) || findDirectLink(item.source_detail);
}

function stripDirectLinks(value?: string | null) {
  return (value ?? '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getContinueLabel(item: Escalation) {
  const cleanedContinue = stripDirectLinks(item.where_to_continue);
  const cleanedSourceDetail = stripDirectLinks(item.source_detail);
  return cleanedContinue || cleanedSourceDetail || item.source || 'No continue instruction saved';
}

function getEstimateAttachments(item: Escalation) {
  return (item.attachments ?? []).filter((attachment) => (attachment.attachment_category ?? 'estimate') === 'estimate');
}

function getNeedsMoreInfoScreenshots(item: Escalation) {
  return (item.attachments ?? []).filter((attachment) => attachment.attachment_category === 'needs_more_info');
}

function getPhoneNumber(item: Escalation) {
  if (item.phone?.trim()) return item.phone.trim();

  const searchableText = [item.source_detail, item.where_to_continue, item.situation, item.last_touch]
    .filter(Boolean)
    .join(' ');

  const match = searchableText.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  return match?.[0]?.trim() ?? '';
}

function getCustomerEmail(item: Escalation) {
  if (item.email?.trim()) return item.email.trim();

  const searchableText = [item.source_detail, item.where_to_continue, item.situation, item.last_touch]
    .filter(Boolean)
    .join(' ');

  const match = searchableText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.trim() ?? '';
}

function openEmailCompose(item: Escalation) {
  const customerEmail = getCustomerEmail(item);
  if (!customerEmail) return false;

  const subject = encodeURIComponent(`Green Acres Landscaping - ${item.topic}`);
  window.location.href = `mailto:${encodeURIComponent(customerEmail)}?subject=${subject}`;
  return true;
}

async function openBradleyQuoSearch(item: Escalation) {
  const phoneNumber = getPhoneNumber(item);
  if (phoneNumber) await copyToClipboard(phoneNumber);
  window.open(BRADLEY_QUO_HOME_URL, '_blank', 'noopener,noreferrer');
  return Boolean(phoneNumber);
}

async function copyToClipboard(text: string) {
  if (!text.trim()) return false;

  try {
    await navigator.clipboard.writeText(text.trim());
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text.trim();
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(textarea);
    return copied;
  }
}

function openCallLink(item: Escalation) {
  const directLink = getCallLink(item);
  if (!directLink) return false;

  window.open(directLink, '_blank', 'noopener,noreferrer');
  return true;
}

function openReplyThread(item: Escalation) {
  const directLink = getReplyThreadLink(item);
  if (!directLink) return false;

  window.open(directLink, '_blank', 'noopener,noreferrer');
  return true;
}

export function BradleyReviewPage() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [handoffItem, setHandoffItem] = useState<Escalation | null>(null);
  const [handoffMode, setHandoffMode] = useState<HandoffMode>('reply');
  const [handoffNote, setHandoffNote] = useState('');
  const [savingHandoff, setSavingHandoff] = useState(false);
  const [selectedReviewItem, setSelectedReviewItem] = useState<Escalation | null>(null);
  const [directReplyItem, setDirectReplyItem] = useState<Escalation | null>(null);
  const [photoReviewItem, setPhotoReviewItem] = useState<Escalation | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await listEscalations({ resolved: false });
      setItems(data.sort(sortEscalations));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Bradley review.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const startHandoff = (item: Escalation, mode: HandoffMode) => {
    setHandoffItem(item);
    setHandoffMode(mode);

    if (mode === 'reply') {
      setHandoffNote(item.bradley_note || item.proposed_next_step || '');
      return;
    }

    setHandoffNote(
      item.bradley_note ||
        'Carl, please review the thread and gather the missing details before Bradley makes a decision.'
    );
    setSuccess('Add what information is needed, then hand it to Carl. This will not open Carl’s private thread link for Bradley.');
  };

  const action = async (item: Escalation, label: string, status: string, ownerNextAction: OwnerNextAction, note: string) => {
    setError('');
    setSuccess('');

    if (label === 'Direct Reply') {
      setDirectReplyItem(item);
      setSuccess('Direct reply helper opened. Bradley can use his own email or Quo account, then mark I Replied after sending.');
      return;
    }

    if (label === 'Reply Needed') {
      startHandoff(item, 'reply');
      return;
    }

    if (label === 'Needs More Info') {
      setPhotoReviewItem(item);
      setSuccess('Needs More Info screenshots opened. Bradley can review the full conversation/context before deciding what Carl should do next.');
      return;
    }

    if (label === 'I Replied') {
      const confirmed = window.confirm(
        `Are you sure Bradley already replied to ${item.customer_name}? This will mark the item as Bradley Replied and keep it in the log.`
      );

      if (!confirmed) return;
    }

    const threadOpened = label === 'Call Needed' ? openCallLink(item) : false;
    const phoneNumber = label === 'Call Needed' ? getPhoneNumber(item) : '';
    const phoneCopied = phoneNumber ? await copyToClipboard(phoneNumber) : false;

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, status, owner_next_action: ownerNextAction } : entry
      )
    );

    try {
      const extraPayload =
        label === 'Okay Carl, Work This'
          ? { bradley_note: item.bradley_note || 'Bradley approved this. Carl can work this item using the proposed next step.' }
          : {};

      await updateBradleyAction(item.id, status, ownerNextAction, note, extraPayload);

      if (label === 'Call Needed') {
        const phoneMessage = phoneCopied
          ? `Phone number copied: ${phoneNumber}.`
          : 'No phone number was saved on this escalation, so nothing was copied.';
        const threadMessage = threadOpened
          ? ' Thread opened.'
          : ' Add a Call Link / OpenPhone Link if you want Call Needed to open the call thread automatically.';
        setSuccess(`${phoneMessage}${threadMessage}`);
      } else if (label === 'I Replied') {
        setSuccess('Saved as Bradley Replied.');
      } else if (label === 'Okay Carl, Work This') {
        setSuccess('Moved to Carl Work Queue.');
      }

      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update item.');
      await load();
    }
  };

  const saveHandoffForCarl = async () => {
    if (!handoffItem) return;
    const cleanNote = handoffNote.trim();
    if (!cleanNote) {
      setError(handoffMode === 'reply' ? 'Add the reply note first before sending it to Carl.' : 'Add what information is needed before sending it to Carl.');
      return;
    }

    setSavingHandoff(true);
    setError('');
    setSuccess('');

    const isMoreInfo = handoffMode === 'moreInfo';

    try {
      await updateBradleyAction(
        handoffItem.id,
        isMoreInfo ? 'Follow-Up Needed' : 'Ready for Carl',
        'Carl',
        isMoreInfo
          ? 'Bradley requested more information and handed this back to Carl.'
          : 'Bradley added a reply note and handed this back to Carl.',
        { bradley_note: cleanNote }
      );
      setHandoffItem(null);
      setHandoffNote('');
      setSuccess(isMoreInfo ? 'More info request saved. This item is now in Carl Work Queue.' : 'Reply note saved. This item is now in Carl Work Queue.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save Bradley note.');
    } finally {
      setSavingHandoff(false);
    }
  };

  const reviewItems = useMemo(() => items.filter((item) =>
    item.owner_next_action === 'Bradley' || ['Needs Bradley', 'Waiting on Bradley'].includes(item.status)
  ), [items]);

  const urgent = reviewItems.filter((item) => item.urgency === 'Urgent / Customer-Sensitive');
  const standard = reviewItems.filter((item) => item.urgency === 'Standard / Non-Urgent');

  const handoffTitle = handoffMode === 'moreInfo' ? 'More info request for Carl' : 'Reply note for Carl';
  const handoffDescription = handoffMode === 'moreInfo'
    ? 'Bradley can type what information Carl needs to gather. It will only move to Carl Work Queue after clicking Okay Carl, Work This.'
    : 'Bradley can type the exact instruction or suggested reply. When saved, it moves to Carl Work Queue.';

  return (
    <div className="page-shell space-y-6">
      <div>
        <p className="section-title">Owner view</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Bradley Review</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">A simple decision inbox. Bradley can review estimate photos, open conversation screenshots for Needs More Info, or hand clear notes back to Carl.</p>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-ga-200 bg-ga-50 p-4 text-sm text-ga-800">{success}</div> : null}

      {loading ? <LoadingState label="Loading Bradley review..." /> : (
        <>
          <OwnerSection title="Urgent / Customer-Sensitive" items={urgent} onOpenItem={setSelectedReviewItem} />
          <OwnerSection title="Standard / Non-Urgent" items={standard} onOpenItem={setSelectedReviewItem} />
        </>
      )}

      {selectedReviewItem ? (
        <ReviewDetailModal
          item={selectedReviewItem}
          onClose={() => setSelectedReviewItem(null)}
          onAction={async (item, label, status, ownerNextAction, note) => {
            await action(item, label, status, ownerNextAction, note);
            if (label === 'Resolved' || label === 'Okay Carl, Work This' || label === 'I Replied') {
              setSelectedReviewItem(null);
            }
          }}
        />
      ) : null}


      {directReplyItem ? (
        <DirectReplyModal
          item={directReplyItem}
          onClose={() => setDirectReplyItem(null)}
          onMarkReplied={async () => {
            await action(directReplyItem, 'I Replied', 'Bradley Replied', 'Customer', 'Bradley replied directly from his own email or Quo account.');
            setDirectReplyItem(null);
            setSelectedReviewItem(null);
          }}
        />
      ) : null}

      {photoReviewItem ? (
        <PhotoReviewModal
          item={photoReviewItem}
          onClose={() => setPhotoReviewItem(null)}
          onReplyNeeded={() => {
            setPhotoReviewItem(null);
            startHandoff(photoReviewItem, 'reply');
          }}
        />
      ) : null}

      {handoffItem ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <Card className="w-full max-w-2xl">
            <CardContent className="p-6">
              <div className="mb-4">
                <p className="section-title">{handoffTitle}</p>
                <h2 className="mt-2 text-2xl font-bold text-slate-950">{handoffItem.customer_name}</h2>
                <p className="mt-1 text-sm text-slate-500">{handoffDescription}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Decision needed</p>
                <p className="mt-1">{truncate(handoffItem.proposed_next_step, 220)}</p>
              </div>
              <div className="mt-4">
                <Textarea
                  value={handoffNote}
                  onChange={(event) => setHandoffNote(event.target.value)}
                  className="min-h-[180px]"
                  placeholder={handoffMode === 'moreInfo'
                    ? 'Example: Carl, please ask the customer for the backyard access details and confirm if Saturday is the only available day.'
                    : 'Example: Carl, please reply: Hi [Name], Bradley reviewed this and...'}
                />
              </div>
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => setHandoffItem(null)} disabled={savingHandoff}>Cancel</Button>
                <Button onClick={saveHandoffForCarl} disabled={savingHandoff} leftIcon={<Check className="h-4 w-4" />}>
                  {savingHandoff ? 'Saving...' : 'Okay Carl, Work This'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function OwnerSection({
  title,
  items,
  onOpenItem
}: {
  title: string;
  items: Escalation[];
  onOpenItem: (item: Escalation) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{items.length}</span>
      </div>
      {items.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenItem(item)}
              className="group rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-soft transition-all duration-200 hover:-translate-y-0.5 hover:border-ga-200 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-ga-600/30"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <UrgencyBadge urgency={item.urgency} />
                    <SourceBadge source={item.source} />
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.topic}</span>
                    <StatusBadge status={item.status} />
                    <span className="rounded-full bg-ga-50 px-2.5 py-1 text-xs font-semibold text-ga-700 sm:hidden">
                      {formatDate(item.follow_up_date)}
                    </span>
                  </div>
                  <div>
                    <h3 className="truncate text-xl font-bold text-slate-950">{item.customer_name}</h3>
                    <p className="mt-1 text-xs font-medium text-slate-500">Click to review details.</p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="hidden rounded-full bg-ga-50 px-3 py-1 text-xs font-semibold text-ga-700 sm:inline-flex">
                    {formatDate(item.follow_up_date)}
                  </span>
                  <ChevronRight className="h-5 w-5 text-slate-400 transition-transform duration-200 group-hover:translate-x-1" />
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState title="No items for this section" description="Bradley has nothing to review here right now." />
      )}
    </section>
  );
}

function ReviewDetailModal({
  item,
  onClose,
  onAction
}: {
  item: Escalation;
  onClose: () => void;
  onAction: (item: Escalation, label: string, status: string, ownerNextAction: OwnerNextAction, note: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-3xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 bg-white p-5">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap gap-2">
              <UrgencyBadge urgency={item.urgency} />
              <SourceBadge source={item.source} />
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.topic}</span>
              <StatusBadge status={item.status} />
              <span className="rounded-full bg-ga-50 px-2.5 py-1 text-xs font-semibold text-ga-700">{formatDate(item.follow_up_date)}</span>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-slate-950">{item.customer_name}</h3>
              <p className="mt-1 text-xs font-medium text-slate-500">Review details, then choose the next action.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close review details"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-124px)] overflow-y-auto p-5">
          <div className="space-y-4 text-sm">
            <OwnerField label="Decision needed" value={item.proposed_next_step} strong />
            <OwnerField label="Why Bradley is needed" value={item.reason_for_escalation} />
            <OwnerField label="Situation" value={item.situation} />
            <AttachmentGallery attachments={getEstimateAttachments(item)} title="Estimate photos / reference images" compact />
            {item.bradley_note ? <OwnerField label="Current Bradley note" value={item.bradley_note} strong /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <OwnerField label="Continue in" value={getContinueLabel(item)} />
              <OwnerField label="Escalated date" value={formatDate(item.follow_up_date)} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Review helper</p>
              <p className="mt-1">
                Needs More Info opens the attached conversation screenshots in a focused popup. Reply Needed lets Bradley write the exact instruction for Carl. Direct Reply helps Bradley use his own email or Quo account.
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <div className="grid gap-2 sm:grid-cols-2">
              {BRADLEY_ACTIONS.filter((action) => action.label !== 'Okay Carl, Work This' && action.label !== 'Resolved').map((action) => (
                <Button
                  key={action.label}
                  variant="secondary"
                  size="sm"
                  className="justify-center"
                  leftIcon={actionIcons[action.label]}
                  onClick={() => onAction(item, action.label, action.status, action.ownerNextAction, action.note)}
                >
                  {action.label}
                </Button>
              ))}
            </div>

            {BRADLEY_ACTIONS.filter((action) => action.label === 'Resolved').map((action) => (
              <Button
                key={action.label}
                variant="primary"
                size="sm"
                className="mx-auto w-full justify-center sm:max-w-sm"
                leftIcon={actionIcons[action.label]}
                onClick={() => onAction(item, action.label, action.status, action.ownerNextAction, action.note)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


function PhotoReviewModal({
  item,
  onClose,
  onReplyNeeded
}: {
  item: Escalation;
  onClose: () => void;
  onReplyNeeded: () => void;
}) {
  const attachments = getNeedsMoreInfoScreenshots(item);
  const [activeIndex, setActiveIndex] = useState(0);
  const active = attachments[activeIndex];
  const hasMultiple = attachments.length > 1;

  const goPrevious = () => {
    setActiveIndex((current) => (current === 0 ? attachments.length - 1 : current - 1));
  };

  const goNext = () => {
    setActiveIndex((current) => (current === attachments.length - 1 ? 0 : current + 1));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!attachments.length) return;
      if (event.key === 'ArrowLeft' && hasMultiple) goPrevious();
      if (event.key === 'ArrowRight' && hasMultiple) goNext();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [attachments.length, hasMultiple]);

  useEffect(() => {
    if (activeIndex > attachments.length - 1) setActiveIndex(0);
  }, [activeIndex, attachments.length]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" onClick={onClose}>
      <div
        className="max-h-[94vh] w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <p className="section-title">Needs More Info screenshots</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">{item.customer_name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              Review the attached conversation screenshots here. Use the arrows or thumbnails when there are multiple screenshots.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close screenshots"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(94vh-132px)] overflow-y-auto p-5">
          {active ? (
            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 p-4">
                <div>
                  <p className="text-sm font-semibold text-slate-950">Screenshot {activeIndex + 1} of {attachments.length}</p>
                  <p className="mt-1 max-w-xl truncate text-xs text-slate-500">{active.file_name}</p>
                </div>
                <a href={active.file_url} target="_blank" rel="noreferrer">
                  <Button type="button" variant="secondary" size="sm" leftIcon={<ExternalLink className="h-4 w-4" />}>
                    Open full size
                  </Button>
                </a>
              </div>

              <div className="relative flex min-h-[360px] items-center justify-center bg-slate-950 p-3 sm:p-5">
                {hasMultiple ? (
                  <button
                    type="button"
                    onClick={goPrevious}
                    className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-900 shadow-lg transition hover:bg-white"
                    aria-label="Previous screenshot"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                ) : null}

                <img
                  src={active.file_url}
                  alt={active.file_name}
                  className="max-h-[62vh] w-auto max-w-full rounded-xl object-contain"
                />

                {hasMultiple ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/90 p-3 text-slate-900 shadow-lg transition hover:bg-white"
                    aria-label="Next screenshot"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                ) : null}
              </div>

              {hasMultiple ? (
                <div className="flex gap-2 overflow-x-auto border-t border-slate-100 p-3">
                  {attachments.map((attachment, index) => (
                    <button
                      key={attachment.id}
                      type="button"
                      onClick={() => setActiveIndex(index)}
                      className={`h-16 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                        index === activeIndex ? 'border-ga-600' : 'border-transparent opacity-70 hover:opacity-100'
                      }`}
                      aria-label={`View screenshot ${index + 1}`}
                    >
                      <img src={attachment.file_url} alt={attachment.file_name} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
              <ImageIcon className="mx-auto h-8 w-8 text-slate-400" />
              <h3 className="mt-3 text-lg font-semibold text-slate-950">No Needs More Info screenshots attached</h3>
              <p className="mt-1 text-sm text-slate-500">
                Add screenshots in the Needs More Info Screenshots field on the escalation first so Bradley can review them here.
              </p>
            </div>
          )}

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={onReplyNeeded} leftIcon={<Reply className="h-4 w-4" />}>
              Write Note for Carl
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}


function DirectReplyModal({
  item,
  onClose,
  onMarkReplied
}: {
  item: Escalation;
  onClose: () => void;
  onMarkReplied: () => void;
}) {
  const [localMessage, setLocalMessage] = useState('');
  const customerEmail = getCustomerEmail(item);
  const phoneNumber = getPhoneNumber(item);
  const canUseEmail = Boolean(customerEmail);
  const canUseQuo = Boolean(phoneNumber);

  const setMessage = (message: string) => {
    setLocalMessage(message);
    window.setTimeout(() => setLocalMessage(''), 2500);
  };

  const copyValue = async (value: string, label: string) => {
    const copied = await copyToClipboard(value);
    setMessage(copied ? `${label} copied.` : `Unable to copy ${label.toLowerCase()}.`);
  };

  const handleEmailCompose = () => {
    const opened = openEmailCompose(item);
    setMessage(opened ? 'Email compose opened in Bradley’s default email account.' : 'No customer email is saved yet.');
  };

  const handleQuoOpen = async () => {
    const copiedPhone = await openBradleyQuoSearch(item);
    setMessage(copiedPhone ? 'Phone copied. Quo opened. Bradley can paste/search the phone number in his own Quo account.' : 'Quo opened, but no phone number is saved yet.');
  };

  const handleMarkReplied = async () => {
    const confirmed = window.confirm(`Are you sure Bradley already replied to ${item.customer_name} from his own email or Quo account?`);
    if (!confirmed) return;
    await onMarkReplied();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/50 p-4" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
          <div>
            <p className="section-title">Direct reply using Bradley’s own account</p>
            <h2 className="mt-2 text-2xl font-bold text-slate-950">{item.customer_name}</h2>
            <p className="mt-1 text-sm text-slate-500">
              This does not use Carl’s private Gmail or Quo thread link. It helps Bradley reply from his own email or Quo account.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
            aria-label="Close direct reply helper"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[calc(92vh-124px)] overflow-y-auto p-5">
          {localMessage ? (
            <div className="mb-4 rounded-2xl border border-ga-200 bg-ga-50 p-3 text-sm text-ga-800">{localMessage}</div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Mail className="h-4 w-4" />
                Email direct reply
              </div>
              <p className="mt-2 break-words text-sm text-slate-700">{customerEmail || 'No customer email saved yet.'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" leftIcon={<Copy className="h-4 w-4" />} disabled={!canUseEmail} onClick={() => copyValue(customerEmail, 'Customer email')}>
                  Copy Email
                </Button>
                <Button size="sm" leftIcon={<ExternalLink className="h-4 w-4" />} disabled={!canUseEmail} onClick={handleEmailCompose}>
                  Open Email Compose
                </Button>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <Search className="h-4 w-4" />
                Quo direct reply
              </div>
              <p className="mt-2 break-words text-sm text-slate-700">{phoneNumber || 'No customer phone saved yet.'}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Button size="sm" variant="secondary" leftIcon={<Copy className="h-4 w-4" />} disabled={!canUseQuo} onClick={() => copyValue(phoneNumber, 'Phone number')}>
                  Copy Phone
                </Button>
                <Button size="sm" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={handleQuoOpen}>
                  Open Quo
                </Button>
              </div>
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            If Bradley does not see the customer in his Quo account after searching the phone number, then that customer thread is only available in Carl/team access. In that case, Bradley should use Reply Needed and hand the reply back to Carl.
          </div>

          <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={onClose}>Close</Button>
            <Button onClick={handleMarkReplied} leftIcon={<Check className="h-4 w-4" />}>
              I Replied
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function OwnerField({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 whitespace-pre-wrap break-words ${strong ? 'font-medium text-slate-950' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}
