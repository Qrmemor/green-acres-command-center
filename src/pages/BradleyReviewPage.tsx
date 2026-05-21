import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronRight, Clock, Info, PhoneCall, Reply, ShieldAlert, X } from 'lucide-react';
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
  'Call Needed': <PhoneCall className="h-4 w-4" />,
  'Reply Needed': <Reply className="h-4 w-4" />,
  'Okay Carl, Work This': <Check className="h-4 w-4" />,
  'Needs More Info': <Info className="h-4 w-4" />,
  'I Replied': <Clock className="h-4 w-4" />,
  Resolved: <ShieldAlert className="h-4 w-4" />
};

type HandoffMode = 'reply' | 'moreInfo';

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
  const callLink = getCallLink(item);
  const replyLink = getReplyThreadLink(item);
  const cleanedContinue = stripDirectLinks(item.where_to_continue);
  const cleanedSourceDetail = stripDirectLinks(item.source_detail);
  const cleanText = cleanedContinue || cleanedSourceDetail || item.where_to_continue;

  const savedLinks = [
    callLink ? 'Call link saved' : '',
    replyLink ? 'Reply thread link saved' : ''
  ].filter(Boolean).join(' · ');

  if (cleanText && savedLinks) return `${cleanText} · ${savedLinks}`;
  if (savedLinks) return savedLinks;
  return cleanText;
}

function getPhoneNumber(item: Escalation) {
  if (item.phone?.trim()) return item.phone.trim();

  const searchableText = [item.source_detail, item.where_to_continue, item.situation, item.last_touch]
    .filter(Boolean)
    .join(' ');

  const match = searchableText.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  return match?.[0]?.trim() ?? '';
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

    const threadOpened = openReplyThread(item);
    setHandoffNote(
      item.bradley_note ||
        'Carl, please review the thread and gather the missing details before Bradley makes a decision.'
    );
    setSuccess(
      threadOpened
        ? 'Thread opened. Add what information is needed, then hand it to Carl.'
        : 'Add what information is needed, then hand it to Carl. No direct thread URL is saved yet.'
    );
  };

  const action = async (item: Escalation, label: string, status: string, ownerNextAction: OwnerNextAction, note: string) => {
    setError('');
    setSuccess('');

    if (label === 'Reply Needed') {
      startHandoff(item, 'reply');
      return;
    }

    if (label === 'Needs More Info') {
      startHandoff(item, 'moreInfo');
      return;
    }

    if (label === 'I Replied') {
      const confirmed = window.confirm(
        `Are you sure Bradley already replied to ${item.customer_name}? This will mark the item as Bradley Replied and keep it in the log.`
      );

      if (!confirmed) return;
    }

    const threadOpened = label === 'Call Needed' ? openCallLink(item) : label === 'I Replied' ? openReplyThread(item) : false;
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
        setSuccess(threadOpened ? 'Saved as Bradley Replied. Reply thread opened.' : 'Saved as Bradley Replied. Add a Reply / Email Thread Link if you want it to open automatically.');
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
        <p className="mt-2 max-w-2xl text-sm text-slate-500">A simple decision inbox. Call actions use the call link, reply actions use the reply or email thread link, and Bradley can hand clear notes back to Carl.</p>
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
  const hasCallLink = Boolean(getCallLink(item));
  const hasReplyThreadLink = Boolean(getReplyThreadLink(item));
  const hasPhoneNumber = Boolean(getPhoneNumber(item));

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
            <AttachmentGallery attachments={item.attachments} compact />
            {item.bradley_note ? <OwnerField label="Current Bradley note" value={item.bradley_note} strong /> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <OwnerField label="Continue in" value={getContinueLabel(item)} />
              <OwnerField label="Follow-up" value={formatDate(item.follow_up_date)} />
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p className="font-semibold uppercase tracking-wide text-slate-500">Automation helper</p>
              <p className="mt-1">
                {hasPhoneNumber ? 'Call Needed will copy the phone number.' : 'No phone number saved yet.'}{' '}
                {hasCallLink ? 'Call Needed can open the saved call link.' : 'No call link saved yet.'}{' '}
                {hasReplyThreadLink ? 'I Replied and Needs More Info can open the saved reply/email thread link.' : 'No reply/email thread link saved yet.'}
              </p>
            </div>
          </div>

          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {BRADLEY_ACTIONS.map((action) => (
              <Button
                key={action.label}
                variant={action.label === 'Resolved' || action.label === 'Okay Carl, Work This' ? 'primary' : 'secondary'}
                size="sm"
                className="justify-start"
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

function OwnerField({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 whitespace-pre-wrap break-words ${strong ? 'font-medium text-slate-950' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}
