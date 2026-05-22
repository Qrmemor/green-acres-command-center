import { useEffect, useMemo, useState } from 'react';
import { Brain, CheckCircle2, Database, Plus, RefreshCcw, Search, Trash2 } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { useAuth } from '@/context/AuthContext';
import { createAIMemory, deactivateAIMemory, buildMemoryFromEscalation, listAIMemories } from '@/services/aiMemory';
import { listEscalations } from '@/services/escalations';
import type { AIMemory, AIMemoryConfidence, AIMemoryType } from '@/types';

const MEMORY_TYPES: AIMemoryType[] = ['sop_rule', 'bradley_pattern', 'customer_reply', 'pricing_scope', 'service_area', 'workflow', 'lesson'];
const CONFIDENCE_OPTIONS: AIMemoryConfidence[] = ['high', 'medium', 'low'];

const blankForm = {
  memory_type: 'lesson' as AIMemoryType,
  title: '',
  summary: '',
  tags: '',
  confidence: 'medium' as AIMemoryConfidence
};

function labelize(value: string) {
  return value.replace(/_/g, ' ');
}

function parseTags(value: string) {
  return value
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function AIMemoryPage() {
  const { user } = useAuth();
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState(blankForm);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setMemories(await listAIMemories({ activeOnly: true, limit: 500 }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load AI memories.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return memories.filter((memory) => {
      const matchesType = !typeFilter || memory.memory_type === typeFilter;
      const haystack = [memory.title, memory.summary, memory.memory_type, memory.confidence, ...(memory.tags ?? [])].join(' ').toLowerCase();
      return matchesType && (!term || haystack.includes(term));
    });
  }, [memories, search, typeFilter]);

  const saveManualMemory = async () => {
    if (!form.title.trim() || !form.summary.trim()) {
      setError('Title and memory summary are required.');
      return;
    }

    setSaving(true);
    setError('');
    setNotice('');
    try {
      await createAIMemory({
        memory_type: form.memory_type,
        title: form.title.trim(),
        summary: form.summary.trim(),
        tags: parseTags(form.tags),
        confidence: form.confidence,
        source_escalation_id: null,
        is_active: true
      }, user?.id);
      setForm(blankForm);
      setNotice('AI memory saved. It will now be used by AI Triage.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save AI memory.');
    } finally {
      setSaving(false);
    }
  };

  const generateFromResolved = async () => {
    setGenerating(true);
    setError('');
    setNotice('');
    try {
      const [allEscalations, existing] = await Promise.all([
        listEscalations(),
        listAIMemories({ activeOnly: true, limit: 1000 })
      ]);
      const existingSourceIds = new Set(existing.map((memory) => memory.source_escalation_id).filter(Boolean));
      const eligible = allEscalations.filter((item) => {
        const resolvedOrUseful = ['Resolved', 'Closed', 'Not a Fit', 'Bradley Replied', 'Approved', 'Ready for Carl'].includes(item.status) || Boolean(item.resolved_at || item.bradley_note);
        return resolvedOrUseful && !existingSourceIds.has(item.id);
      });

      let created = 0;
      for (const escalation of eligible.slice(0, 50)) {
        const memory = buildMemoryFromEscalation(escalation);
        await createAIMemory(memory, user?.id);
        created += 1;
      }

      setNotice(created ? `${created} AI memor${created === 1 ? 'y' : 'ies'} generated from past Bradley/Carl decisions.` : 'No new resolved or Bradley-handled cases to learn from.');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to generate AI memories.');
    } finally {
      setGenerating(false);
    }
  };

  const forgetMemory = async (memory: AIMemory) => {
    const ok = window.confirm(`Forget this AI memory?\n\n${memory.title}`);
    if (!ok) return;

    try {
      await deactivateAIMemory(memory.id);
      setNotice('AI memory forgotten.');
      setMemories((current) => current.filter((item) => item.id !== memory.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to forget memory.');
    }
  };

  return (
    <div className="page-shell max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">AI KNOWLEDGE BASE</p>
          <h1 className="page-title">AI Memory</h1>
          <p className="page-subtitle">Save Bradley patterns, SOP lessons, and resolved-case decisions so AI Triage can use them before you escalate.</p>
        </div>
        <Button onClick={generateFromResolved} disabled={generating} leftIcon={<Database className="h-4 w-4" />}>
          {generating ? 'Learning...' : 'Learn from resolved cases'}
        </Button>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {notice ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5 text-ga-700" /> Add memory manually</CardTitle>
            <CardDescription>Use this for SOP rules or Bradley lessons that should guide future AI triage.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="memory-type">Memory type</Label>
                <Select id="memory-type" value={form.memory_type} onChange={(event) => setForm((current) => ({ ...current, memory_type: event.target.value as AIMemoryType }))} options={MEMORY_TYPES} />
              </div>
              <div>
                <Label htmlFor="memory-confidence">Confidence</Label>
                <Select id="memory-confidence" value={form.confidence} onChange={(event) => setForm((current) => ({ ...current, confidence: event.target.value as AIMemoryConfidence }))} options={CONFIDENCE_OPTIONS} />
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="memory-title">Title</Label>
              <Input id="memory-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="Example: Payment setup with pending invoice" />
            </div>
            <div className="mt-4">
              <Label htmlFor="memory-summary">Memory summary</Label>
              <Textarea id="memory-summary" className="min-h-[190px]" value={form.summary} onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))} placeholder="Example: If a customer asks for automatic payment setup but HomeWorks has a pending invoice, Carl should confirm with Bradley before sending the payment link." />
            </div>
            <div className="mt-4">
              <Label htmlFor="memory-tags">Tags</Label>
              <Input id="memory-tags" value={form.tags} onChange={(event) => setForm((current) => ({ ...current, tags: event.target.value }))} placeholder="payment, invoice, HomeWorks" />
              <p className="mt-1 text-xs text-slate-500">Separate tags with commas. Tags improve AI matching.</p>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setForm(blankForm)}>Clear</Button>
              <Button onClick={saveManualMemory} disabled={saving} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
                {saving ? 'Saving...' : 'Save memory'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-blue-700" /> Saved AI memories</CardTitle>
            <CardDescription>{memories.length} active memor{memories.length === 1 ? 'y' : 'ies'} available for AI Triage.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="mb-4 grid gap-3 sm:grid-cols-[1fr_220px_auto]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
                <Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search memory, tag, or rule..." />
              </div>
              <Select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} options={MEMORY_TYPES} placeholder="All memory types" />
              <Button variant="secondary" onClick={load} leftIcon={<RefreshCcw className="h-4 w-4" />}>Refresh</Button>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">Loading AI memories...</div>
            ) : filtered.length ? (
              <div className="space-y-3">
                {filtered.map((memory) => (
                  <div key={memory.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-slate-950">{memory.title}</p>
                          <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">{labelize(memory.memory_type)}</span>
                          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">{memory.confidence}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{memory.summary}</p>
                        {memory.tags.length ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {memory.tags.map((tag) => <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{tag}</span>)}
                          </div>
                        ) : null}
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => forgetMemory(memory)} leftIcon={<Trash2 className="h-4 w-4" />}>
                        Forget
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                No AI memories found for this filter yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
