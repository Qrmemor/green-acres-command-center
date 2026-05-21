import { useState } from 'react';
import { motion } from 'framer-motion';
import { CalendarClock, ExternalLink, MessageSquare, Pencil, CheckCircle2, Clock3, UserRound, Clipboard, Check, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Card, CardContent } from '@/components/ui/Card';
import { SourceBadge, StatusBadge, UrgencyBadge } from '@/components/common/Badges';
import { AttachmentGallery } from '@/components/common/AttachmentGallery';
import { formatDate, isDueOrOverdue, truncate } from '@/lib/utils';
import type { Escalation } from '@/types';

interface EscalationCardProps {
  escalation: Escalation;
  onStatusChange?: (id: string, status: string) => void;
  onDelete?: (id: string) => void;
  deleting?: boolean;
  compact?: boolean;
  canOpen?: boolean;
  canEdit?: boolean;
  showStatusActions?: boolean;
}

export function EscalationCard({
  escalation,
  onStatusChange,
  onDelete,
  deleting = false,
  compact = false,
  canOpen = true,
  canEdit = true,
  showStatusActions = true
}: EscalationCardProps) {
  const highlighted = isDueOrOverdue(escalation);
  const [copiedNote, setCopiedNote] = useState(false);

  const copyBradleyNote = async () => {
    if (!escalation.bradley_note) return;

    try {
      await navigator.clipboard.writeText(escalation.bradley_note);
      setCopiedNote(true);
      window.setTimeout(() => setCopiedNote(false), 1800);
    } catch (error) {
      console.error('Unable to copy Bradley note:', error);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <Card className={highlighted ? 'border-amber-300 bg-amber-50/40' : ''}>
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <UrgencyBadge urgency={escalation.urgency} />
                <SourceBadge source={escalation.source} />
                <StatusBadge status={escalation.status} />
                {highlighted ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                    <CalendarClock className="h-3 w-3" /> Due / Overdue
                  </span>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-lg font-semibold text-slate-950">{escalation.customer_name}</h3>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{escalation.topic}</span>
              </div>

              {escalation.address ? <p className="mt-1 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{escalation.address}</p> : null}

              <div className="mt-4 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <p className="font-semibold text-slate-700">Situation</p>
                  <p className="mt-1 break-words text-slate-600 [overflow-wrap:anywhere]">{truncate(escalation.situation, compact ? 120 : 190)}</p>
                </div>
                <div>
                  <p className="font-semibold text-slate-700">Reason Bradley is needed</p>
                  <p className="mt-1 break-words text-slate-600 [overflow-wrap:anywhere]">{truncate(escalation.reason_for_escalation, compact ? 120 : 190)}</p>
                </div>
              </div>

              {escalation.bradley_note ? (
                <div className="mt-4 rounded-xl border border-ga-100 bg-ga-50 p-4 text-sm text-ga-950">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <p className="font-semibold">Bradley note for Carl</p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leftIcon={copiedNote ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                      onClick={copyBradleyNote}
                    >
                      {copiedNote ? 'Copied' : 'Copy Note'}
                    </Button>
                  </div>
                  <div className="max-w-full overflow-hidden break-words rounded-lg border border-ga-100 bg-white/70 p-3 leading-6 text-slate-900 whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {escalation.bradley_note}
                  </div>
                </div>
              ) : null}

              <AttachmentGallery attachments={escalation.attachments} compact={compact} />

              {!compact ? (
                <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
                  <p className="font-semibold">Proposed next step</p>
                  <p className="mt-1 break-words [overflow-wrap:anywhere]">{truncate(escalation.proposed_next_step, 220)}</p>
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClock className="h-3.5 w-3.5" /> Follow-up: {formatDate(escalation.follow_up_date)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <Clock3 className="h-3.5 w-3.5" /> Last touch: {truncate(escalation.last_touch, 80)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <UserRound className="h-3.5 w-3.5" /> Owner next: {escalation.owner_next_action}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 lg:w-44 lg:flex-col">
              {canOpen ? (
                <Link to={`/escalations/${escalation.id}`} className="inline-flex">
                  <Button variant="secondary" className="w-full" leftIcon={<ExternalLink className="h-4 w-4" />}>
                    Open
                  </Button>
                </Link>
              ) : null}
              {canEdit ? (
                <Link to={`/escalations/${escalation.id}?edit=true`} className="inline-flex">
                  <Button variant="ghost" className="w-full" leftIcon={<Pencil className="h-4 w-4" />}>
                    Edit
                  </Button>
                </Link>
              ) : null}
              {onDelete ? (
                <Button
                  variant="danger"
                  className="w-full"
                  leftIcon={<Trash2 className="h-4 w-4" />}
                  onClick={() => onDelete(escalation.id)}
                  disabled={deleting}
                >
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              ) : null}
              {showStatusActions && onStatusChange ? (
                <>
                  <Button variant="ghost" className="w-full" leftIcon={<MessageSquare className="h-4 w-4" />} onClick={() => onStatusChange(escalation.id, 'Waiting on Customer')}>
                    Waiting Customer
                  </Button>
                  <Button variant="ghost" className="w-full" leftIcon={<Clock3 className="h-4 w-4" />} onClick={() => onStatusChange(escalation.id, 'Waiting on Bradley')}>
                    Waiting Bradley
                  </Button>
                  <Button variant="ghost" className="w-full" leftIcon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onStatusChange(escalation.id, 'Resolved')}>
                    Resolve
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
