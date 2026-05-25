import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Copy,
  ExternalLink,
  MessageSquareReply,
  Phone,
  RotateCcw,
  Send,
  Sparkles,
  TimerReset
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { AttachmentGallery } from '@/components/common/AttachmentGallery';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { SourceBadge, StatusBadge, UrgencyBadge } from '@/components/common/Badges';
import { formatDate, isDueOrOverdue, isOverdue, isToday, sortEscalations, toInputDate, truncate } from '@/lib/utils';
import { listEscalations, updateBradleyAction } from '@/services/escalations';
import type { Escalation } from '@/types';

type ReturnModalState = {
  item: Escalation;
  note: string;
} | null;

type DraftModalState = {
  item: Escalation;
  draft: string;
} | null;

function findDirectLink(value?: string | null) {
  const trimmed = (value ?? '').trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/[),.]+$/, '');
  const match = trimmed.match(/https?:\/\/\S+/i);
  return match?.[0]?.replace(/[),.]+$/, '') ?? '';
}

function getReplyThreadLink(item: Escalation) {
  return findDirectLink(item.thread_link) || findDirectLink(item.where_to_continue) || findDirectLink(item.source_detail);
}

function getCallLink(item: Escalation) {
  return findDirectLink(item.call_link);
}

function getPhoneNumber(item: Escalation) {
  if (item.phone?.trim()) return item.phone.trim();

  const searchableText = [item.source_detail, item.where_to_continue, item.situation, item.last_touch]
    .filter(Boolean)
    .join(' ');

  const match = searchableText.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/);
  return match?.[0]?.trim() ?? '';
}

function getFirstName(item: Escalation) {
  return item.customer_name.trim().split(/\s+/)[0] || 'there';
}

function cleanBradleyNoteForReply(note?: string | null) {
  const raw = (note ?? '').trim();
  if (!raw) return '';

  const directReplyMatch = raw.match(/(?:^|\n)\s*(Hi\s+[^\n]+[\s\S]*)/i);
  if (directReplyMatch?.[1]) return directReplyMatch[1].trim();

  return raw
    .replace(/^Carl,?\s*/i, '')
    .replace(/^For\s+.+?,\s*please\s+reply\s+with\s+this:\s*/i, '')
    .trim();
}

function buildCustomerReply(item: Escalation) {
  const firstName = getFirstName(item);
  const directReply = cleanBradleyNoteForReply(item.bradley_note);

  if (/^Hi\s+/i.test(directReply)) return directReply;

  const instruction = directReply || item.proposed_next_step;
  const lowered = instruction.toLowerCase();

  if (lowered.includes('fully booked') || lowered.includes('booked out') || lowered.includes('june')) {
    return `Hi ${firstName}, this is Carl with Green Acres.\n\nI did want to be upfront that we are currently booked out through June for project work. We can reconnect in June and reassess the scope then, or if timing is important, I would be happy to connect you with a trusted contact who may be able to get to it sooner.\n\nWe have had a lot of demand recently and are working on building out another crew, but I do not want to keep you waiting if you are looking to move quickly.\n\nJust let me know what works best on your end.`;
  }

  if (lowered.includes('photos') || lowered.includes('photo') || lowered.includes('video')) {
    return `Hi ${firstName}, this is Carl with Green Acres.\n\nThanks for reaching out. The fastest next step would be to send over a few photos or a short video of the area so we can review the scope and figure out the best next step.\n\nPlease also include the property address and any access notes we should know about.\n\nThanks,\nCarl`;
  }

  if (lowered.includes('confirm') || lowered.includes('review') || lowered.includes('check')) {
    return `Hi ${firstName}, this is Carl with Green Acres.\n\nThank you for the update. I am going to review this internally first so we can make sure we give you the right next step.\n\nI will follow up once I have direction.\n\nThanks,\nCarl`;
  }

  return `Hi ${firstName}, this is Carl with Green Acres.\n\n${instruction}\n\nThanks,\nCarl`;
}

function openLink(link: string) {
  if (!link) return false;
  window.open(link, '_blank', 'noopener,noreferrer');
  return true;
}

async function copyToClipboard(text: string) {
  if (!text.trim()) return false;
  try {
    await navigator.clipboard.writeText(text.trim());
    return true;
  } catch (error) {
    console.error('Unable to copy text:', error);
    return false;
  }
}

function getMissingInfo(item: Escalation) {
  const missing: string[] = [];
  const estimatePhotos = item.attachments?.filter((attachment) => attachment.attachment_category === 'estimate') ?? [];
  const needsScopeVisuals = ['Estimate', 'Pricing', 'Scope', 'Turf Program', 'Mowing'].includes(item.topic);

  if (!item.customer_name?.trim()) missing.push('Customer name');
  if (!item.address?.trim()) missing.push('Property address');
  if (!item.phone?.trim() && !item.email?.trim()) missing.push('Phone or email');
  if (!item.where_to_continue?.trim()) missing.push('Where to continue');
  if (!item.last_touch?.trim()) missing.push('Last touch');
  if (needsScopeVisuals && estimatePhotos.length === 0) missing.push('Photos / reference images');

  return missing;
}

function getWorkItems(items: Escalation[]) {
  return items
    .filter((item) => !item.resolved_at)
    .filter(
      (item) =>
        item.owner_next_action === 'Carl' ||
        ['Ready for Carl', 'Approved', 'Follow-Up Needed', 'Waiting on Customer'].includes(item.status)
    )
    .sort(sortEscalations);
}

function isReadyForCarl(item: Escalation) {
  return item.owner_next_action === 'Carl' || ['Ready for Carl', 'Approved'].includes(item.status);
}

export function CarlReviewPage() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [returnModal, setReturnModal] = useState<ReturnModalState>(null);
  const [draftModal, setDraftModal] = useState<DraftModalState>(null);
  const [savingReturn, setSavingReturn] = useState(false);
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const nextItems = await listEscalations({ resolved: false });
      setItems(nextItems);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Carl review.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const workItems = useMemo(() => getWorkItems(items), [items]);
  const visibleWorkItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return workItems;
    return workItems.filter((item) =>
      [item.customer_name, item.address, item.topic, item.status, item.source, item.situation, item.bradley_note, item.proposed_next_step]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(term)
    );
  }, [search, workItems]);

  const dueItems = visibleWorkItems.filter(isDueOrOverdue);
  const readyToReply = visibleWorkItems.filter((item) => isReadyForCarl(item) && item.status !== 'Follow-Up Needed');
  const needsFollowUp = visibleWorkItems.filter((item) => item.status === 'Follow-Up Needed');
  const waitingCustomer = visibleWorkItems.filter((item) => item.status === 'Waiting on Customer');
  const otherCarlItems = visibleWorkItems.filter(
    (item) => !isReadyForCarl(item) && item.status !== 'Follow-Up Needed' && item.status !== 'Waiting on Customer'
  );

  const handleCopyBradleyNote = async (item: Escalation) => {
    setError('');
    setSuccess('');

    if (!item.bradley_note?.trim()) {
      setError('No Bradley note is saved on this item.');
      return;
    }

    const copied = await copyToClipboard(item.bradley_note);
    setSuccess(copied ? 'Bradley note copied.' : 'Unable to copy Bradley note.');
  };

  const handleOpenReplyThread = (item: Escalation) => {
    setError('');
    setSuccess('');

    const opened = openLink(getReplyThreadLink(item));
    if (!opened) {
      setError('No customer thread link is saved on this item.');
      return;
    }

    setSuccess('Reply thread opened.');
  };

  const handleCopyPhone = async (item: Escalation) => {
    setError('');
    setSuccess('');

    const phone = getPhoneNumber(item);
    if (!phone) {
      setError('No phone number is saved on this item.');
      return;
    }

    const copied = await copyToClipboard(phone);
    const callLinkOpened = openLink(getCallLink(item));
    setSuccess(
      `${copied ? `Phone copied: ${phone}.` : 'Unable to copy phone number.'}${callLinkOpened ? ' Call link opened.' : ''}`
    );
  };

  const handleBuildDraft = (item: Escalation) => {
    setDraftModal({ item, draft: buildCustomerReply(item) });
  };

  const updateItem = async (item: Escalation, status: string, ownerNextAction: 'Carl' | 'Bradley' | 'Customer', note: string, bradleyNote?: string) => {
    setError('');
    setSuccess('');

    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? {
              ...entry,
              status,
              owner_next_action: ownerNextAction,
              bradley_note: bradleyNote ?? entry.bradley_note,
              resolved_at: status === 'Resolved' ? new Date().toISOString() : entry.resolved_at
            }
          : entry
      )
    );

    try {
      await updateBradleyAction(
        item.id,
        status,
        ownerNextAction,
        note,
        bradleyNote !== undefined ? { bradley_note: bradleyNote } : {}
      );
      setSuccess(note);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update item.');
      await load();
    }
  };

  const markReplied = async (item: Escalation) => {
    await updateItem(item, 'Waiting on Customer', 'Customer', 'Carl replied and is waiting on customer.');
  };

  const markResolved = async (item: Escalation) => {
    await updateItem(item, 'Resolved', 'Carl', 'Carl marked item resolved.');
  };

  const sendBackToBradley = async () => {
    if (!returnModal) return;
    const cleanNote = returnModal.note.trim();
    if (!cleanNote) {
      setError('Add Carl review note before sending this back to Bradley.');
      return;
    }

    setSavingReturn(true);
    try {
      const handoffNote = `Carl note for Bradley:\n${cleanNote}`;
      await updateItem(
        returnModal.item,
        'Needs Bradley',
        'Bradley',
        'Carl sent this back to Bradley with a review note.',
        handoffNote
      );
      setReturnModal(null);
    } finally {
      setSavingReturn(false);
    }
  };

  const copyDraftAndMarkReady = async () => {
    if (!draftModal) return;
    const copied = await copyToClipboard(draftModal.draft);
    setSuccess(copied ? 'Reply draft copied. Paste it into the customer thread, then mark Replied / Waiting Customer.' : 'Unable to copy reply draft.');
  };

  return (
    <div className="page-shell space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-title">Carl workflow</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">Carl Work Queue</h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-500">
            Start here after Bradley reviews escalations. Build a customer reply, copy Bradley's instruction, check missing info, and track due follow-ups.
          </p>
        </div>
        <Button variant="secondary" leftIcon={<TimerReset className="h-4 w-4" />} onClick={() => void load()}>
          Refresh Queue
        </Button>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-ga-200 bg-ga-50 p-4 text-sm text-ga-800">{success}</div> : null}

      {loading ? (
        <LoadingState label="Loading Carl work queue..." />
      ) : (
        <>
          <section className="grid gap-4 md:grid-cols-4">
            <QueueStat label="Due / overdue" value={dueItems.length} tone={dueItems.length ? 'warning' : 'normal'} />
            <QueueStat label="Ready to reply" value={readyToReply.length} />
            <QueueStat label="Needs info" value={needsFollowUp.length} tone={needsFollowUp.length ? 'warning' : 'normal'} />
            <QueueStat label="Waiting customer" value={waitingCustomer.length} />
          </section>

          <Card>
            <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Today's Carl plan</h2>
                <p className="text-sm text-slate-500">
                  Work due/overdue items first, then reply-ready items, then missing-info follow-ups.
                </p>
              </div>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search Carl queue..."
                className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-ga-600 md:max-w-xs"
              />
            </CardContent>
          </Card>

          <CarlReviewSection
            title="Due / Overdue"
            description="Items that need Carl's attention today or are already overdue."
            items={dueItems}
            onCopyNote={handleCopyBradleyNote}
            onBuildDraft={handleBuildDraft}
            onOpenThread={handleOpenReplyThread}
            onCopyPhone={handleCopyPhone}
            onReplied={markReplied}
            onSendBack={(item) => setReturnModal({ item, note: '' })}
            onResolved={markResolved}
          />
          <CarlReviewSection
            title="Ready for Carl"
            description="Approved items or Bradley reply notes that Carl can work now."
            items={readyToReply}
            onCopyNote={handleCopyBradleyNote}
            onBuildDraft={handleBuildDraft}
            onOpenThread={handleOpenReplyThread}
            onCopyPhone={handleCopyPhone}
            onReplied={markReplied}
            onSendBack={(item) => setReturnModal({ item, note: '' })}
            onResolved={markResolved}
          />
          <CarlReviewSection
            title="Needs Follow-Up Info"
            description="Bradley needs Carl to gather missing details before he can decide."
            items={needsFollowUp}
            onCopyNote={handleCopyBradleyNote}
            onBuildDraft={handleBuildDraft}
            onOpenThread={handleOpenReplyThread}
            onCopyPhone={handleCopyPhone}
            onReplied={markReplied}
            onSendBack={(item) => setReturnModal({ item, note: '' })}
            onResolved={markResolved}
          />
          <CarlReviewSection
            title="Waiting on Customer"
            description="Items already replied to. Track only if follow-up is due."
            items={waitingCustomer}
            onCopyNote={handleCopyBradleyNote}
            onBuildDraft={handleBuildDraft}
            onOpenThread={handleOpenReplyThread}
            onCopyPhone={handleCopyPhone}
            onReplied={markReplied}
            onSendBack={(item) => setReturnModal({ item, note: '' })}
            onResolved={markResolved}
          />
          <CarlReviewSection
            title="Other Carl Items"
            description="Other unresolved items where the ball is on Carl's side."
            items={otherCarlItems}
            onCopyNote={handleCopyBradleyNote}
            onBuildDraft={handleBuildDraft}
            onOpenThread={handleOpenReplyThread}
            onCopyPhone={handleCopyPhone}
            onReplied={markReplied}
            onSendBack={(item) => setReturnModal({ item, note: '' })}
            onResolved={markResolved}
          />
        </>
      )}

      {draftModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <Card className="max-h-[90vh] w-full max-w-3xl overflow-y-auto">
            <CardContent className="p-6">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="section-title">Reply Draft Builder</p>
                  <h2 className="mt-2 text-2xl font-bold text-slate-950">{draftModal.item.customer_name}</h2>
                  <p className="mt-1 text-sm text-slate-500">Review and edit before copying. This does not send anything automatically.</p>
                </div>
                <Button variant="ghost" onClick={() => setDraftModal(null)}>Close</Button>
              </div>

              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-950">Bradley note / source instruction</p>
                <p className="mt-2 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {draftModal.item.bradley_note || draftModal.item.proposed_next_step}
                </p>
              </div>

              <Textarea
                value={draftModal.draft}
                onChange={(event) => setDraftModal({ ...draftModal, draft: event.target.value })}
                className="mt-5 min-h-[260px] font-mono text-sm"
              />

              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => setDraftModal(null)}>Cancel</Button>
                <Button variant="secondary" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => handleOpenReplyThread(draftModal.item)}>
                  Open Thread
                </Button>
                <Button leftIcon={<Copy className="h-4 w-4" />} onClick={copyDraftAndMarkReady}>
                  Copy Reply Draft
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {returnModal ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <Card className="w-full max-w-2xl">
            <CardContent className="p-6">
              <p className="section-title">Send back to Bradley</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-950">{returnModal.item.customer_name}</h2>
              <p className="mt-1 text-sm text-slate-500">
                Add the exact Carl review note Bradley needs to see. This item will return to Bradley Review as Needs Bradley.
              </p>
              <div className="mt-4 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Current Bradley note / instruction</p>
                <p className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{returnModal.item.bradley_note || 'No Bradley note saved.'}</p>
              </div>
              <Textarea
                value={returnModal.note}
                onChange={(event) => setReturnModal({ ...returnModal, note: event.target.value })}
                className="mt-4 min-h-[180px]"
                placeholder="Example: Bradley, I replied in Quo and the customer confirmed the address/photos. Please review pricing next."
              />
              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button variant="secondary" onClick={() => setReturnModal(null)} disabled={savingReturn}>Cancel</Button>
                <Button onClick={sendBackToBradley} disabled={savingReturn} leftIcon={<RotateCcw className="h-4 w-4" />}>
                  {savingReturn ? 'Sending...' : 'Send Back to Bradley'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function QueueStat({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'warning' }) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${tone === 'warning' ? 'bg-amber-50 text-amber-700' : 'bg-ga-50 text-ga-700'}`}>
          {tone === 'warning' ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-950">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CarlReviewSection({
  title,
  description,
  items,
  onCopyNote,
  onBuildDraft,
  onOpenThread,
  onCopyPhone,
  onReplied,
  onSendBack,
  onResolved
}: {
  title: string;
  description: string;
  items: Escalation[];
  onCopyNote: (item: Escalation) => void;
  onBuildDraft: (item: Escalation) => void;
  onOpenThread: (item: Escalation) => void;
  onCopyPhone: (item: Escalation) => void;
  onReplied: (item: Escalation) => void;
  onSendBack: (item: Escalation) => void;
  onResolved: (item: Escalation) => void;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
          <p className="text-sm text-slate-500">{description}</p>
        </div>
        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">{items.length}</span>
      </div>

      {items.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((item) => (
            <CarlWorkCard
              key={`${title}-${item.id}`}
              item={item}
              onCopyNote={onCopyNote}
              onBuildDraft={onBuildDraft}
              onOpenThread={onOpenThread}
              onCopyPhone={onCopyPhone}
              onReplied={onReplied}
              onSendBack={onSendBack}
              onResolved={onResolved}
            />
          ))}
        </div>
      ) : (
        <EmptyState title="No items here" description="Nothing currently needs Carl's review in this section." />
      )}
    </section>
  );
}

function CarlWorkCard({
  item,
  onCopyNote,
  onBuildDraft,
  onOpenThread,
  onCopyPhone,
  onReplied,
  onSendBack,
  onResolved
}: {
  item: Escalation;
  onCopyNote: (item: Escalation) => void;
  onBuildDraft: (item: Escalation) => void;
  onOpenThread: (item: Escalation) => void;
  onCopyPhone: (item: Escalation) => void;
  onReplied: (item: Escalation) => void;
  onSendBack: (item: Escalation) => void;
  onResolved: (item: Escalation) => void;
}) {
  const missing = getMissingInfo(item);
  const dueLabel = isOverdue(item.follow_up_date) ? 'Overdue' : isToday(item.follow_up_date) ? 'Due today' : '';

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-5">
        <div className="mb-3 flex flex-wrap gap-2">
          <UrgencyBadge urgency={item.urgency} />
          <SourceBadge source={item.source} />
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.topic}</span>
          <StatusBadge status={item.status} />
          {dueLabel ? <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700">{dueLabel}</span> : null}
        </div>

        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-xl font-bold text-slate-950">{item.customer_name}</h3>
            {item.address ? <p className="mt-1 text-sm text-slate-500">{item.address}</p> : null}
          </div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Due: {formatDate(item.follow_up_date)}</p>
        </div>

        <div className="mt-4 space-y-4 text-sm">
          {item.bradley_note ? (
            <div className="rounded-2xl border border-ga-100 bg-ga-50 p-4 text-ga-950">
              <p className="font-semibold">Bradley note for Carl</p>
              <p className="mt-2 whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{item.bradley_note}</p>
            </div>
          ) : null}

          {missing.length ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
              <p className="font-semibold text-amber-900">Missing info checker</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {missing.map((entry) => (
                  <span key={entry} className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-amber-800">
                    {entry}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <CarlField label="Situation" value={truncate(item.situation, 260)} />
            <CarlField label="Proposed next step" value={item.proposed_next_step} strong />
          </div>
          <AttachmentGallery attachments={item.attachments} compact />

          <div className="grid gap-3 sm:grid-cols-2">
            <CarlField label="Continue in" value={item.where_to_continue} />
            <CarlField label="Last touch" value={truncate(item.last_touch, 160)} />
          </div>
        </div>

        <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <Button variant="primary" size="sm" className="justify-start" leftIcon={<Sparkles className="h-4 w-4" />} onClick={() => onBuildDraft(item)}>
            Build Reply
          </Button>
          <Button variant="secondary" size="sm" className="justify-start" leftIcon={<Clipboard className="h-4 w-4" />} onClick={() => onCopyNote(item)}>
            Copy Note
          </Button>
          <Button variant="secondary" size="sm" className="justify-start" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => onOpenThread(item)}>
            Open Thread
          </Button>
          <Button variant="secondary" size="sm" className="justify-start" leftIcon={<Phone className="h-4 w-4" />} onClick={() => onCopyPhone(item)}>
            Copy Phone
          </Button>
          <Button variant="secondary" size="sm" className="justify-start" leftIcon={<Send className="h-4 w-4" />} onClick={() => onReplied(item)}>
            Replied / Waiting Customer
          </Button>
          <Button variant="secondary" size="sm" className="justify-start" leftIcon={<MessageSquareReply className="h-4 w-4" />} onClick={() => onSendBack(item)}>
            Send Back to Bradley
          </Button>
          <Button variant="secondary" size="sm" className="justify-start xl:col-span-3" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onResolved(item)}>
            Resolve
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function CarlField({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere] ${strong ? 'font-medium text-slate-950' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}
