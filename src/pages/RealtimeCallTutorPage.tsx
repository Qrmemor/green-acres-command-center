import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clipboard,
  FileText,
  ImagePlus,
  Loader2,
  Mic,
  MicOff,
  MonitorUp,
  PauseCircle,
  PlayCircle,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Trash2,
  UploadCloud,
  Volume2,
  X
} from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { getRealtimeTutorReply, transcribeTutorAudio, type RealtimeTutorResult } from '@/services/realtimeCallTutor';

type TutorFileStatus = 'ready' | 'processing' | 'processed' | 'error';
type TutorFile = {
  id: string;
  name: string;
  type: string;
  size: number;
  text: string;
  status: TutorFileStatus;
  error?: string;
};

type TranscriptEntry = {
  id: string;
  speaker: 'Customer' | 'You' | 'Manual';
  text: string;
  createdAt: string;
};

type ListeningMode = 'microphone' | 'tab-audio' | null;
type AudioHealth = 'idle' | 'hearing' | 'quiet' | 'no-audio';

const MAX_FILE_SIZE = 12 * 1024 * 1024;

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function extractPlainTextFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_FILE_SIZE) {
      reject(new Error('File is too large. Max file size is 12 MB.'));
      return;
    }

    const reader = new FileReader();
    const lowerName = file.name.toLowerCase();

    reader.onerror = () => reject(new Error('Could not read file.'));

    if (file.type.startsWith('text/') || /\.(txt|md|csv|json|rtf)$/i.test(lowerName)) {
      reader.onload = () => resolve(String(reader.result || '').trim());
      reader.readAsText(file);
      return;
    }

    // Browser-only fallback for PDF/DOCX/images:
    // This keeps the feature working without exposing API keys. The text can be improved by pasting SOP text
    // or using TXT exports. The AI will still use file name/type metadata and any extracted text.
    reader.onload = () => {
      resolve(`[Uploaded file: ${file.name}]
Type: ${file.type || 'unknown'}
Size: ${formatSize(file.size)}

Text extraction note:
This browser build can directly read TXT/CSV/MD/JSON files. For PDF, DOCX, and image files, paste the important SOP text into a TXT file or add it manually in the document notes until server-side OCR/parsing is added.`);
    };
    reader.readAsArrayBuffer(file);
  });
}

function getStatusTone(status: TutorFileStatus): 'green' | 'red' | 'amber' | 'blue' | 'slate' {
  if (status === 'processed') return 'green';
  if (status === 'processing') return 'blue';
  if (status === 'error') return 'red';
  return 'slate';
}

function canRecordTabAudio() {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia) && typeof MediaRecorder !== 'undefined';
}

function buildKnowledge(files: TutorFile[]) {
  return files
    .filter((file) => file.status === 'processed' && file.text.trim())
    .map((file) => `DOCUMENT: ${file.name}\n${file.text}`)
    .join('\n\n---\n\n')
    .slice(0, 55000);
}

function buildTranscript(entries: TranscriptEntry[]) {
  return entries.map((entry) => `[${formatTime(entry.createdAt)}] ${entry.speaker}: ${entry.text}`).join('\n');
}

export function RealtimeCallTutorPage() {
  const [files, setFiles] = useState<TutorFile[]>([]);
  const [sessionActive, setSessionActive] = useState(false);
  const [paused, setPaused] = useState(false);
  const [listeningMode, setListeningMode] = useState<ListeningMode>(null);
  const [audioHealth, setAudioHealth] = useState<AudioHealth>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [audioHelp, setAudioHelp] = useState('Start a call session, then share microphone or customer tab audio.');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [manualQuestion, setManualQuestion] = useState('');
  const [result, setResult] = useState<RealtimeTutorResult | null>(null);
  const [loadingReply, setLoadingReply] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [consentAccepted, setConsentAccepted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioMeterFrameRef = useRef<number | null>(null);
  const transcriptionQueueRef = useRef<Promise<void>>(Promise.resolve());
  const lastAskedRef = useRef('');

  const knowledgeText = useMemo(() => buildKnowledge(files), [files]);
  const transcriptText = useMemo(() => buildTranscript(transcript), [transcript]);
  const hasKnowledge = knowledgeText.trim().length > 0;
  const activeFileCount = files.filter((file) => file.status === 'processed').length;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript, result, loadingReply]);

  useEffect(() => {
    return () => {
      stopListening();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const copy = async (value: string, label = 'Copied.') => {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(''), 1600);
  };

  const addTranscript = (speaker: TranscriptEntry['speaker'], text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setTranscript((current) => [
      ...current,
      { id: makeId(), speaker, text: clean, createdAt: new Date().toISOString() }
    ]);
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
    setAudioHealth('idle');
    setAudioHelp('Start a call session, then share microphone or customer tab audio.');
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
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);

      const data = new Uint8Array(analyser.fftSize);
      audioContextRef.current = audioContext;
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
          setAudioHealth('hearing');
          setAudioHelp(mode === 'tab-audio' ? 'Hearing customer tab audio.' : 'Hearing microphone audio.');
        } else {
          quietFrames += 1;
          if (quietFrames > 80) {
            setAudioHealth('quiet');
            setAudioHelp(mode === 'tab-audio'
              ? 'No clear tab audio detected. Re-share the customer call tab and check Share tab audio.'
              : 'No clear microphone audio detected. Check mic permissions or input volume.');
          } else {
            setAudioHealth('idle');
            setAudioHelp('Waiting for speech.');
          }
        }

        audioMeterFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      setAudioHealth('no-audio');
      setAudioHelp('Could not start audio meter.');
    }
  };

  const stopListening = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        // ignore
      }
    }

    mediaRecorderRef.current = null;
    displayStreamRef.current?.getTracks().forEach((track) => track.stop());
    audioStreamRef.current?.getTracks().forEach((track) => track.stop());
    displayStreamRef.current = null;
    audioStreamRef.current = null;
    setListeningMode(null);
    stopAudioMeter();
  };

  const processFiles = async (selected: File[]) => {
    setError('');
    const newFiles: TutorFile[] = selected.map((file) => ({
      id: makeId(),
      name: file.name,
      type: file.type || 'unknown',
      size: file.size,
      text: '',
      status: 'processing'
    }));

    setFiles((current) => [...current, ...newFiles]);

    for (let index = 0; index < selected.length; index += 1) {
      const file = selected[index];
      const fileId = newFiles[index].id;

      try {
        const text = await extractPlainTextFromFile(file);
        setFiles((current) => current.map((item) => item.id === fileId ? { ...item, text, status: 'processed' } : item));
      } catch (err) {
        setFiles((current) => current.map((item) => item.id === fileId ? { ...item, status: 'error', error: err instanceof Error ? err.message : 'Could not process file.' } : item));
      }
    }
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await processFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const requestTutorReply = async (latestCustomerText: string, force = false) => {
    const cleanLatest = latestCustomerText.trim();
    if (!cleanLatest) {
      setError('Type what the customer said or start listening first.');
      return;
    }

    if (!force && cleanLatest === lastAskedRef.current) return;
    lastAskedRef.current = cleanLatest;

    setLoadingReply(true);
    setError('');

    try {
      const nextResult = await getRealtimeTutorReply({
        latestCustomerText: cleanLatest,
        transcript: buildTranscript(transcript),
        knowledge: knowledgeText,
        hasKnowledge,
        mode: 'live'
      });
      setResult(nextResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Realtime tutor failed.');
    } finally {
      setLoadingReply(false);
    }
  };

  const enqueueTranscription = (blob: Blob) => {
    transcriptionQueueRef.current = transcriptionQueueRef.current.then(async () => {
      if (!blob.size || paused || !sessionActive) return;

      setTranscribing(true);
      try {
        const text = await transcribeTutorAudio(blob);
        if (text.trim()) {
          addTranscript('Customer', text);
          window.setTimeout(() => void requestTutorReply(text, false), 150);
        }
      } catch (err) {
        setAudioHelp(err instanceof Error ? err.message : 'Could not transcribe audio.');
      } finally {
        setTranscribing(false);
      }
    });
  };

  const startCallSession = () => {
    if (!consentAccepted) {
      setError('Please acknowledge the consent reminder before starting a call session.');
      return;
    }

    setSessionActive(true);
    setPaused(false);
    setError('');
    if (!transcript.length) {
      addTranscript('Manual', 'Call session started.');
    }
  };

  const endCallSession = () => {
    stopListening();
    setSessionActive(false);
    setPaused(false);
    addTranscript('Manual', 'Call session ended.');
  };

  const newSession = () => {
    stopListening();
    setSessionActive(false);
    setPaused(false);
    setTranscript([]);
    setManualQuestion('');
    setResult(null);
    setError('');
    setCopied('');
    lastAskedRef.current = '';
  };

  const startMicrophone = async () => {
    if (!sessionActive) startCallSession();
    if (!consentAccepted) return;

    stopListening();
    setError('');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      startAudioCapture(stream, 'microphone');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start microphone.');
    }
  };

  const startTabAudio = async () => {
    if (!sessionActive) startCallSession();
    if (!consentAccepted) return;

    stopListening();
    setError('');

    if (!canRecordTabAudio()) {
      setError('Tab audio capture is not supported in this browser. Use Chrome or Edge.');
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      const audioTracks = displayStream.getAudioTracks();

      if (!audioTracks.length) {
        displayStream.getTracks().forEach((track) => track.stop());
        setError('No tab audio was shared. Choose the customer call tab and check Share tab audio.');
        return;
      }

      displayStreamRef.current = displayStream;
      const audioStream = new MediaStream(audioTracks);
      startAudioCapture(audioStream, 'tab-audio');

      displayStream.getTracks().forEach((track) => {
        track.onended = () => stopListening();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start tab audio.');
    }
  };

  const startAudioCapture = (stream: MediaStream, mode: ListeningMode) => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });

    audioStreamRef.current = stream;
    mediaRecorderRef.current = recorder;
    setListeningMode(mode);
    startAudioMeter(stream, mode);

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 1500) enqueueTranscription(event.data);
    };

    recorder.onerror = () => {
      setError('Audio recorder failed. Stop and start listening again.');
    };

    stream.getAudioTracks().forEach((track) => {
      track.onended = () => stopListening();
    });

    recorder.start(5000);
  };

  const submitManual = async () => {
    const clean = manualQuestion.trim();
    if (!clean) return;

    if (!sessionActive) startCallSession();
    addTranscript('Customer', clean);
    setManualQuestion('');
    await requestTutorReply(clean, true);
  };

  const transformReply = async (style: 'shorter' | 'professional' | 'taglish') => {
    if (!result?.recommendedReply) return;

    setLoadingReply(true);
    setError('');

    try {
      const nextResult = await getRealtimeTutorReply({
        latestCustomerText: `Rewrite this reply in ${style} style: ${result.recommendedReply}`,
        transcript: buildTranscript(transcript),
        knowledge: knowledgeText,
        hasKnowledge,
        mode: style
      });
      setResult((current) => current ? { ...current, recommendedReply: nextResult.recommendedReply } : nextResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rewrite reply.');
    } finally {
      setLoadingReply(false);
    }
  };

  return (
    <div className="page-shell max-w-7xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">AI CUSTOMER SERVICE</p>
          <h1 className="page-title">Realtime Customer Service Call Tutor</h1>
          <p className="page-subtitle">
            Upload SOPs, start a call session, and read short AI-guided replies based on your documents and current call context.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-full bg-ga-50 px-3 py-1 font-medium text-ga-800">{activeFileCount} processed files</span>
          <span className={`rounded-full px-3 py-1 font-medium ${sessionActive ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
            {sessionActive ? paused ? 'Paused' : 'Call active' : 'No active call'}
          </span>
        </div>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <Card className="mb-5 border-amber-200">
        <CardContent className="flex flex-col gap-3 p-4 text-sm text-amber-900 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-semibold">Consent and privacy reminder</p>
            <p>Call transcription or recording may require customer consent depending on local laws or company policy. This tool only listens after you start a session.</p>
          </div>
          <label className="flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm font-medium shadow-sm">
            <input type="checkbox" checked={consentAccepted} onChange={(event) => setConsentAccepted(event.target.checked)} />
            I understand
          </label>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)_420px]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><PlayCircle className="h-5 w-5 text-ga-700" /> Call Control Panel</CardTitle>
              <CardDescription>Start only when you are ready to listen or type the customer question.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <Button onClick={startCallSession} disabled={sessionActive} leftIcon={<PlayCircle className="h-4 w-4" />}>Start Session</Button>
                <Button variant="secondary" onClick={() => setPaused((current) => !current)} disabled={!sessionActive} leftIcon={<PauseCircle className="h-4 w-4" />}>
                  {paused ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="danger" onClick={endCallSession} disabled={!sessionActive} leftIcon={<MicOff className="h-4 w-4" />}>End Call</Button>
                <Button variant="secondary" onClick={newSession} leftIcon={<RefreshCw className="h-4 w-4" />}>New Session</Button>
              </div>

              <div className="grid gap-2">
                <Button onClick={startTabAudio} disabled={paused || !consentAccepted} leftIcon={<MonitorUp className="h-4 w-4" />}>
                  Listen to Call Tab
                </Button>
                <Button variant="secondary" onClick={startMicrophone} disabled={paused || !consentAccepted} leftIcon={<Mic className="h-4 w-4" />}>
                  Use Microphone
                </Button>
                {listeningMode ? (
                  <Button variant="ghost" onClick={stopListening} leftIcon={<MicOff className="h-4 w-4" />}>Stop Listening</Button>
                ) : null}
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <span>Microphone status</span>
                  <span className={audioHealth === 'hearing' ? 'text-emerald-700' : audioHealth === 'quiet' ? 'text-red-700' : 'text-slate-500'}>
                    {listeningMode ? audioHealth === 'hearing' ? 'Hearing audio' : audioHealth === 'quiet' ? 'No clear audio' : 'Waiting' : 'Off'}
                  </span>
                </div>
                <div className="h-3 overflow-hidden rounded-full bg-slate-200">
                  <div className="h-full rounded-full bg-ga-600 transition-all" style={{ width: `${Math.max(4, audioLevel)}%` }} />
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">{audioHelp}</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><UploadCloud className="h-5 w-5 text-ga-700" /> Document Upload Area</CardTitle>
              <CardDescription>Upload SOPs, scripts, FAQs, policies, templates, and service notes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                accept=".txt,.md,.csv,.json,.pdf,.docx,.doc,.png,.jpg,.jpeg,image/*,text/*"
                onChange={handleFileInput}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex w-full flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition hover:border-ga-400 hover:bg-ga-50"
              >
                <ImagePlus className="mb-3 h-8 w-8 text-ga-700" />
                <span className="font-semibold text-slate-900">Upload SOP files</span>
                <span className="mt-1 text-xs text-slate-500">PDF, DOCX, TXT, image files. TXT gives best extraction in this browser build.</span>
              </button>

              <div className="space-y-2">
                {files.length ? files.map((file) => (
                  <div key={file.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{file.name}</p>
                        <p className="text-xs text-slate-500">{formatSize(file.size)}</p>
                      </div>
                      <button type="button" onClick={() => setFiles((current) => current.filter((item) => item.id !== file.id))} className="rounded-full p-1 text-slate-400 hover:bg-red-50 hover:text-red-600">
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <Badge tone={getStatusTone(file.status)}>{file.status}</Badge>
                      {file.error ? <span className="text-xs text-red-600">{file.error}</span> : null}
                    </div>
                  </div>
                )) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">No files uploaded yet.</div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Volume2 className="h-5 w-5 text-ga-700" /> Live Transcript Panel</CardTitle>
              <CardDescription>Customer and manual messages stay in memory until you start a new session.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[430px] overflow-y-auto rounded-3xl border border-slate-200 bg-slate-50 p-4">
                {transcript.length ? transcript.map((entry) => (
                  <div key={entry.id} className="mb-3 rounded-2xl bg-white p-3 shadow-sm">
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold uppercase tracking-wide text-ga-700">{entry.speaker}</span>
                      <span className="text-slate-400">{formatTime(entry.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-sm leading-6 text-slate-800">{entry.text}</p>
                  </div>
                )) : (
                  <div className="flex h-full items-center justify-center text-center text-sm text-slate-500">
                    Start a session and speak, share tab audio, or type a customer question.
                  </div>
                )}
                {transcribing ? <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">Transcribing audio...</p> : null}
                <div ref={transcriptEndRef} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Manual Question Input</CardTitle>
              <CardDescription>Use this when realtime audio is not available. It continues the same active call session.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={manualQuestion}
                onChange={(event) => setManualQuestion(event.target.value)}
                className="min-h-[110px]"
                placeholder="Type what the customer said, example: I want an estimate but I cannot send photos."
              />
              <div className="flex flex-wrap gap-2">
                <Button onClick={submitManual} disabled={loadingReply} leftIcon={loadingReply ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}>
                  Generate Answer
                </Button>
                <Button variant="secondary" onClick={() => setManualQuestion('')} disabled={!manualQuestion}>Clear</Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="overflow-hidden border-ga-200">
            <CardHeader className="bg-ga-950 text-white">
              <CardTitle className="flex items-center gap-2 text-white"><Sparkles className="h-5 w-5" /> AI Suggested Reply Panel</CardTitle>
              <CardDescription className="text-ga-100">Read this out loud during the call.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {loadingReply ? (
                <div className="rounded-3xl border border-blue-200 bg-blue-50 p-5 text-sm text-blue-800">
                  <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Generating next reply...</span>
                </div>
              ) : result ? (
                <>
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Recommended Reply</p>
                    <p className="mt-2 whitespace-pre-wrap text-lg font-bold leading-8 text-emerald-950">{result.recommendedReply}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Button size="sm" variant="secondary" onClick={() => copy(result.recommendedReply, 'Reply copied.')} leftIcon={<Clipboard className="h-4 w-4" />}>Copy reply</Button>
                      <Button size="sm" variant="ghost" onClick={() => transformReply('shorter')}>Make shorter</Button>
                      <Button size="sm" variant="ghost" onClick={() => transformReply('professional')}>More professional</Button>
                      <Button size="sm" variant="ghost" onClick={() => transformReply('taglish')}>Taglish version</Button>
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Next Step</p>
                      <p className="mt-2 text-sm leading-6 text-slate-800">{result.nextStep}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Escalation Needed</p>
                      <div className="mt-2 flex items-center gap-2">
                        <Badge tone={result.escalationNeeded ? 'red' : 'green'}>{result.escalationNeeded ? 'Yes' : 'No'}</Badge>
                        <span className="text-sm text-slate-700">{result.escalationReason || 'No escalation trigger detected.'}</span>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  The recommended reply will appear here once the customer speaks or you type a question.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5 text-amber-600" /> Coaching Panel</CardTitle>
              <CardDescription>Follow-up questions, missing info, and safety guidance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {result ? (
                <>
                  <div>
                    <p className="mb-2 text-sm font-semibold text-slate-900">Follow-up questions</p>
                    <div className="space-y-2">
                      {result.followUpQuestions.length ? result.followUpQuestions.map((item) => (
                        <div key={item} className="rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{item}</div>
                      )) : <p className="text-sm text-slate-500">No follow-up question needed.</p>}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-sm font-semibold text-slate-900">Missing information</p>
                    <div className="flex flex-wrap gap-2">
                      {result.missingInfo.length ? result.missingInfo.map((item) => <Badge key={item} tone="amber">{item}</Badge>) : <Badge tone="green">Complete enough for now</Badge>}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-red-800"><AlertTriangle className="h-4 w-4" /> Warning</p>
                    <p className="mt-2 text-sm leading-6 text-red-700">{result.warning}</p>
                  </div>

                  <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-blue-900"><CheckCircle2 className="h-4 w-4" /> Source basis</p>
                    <p className="mt-2 text-sm leading-6 text-blue-800">{result.sourceBasis}</p>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-500">
                  Coaching notes will appear after the first customer question.
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
