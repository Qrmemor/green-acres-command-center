import { useState } from 'react';
import { Brain, Clipboard, Sparkles } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { type AITriageAnalysis } from '@/services/aiTriage';
import { analyzeEscalationDraftWithOpenAI } from '@/services/openaiTriage';
import { listAIMemories } from '@/services/aiMemory';
import { listEscalations } from '@/services/escalations';
import { DEFAULT_TOPICS } from '@/lib/constants';

function parseFreeTextToDraft(raw: string, source: string, topic: string) {
  const email = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? '';
  const phone = raw.match(/(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] ?? '';
  const firstLine = raw.split(/\r?\n/).find((line) => line.trim())?.trim() ?? '';
  const customerNameMatch = firstLine.match(/(?:from|customer|name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/);

  return {
    customer_name: customerNameMatch?.[1] ?? '',
    phone,
    email,
    source,
    topic,
    situation: raw.trim(),
    last_touch: raw.trim() ? 'Review pasted customer context.' : '',
    reason_for_escalation: '',
    proposed_next_step: '',
    where_to_continue: source === 'Gmail' ? 'team@ Gmail thread' : source === 'Quo' ? 'Quo thread' : source
  };
}

export function AITriagePage() {
  const [source, setSource] = useState('Quo');
  const [topic, setTopic] = useState('Other');
  const [input, setInput] = useState('');
  const [analysis, setAnalysis] = useState<AITriageAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const analyze = async () => {
    if (!input.trim()) {
      setError('Paste the customer message or escalation context first.');
      return;
    }

    setLoading(true);
    setError('');
    setCopied('');
    try {
      const [history, memories] = await Promise.all([listEscalations(), listAIMemories({ activeOnly: true })]);
      const draft = parseFreeTextToDraft(input, source, topic);
      setAnalysis(await analyzeEscalationDraftWithOpenAI(draft, history, memories));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI triage failed.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(`${label} copied.`);
  };

  return (
    <div className="page-shell max-w-6xl">
      <div className="mb-6">
        <p className="page-kicker">AI COMMAND CENTER</p>
        <h1 className="page-title">AI Triage Assistant</h1>
        <p className="page-subtitle">Paste a customer message or internal note before escalating. The assistant checks SOP triggers, missing info, and similar past Bradley decisions.</p>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[1fr_0.95fr]">
        <Card>
          <CardHeader>
            <CardTitle>Before you escalate</CardTitle>
            <CardDescription>Use this as a quick decision check. It does not send anything to customers or Bradley.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="ai-source">Source</Label>
                <Select id="ai-source" value={source} onChange={(event) => setSource(event.target.value)} options={['Quo', 'HomeWorks', 'Gmail', 'Other']} />
              </div>
              <div>
                <Label htmlFor="ai-topic">Topic</Label>
                <Select id="ai-topic" value={topic} onChange={(event) => setTopic(event.target.value)} options={DEFAULT_TOPICS} />
              </div>
            </div>
            <div className="mt-4">
              <Label htmlFor="ai-input">Customer message / internal context</Label>
              <Textarea
                id="ai-input"
                className="min-h-[330px]"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="Paste the customer message, Quo text, Gmail reply, HomeWorks note, or draft escalation here."
              />
            </div>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => { setInput(''); setAnalysis(null); }}>Clear</Button>
              <Button onClick={analyze} disabled={loading} leftIcon={<Sparkles className="h-4 w-4" />}>
                {loading ? 'Analyzing...' : 'Analyze with OpenAI'}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Brain className="h-5 w-5 text-blue-700" /> AI Result</CardTitle>
            <CardDescription>Keep Bradley out of items Carl can safely handle.</CardDescription>
          </CardHeader>
          <CardContent>
            {!analysis ? (
              <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                Paste context and click Analyze with OpenAI. If OpenAI is not configured, the local SOP triage will still run as fallback.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Recommendation</p>
                  <p className="mt-1 text-2xl font-bold text-slate-950">{analysis.decision}</p>
                  <p className="mt-1 text-sm text-slate-600">Confidence: {analysis.confidence}{(analysis as any).engine ? ` · Engine: ${(analysis as any).engine}` : ''}</p>
                  {(analysis as any).openAIError ? <p className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">OpenAI fallback: {(analysis as any).openAIError}</p> : null}
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</p>
                  <ul className="mt-2 space-y-1 text-sm text-slate-700">
                    {analysis.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
                  </ul>
                </div>

                {analysis.sopTriggers.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">SOP triggered</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {analysis.sopTriggers.map((trigger) => <span key={trigger} className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">{trigger}</span>)}
                    </div>
                  </div>
                ) : null}

                {analysis.missingInfo.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing info</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {analysis.missingInfo.map((item) => <span key={item} className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">{item}</span>)}
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested next step</p>
                  <p className="mt-2 text-sm text-slate-700">{analysis.suggestedNextStep}</p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Suggested reply</p>
                    <Button size="sm" variant="secondary" onClick={() => copy(analysis.suggestedReply, 'Suggested reply')} leftIcon={<Clipboard className="h-3.5 w-3.5" />}>Copy</Button>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{analysis.suggestedReply}</p>
                </div>

                {analysis.memoryMatches.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI memory matches</p>
                    <div className="mt-2 space-y-2">
                      {analysis.memoryMatches.map((item) => (
                        <div key={item.id} className="rounded-xl border border-emerald-100 bg-emerald-50 p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{item.title}</span>
                            <span className="rounded-full bg-white px-2 py-0.5 text-xs text-emerald-700">{item.memory_type.replace(/_/g, ' ')}</span>
                            <span className="text-xs text-emerald-700">{item.score}% match</span>
                          </div>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{item.summary}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                {analysis.similarCases.length ? (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Similar cases</p>
                    <div className="mt-2 space-y-2">
                      {analysis.similarCases.map((item) => (
                        <div key={item.id} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-900">{item.customer_name}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{item.topic}</span>
                            <span className="text-xs text-slate-500">{item.score}% match</span>
                          </div>
                          <p className="mt-1 text-xs text-slate-500">{item.learned_from}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
