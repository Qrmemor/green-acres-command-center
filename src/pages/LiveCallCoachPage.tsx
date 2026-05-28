import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PhoneCall,
  Radio,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  Volume2
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
import { getLiveCallCoaching, transcribeCallAudio, type LiveCoachResult } from '@/services/liveCallCoach';
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
type ListeningMode = 'microphone' | 'tab-audio' | null;
type AudioHealth = 'idle' | 'hearing' | 'quiet' | 'no-audio';

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

function canRecordTabAudio() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof MediaRecorder !== 'undefined';
}

export function LiveCallCoachPage() {
  const [source, setSource] = useState('Quo');
  const [topic, setTopic] = useState('Call Needed');
  const [finalTranscript, setFinalTranscript] = useState('');
  const [interimTranscript, setInterimTranscript] = useState('');
  const [manualContext, setManualContext] = useState('');
  const [listeningMode, setListeningMode] = useState<ListeningMode>(null);
  const [autoCoach, setAutoCoach] = useState(true);
  const [coaching, setCoaching] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [coach, setCoach] = useState<LiveCoachResult | null>(null);
  const [history, setHistory] = useState<Escalation[]>([]);
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioHealth, setAudioHealth] = useState<AudioHealth>('idle');
  const [audioHelp, setAudioHelp] = useState('Capture a Quo/OpenPhone tab and check Share tab audio.');

  const listening = listeningMode !== null;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const shouldRestartRef = useRef(false);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const transcriptionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastAnalyzedRef = useRef('');
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioMeterFrameRef = useRef<number | null>(null);
  const quietFrameCountRef = useRef(0);

  const stopAudioMeter = () => {
    if (audioMeterFrameRef.current !== null) {
      cancelAnimationFrame(audioMeterFrameRef.current);
      audioMeterFrameRef.current = null;
    }

    if (audioContextRef.current) {
      void audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }

    quietFrameCountRef.current = 0;
    setAudioLevel(0);
    setAudioHealth('idle');
    setAudioHelp('Capture a Quo/OpenPhone tab and check Share tab audio.');
  };

  const startAudioMeter = (stream: MediaStream, mode: ListeningMode) => {
    stopAudioMeter();

    try {
      const AudioContextConstructor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

      if (!AudioContextConstructor) {
        setAudioHealth('no-audio');
        setAudioHelp('Audio meter is not supported in this browser. Use Chrome or Edge.');
        return;
      }

      const audioContext = new AudioContextConstructor();
      const sourceNode = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      sourceNode.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      audioContextRef.current = audioContext;
      quietFrameCountRef.current = 0;

      const tick = () => {
        analyser.getByteTimeDomainData(data);

        let sum = 0;
        for (let index = 0; index < data.length; index += 1) {
          const centered = data[index] - 128;
          sum += centered * centered;
        }

        const rms = Math.sqrt(sum / data.length);
        const normalized = Math.min(100, Math.round((rms / 42) * 100));
        setAudioLevel(normalized);

        if (normalized >= 6) {
          quietFrameCountRef.current = 0;
          setAudioHealth('hearing');
          setAudioHelp(mode === 'tab-audio'
            ? 'Hearing audio from the selected tab. Keep the Quo/OpenPhone tab open while on the call.'
            : 'Hearing microphone audio.');
        } else {
          quietFrameCountRef.current += 1;
          if (quietFrameCountRef.current > 90) {
            setAudioHealth('quiet');
            setAudioHelp(mode === 'tab-audio'
              ? 'No clear tab audio detected yet. Make sure you selected the Quo/OpenPhone tab, not this app tab, and checked Share tab audio.'
              : 'No clear microphone audio detected yet. Check microphone permissions and input volume.');
          } else {
            setAudioHealth('idle');
            setAudioHelp('Waiting for audio. Speak or play sound in the selected call tab.');
          }
        }

        audioMeterFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      setAudioHealth('no-audio');
      setAudioHelp('Could not start the audio meter. Try Chrome or Edge and capture the call tab again.');
    }
  };


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

  useEffect(() => {
    return () => {
      shouldRestartRef.current = false;
      recognitionRef.current?.abort();
      mediaRecorderRef.current?.state !== 'inactive' && mediaRecorderRef.current?.stop();
      displayStreamRef.current?.getTracks().forEach((track) => track.stop());
      audioStreamRef.current?.getTracks().forEach((track) => track.stop());
      stopAudioMeter();
    };
  }, []);

  const appendTranscript = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setFinalTranscript((current) => `${current}${current.trim() ? '\n' : ''}${clean}`.trimStart());
  };

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

  const stopListening = () => {
    shouldRestartRef.current = false;
    setListeningMode(null);
    setInterimTranscript('');

    try {
      recognitionRef.current?.stop();
    } catch {
      recognitionRef.current?.abort();
    }
    recognitionRef.current = null;

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore recorder stop errors
      }
    }
    mediaRecorderRef.current = null;

    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    audioStreamRef.current = null;
    stopAudioMeter();
  };

  const startMicrophoneListening = () => {
    stopListening();
    setError('');
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setError('Live microphone transcription is not supported in this browser. Use Chrome or Edge, or type/paste the call notes manually.');
      return;
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

      if (finalText.trim()) appendTranscript(finalText);
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
          setListeningMode(null);
        }
      } else {
        setListeningMode(null);
      }
    };

    recognitionRef.current = recognition;
    shouldRestartRef.current = true;
    setListeningMode('microphone');

    try {
      recognition.start();
    } catch (err) {
      shouldRestartRef.current = false;
      setListeningMode(null);
      setError(err instanceof Error ? err.message : 'Could not start microphone.');
    }
  };

  const enqueueTabAudioTranscription = (blob: Blob) => {
    transcriptionQueueRef.current = transcriptionQueueRef.current.then(async () => {
      if (!blob.size) return;
      setTranscribing(true);
      try {
        const text = await transcribeCallAudio(blob);
        appendTranscript(text);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not transcribe tab audio.');
      } finally {
        setTranscribing(false);
      }
    });
  };

  const startTabAudioListening = async () => {
    stopListening();
    setError('');

    if (!canRecordTabAudio()) {
      setError('Tab audio capture is not supported in this browser. Use Chrome or Edge.');
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      });

      const audioTracks = displayStream.getAudioTracks();
      if (!audioTracks.length) {
        displayStream.getTracks().forEach((track) => track.stop());
        setError('No tab audio was shared. Click Capture Tab Audio again, choose the Quo/OpenPhone tab, and make sure Share tab audio is checked.');
        return;
      }

      const audioStream = new MediaStream(audioTracks);
      startAudioMeter(audioStream, 'tab-audio');
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const recorder = new MediaRecorder(audioStream, { mimeType });

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 1200) enqueueTabAudioTranscription(event.data);
      };

      recorder.onerror = () => {
        setError('Tab audio recorder failed. Try starting Capture Tab Audio again.');
      };

      audioTracks.forEach((track) => {
        track.onended = () => stopListening();
      });
      displayStream.getVideoTracks().forEach((track) => {
        track.onended = () => stopListening();
      });

      displayStreamRef.current = displayStream;
      audioStreamRef.current = audioStream;
      mediaRecorderRef.current = recorder;
      setListeningMode('tab-audio');

      recorder.start(7000);
      setCopied('Tab audio capture started. Keep the selected call tab open while talking.');
      window.setTimeout(() => setCopied(''), 2200);
    } catch (err) {
      setListeningMode(null);
      if (err instanceof DOMException && err.name === 'NotAllowedError') {
        setError('Tab audio capture was cancelled or blocked. Try again and select the Quo/OpenPhone tab.');
      } else {
        setError(err instanceof Error ? err.message : 'Could not start tab audio capture.');
      }
    }
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
            Use microphone mode for speaker calls, or tab audio mode when your Quo/OpenPhone call is in the browser and you are wearing headphones.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="rounded-full bg-ga-50 px-3 py-1 font-medium text-ga-800">{memories.length} memories loaded</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">{history.length} cases available</span>
        </div>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">Headphones setup</p>
        <p className="mt-1">
          If you are wearing headphones, use <span className="font-semibold">Capture Tab Audio</span>. Select the Quo/OpenPhone browser tab and check <span className="font-semibold">Share tab audio</span>. This lets the system hear the customer audio from that tab.
        </p>
      </div>

      <Card className="mb-5 border-amber-200">
        <CardContent className="p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">Audio Debug / Quo Test</p>
              <p className="mt-1 text-sm text-slate-600">{audioHelp}</p>
            </div>
            <div className="min-w-[260px]">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                <span>{listeningMode === 'tab-audio' ? 'Tab audio level' : listeningMode === 'microphone' ? 'Mic level' : 'Audio level'}</span>
                <span className={
                  audioHealth === 'hearing'
                    ? 'text-emerald-700'
                    : audioHealth === 'quiet' || audioHealth === 'no-audio'
                      ? 'text-red-700'
                      : 'text-slate-500'
                }>
                  {audioHealth === 'hearing'
                    ? 'Hearing audio'
                    : audioHealth === 'quiet'
                      ? 'No clear audio'
                      : audioHealth === 'no-audio'
                        ? 'Audio meter unavailable'
                        : 'Waiting'}
                </span>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-150 ${
                    audioHealth === 'hearing'
                      ? 'bg-emerald-500'
                      : audioHealth === 'quiet' || audioHealth === 'no-audio'
                        ? 'bg-red-400'
                        : 'bg-amber-400'
                  }`}
                  style={{ width: `${Math.max(4, audioLevel)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Quick test: play audio in the Quo/OpenPhone tab. If this bar does not move, the system is not receiving that tab audio yet.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2"><PhoneCall className="h-5 w-5 text-ga-700" /> Call controls</CardTitle>
                  <CardDescription>Choose the audio source, then the AI will coach from the transcript.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {listening ? (
                    <Button variant="danger" onClick={stopListening} leftIcon={<MicOff className="h-4 w-4" />}>
                      Stop {listeningMode === 'tab-audio' ? 'Tab Audio' : 'Mic'}
                    </Button>
                  ) : (
                    <>
                      <Button onClick={startMicrophoneListening} leftIcon={<Mic className="h-4 w-4" />}>Use Microphone</Button>
                      <Button variant="secondary" onClick={startTabAudioListening} leftIcon={<MonitorUp className="h-4 w-4" />}>Capture Tab Audio</Button>
                    </>
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
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="live-source">Source</Label>
                  <Select id="live-source" value={source} onChange={(event) => setSource(event.target.value)} options={['Quo', 'HomeWorks', 'Gmail', 'Other']} />
                </div>
                <div>
                  <Label htmlFor="live-topic">Topic</Label>
                  <Select id="live-topic" value={topic} onChange={(event) => setTopic(event.target.value)} options={DEFAULT_TOPICS} />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className={`rounded-2xl border p-4 text-sm ${listeningMode === 'microphone' ? 'border-ga-300 bg-ga-50 text-ga-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  <div className="mb-1 flex items-center gap-2 font-semibold"><Mic className="h-4 w-4" /> Microphone Mode</div>
                  <p>Use this if the customer is on speaker or your mic can hear both sides.</p>
                </div>
                <div className={`rounded-2xl border p-4 text-sm ${listeningMode === 'tab-audio' ? 'border-blue-300 bg-blue-50 text-blue-900' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
                  <div className="mb-1 flex items-center gap-2 font-semibold"><Volume2 className="h-4 w-4" /> Tab Audio Mode</div>
                  <p>Use this for Quo/OpenPhone browser calls while wearing headphones.</p>
                </div>
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
                {transcribing ? <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-blue-600">Transcribing tab audio...</p> : null}
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
                  Start microphone or capture tab audio, then click <span className="font-semibold text-slate-900">Coach Now</span>. If Auto Coach is on, suggestions will refresh as the transcript grows.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-ga-700" /> How to use with headphones</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>Open the Quo/OpenPhone call in a Chrome or Edge browser tab.</p>
              <p>Click <span className="font-semibold text-slate-900">Capture Tab Audio</span>, choose the Quo/OpenPhone tab, not the Green Acres tab, and check <span className="font-semibold text-slate-900">Share tab audio</span>.</p>
              <p>Watch the Audio Debug meter. If it says <span className="font-semibold text-slate-900">Hearing audio</span>, the system is receiving sound from the call tab.</p>
              <p>If the meter does not move, stop capture and try again. Make sure the selected tab is not muted and that audio is actually playing in that tab.</p>
              <p>For simple calls, turn Auto Coach off and only click Coach Now when needed to save tokens.</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
