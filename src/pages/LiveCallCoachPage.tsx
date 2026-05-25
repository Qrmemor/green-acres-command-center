import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  RefreshCw,
  Radio,
  ShieldAlert,
  Sparkles,
  Trash2
} from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { DEFAULT_TOPICS } from '@/lib/constants';
import { listAIMemories } from '@/services/aiMemory';
import { listEscalations } from '@/services/escalations';
import { getLiveCallCoaching, type LiveCoachResult } from '@/services/liveCallCoach';
import type { AIMemory, Escalation } from '@/types';

type SpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: {
      isFinal: boolean;
      [index: number]: {
        transcript: string;
      };
    };
  };
};

type SpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: Event & { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function decisionTone(decision?: string): 'green' | 'red' | 'amber' | 'blue' | 'slate' {
  if (decision === 'Needs Bradley') return 'red';
  if (decision === 'Need more info first') return 'amber';
  if (decision === 'Carl can handle') return 'green';
  return 'slate';
}

function buildCallNotes(transcript: string, coach: LiveCoachResult | null) {
  return [
    'LIVE CALL NOTES',
    '',
    coach ? `Decision: ${coach.decision}` : '',
    coach ? `Confidence: ${coach.confidence}` : '',
    coach?.sopTriggers?.length ? `SOP Triggered: ${coach.sopTriggers.join(', ')}` : '',
    coach?.missingInfo?.length ? `Missing Info: ${coach.missingInfo.join(', ')}` : '',
    coach?.sayThisNext ? `Suggested Response: ${coach.sayThisNext}` : '',
    coach?.callNotes ? `\nAI Notes:\n${coach.callNotes}` : '',
    '',
    'Transcript:',
    transcript || 'No transcript captured.'
  ].filter(Boolean).join('\n');
}

export function LiveCallCoachPage() {
  const [source, setSource] = useState('Quo');
  const [topic, setTopic] = useState('Call Needed');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [manualContext, setManualContext] = useState('');
  const [listening, setListening] = useState(false);
  const [autoCoach, setAutoCoach] = useState(true);
  const [coaching, setCoaching] = useState(false);
  const [coach, setCoach] = useState<LiveCoachResult | null>(null);
  const [history, setHistory] = useState<Escalation[]>([]);
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldRestartRef = useRef(false);
  const lastAnalyzedRef = useRef('');
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);

  const transcript = useMemo(() => {
    return [manualContext.trim(), finalTranscript.trim(), interimTranscript.trim() ? `[listening] ${interimTranscript.trim()}` : '']
      .filter(Boolean)
      .join('\n');
  }, [manualContext, finalTranscript, interimTranscript]);

  useEffect(() => {
    let mounted = true;
    async function loadContext() {
      setContextLoading(true);
      try {
        const [nextHistory, nextMemories] = await Promise.all([listEscalations(), listAIMemories({ activeOnly: true })]);
        if (!mounted) return;
        setHistory(nextHistory);
        setMemories(nextMemories);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load Live Call Coach context.');
      } finally {
        if (mounted) setContextLoading(false);
      }
    }
    loadContext();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    transcriptBoxRef.current?.scrollTo({ top: transcriptBoxRef.current.scrollHeight, behavior: 'smooth' });
  }, [finalTranscript, interimTranscript]);

  const requestCoaching = async (force = false) => {
    const cleanTranscript = transcript.trim();
    if (!cleanTranscript) {
      setError('Start listening or type call context first.');
      return;
    }

    if (!force && cleanTranscript === lastAnalyzedRef.current) return;

    setError('');
    setCopied('');
    setCoaching(true);
    lastAnalyzedRef.current = cleanTranscript;

    try {
      const nextCoach = await getLiveCallCoaching({ transcript: cleanTranscript, source, topic, memories, history });
      setCoach(nextCoach);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live Call Coach failed.');
    } finally {
      setCoaching(false);
    }
  };

  useEffect(() => {
    if (!autoCoach || !listening || contextLoading) return;
    if (transcript.trim().length < 80) return;

    const timer = window.setTimeout(() => {
      void requestCoaching(false);
    }, 3500);

    return () => window.clearTimeout(timer);
  }, [transcript, autoCoach, listening, contextLoading]);

  const startListening = () => {
    setError('');
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setError('Live transcription is not supported in this browser. Use Chrome or Edge, or type/paste the call notes manually.');
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalText = '';
      let interimText = '';

      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? '';
        if (result.isFinal) finalText += `${text} `;
        else interimText += text;
      }

      if (finalText.trim()) {
        setFinalTranscript((current) => `${current}${finalText}`.trimStart());
      }
      setInterimTranscript(interimText);
    };

    recognition.onerror = (event) => {
      const message = event.error === 'not-allowed'
        ? 'Microphone permission was blocked. Allow microphone access in the browser.'
        : `Speech recognition error${event.error ? `: ${event.error}` : ''}.`;
      setError(message);
    };

    recognition.onend = () => {
      setInterimTranscript('');
      if (shouldRestartRef.current) {
        try {
          recognition.start();
        } catch {
          shouldRestartRef.current = false;
          setListening(false);
        }
      } else {
        setListening(false);
      }
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    setListening(true);

    try {
      recognition.start();
    } catch (err) {
      shouldRestartRef.current = false;
      setListening(false);
      setError(err instanceof Error ? err.message : 'Could not start microphone.');
    }
  };

  const stopListening = () => {
    shouldRestartRef.current = false;
    setListening(false);
    recognitionRef.current?.stop();
  };

  const clearCall = () => {
    stopListening();
    setFinalTranscript('');
    setInterimTranscript('');
    setManualContext('');
    setCoach(null);
    setError('');
    setCopied('');
    lastAnalyzedRef.current = '';
  };

  const copy = async (value: string, label = 'Copied.') => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1800);
  };

  return (
    <div className="page-shell max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">AI COMMAND CENTER</p>
          <h1 className="page-title">Live Call Coach</h1>
          <p className="page-subtitle">
            Let the system listen through your microphone, transcribe the call, and show SOP-based text guidance you can read while talking.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="rounded-full bg-ga-50 px-3 py-1 font-medium text-ga-800">{memories.length} memories loaded</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">{history.length} cases available</span>
        </div>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <div className="mb-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="font-semibold">Important call note</p>
        <p className="mt-1">
          This listens only through your browser microphone. If the customer audio is inside OpenPhone/Quo and you use headphones, the system may only hear you. Use speaker mode or type/paste key details if needed.
        </p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><PhoneCall className="h-5 w-5 text-ga-700" /> Call controls</CardTitle>
                  <CardDescription>Start listening when the call begins. The AI will coach from the live transcript.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {listening ? (
                    <Button variant="danger" onClick={stopListening} leftIcon={<MicOff className="h-4 w-4" />}>Stop Listening</Button>
                  ) : (
                    <Button onClick={startListening} leftIcon={<Mic className="h-4 w-4" />}>Start Listening</Button>
                  )}
                  <Button variant={autoCoach ? 'warning' : 'secondary'} onClick={() => setAutoCoach((current) => !current)} leftIcon={<Radio className="h-4 w-4" />}>
                    {autoCoach ? 'Auto Coach On' : 'Auto Coach Off'}
                  </Button>
                  <Button variant="secondary" onClick={() => requestCoaching(true)} disabled={coaching || contextLoading} leftIcon={coaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}>
                    Coach Now
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="live-source">Source</Label>
                <Select id="live-source" value={source} onChange={(event) => setSource(event.target.value)} options={['Quo', 'HomeWorks', 'Gmail', 'Other']} />
              </div>
              <div>
                <Label htmlFor="live-topic">Topic</Label>
                <Select id="live-topic" value={topic} onChange={(event) => setTopic(event.target.value)} options={DEFAULT_TOPICS} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>Live transcript</CardTitle>
                  <CardDescription>Use this as your running call notes. You can also type or paste context manually.</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => copy(buildCallNotes(transcript, coach), 'Call notes copied.')} leftIcon={<Clipboard className="h-4 w-4" />}>
                    Copy Notes
                  </Button>
                  <Button variant="ghost" onClick={clearCall} leftIcon={<Trash2 className="h-4 w-4" />}>Clear</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="manual-context">Manual context / call setup</Label>
                <Textarea
                  id="manual-context"
                  value={manualContext}
                  onChange={(event) => setManualContext(event.target.value)}
                  placeholder="Optional: type customer name, address, service, or context before/during the call."
                  className="min-h-[90px]"
                />
              </div>

              <div ref={transcriptBoxRef} className="min-h-[320px] max-h-[420px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800">
                {finalTranscript ? <span className="whitespace-pre-wrap">{finalTranscript}</span> : <span className="text-slate-400">Transcript will appear here after you start listening.</span>}
                {interimTranscript ? <span className="whitespace-pre-wrap text-slate-500"> {interimTranscript}</span> : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="overflow-hidden border-ga-200">
            <CardHeader className="bg-ga-950 text-white">
              <CardTitle className="flex items-center gap-2 text-white"><Sparkles className="h-5 w-5" /> What to say next</CardTitle>
              <CardDescription className="text-ga-100">Read this while talking to the customer.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {coach ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={decisionTone(coach.decision)}>{coach.decision}</Badge>
                    <Badge tone="blue">Confidence: {coach.confidence}</Badge>
                  </div>

                  <div className="rounded-2xl border border-ga-200 bg-ga-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-ga-700">Say this next</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-ga-950">{coach.sayThisNext}</p>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => copy(coach.sayThisNext, 'Suggested response copied.')} leftIcon={<Clipboard className="h-4 w-4" />}>
                      Copy line
                    </Button>
                  </div>

                  {coach.askNext.length ? (
                    <div>
                      <p className="mb-2 text-sm font-semibold text-slate-900">Ask next</p>
                      <ul className="space-y-2">
                        {coach.askNext.map((item) => (
                          <li key={item} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{item}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {coach.sopTriggers.length ? (
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><ShieldAlert className="h-4 w-4 text-amber-600" /> SOP triggered</p>
                      <div className="flex flex-wrap gap-2">
                        {coach.sopTriggers.map((trigger) => <Badge key={trigger} tone="amber">{trigger}</Badge>)}
                      </div>
                    </div>
                  ) : null}

                  {coach.missingInfo.length ? (
                    <div>
                      <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><AlertTriangle className="h-4 w-4 text-red-600" /> Missing info</p>
                      <div className="flex flex-wrap gap-2">
                        {coach.missingInfo.map((item) => <Badge key={item} tone="red">{item}</Badge>)}
                      </div>
                    </div>
                  ) : null}

                  {coach.doNotSay.length ? (
                    <div className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm text-red-800">
                      <p className="font-semibold">Do not say</p>
                      <ul className="mt-2 list-disc space-y-1 pl-5">
                        {coach.doNotSay.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  ) : null}

                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-900"><CheckCircle2 className="h-4 w-4 text-ga-700" /> Quick summary</p>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{coach.summary}</p>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 text-sm text-slate-600">
                  Start listening, then click <span className="font-semibold text-slate-900">Coach Now</span>. If Auto Coach is on, suggestions will refresh as the transcript grows.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-ga-700" /> Best use</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>Use it when a live call is unclear, the customer asks for Bradley, pricing feels risky, or you need the next safe SOP question.</p>
              <p>For simple calls, turn Auto Coach off and only click Coach Now when needed to save tokens.</p>
              <p>It only advises Carl. It does not speak to the customer or send messages.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
