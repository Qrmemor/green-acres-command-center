import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clipboard,
  Database,
  Loader2,
  MessageCircle,
  MonitorUp,
  Plus,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  Square,
  Trash2,
  UserRound,
  Volume2
} from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { createAIMemory, deactivateAIMemory, listAIMemories } from '@/services/aiMemory';
import {
  getRealtimeTutorChatReply,
  transcribeTutorAudio,
  type TutorChatMessage,
  type TutorChatReply
} from '@/services/realtimeCallTutor';
import type { AIMemory } from '@/types';

type ChatRow =
  | { id: string; role: 'customer'; text: string; createdAt: string; source?: 'manual' | 'tab-audio' }
  | { id: string; role: 'coach'; customerText: string; reply: TutorChatReply; createdAt: string };

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function isTutorMemory(memory: AIMemory) {
  return (memory.tags ?? []).map((tag) => tag.toLowerCase()).includes('call_tutor');
}

function tutorMemoryText(memories: AIMemory[]) {
  return memories
    .filter((memory) => memory.is_active && isTutorMemory(memory))
    .map((memory) => [
      `TITLE: ${memory.title}`,
      `CONFIDENCE: ${memory.confidence}`,
      memory.tags?.length ? `TAGS: ${memory.tags.join(', ')}` : '',
      `CALL TUTOR SOP MEMORY: ${memory.summary}`
    ].filter(Boolean).join('\n'))
    .join('\n\n---\n\n');
}

function buildConversation(rows: ChatRow[]) {
  return rows.map((row) => {
    if (row.role === 'customer') return `Customer: ${row.text}`;
    return `Suggested Reply: ${row.reply.recommendedReply}\nEscalation Needed: ${row.reply.escalationNeeded ? 'Yes' : 'No'}`;
  }).join('\n\n');
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function canRecordTabAudio() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof MediaRecorder !== 'undefined';
}

export function RealtimeCallTutorPage() {
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [memoryLoading, setMemoryLoading] = useState(true);
  const [rows, setRows] = useState<ChatRow[]>([]);
  const [customerInput, setCustomerInput] = useState('');
  const [loadingReply, setLoadingReply] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [tabAudioActive, setTabAudioActive] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioHelp, setAudioHelp] = useState('Use Capture Tab Audio so the system can hear what the customer says and auto-create replies.');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [memoryTitle, setMemoryTitle] = useState('');
  const [sopContent, setSopContent] = useState('');
  const [savingMemory, setSavingMemory] = useState(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioMeterFrameRef = useRef<number | null>(null);
  const lastHeardRef = useRef('');
  const replyQueueRef = useRef<Promise<void>>(Promise.resolve());

  const tutorMemories = useMemo(() => memories.filter((memory) => memory.is_active && isTutorMemory(memory)), [memories]);
  const callTutorMemory = useMemo(() => tutorMemoryText(memories), [memories]);
  const conversation = useMemo(() => buildConversation(rows), [rows]);

  useEffect(() => {
    void loadMemories();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [rows, loadingReply]);

  useEffect(() => {
    return () => {
      stopTabAudioCapture();
    };
  }, []);

  const loadMemories = async () => {
    setMemoryLoading(true);
    setError('');
    try {
      const data = await listAIMemories({ activeOnly: true, limit: 200 });
      setMemories(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load Call Tutor SOP Memory.');
    } finally {
      setMemoryLoading(false);
    }
  };

  const copy = async (value: string, label = 'Copied.') => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1400);
  };

  const saveTutorMemory = async () => {
    const title = memoryTitle.trim();
    const sop = sopContent.trim();

    if (!title || !sop) {
      setError('Add an SOP title and SOP content before saving.');
      return;
    }

    setSavingMemory(true);
    setError('');

    try {
      await createAIMemory({
        memory_type: 'sop_rule',
        title,
        summary: sop,
        tags: ['call_tutor', 'realtime_call_tutor', 'call_tutor_sop'],
        source_escalation_id: null,
        confidence: 'high',
        is_active: true
      });

      setMemoryTitle('');
      setSopContent('');
      setCopied('Call Tutor SOP saved.');
      window.setTimeout(() => setCopied(''), 1400);
      await loadMemories();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save Call Tutor SOP.');
    } finally {
      setSavingMemory(false);
    }
  };

  const forgetTutorMemory = async (id: string) => {
    setError('');
    try {
      await deactivateAIMemory(id);
      setMemories((current) => current.filter((memory) => memory.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove memory.');
    }
  };

  const stopAudioMeter = () => {
    if (audioMeterFrameRef.current !== null) {
      cancelAnimationFrame(audioMeterFrameRef.current);
      audioMeterFrameRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    setAudioLevel(0);
  };

  const startAudioMeter = (stream: MediaStream) => {
    stopAudioMeter();

    try {
      const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextConstructor) {
        setAudioHelp('Audio meter is not supported in this browser. Use Chrome or Edge.');
        return;
      }

      const audioContext = new AudioContextConstructor();
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      audioContextRef.current = audioContext;

      const data = new Uint8Array(analyser.fftSize);
      let quietFrames = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const centered = data[index] - 128;
          sum += centered * centered;
        }
        const rms = Math.sqrt(sum / data.length);
        const normalized = Math.min(100, Math.round((rms / 38) * 100));
        setAudioLevel(normalized);

        if (normalized >= 3) {
          quietFrames = 0;
          setAudioHelp('Hearing customer tab audio. Suggested replies will update automatically.');
        } else {
          quietFrames += 1;
          if (quietFrames > 80) {
            setAudioHelp('No clear tab audio detected. Re-share the customer call tab and check Share tab audio.');
          } else {
            setAudioHelp('Waiting for customer speech...');
          }
        }

        audioMeterFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      setAudioHelp('Could not start the audio meter.');
    }
  };

  const generateReplyForCustomerLine = async (clean: string, source: 'manual' | 'tab-audio') => {
    const customerRow: ChatRow = {
      id: makeId(),
      role: 'customer',
      text: clean,
      createdAt: new Date().toISOString(),
      source
    };

    const nextRows = [...rows, customerRow];
    setRows(nextRows);
    setLoadingReply(true);
    setError('');

    try {
      const messages: TutorChatMessage[] = nextRows.map((row) => row.role === 'customer' ? { role: 'customer', text: row.text } : { role: 'coach', text: row.reply.recommendedReply });
      const reply = await getRealtimeTutorChatReply({
        latestCustomerText: clean,
        conversation: buildConversation(nextRows),
        messages,
        aiMemory: callTutorMemory,
        memoryCount: tutorMemories.length
      });

      setRows((current) => [
        ...current,
        { id: makeId(), role: 'coach', customerText: clean, reply, createdAt: new Date().toISOString() }
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Realtime tutor failed.');
    } finally {
      setLoadingReply(false);
    }
  };

  const pushCustomerLine = (text: string, source: 'manual' | 'tab-audio') => {
    const clean = text.trim();
    if (!clean) return;

    const normalized = normalizeText(clean);
    if (normalized.length < 3) return;

    const last = normalizeText(lastHeardRef.current);
    if (last && (last === normalized || last.includes(normalized) || normalized.includes(last))) {
      return;
    }

    lastHeardRef.current = clean;

    replyQueueRef.current = replyQueueRef.current.then(async () => {
      await generateReplyForCustomerLine(clean, source);
    });
  };

  const submitCustomerSays = async () => {
    const clean = customerInput.trim();
    if (!clean) return;
    setCustomerInput('');
    pushCustomerLine(clean, 'manual');
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
        aiMemory: callTutorMemory,
        memoryCount: tutorMemories.length,
        mode
      });
      setRows((current) => current.map((row) => row.id === lastCoach.id && row.role === 'coach' ? { ...row, reply: { ...row.reply, recommendedReply: reply.recommendedReply } } : row));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rewrite reply.');
    } finally {
      setLoadingReply(false);
    }
  };

  const stopTabAudioCapture = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // noop
      }
    }

    if (displayStreamRef.current) {
      displayStreamRef.current.getTracks().forEach((track) => track.stop());
      displayStreamRef.current = null;
    }

    mediaRecorderRef.current = null;
    stopAudioMeter();
    setTabAudioActive(false);
    setAudioLoading(false);
    setAudioHelp('Tab audio stopped. You can start it again when the next call begins.');
  };

  const startTabAudioCapture = async () => {
    if (!canRecordTabAudio()) {
      setError('Tab audio capture needs Chrome or Edge with screen/tab sharing support.');
      return;
    }

    setError('');
    setAudioLoading(true);

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error('No tab audio was shared. Please select the Quo/OpenPhone tab and check Share tab audio.');
      }

      displayStreamRef.current = stream;
      setTabAudioActive(true);
      setAudioHelp('Tab audio connected. When the customer speaks, the system will auto-transcribe and generate a reply.');
      startAudioMeter(stream);

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = async (event) => {
        if (!event.data || event.data.size < 8000) return;
        try {
          const text = await transcribeTutorAudio(event.data);
          if (text) {
            pushCustomerLine(text, 'tab-audio');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not transcribe tab audio.');
        }
      };

      recorder.onerror = () => {
        setError('Tab audio recorder failed. Stop and start it again.');
      };

      recorder.onstop = () => {
        if (displayStreamRef.current) {
          displayStreamRef.current.getTracks().forEach((track) => track.stop());
          displayStreamRef.current = null;
        }
        stopAudioMeter();
        setTabAudioActive(false);
      };

      stream.getVideoTracks().forEach((track) => {
        track.onended = () => {
          stopTabAudioCapture();
        };
      });

      recorder.start(5000);
    } catch (err) {
      stopTabAudioCapture();
      setError(err instanceof Error ? err.message : 'Could not start tab audio capture.');
    } finally {
      setAudioLoading(false);
    }
  };

  const newCall = () => {
    setRows([]);
    setCustomerInput('');
    setCopied('');
    setError('');
    lastHeardRef.current = '';
    stopTabAudioCapture();
  };

  const lastReply = [...rows].reverse().find((row): row is Extract<ChatRow, { role: 'coach' }> => row.role === 'coach');

  return (
    <div className="page-shell max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">AI CUSTOMER SERVICE</p>
          <h1 className="page-title">Realtime Call Tutor</h1>
          <p className="page-subtitle">Customer says → Suggested Reply → Customer says → Suggested Reply. This tab now has its own Call Tutor SOP Memory.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone="blue">{memoryLoading ? 'Loading memory...' : `${tutorMemories.length} Call Tutor SOPs`}</Badge>
          <Button variant="secondary" onClick={loadMemories} leftIcon={<RefreshCw className="h-4 w-4" />}>Refresh Memory</Button>
          <Button variant="danger" onClick={newCall} leftIcon={<Trash2 className="h-4 w-4" />}>New Call</Button>
        </div>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <div className="mb-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-soft">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-ga-50 p-3 text-ga-700"><MessageCircle className="h-6 w-6" /></div>
              <div>
                <h2 className="text-lg font-bold text-slate-950">Simple call flow</h2>
                <p className="mt-1 text-sm leading-6 text-slate-600">Type or capture what the customer says. The suggested reply uses only Call Tutor SOP Memory plus this active conversation.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {!tabAudioActive ? (
                <Button onClick={startTabAudioCapture} disabled={audioLoading || loadingReply} leftIcon={audioLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorUp className="h-4 w-4" />}>
                  Capture Tab Audio
                </Button>
              ) : (
                <Button variant="danger" onClick={stopTabAudioCapture} leftIcon={<Square className="h-4 w-4" />}>
                  Stop Audio
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
                <Volume2 className="h-4 w-4 text-ga-700" /> Audio status
              </div>
              <Badge tone={tabAudioActive ? 'green' : 'slate'}>{tabAudioActive ? 'Listening' : 'Stopped'}</Badge>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-200" style={{ width: `${Math.max(4, audioLevel)}%` }} />
            </div>
            <p className="mt-2 text-sm leading-6 text-slate-600">{audioHelp}</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">When the browser asks what to share, choose the Quo/OpenPhone tab and check <span className="font-semibold">Share tab audio</span>.</p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Database className="h-5 w-5 text-ga-700" /> Call Tutor SOP Memory</CardTitle>
            <CardDescription>Add one SOP title, then paste the full SOP below.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <input
              value={memoryTitle}
              onChange={(event) => setMemoryTitle(event.target.value)}
              placeholder="SOP title, example: New lead estimate intake"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-ga-500 focus:ring-2 focus:ring-ga-500/20"
            />
            <Textarea
              value={sopContent}
              onChange={(event) => setSopContent(event.target.value)}
              placeholder="Paste the full SOP here..."
              className="min-h-[260px]"
            />
            <Button onClick={saveTutorMemory} disabled={savingMemory} leftIcon={savingMemory ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}>
              Save SOP Memory
            </Button>
          </CardContent>
        </Card>
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
                      <Badge tone={row.source === 'tab-audio' ? 'blue' : 'slate'}>{row.source === 'tab-audio' ? 'Tab audio' : 'Manual'}</Badge>
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
                    <div className="mt-4 rounded-2xl bg-white/10 p-3 text-sm">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ga-100">Escalation needed</p>
                      <p className="mt-1 leading-6 text-white">{row.reply.escalationNeeded ? `Yes. ${row.reply.escalationReason}` : 'No'}</p>
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
                    <p className="mt-2 text-sm leading-6 text-slate-500">Type it manually or use Capture Tab Audio so the system hears the customer and generates the next reply automatically.</p>
                  </div>
                </div>
              )}
              {loadingReply ? <div className="mb-4 flex justify-end"><div className="rounded-2xl bg-ga-950 px-4 py-3 text-sm font-semibold text-white"><Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Generating suggested reply...</div></div> : null}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-slate-200 bg-white p-4">
              <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-slate-900">Customer says</p><p className="text-xs text-slate-500">Manual input still works anytime</p></div>
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
            <CardHeader><CardTitle>Coach Notes</CardTitle><CardDescription>Only the important parts are kept here.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              {lastReply ? (
                <>
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
            <CardHeader><CardTitle>Saved Call Tutor SOPs</CardTitle><CardDescription>Only SOP memories tagged for this call tutor are shown.</CardDescription></CardHeader>
            <CardContent className="space-y-3">
              {tutorMemories.length ? tutorMemories.slice(0, 8).map((memory) => (
                <div key={memory.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{memory.title}</p>
                      <p className="mt-1 max-h-24 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">{memory.summary}</p>
                    </div>
                    <button type="button" onClick={() => void forgetTutorMemory(memory.id)} className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )) : (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No Call Tutor SOP memories yet. Add SOP rules above.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
