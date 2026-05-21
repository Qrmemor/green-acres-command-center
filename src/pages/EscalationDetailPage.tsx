import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, CalendarClock, ImagePlus, MessageSquarePlus, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Textarea } from '@/components/ui/Textarea';
import { SourceBadge, StatusBadge, UrgencyBadge } from '@/components/common/Badges';
import { AttachmentGallery } from '@/components/common/AttachmentGallery';
import { LoadingState } from '@/components/common/LoadingState';
import { EscalationForm, type EscalationFormValues } from '@/components/forms/EscalationForm';
import { addComment, archiveEscalation, deleteEscalation, getEscalation, listActivityLogs, listComments, updateEscalation } from '@/services/escalations';
import { deleteEscalationAttachment, listEscalationAttachments, uploadEscalationAttachments } from '@/services/attachments';
import { fallbackOptions, getWorkspaceOptions, type WorkspaceOptions } from '@/services/settingsOptions';
import { formatDate, formatDateTime } from '@/lib/utils';
import type { ActivityLog, Comment, Escalation, EscalationAttachment } from '@/types';

export function EscalationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const editing = searchParams.get('edit') === 'true';

  const [item, setItem] = useState<Escalation | null>(null);
  const [attachments, setAttachments] = useState<EscalationAttachment[]>([]);
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [options, setOptions] = useState<WorkspaceOptions>(fallbackOptions);
  const [comment, setComment] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [attachmentError, setAttachmentError] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [uploadingPhotos, setUploadingPhotos] = useState(false);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const [nextItem, nextLogs, nextComments, nextOptions, nextAttachments] = await Promise.all([
        getEscalation(id),
        listActivityLogs(id),
        listComments(id),
        getWorkspaceOptions(),
        listEscalationAttachments(id)
      ]);
      setItem(nextItem);
      setLogs(nextLogs);
      setComments(nextComments);
      setOptions(nextOptions);
      setAttachments(nextAttachments);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load escalation.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const contactLine = useMemo(() => [item?.phone, item?.email].filter(Boolean).join(' • '), [item]);

  const saveEdit = async (values: EscalationFormValues, newAttachments: File[]) => {
    if (!id) return;
    await updateEscalation(id, values, 'Carl updated next step');
    if (newAttachments.length) await uploadEscalationAttachments(id, newAttachments);
    setSearchParams({});
    await load();
  };

  const submitComment = async (event: FormEvent) => {
    event.preventDefault();
    if (!id || !comment.trim()) return;
    setSavingComment(true);
    try {
      await addComment(id, comment.trim());
      setComment('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to add comment.');
    } finally {
      setSavingComment(false);
    }
  };

  const uploadPhotos = async (event: ChangeEvent<HTMLInputElement>) => {
    if (!id) return;
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (!files.length) return;

    const invalidFile = files.find((file) => !file.type.startsWith('image/'));
    if (invalidFile) {
      setAttachmentError(`${invalidFile.name} is not an image file.`);
      return;
    }

    const tooLarge = files.find((file) => file.size > 10 * 1024 * 1024);
    if (tooLarge) {
      setAttachmentError(`${tooLarge.name} is too large. Keep each photo under 10 MB.`);
      return;
    }

    setUploadingPhotos(true);
    setAttachmentError('');
    try {
      await uploadEscalationAttachments(id, files);
      await load();
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Unable to upload photos.');
    } finally {
      setUploadingPhotos(false);
    }
  };

  const removeAttachment = async (attachment: EscalationAttachment) => {
    const confirmed = window.confirm('Delete this attached photo?');
    if (!confirmed) return;

    setAttachmentError('');
    try {
      await deleteEscalationAttachment(attachment);
      await load();
    } catch (err) {
      setAttachmentError(err instanceof Error ? err.message : 'Unable to delete photo.');
    }
  };

  const archive = async () => {
    if (!id) return;
    await archiveEscalation(id);
    await load();
  };

  const remove = async () => {
    if (!id) return;
    const confirmed = window.confirm('Delete this escalation permanently? Archive is usually safer.');
    if (!confirmed) return;
    await deleteEscalation(id);
    navigate('/');
  };

  if (loading) return <div className="page-shell"><LoadingState label="Loading escalation..." /></div>;
  if (error) return <div className="page-shell"><Alert>{error}</Alert></div>;
  if (!item) return <div className="page-shell"><Alert>Escalation not found.</Alert></div>;

  if (editing) {
    return (
      <div className="page-shell">
        <EscalationForm initialEscalation={item} sources={options.sources} topics={options.topics} statuses={options.statuses} onSubmit={saveEdit} submitLabel="Save Changes" />
      </div>
    );
  }

  return (
    <div className="page-shell space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-title">Escalation detail</p>
          <h1 className="mt-2 text-3xl font-bold text-slate-950">{item.customer_name}</h1>
          <p className="mt-2 text-sm text-slate-500">{item.address ?? 'No address on file'}{contactLine ? ` • ${contactLine}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setSearchParams({ edit: 'true' })}>Edit</Button>
          <Button variant="warning" leftIcon={<Archive className="h-4 w-4" />} onClick={archive}>Archive</Button>
          <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={remove}>Delete</Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="mb-4 flex flex-wrap gap-2">
            <UrgencyBadge urgency={item.urgency} />
            <SourceBadge source={item.source} />
            <StatusBadge status={item.status} />
            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
              <CalendarClock className="h-3.5 w-3.5" /> Follow-up: {formatDate(item.follow_up_date)}
            </span>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <InfoBlock label="Topic" value={item.topic} />
            <InfoBlock label="Source Detail" value={item.source_detail ?? 'No detail'} />
            <InfoBlock label="Situation" value={item.situation} multiline />
            <InfoBlock label="Last Touch" value={item.last_touch} multiline />
            <InfoBlock label="Reason Bradley is Needed" value={item.reason_for_escalation} multiline />
            <InfoBlock label="Proposed Next Step" value={item.proposed_next_step} multiline />
            <InfoBlock label="Where to Continue" value={item.where_to_continue} multiline />
            <InfoBlock label="Owner Next Action" value={item.owner_next_action} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Estimate photos</CardTitle>
          <CardDescription>Attach customer photos, site photos, or reference images for Bradley's estimate review.</CardDescription>
        </CardHeader>
        <CardContent>
          {attachmentError ? <Alert className="mb-4">{attachmentError}</Alert> : null}
          <div className="mb-4 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl bg-white p-5 text-center transition hover:bg-ga-50">
              <ImagePlus className="h-8 w-8 text-ga-700" />
              <span className="mt-2 text-sm font-semibold text-slate-900">Upload photos</span>
              <span className="mt-1 text-xs text-slate-500">Images only, max 10 MB each. You can select multiple files.</span>
              <input type="file" accept="image/*" multiple className="hidden" onChange={uploadPhotos} disabled={uploadingPhotos} />
            </label>
            {uploadingPhotos ? <p className="mt-3 text-center text-sm text-slate-500">Uploading photos...</p> : null}
          </div>
          <AttachmentGallery attachments={attachments} onDelete={removeAttachment} />
          {!attachments.length ? <p className="text-sm text-slate-500">No estimate photos attached yet.</p> : null}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <Card>
          <CardHeader>
            <CardTitle>Comments</CardTitle>
            <CardDescription>Internal notes for Carl and Bradley.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitComment} className="mb-5 space-y-3">
              <Label htmlFor="comment">Add Comment</Label>
              <Textarea id="comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Add a clear note or Bradley direction..." />
              <Button type="submit" disabled={savingComment || !comment.trim()} leftIcon={<MessageSquarePlus className="h-4 w-4" />}>
                {savingComment ? 'Adding...' : 'Add Comment'}
              </Button>
            </form>

            <div className="space-y-3">
              {comments.length ? comments.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-800">{entry.comment}</p>
                  <p className="mt-2 text-xs text-slate-500">{formatDateTime(entry.created_at)}</p>
                </div>
              )) : <p className="text-sm text-slate-500">No comments yet.</p>}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Activity Log</CardTitle>
            <CardDescription>Created, updated, status changes, and comments.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {logs.length ? logs.map((log) => (
                <div key={log.id} className="border-l-2 border-ga-200 pl-3">
                  <p className="text-sm font-semibold text-slate-900">{log.action_type}</p>
                  {log.note ? <p className="text-sm text-slate-600">{log.note}</p> : null}
                  <p className="text-xs text-slate-500">{formatDateTime(log.created_at)}</p>
                </div>
              )) : <p className="text-sm text-slate-500">No activity yet.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InfoBlock({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return (
    <div className={multiline ? 'rounded-2xl bg-slate-50 p-4' : ''}>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-800 [overflow-wrap:anywhere]">{value}</p>
    </div>
  );
}
