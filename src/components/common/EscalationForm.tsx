import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ImagePlus, Save, X } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ESCALATION_TRIGGERS, OWNER_NEXT_ACTION_OPTIONS, RESOLVED_STATUSES, URGENCY_OPTIONS } from '@/lib/constants';
import { cn, toInputDate } from '@/lib/utils';
import type { Escalation, EscalationPayload } from '@/types';

export type EscalationFormValues = Omit<EscalationPayload, 'created_by'>;
export type EscalationFormSubmit = (values: EscalationFormValues, attachments: File[]) => Promise<void>;

interface EscalationFormProps {
  initialEscalation?: Escalation | null;
  sources: string[];
  topics: string[];
  statuses: string[];
  onSubmit: EscalationFormSubmit;
  onSubmitAndAddAnother?: EscalationFormSubmit;
  submitLabel?: string;
}

const blankValues: EscalationFormValues = {
  customer_name: '',
  address: '',
  phone: '',
  email: '',
  source: 'Quo',
  source_detail: '',
  call_link: '',
  thread_link: '',
  where_to_continue: '',
  urgency: 'Standard / Non-Urgent',
  topic: 'Other',
  situation: '',
  last_touch: '',
  reason_for_escalation: '',
  proposed_next_step: '',
  bradley_note: '',
  status: 'Needs Bradley',
  follow_up_date: toInputDate(),
  owner_next_action: 'Bradley',
  assigned_to: null
};

function fromEscalation(item?: Escalation | null): EscalationFormValues {
  if (!item) return blankValues;
  return {
    customer_name: item.customer_name,
    address: item.address ?? '',
    phone: item.phone ?? '',
    email: item.email ?? '',
    source: item.source,
    source_detail: item.source_detail ?? '',
    call_link: item.call_link ?? '',
    thread_link: item.thread_link ?? '',
    where_to_continue: item.where_to_continue,
    urgency: item.urgency,
    topic: item.topic,
    situation: item.situation,
    last_touch: item.last_touch,
    reason_for_escalation: item.reason_for_escalation,
    proposed_next_step: item.proposed_next_step,
    bradley_note: item.bradley_note ?? '',
    status: item.status,
    follow_up_date: item.follow_up_date,
    owner_next_action: item.owner_next_action,
    assigned_to: item.assigned_to
  };
}

export function EscalationForm({
  initialEscalation,
  sources,
  topics,
  statuses,
  onSubmit,
  onSubmitAndAddAnother,
  submitLabel = 'Save Escalation'
}: EscalationFormProps) {
  const navigate = useNavigate();
  const [values, setValues] = useState<EscalationFormValues>(fromEscalation(initialEscalation));
  const [selectedTriggers, setSelectedTriggers] = useState<string[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(fromEscalation(initialEscalation));
    setAttachmentFiles([]);
  }, [initialEscalation]);

  const requiresFollowUp = useMemo(() => !RESOLVED_STATUSES.includes(values.status), [values.status]);

  const setField = <K extends keyof EscalationFormValues>(key: K, value: EscalationFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const toggleTrigger = (trigger: string) => {
    setSelectedTriggers((current) => {
      const exists = current.includes(trigger);
      const next = exists ? current.filter((item) => item !== trigger) : [...current, trigger];
      if (next.length > 0) {
        setValues((previous) => ({ ...previous, status: 'Needs Bradley', owner_next_action: 'Bradley' }));
      }
      return next;
    });
  };



  const addAttachmentFiles = (files: FileList | null) => {
    const selected = Array.from(files ?? []);
    if (!selected.length) return;

    const invalidFile = selected.find((file) => !file.type.startsWith('image/'));
    if (invalidFile) {
      setError(`${invalidFile.name} is not an image file.`);
      return;
    }

    const tooLarge = selected.find((file) => file.size > 10 * 1024 * 1024);
    if (tooLarge) {
      setError(`${tooLarge.name} is too large. Keep each photo under 10 MB.`);
      return;
    }

    setError('');
    setAttachmentFiles((current) => [...current, ...selected]);
  };

  const removeAttachmentFile = (index: number) => {
    setAttachmentFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const validate = () => {
    const required: Array<[keyof EscalationFormValues, string]> = [
      ['customer_name', 'Customer name is required.'],
      ['source', 'Source is required.'],
      ['situation', 'Situation is required.'],
      ['last_touch', 'Last touch is required.'],
      ['reason_for_escalation', 'Reason for escalation is required.'],
      ['proposed_next_step', 'Proposed next step is required.'],
      ['where_to_continue', 'Where to continue is required.'],
      ['status', 'Status is required.']
    ];

    for (const [key, message] of required) {
      if (!String(values[key] ?? '').trim()) return message;
    }

    if (requiresFollowUp && !values.follow_up_date) return 'Follow-up date is required unless item is Resolved, Closed, or Not a Fit.';
    return '';
  };

  const submit = async (addAnother = false) => {
    setError('');
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    try {
      const normalized: EscalationFormValues = {
        ...values,
        address: values.address?.trim() || null,
        phone: values.phone?.trim() || null,
        email: values.email?.trim() || null,
        source_detail: values.source_detail?.trim() || null,
        call_link: values.call_link?.trim() || null,
        thread_link: values.thread_link?.trim() || null,
        bradley_note: values.bradley_note?.trim() || null,
        follow_up_date: values.follow_up_date || null
      };

      if (addAnother && onSubmitAndAddAnother) {
        await onSubmitAndAddAnother(normalized, attachmentFiles);
        setValues(blankValues);
        setSelectedTriggers([]);
        setAttachmentFiles([]);
      } else {
        await onSubmit(normalized, attachmentFiles);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong while saving the escalation.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{initialEscalation ? 'Edit escalation' : 'Add escalation'}</CardTitle>
        <CardDescription>Capture the minimum context Bradley needs to make a decision without reading the full thread.</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <Alert className="mb-5 flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </Alert>
        ) : null}

        <div className="grid gap-5 lg:grid-cols-2">
          <div>
            <Label htmlFor="customer_name">Customer Name *</Label>
            <Input id="customer_name" value={values.customer_name} onChange={(event) => setField('customer_name', event.target.value)} placeholder="e.g. Bill Parker" />
          </div>
          <div>
            <Label htmlFor="topic">Topic *</Label>
            <Select id="topic" options={topics} value={values.topic} onChange={(event) => setField('topic', event.target.value)} />
          </div>
          <div>
            <Label htmlFor="address">Property Address</Label>
            <Input id="address" value={values.address ?? ''} onChange={(event) => setField('address', event.target.value)} placeholder="Address or short address label" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={values.phone ?? ''} onChange={(event) => setField('phone', event.target.value)} placeholder="Optional" />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={values.email ?? ''} onChange={(event) => setField('email', event.target.value)} placeholder="Optional" />
            </div>
          </div>

          <div>
            <Label htmlFor="source">Source *</Label>
            <Select id="source" options={sources} value={values.source} onChange={(event) => setField('source', event.target.value)} />
            <p className="field-helper">Use the original place where Carl found the item: Quo, HomeWorks, Gmail, or Other.</p>
          </div>
          <div>
            <Label htmlFor="source_detail">Source Detail</Label>
            <Input id="source_detail" value={values.source_detail ?? ''} onChange={(event) => setField('source_detail', event.target.value)} placeholder="e.g. team@ thread, Quo text, HomeWorks profile" />
          </div>

          <div>
            <Label htmlFor="call_link">Call Link / OpenPhone Link</Label>
            <Input
              id="call_link"
              value={values.call_link ?? ''}
              onChange={(event) => setField('call_link', event.target.value)}
              placeholder="Optional OpenPhone or Quo call/text link"
            />
            <p className="field-helper">Used only by Call Needed. Bradley can copy the phone number and open this call/text link without opening the email thread.</p>
          </div>
          <div>
            <Label htmlFor="thread_link">Reply / Email Thread Link</Label>
            <Input
              id="thread_link"
              value={values.thread_link ?? ''}
              onChange={(event) => setField('thread_link', event.target.value)}
              placeholder="Optional Gmail, Quo, or HomeWorks reply thread link"
            />
            <p className="field-helper">Used by I Replied and Needs More Info. This should be the place Bradley continues or reviews the reply thread.</p>
          </div>

          <div>
            <Label htmlFor="urgency">Urgency *</Label>
            <Select id="urgency" options={URGENCY_OPTIONS} value={values.urgency} onChange={(event) => setField('urgency', event.target.value as EscalationFormValues['urgency'])} />
          </div>
          <div>
            <Label htmlFor="status">Status *</Label>
            <Select id="status" options={statuses} value={values.status} onChange={(event) => setField('status', event.target.value)} />
          </div>

          <div>
            <Label htmlFor="owner_next_action">Owner Next Action *</Label>
            <Select
              id="owner_next_action"
              options={OWNER_NEXT_ACTION_OPTIONS}
              value={values.owner_next_action}
              onChange={(event) => setField('owner_next_action', event.target.value as EscalationFormValues['owner_next_action'])}
            />
          </div>
          <div>
            <Label htmlFor="follow_up_date">Follow-Up Date {requiresFollowUp ? '*' : ''}</Label>
            <Input id="follow_up_date" type="date" value={values.follow_up_date ?? ''} onChange={(event) => setField('follow_up_date', event.target.value)} />
            <p className="field-helper">Required for anything still open so the ball does not sit in the middle.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div>
            <Label htmlFor="situation">Situation *</Label>
            <Textarea id="situation" value={values.situation} onChange={(event) => setField('situation', event.target.value)} placeholder="What happened? Keep it short but clear." />
            <p className="field-helper">Summarize the customer issue or context in plain English.</p>
          </div>
          <div>
            <Label htmlFor="last_touch">Last Touch *</Label>
            <Textarea id="last_touch" value={values.last_touch} onChange={(event) => setField('last_touch', event.target.value)} placeholder="Last customer/admin touch and current ball-in-court." />
            <p className="field-helper">Example: Customer texted today asking for call. Carl has not replied yet.</p>
          </div>
          <div>
            <Label htmlFor="reason_for_escalation">Reason for Escalation *</Label>
            <Textarea
              id="reason_for_escalation"
              value={values.reason_for_escalation}
              onChange={(event) => setField('reason_for_escalation', event.target.value)}
              placeholder="Why does Bradley need this?"
            />
            <p className="field-helper">Mention pricing uncertainty, complaint, call request, owner decision, service area concern, or scope issue.</p>
          </div>
          <div>
            <Label htmlFor="proposed_next_step">Proposed Next Step *</Label>
            <Textarea
              id="proposed_next_step"
              value={values.proposed_next_step}
              onChange={(event) => setField('proposed_next_step', event.target.value)}
              placeholder="What should Carl do if Bradley approves?"
            />
            <p className="field-helper">Write the recommended action, not a vague question.</p>
          </div>
          <div className="lg:col-span-2">
            <Label htmlFor="bradley_note">Bradley Note for Carl</Label>
            <Textarea
              id="bradley_note"
              value={values.bradley_note ?? ''}
              onChange={(event) => setField('bradley_note', event.target.value)}
              placeholder="Optional. Bradley can add the exact reply note or instruction for Carl here."
            />
            <p className="field-helper">This appears on Carl's Work Queue after Bradley approves or leaves a reply instruction.</p>
          </div>

          <div className="lg:col-span-2">
            <Label htmlFor="estimate_photos">Estimate Photos / Reference Images</Label>
            <div className="mt-2 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-4">
              <label
                htmlFor="estimate_photos"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl bg-white p-5 text-center transition hover:bg-ga-50"
              >
                <ImagePlus className="h-8 w-8 text-ga-700" />
                <span className="mt-2 text-sm font-semibold text-slate-900">Attach photos for estimate review</span>
                <span className="mt-1 text-xs text-slate-500">Upload lawn, beds, damage, access, or reference photos. Images only, max 10 MB each.</span>
                <input
                  id="estimate_photos"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addAttachmentFiles(event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>

              {attachmentFiles.length ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected photos</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {attachmentFiles.map((file, index) => (
                      <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{file.name}</p>
                          <p className="text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachmentFile(index)}
                          className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          aria-label={`Remove ${file.name}`}
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <p className="field-helper">For estimate items, attach customer photos so Bradley can review scope without opening the original thread.</p>
          </div>

          <div className="lg:col-span-2">
            <Label htmlFor="where_to_continue">Where Bradley Should Continue *</Label>
            <Textarea
              id="where_to_continue"
              value={values.where_to_continue}
              onChange={(event) => setField('where_to_continue', event.target.value)}
              placeholder="Example: Reply in Quo thread with phone ending 1234, or continue in team@ Gmail thread."
            />
            <p className="field-helper">This is the human-readable instruction, like Reply in Quo or continue in team@ Gmail. Use the separate Call Link or Reply Thread Link fields for clickable links.</p>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Escalation triggers</p>
              <p className="text-xs text-slate-500">Selecting any trigger automatically marks the item as Needs Bradley.</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {ESCALATION_TRIGGERS.map((trigger) => {
              const active = selectedTriggers.includes(trigger);
              return (
                <button
                  key={trigger}
                  type="button"
                  onClick={() => toggleTrigger(trigger)}
                  className={cn(
                    'rounded-full border px-3 py-1.5 text-xs font-medium transition',
                    active ? 'border-red-200 bg-red-50 text-red-700' : 'border-slate-200 bg-white text-slate-600 hover:border-ga-300 hover:text-ga-800'
                  )}
                >
                  {trigger}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => navigate(-1)} disabled={submitting}>
            Cancel
          </Button>
          {onSubmitAndAddAnother ? (
            <Button variant="secondary" onClick={() => submit(true)} disabled={submitting}>
              Save and Add Another
            </Button>
          ) : null}
          <Button onClick={() => submit(false)} disabled={submitting} leftIcon={<Save className="h-4 w-4" />}>
            {submitting ? 'Saving...' : submitLabel}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
