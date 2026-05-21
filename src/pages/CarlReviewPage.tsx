import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clipboard, ExternalLink, MessageSquareReply, Phone, RotateCcw, Send, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { AttachmentGallery } from '@/components/common/AttachmentGallery';
import { EmptyState } from '@/components/common/EmptyState';
import { LoadingState } from '@/components/common/LoadingState';
import { SourceBadge, StatusBadge, UrgencyBadge } from '@/components/common/Badges';
import { formatDate, sortEscalations, truncate } from '@/lib/utils';
import { listEscalations, updateBradleyAction } from '@/services/escalations';
import type { Escalation } from '@/types';

type ReturnModalState = {
  item: Escalation;
  note: string;
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

function getWorkItems(items: Escalation[]) {
  return items
    .filter((item) => !item.resolved_at)
    .filter((item) => item.owner_next_action === 'Carl' || ['Ready for Carl', 'Approved', 'Follow-Up Needed'].includes(item.status))
    .sort(sortEscalations);
}

export function CarlReviewPage() {
  const [items, setItems] = useState<Escalation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [returnModal, setReturnModal] = useState<ReturnModalState>(null);
  const [savingReturn, setSavingReturn] = useState(false);

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
  const readyToReply = workItems.filter((item) => ['Ready for Carl', 'Approved'].includes(item.status));
  const needsFollowUp = workItems.filter((item) => item.status === 'Follow-Up Needed');
  const otherCarlItems = workItems.filter((item) => !['Ready for Carl', 'Approved', 'Follow-Up Needed'].includes(item.status));

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
      setError('No Reply / Email Thread Link is saved on this item.');
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
    openLink(getReplyThreadLink(item));
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

  return (
    <div className="page-shell space-y-6">
      <div>
        <p className="section-title">Carl workflow</p>
        <h1 className="mt-2 text-3xl font-bold text-slate-950">Carl Review</h1>
        <p className="mt-2 max-w-2xl text-sm text-slate-500">
          Work queue for items Bradley handed back to Carl. Copy Bradley's note, open the reply thread, reply to the customer, or send the item back to Bradley with a clear review note.
        </p>
      </div>

      {error ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-ga-200 bg-ga-50 p-4 text-sm text-ga-800">{success}</div> : null}

      {loading ? (
        <LoadingState label="Loading Carl review..." />
      ) : (
        <>
          <CarlReviewSection title="Ready for Carl" description="Approved items or reply notes that Carl can work now." items={readyToReply} onCopyNote={handleCopyBradleyNote} onOpenThread={handleOpenReplyThread} onCopyPhone={handleCopyPhone} onReplied={markReplied} onSendBack={(item) => setReturnModal({ item, note: '' })} onResolved={markResolved} />
          <CarlReviewSection title="Needs Follow-Up Info" description="Bradley needs Carl to gather missing details before he can decide." items={needsFollowUp} onCopyNote={handleCopyBradleyNote} onOpenThread={handleOpenReplyThread} onCopyPhone={handleCopyPhone} onReplied={markReplied} onSendBack={(item) => setReturnModal({ item, note: '' })} onResolved={markResolved} />
          <CarlReviewSection title="Other Carl Items" description="Other unresolved items where the ball is on Carl's side." items={otherCarlItems} onCopyNote={handleCopyBradleyNote} onOpenThread={handleOpenReplyThread} onCopyPhone={handleCopyPhone} onReplied={markReplied} onSendBack={(item) => setReturnModal({ item, note: '' })} onResolved={markResolved} />
        </>
      )}

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

function CarlReviewSection({
  title,
  description,
  items,
  onCopyNote,
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
            <Card key={item.id} className="overflow-hidden">
              <CardContent className="p-5">
                <div className="mb-3 flex flex-wrap gap-2">
                  <UrgencyBadge urgency={item.urgency} />
                  <SourceBadge source={item.source} />
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">{item.topic}</span>
                  <StatusBadge status={item.status} />
                </div>

                <h3 className="text-xl font-bold text-slate-950">{item.customer_name}</h3>
                {item.address ? <p className="mt-1 text-sm text-slate-500">{item.address}</p> : null}

                <div className="mt-4 space-y-4 text-sm">
                  {item.bradley_note ? (
                    <div className="rounded-2xl border border-ga-100 bg-ga-50 p-4 text-ga-950">
                      <p className="font-semibold">Bradley note for Carl</p>
                      <p className="mt-2 whitespace-pre-wrap break-words leading-6 [overflow-wrap:anywhere]">{item.bradley_note}</p>
                    </div>
                  ) : null}

                  <CarlField label="Situation" value={truncate(item.situation, 260)} />
                  <CarlField label="Proposed next step" value={item.proposed_next_step} strong />
                  <AttachmentGallery attachments={item.attachments} compact />

                  <div className="grid gap-3 sm:grid-cols-2">
                    <CarlField label="Continue in" value={item.where_to_continue} />
                    <CarlField label="Follow-up" value={formatDate(item.follow_up_date)} />
                  </div>
                </div>

                <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  <Button variant="secondary" size="sm" className="justify-start" leftIcon={<Clipboard className="h-4 w-4" />} onClick={() => onCopyNote(item)}>
                    Copy Note
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" leftIcon={<ExternalLink className="h-4 w-4" />} onClick={() => onOpenThread(item)}>
                    Open Thread
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" leftIcon={<Phone className="h-4 w-4" />} onClick={() => onCopyPhone(item)}>
                    Copy Phone
                  </Button>
                  <Button variant="primary" size="sm" className="justify-start" leftIcon={<Send className="h-4 w-4" />} onClick={() => onReplied(item)}>
                    Replied / Waiting Customer
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" leftIcon={<MessageSquareReply className="h-4 w-4" />} onClick={() => onSendBack(item)}>
                    Send Back to Bradley
                  </Button>
                  <Button variant="secondary" size="sm" className="justify-start" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onResolved(item)}>
                    Resolve
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="No items here" description="Nothing currently needs Carl's review in this section." />
      )}
    </section>
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
