import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ClipboardPaste, ImagePlus, Save, Wand2, X } from 'lucide-react';
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
export interface EscalationFormAttachments {
  estimatePhotos: File[];
  moreInfoScreenshots: File[];
}
export type EscalationFormSubmit = (values: EscalationFormValues, attachments: EscalationFormAttachments) => Promise<void>;

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


const FIELD_LABELS = [
  'Source / continue here',
  'Source',
  'Situation',
  'Last touch',
  'Last Touch',
  'Reason',
  'Reason for Escalation',
  'Proposed next step',
  'Proposed Next Step',
  'Where Bradley Should Continue',
  'Where to Continue'
];

function getLabeledSection(raw: string, labels: string[]) {
  const escapedLabels = FIELD_LABELS.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const wantedLabels = labels.map((label) => label.toLowerCase());
  const regex = new RegExp(`(?:^|\\n)\\s*(${escapedLabels})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:${escapedLabels})\\s*:|$)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    if (wantedLabels.includes(match[1].toLowerCase())) {
      return match[2].trim();
    }
  }
  return '';
}

function inferSource(sourceText: string): string {
  const source = sourceText.toLowerCase();
  if (source.includes('quo')) return 'Quo';
  if (source.includes('team@') || source.includes('gmail') || source.includes('email')) return 'Gmail';
  if (source.includes('homeworks') || source.includes('home works')) return 'HomeWorks';
  return 'Other';
}

function inferTopic(text: string): string {
  const haystack = text.toLowerCase();
  if (haystack.includes('refund')) return 'Refund';
  if (haystack.includes('call')) return 'Call Needed';
  if (haystack.includes('complaint') || haystack.includes('angry') || haystack.includes('frustrated')) return 'Complaint';
  if (haystack.includes('schedule') || haystack.includes('scheduling') || haystack.includes('timing')) return 'Scheduling';
  if (haystack.includes('estimate') || haystack.includes('quote')) return 'Estimate';
  if (haystack.includes('scope')) return 'Scope';
  if (haystack.includes('invoice') || haystack.includes('payment') || haystack.includes('automatic payment')) return 'Payment';
  if (haystack.includes('referral') || haystack.includes('refer')) return 'Referral';
  if (haystack.includes('turf')) return 'Turf Program';
  if (haystack.includes('mowing') || haystack.includes('lawn maintenance')) return 'Mowing';
  if (haystack.includes('website purchase')) return 'Website Purchase';
  if (haystack.includes('pricing') || haystack.includes('price')) return 'Pricing';
  return 'Other';
}

function inferUrgency(text: string): EscalationFormValues['urgency'] {
  const haystack = text.toLowerCase();
  const urgentTerms = [
    'angry',
    'frustrated',
    'complaint',
    'unhappy',
    'damage',
    'safety',
    'crew no-show',
    'no-show',
    'refund',
    'collections',
    'outside service area',
    'hoa',
    'commercial',
    'urgent'
  ];
  if (urgentTerms.some((term) => haystack.includes(term)) || /\$\s?2[,0-9]{3,}/.test(haystack)) {
    return 'Urgent / Customer-Sensitive';
  }
  return 'Standard / Non-Urgent';
}

function extractEmail(raw: string) {
  return raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
}

function extractPhone(raw: string) {
  return raw.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] ?? '';
}

function parseQuickEscalation(
  rawText: string,
  current: EscalationFormValues,
  sources: string[],
  topics: string[],
  statuses: string[]
): EscalationFormValues {
  const raw = rawText.replace(/\r\n/g, '\n').trim();
  const firstLine = raw.split('\n').find((line) => line.trim())?.trim() ?? '';
  const titleLine = firstLine.replace(/^ESCALATION\s*[—–-]\s*/i, '');
  const titleParts = titleLine.split(/\s+[—–]\s+/).map((part) => part.trim()).filter(Boolean);

  const titleTopic = titleParts[0] ?? '';
  const titleCustomer = titleParts[1] ?? '';
  const titleAddress = titleParts.slice(2).join(' — ');

  const sourceDetail = getLabeledSection(raw, ['Source / continue here', 'Source']);
  const situation = getLabeledSection(raw, ['Situation']);
  const lastTouch = getLabeledSection(raw, ['Last touch', 'Last Touch']);
  const reason = getLabeledSection(raw, ['Reason', 'Reason for Escalation']);
  const proposedNextStep = getLabeledSection(raw, ['Proposed next step', 'Proposed Next Step']);
  const whereToContinue = getLabeledSection(raw, ['Where Bradley Should Continue', 'Where to Continue']) || sourceDetail;

  const inferredSource = inferSource(sourceDetail || raw);
  const inferredTopic = inferTopic(`${titleTopic}\n${situation}\n${reason}\n${proposedNextStep}`);
  const inferredUrgency = inferUrgency(raw);

  return {
    ...current,
    customer_name: titleCustomer || current.customer_name,
    address: titleAddress || current.address,
    phone: extractPhone(raw) || current.phone,
    email: extractEmail(raw) || current.email,
    source: sources.includes(inferredSource) ? inferredSource : current.source,
    source_detail: sourceDetail || current.source_detail,
    where_to_continue: whereToContinue || current.where_to_continue,
    urgency: inferredUrgency,
    topic: topics.includes(inferredTopic) ? inferredTopic : current.topic,
    situation: situation || current.situation,
    last_touch: lastTouch || current.last_touch,
    reason_for_escalation: reason || current.reason_for_escalation,
    proposed_next_step: proposedNextStep || current.proposed_next_step,
    status: statuses.includes('Needs Bradley') ? 'Needs Bradley' : current.status,
    owner_next_action: 'Bradley'
  };
}

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
  const [quickPaste, setQuickPaste] = useState('');
  const [notice, setNotice] = useState('');
  const [estimatePhotoFiles, setEstimatePhotoFiles] = useState<File[]>([]);
  const [moreInfoScreenshotFiles, setMoreInfoScreenshotFiles] = useState<File[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setValues(fromEscalation(initialEscalation));
    setQuickPaste('');
    setNotice('');
    setEstimatePhotoFiles([]);
    setMoreInfoScreenshotFiles([]);
  }, [initialEscalation]);

  const requiresFollowUp = useMemo(() => !RESOLVED_STATUSES.includes(values.status), [values.status]);

  const setField = <K extends keyof EscalationFormValues>(key: K, value: EscalationFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
  };

  const applyQuickPaste = () => {
    const pasted = quickPaste.trim();
    if (!pasted) {
      setError('Paste an escalation summary first.');
      return;
    }

    setValues((current) => parseQuickEscalation(pasted, current, sources, topics, statuses));
    setError('');
    setNotice('Escalation details were applied to the form. Review anything that was not included in the pasted text.');
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



  const addAttachmentFiles = (type: 'estimate' | 'needs_more_info', files: FileList | null) => {
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
    const setter = type === 'estimate' ? setEstimatePhotoFiles : setMoreInfoScreenshotFiles;
    setter((current) => [...current, ...selected]);
  };

  const removeAttachmentFile = (type: 'estimate' | 'needs_more_info', index: number) => {
    const setter = type === 'estimate' ? setEstimatePhotoFiles : setMoreInfoScreenshotFiles;
    setter((current) => current.filter((_, itemIndex) => itemIndex !== index));
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

    if (requiresFollowUp && !values.follow_up_date) return 'Escalation date is required unless item is Resolved, Closed, or Not a Fit.';
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
        await onSubmitAndAddAnother(normalized, { estimatePhotos: estimatePhotoFiles, moreInfoScreenshots: moreInfoScreenshotFiles });
        setValues(blankValues);
        setSelectedTriggers([]);
        setQuickPaste('');
        setNotice('');
        setEstimatePhotoFiles([]);
    setMoreInfoScreenshotFiles([]);
      } else {
        await onSubmit(normalized, { estimatePhotos: estimatePhotoFiles, moreInfoScreenshots: moreInfoScreenshotFiles });
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

        {notice ? (
          <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {notice}
          </div>
        ) : null}

        {!initialEscalation ? (
          <div className="mb-6 rounded-2xl border border-ga-100 bg-ga-50/70 p-4">
            <div className="mb-3 flex items-start gap-3">
              <div className="rounded-xl bg-white p-2 text-ga-700 shadow-soft">
                <ClipboardPaste className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900">Quick Paste Escalation</p>
                <p className="text-xs text-slate-600">
                  Paste Carl's escalation block here, then auto-fill the form. Anything not detected can still be entered manually.
                </p>
              </div>
            </div>
            <Textarea
              value={quickPaste}
              onChange={(event) => setQuickPaste(event.target.value)}
              className="min-h-[150px] bg-white font-mono text-xs leading-relaxed"
              placeholder={"ESCALATION — Payment setup / pending invoice — Steven Beall — 432 Gaither St, Gaithersburg, MD 20877\n\nSource / continue here: team@ email / HomeWorks\n\nSituation: Steven Beall emailed asking for a link to set up automatic payments for weekly lawn maintenance.\n\nLast touch: 05/21/2026 at 8:04 AM via Gmail\n\nReason: I see a pending invoice in HomeWorks, but I want to confirm before sending anything.\n\nProposed next step: Please confirm if you want me to send the invoice/payment setup link from HomeWorks, or if you want to review it first."}
            />
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => { setQuickPaste(''); setNotice(''); }}>
                Clear Paste Box
              </Button>
              <Button onClick={applyQuickPaste} leftIcon={<Wand2 className="h-4 w-4" />}>
                Auto-Fill Form
              </Button>
            </div>
          </div>
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
            <Label htmlFor="follow_up_date">Escalation Date {requiresFollowUp ? '*' : ''}</Label>
            <Input id="follow_up_date" type="date" value={values.follow_up_date ?? ''} onChange={(event) => setField('follow_up_date', event.target.value)} />
            <p className="field-helper">Use the date you escalated this item to Bradley.</p>
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
                <span className="mt-2 text-sm font-semibold text-slate-900">Attach estimate/site photos</span>
                <span className="mt-1 text-xs text-slate-500">Use this for lawn, beds, damage, access, or reference photos. Images only, max 10 MB each.</span>
                <input
                  id="estimate_photos"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addAttachmentFiles('estimate', event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>

              {estimatePhotoFiles.length ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected estimate photos</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {estimatePhotoFiles.map((file, index) => (
                      <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{file.name}</p>
                          <p className="text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachmentFile('estimate', index)}
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
            <p className="field-helper">For estimate items, attach customer photos so Bradley can review the physical scope quickly.</p>
          </div>

          <div className="lg:col-span-2">
            <Label htmlFor="needs_more_info_screenshots">Needs More Info Screenshots / Conversation Context</Label>
            <div className="mt-2 rounded-2xl border border-dashed border-amber-300 bg-amber-50/50 p-4">
              <label
                htmlFor="needs_more_info_screenshots"
                className="flex cursor-pointer flex-col items-center justify-center rounded-xl bg-white p-5 text-center transition hover:bg-amber-50"
              >
                <ImagePlus className="h-8 w-8 text-amber-700" />
                <span className="mt-2 text-sm font-semibold text-slate-900">Attach screenshots of full details or customer conversation</span>
                <span className="mt-1 text-xs text-slate-500">Use this for screenshots Bradley should read when he clicks Needs More Info. Images only, max 10 MB each.</span>
                <input
                  id="needs_more_info_screenshots"
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    addAttachmentFiles('needs_more_info', event.target.files);
                    event.target.value = '';
                  }}
                />
              </label>

              {moreInfoScreenshotFiles.length ? (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Selected needs-more-info screenshots</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {moreInfoScreenshotFiles.map((file, index) => (
                      <div key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-800">{file.name}</p>
                          <p className="text-xs text-slate-500">{(file.size / (1024 * 1024)).toFixed(1)} MB</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeAttachmentFile('needs_more_info', index)}
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
            <p className="field-helper">These are separate from estimate photos. Bradley sees these in a focused popup when he clicks Needs More Info.</p>
          </div>

          <div className="lg:col-span-2">
            <Label htmlFor="where_to_continue">Where Bradley Should Continue *</Label>
            <Textarea
              id="where_to_continue"
              value={values.where_to_continue}
              onChange={(event) => setField('where_to_continue', event.target.value)}
              placeholder="Example: Reply in Quo thread with phone ending 1234, or continue in team@ Gmail thread."
            />
            <p className="field-helper">This is the human-readable instruction, like Reply in Quo or continue in team@ Gmail. Keep this human-readable, for example: Reply in Quo thread, continue in team@ Gmail, or review in HomeWorks.</p>
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
