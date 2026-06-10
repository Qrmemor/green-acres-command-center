import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clipboard,
  Loader2,
  MessageCircle,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  UserRound
} from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { listAIMemories } from '@/services/aiMemory';
import { getRealtimeTutorChatReply, type TutorChatMessage, type TutorChatReply } from '@/services/realtimeCallTutor';
import type { AIMemory } from '@/types';

type ChatRow =
  | { id: string; role: 'customer'; text: string; createdAt: string }
  | { id: string; role: 'coach'; customerText: string; reply: TutorChatReply; createdAt: string };

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function memoryText(memories: AIMemory[]) {
  return memories
    .filter((memory) => memory.is_active)
    .map((memory) => [
      `TITLE: ${memory.title}`,
      `TYPE: ${memory.memory_type}`,
      `CONFIDENCE: ${memory.confidence}`,
      memory.tags?.length ? `TAGS: ${memory.tags.join(', ')}` : '',
      `MEMORY: ${memory.summary}`
    ].filter(Boolean).join('\n'))
    .join('\n\n---\n\n');
}

function buildConversation(rows: ChatRow[]) {
  return rows.map((row) => {
    if (row.role === 'customer') return `Customer: ${row.text}`;
    return `Suggested Reply: ${row.reply.recommendedReply}\nNext Step: ${row.reply.nextStep}\nEscalation Needed: ${row.reply.escalationNeeded ? 'Yes' : 'No'}`;
  }).join('\n\n');
}

export function RealtimeCallTutorPage() {
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [customerInput, setCustomerInput] = useState('');
  const [loadingReply, setLoadingReply] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const activeMemories = useMemo(() => memories.filter((memory) => memory.is_active), [memories]);
  const aiMemory = useMemo(() => memoryText(memories), [memories]);
  const conversation = useMemo(() => buildConversation(rows), [rows]);

  useEffect(() => {
    void loadMemories();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rows, loadingReply]);

  const loadMemories = async () => {
    setMemoryLoading(true);
    setError('');
    try {
      const data = await listAIMemories();
      setMemories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load AI Memory.');
    } finally {
      setMemoryLoading(false);
    }
  };

  const copy = async (value: string, label = 'Copied.') => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1400);
  };

  const submitCustomerSays = async () => {
    const clean = customerInput.trim();
    if (!clean) return;

    const customerRow: ChatRow = { id: makeId(), role: 'customer', text: clean, createdAt: new Date().toISOString() };
    const nextRows = [...rows, customerRow];
    setRows(nextRows);
    setCustomerInput('');
    setLoadingReply(true);
    setError('');

    try {
      const messages: TutorChatMessage[] = nextRows.map((row) => row.role === 'customer' ? { role: 'customer', text: row.text } : { role: 'coach', text: row.reply.recommendedReply });
      const reply = await getRealtimeTutorChatReply({
        latestCustomerText: clean,
        conversation: buildConversation(nextRows),
        messages,
        aiMemory,
        memoryCount: activeMemories.length
      });
      setRows((current) => [...current, { id: makeId(), role: 'coach', customerText: clean, reply, createdAt: new Date().toISOString() }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Realtime tutor failed.');
    } finally {
      setLoadingReply(false);
    }
  };

  const rewriteLast = async (mode: 'shorter' | 'professional' | 'taglish') => {
    const lastCoach = [...rows].reverse().find((row): row is Extract<ChatRow, { role: 'coach' }> => row.role === 'coach');
    if (!lastCoach) return;
    setLoadingReply(true);
    setError('');
    try {
      const reply = await getRealtimeTutorChatReply({
        latestCustomerText: `Rewrite this reply in ${mode} style: ${lastCoach.reply.recommendedReply}`,
        conversation,
        messages: rows.map((row) => row.role === 'customer' ? { role: 'customer', text: row.text } : { role: 'coach', text: row.reply.recommendedReply }),
        aiMemory,
        memoryCount: activeMemories.length,
        mode
      });
      setRows((current) => current.map((row) => row.id === lastCoach.id && row.role === 'coach' ? { ...row, reply: { ...row.reply, recommendedReply: reply.recommendedReply } } : row));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rewrite reply.');
    } finally {
      setLoadingReply(false);
    }
  };

  const newCall = () => {
    setRows([]);
    setCustomerInput('');
    setCopied('');
    setError('');
  };

  const lastReply = [...rows].reverse().find((row): row is Extract<ChatRow, { role: 'coach' }> => row.role === 'coach');

  return (
    <div className="page-shell max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">AI CUSTOMER SERVICE</p>
          <h1 className="page-title">Realtime Call Tutor</h1>
          <p className="page-subtitle">Customer says → Suggested Reply → Customer says → Suggested Reply. Memory comes from your existing AI Memory page.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="blue">{memoryLoading ? 'Loading memory...' : `${activeMemories.length} AI memories loaded`}</Badge>
          <Button variant="secondary" onClick={loadMemories} leftIcon={<RefreshCw className="h-4 w-4" />}>Refresh Memory</Button>
          <Button variant="danger" onClick={newCall} leftIcon={<Trash2 className="h-4 w-4" />}>New Call</Button>
        </div>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <div className="mb-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
        <div className="flex items-start gap-3">
          <div className="rounded-2xl bg-ga-50 p-3 text-ga-700"><MessageCircle className="h-6 w-6" /></div>
          <div>
            <h2 className="text-lg font-bold text-slate-950">Simple call flow</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">Type the exact thing the customer said. The tutor replies with the exact line you can read. Keep adding customer lines until the call ends.</p>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100">
            <CardTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-ga-700" /> Call Tutor Chat</CardTitle>
            <CardDescription>Left side is what the customer said. Right side is the suggested reply.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[580px] overflow-y-auto bg-slate-50 p-5">
              {rows.length ? rows.map((row) => row.role === 'customer' ? (
                <div key={row.id} className="mb-4 flex justify-start">
                  <div className="max-w-[78%] rounded-[24px] rounded-tl-md border border-slate-200 bg-white px-5 py-4 shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <UserRound className="h-4 w-4" /> Customer says <span className="font-normal normal-case text-slate-400">{formatTime(row.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-900">{row.text}</p>
                  </div>
                </div>
              ) : (
                <div key={row.id} className="mb-5 flex justify-end">
                  <div className="max-w-[82%] rounded-[24px] rounded-tr-md bg-ga-950 px-5 py-4 text-white shadow-soft">
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-ga-100">
                      <Bot className="h-4 w-4" /> Suggested Reply <span className="font-normal normal-case text-ga-200">{formatTime(row.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-lg font-semibold leading-8">{row.reply.recommendedReply}</p>
                    <div className="mt-4 grid gap-3 rounded-2xl bg-white/10 p-3 text-sm">
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-ga-100">Next step</p><p className="mt-1 leading-6 text-white">{row.reply.nextStep}</p></div>
                      <div><p className="text-xs font-semibold uppercase tracking-wide text-ga-100">Escalation needed</p><p className="mt-1 leading-6 text-white">{row.reply.escalationNeeded ? `Yes. ${row.reply.escalationReason}` : 'No'}</p></div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => copy(row.reply.recommendedReply, 'Reply copied.')} leftIcon={<Clipboard className="h-4 w-4" />}>Copy</Button>
                    </div>
                  </div>
                </div>
              )) : (
                <div className="flex h-full items-center justify-center text-center">
                  <div className="max-w-md rounded-3xl border border-dashed border-slate-300 bg-white p-8">
                    <MessageCircle className="mx-auto mb-3 h-10 w-10 text-ga-700" />
                    <p className="text-lg font-bold text-slate-950">Start with what the customer says</p>
                    <p className="mt-2 text-sm leading-6 text-slate-500">Example: “I want an estimate for lawn cleanup but I can’t send photos.”</p>
                  </div>
                </div>
              )}
              {loadingReply ? <div className="mb-4 flex justify-end"><div className="rounded-2xl bg-ga-950 px-4 py-3 text-sm font-semibold text-white"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Generating suggested reply...</div></div> : null}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-slate-900">Customer says</p><p className="text-xs text-slate-500">Uses AI Memory automatically</p></div>
              <Textarea
                value={customerInput}
                onChange={(event) => setCustomerInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                    event.preventDefault();
                    void submitCustomerSays();
                  }
                }}
                placeholder="Type the exact thing the customer said, then click Generate Suggested Reply."
                className="min-h-[95px]"
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={submitCustomerSays} disabled={loadingReply || memoryLoading} leftIcon={loadingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}>Generate Suggested Reply</Button>
                <Button variant="secondary" onClick={() => setCustomerInput('')} disabled={!customerInput}>Clear</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle>Latest Suggested Reply</CardTitle><CardDescription>This is the fastest box to read during a call.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {lastReply ? (
                <>
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5"><p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Read this</p><p className="mt-2 whitespace-pre-wrap text-xl font-bold leading-8 text-emerald-950">{lastReply.reply.recommendedReply}</p></div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => copy(lastReply.reply.recommendedReply, 'Reply copied.')} leftIcon={<Clipboard className="h-4 w-4" />}>Copy</Button>
                    <Button size="sm" variant="secondary" onClick={() => rewriteLast('shorter')} disabled={loadingReply}>Shorter</Button>
                    <Button size="sm" variant="secondary" onClick={() => rewriteLast('professional')} disabled={loadingReply}>Professional</Button>
                    <Button size="sm" variant="secondary" onClick={() => rewriteLast('taglish')} disabled={loadingReply}>Taglish</Button>
                  </div>
                </>
              ) : <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-sm text-slate-500">Suggested reply will appear here.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Coach Notes</CardTitle><CardDescription>Next step, missing info, and escalation check.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {lastReply ? (
                <>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Step</p><p className="mt-2 text-sm leading-6 text-slate-800">{lastReply.reply.nextStep}</p></div>
                  <div className="rounded-2xl border border-slate-200 bg-white p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Missing Info</p><div className="mt-2 flex flex-wrap gap-2">{lastReply.reply.missingInfo.length ? lastReply.reply.missingInfo.map((item) => <Badge key={item} tone="amber">{item}</Badge>) : <Badge tone="green">None</Badge>}</div></div>
                  <div className={`rounded-2xl border p-4 ${lastReply.reply.escalationNeeded ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50'}`}>
                    <p className="flex items-center gap-2 text-sm font-semibold">{lastReply.reply.escalationNeeded ? <AlertTriangle className="h-4 w-4 text-red-700" /> : <CheckCircle2 className="h-4 w-4 text-emerald-700" />} Escalation Needed: {lastReply.reply.escalationNeeded ? 'Yes' : 'No'}</p>
                    <p className="mt-2 text-sm leading-6">{lastReply.reply.escalationReason || 'No escalation trigger detected.'}</p>
                  </div>
                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-blue-700">Memory basis</p><p className="mt-2 text-sm leading-6 text-blue-900">{lastReply.reply.sourceBasis}</p></div>
                </>
              ) : <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">Coach notes will appear after the first customer line.</div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>How this works</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm leading-6 text-slate-600">
              <p>1. Type what the customer said.</p>
              <p>2. Read the Suggested Reply.</p>
              <p>3. Type the next customer reply.</p>
              <p>4. Continue until the call ends.</p>
              <p className="font-semibold text-ga-800">Memory source: existing AI Memory page. No separate upload needed.</p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
