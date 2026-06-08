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
import { getLiveTurnCoach, type LiveTurnCoachResult } from '@/services/liveTurnCoach';
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

type InstantSuggestion = {
  say: string;
  ask: string;
  warning: string;
  decision: LiveCoachResult['decision'];
};

function getInstantSuggestion(transcript: string): InstantSuggestion {
  const text = transcript.toLowerCase();

  if (!transcript.trim()) {
    return {
      decision: 'Need more info first',
      say: 'Hi, this is Carl with Green Acres. I can help gather the details first so we can review the best next step.',
      ask: 'Can I get your name, property address, service needed, and a quick description of what is going on?',
      warning: 'Do not promise pricing, timing, or a Bradley call until details are reviewed.'
    };
  }

  if (/(call me|call back|phone call|speak with bradley|talk to bradley|can bradley call|have bradley call)/i.test(text)) {
    return {
      decision: 'Needs Bradley',
      say: 'I understand. I’ll document what happened and flag this for Bradley to review before we confirm the next step.',
      ask: 'What is the best phone number and what is the main thing you want Bradley to review?',
      warning: 'Do not promise Bradley will call at a specific time unless Bradley already confirmed.'
    };
  }

  if (/(angry|upset|frustrated|not happy|complaint|unacceptable|did not finish|not finished|no show|crew did not|wrong|damage|broken)/i.test(text)) {
    return {
      decision: 'Needs Bradley',
      say: 'I’m sorry about that. I’ll make a clear note of what happened and get this reviewed internally so we handle it correctly.',
      ask: 'Can you tell me exactly what happened and, if possible, send a photo or short video of the area?',
      warning: 'Customer-sensitive issue. Do not blame the crew or promise a fix before Bradley reviews.'
    };
  }

  if (/(price|pricing|quote|estimate|how much|cost|charge|invoice|payment|pay|card|refund|discount|credit)/i.test(text)) {
    return {
      decision: 'Needs Bradley',
      say: 'I can help collect the details first so we can review the right pricing or payment next step before confirming anything.',
      ask: 'Can you confirm the property address, scope, and send photos or a short video if this is for an estimate?',
      warning: 'Do not quote pricing or send payment links when pricing/invoice status is unclear.'
    };
  }

  if (/(cleanup|clean up|mulch|weeding|weed|trimming|bush|plant|bed|landscape|project)/i.test(text)) {
    return {
      decision: 'Carl can handle',
      say: 'For cleanup or project work, I can gather the details and photos first. Our project schedule is currently booked out, so I’ll make sure we set the right expectation.',
      ask: 'Can you send photos or video of the area, your property address, and your ideal timing?',
      warning: 'Use the fully-booked project-work SOP if this is cleanup/mulch/weeding/bed work. Do not promise an immediate visit.'
    };
  }

  if (/(mow|mowing|lawn|grass|turf|fertilizer|treatment)/i.test(text)) {
    return {
      decision: 'Need more info first',
      say: 'I can help gather the lawn details and check the best next step internally.',
      ask: 'Can you confirm the property address, lawn concern, and whether you are asking about mowing or the turf program?',
      warning: 'Mowing/turf can be different from cleanup project scheduling. Do not apply the cleanup fully-booked message automatically.'
    };
  }

  if (/(hoa|commercial|business|apartment|condo|multiple locations|property manager)/i.test(text)) {
    return {
      decision: 'Needs Bradley',
      say: 'Thanks for explaining. I’ll collect the details and flag this for Bradley because commercial or HOA-type requests need owner review.',
      ask: 'Can you send the property addresses, scope, frequency, and the best contact information?',
      warning: 'Commercial/HOA leads should be escalated.'
    };
  }

  return {
    decision: 'Need more info first',
    say: 'Got it. I’ll gather the details first so we can decide the correct next step without overpromising.',
    ask: 'Can you confirm the property address, photos or video if relevant, timeline, and the best contact information?',
    warning: 'If you are not 100% sure, collect details and escalate instead of promising.'
  };
}

function findRelevantMemory(transcript: string, memories: AIMemory[]) {
  const text = transcript.toLowerCase();
  if (!text.trim()) return null;

  const scored = memories
    .filter((memory) => memory.is_active)
    .map((memory) => {
      const haystack = `${memory.title} ${memory.summary} ${(memory.tags ?? []).join(' ')}`.toLowerCase();
      let score = 0;

      for (const token of text.split(/[^a-z0-9]+/).filter((word) => word.length > 3)) {
        if (haystack.includes(token)) score += 1;
      }

      if (/(cleanup|clean up|mulch|weeding|trimming|project|plant|bed)/i.test(text) && /(cleanup|mulch|weeding|trimming|project|fully booked|june)/i.test(haystack)) score += 8;
      if (/(payment|invoice|card|auto pay|automatic payment)/i.test(text) && /(payment|invoice|card|homeworks)/i.test(haystack)) score += 8;
      if (/(mow|mowing|turf|fertilizer|weed control)/i.test(text) && /(mow|mowing|turf|fertilizer|weed control)/i.test(haystack)) score += 6;
      if (/(complaint|upset|frustrated|damage|not finished|call me)/i.test(text) && /(complaint|call|damage|bradley|escalate)/i.test(haystack)) score += 6;

      return { memory, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.memory ?? null;
}

function getMemoryBasedSuggestion(transcript: string, memories: AIMemory[]) {
  const memory = findRelevantMemory(transcript, memories);
  if (!memory) return null;

  return {
    title: memory.title,
    summary: memory.summary,
    tags: memory.tags ?? []
  };
}

type CallStage = {
  label: string;
  step: string;
  say: string;
  ask: string;
  endCall: string;
};

function getCustomerLines(transcript: string) {
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^customer\s*:/i.test(line));
}

function getLatestCustomerText(transcript: string) {
  const customerLines = getCustomerLines(transcript);
  const latest = customerLines.at(-1) || transcript.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || '';
  return latest.replace(/^customer\s*:\s*/i, '').trim();
}

function getCallStage(transcript: string): CallStage {
  const text = transcript.toLowerCase();
  const latestCustomerText = getLatestCustomerText(transcript);
  const latest = latestCustomerText.toLowerCase();

  const hasName = /(name is|my name|this is|i'm|i am|customer:)/i.test(transcript) || /\b[A-Z][a-z]+\s+[A-Z][a-z]+\b/.test(transcript);
  const hasAddress = /\b\d{2,6}\s+[a-z0-9 .'-]+\s+(street|st|drive|dr|road|rd|lane|ln|court|ct|avenue|ave|way|circle|cir|place|pl|boulevard|blvd)\b/i.test(transcript);
  const hasPhotos = /(photo|photos|picture|pictures|video|screenshot|sent)/i.test(text) && !/(can't send|cannot send|can not send|unable to send|no photo|no photos|won't send|dont have photo|don't have photo)/i.test(latest);
  const latestIsVisitRequest = /(come here|come to my house|come over|come out|visit|look at it in person|see it in person|site visit|in person)/i.test(latest);
  const customerCannotSendPhotos = /(can't send|cannot send|can not send|unable to send|no photo|no photos|won't send|dont have photo|don't have photo)/i.test(latest);
  const hasTimeline = /(today|tomorrow|this week|next week|asap|soon|urgent|deadline|when|timing|schedule|flexible|no rush)/i.test(text);
  const hasAccess = /(gate|pet|dog|access|fence|locked|parking|backyard|front yard|no gate|no pets|no dog)/i.test(text);
  const wantsEstimate = /(estimate|quote|how much|cost|price|pricing)/i.test(text);
  const projectWork = /(cleanup|clean up|mulch|weeding|weed|trimming|bush|plant|bed|project|landscape)/i.test(text);
  const callRisk = /(call me|call back|bradley|complaint|upset|frustrated|damage|not finished|wrong|refund|discount|credit)/i.test(text);
  const missingBasics = [
    !hasName ? 'full name' : '',
    !hasAddress ? 'property address' : '',
    !hasTimeline ? 'timeline' : '',
    !hasAccess ? 'access notes' : ''
  ].filter(Boolean);

  if (!text.trim()) {
    return {
      label: 'Step 1',
      step: 'Open the call',
      say: 'Hi, this is Carl with Green Acres. How can I help you today?',
      ask: 'Let the customer explain first. Do not interrupt unless needed.',
      endCall: 'Not yet. Start by understanding the request.'
    };
  }

  // This must come before generic estimate/photo logic so the coach responds to the latest customer answer.
  if ((wantsEstimate || projectWork) && latestIsVisitRequest) {
    return {
      label: 'Visit Request',
      step: 'Do not promise a visit',
      say: 'I understand. I can note that you prefer someone to look at it in person, but I cannot promise a visit or timing on this call. I’ll document the request and review the best next step internally.',
      ask: 'Can you briefly describe the area and what needs to be done so I can include that in the notes?',
      endCall: 'Yes, you can end after confirming you will document the visit request and review internally. Escalate to Bradley if a site visit, timing, or pricing decision is needed.'
    };
  }

  if ((wantsEstimate || projectWork) && customerCannotSendPhotos) {
    const stillMissing = [
      !hasName ? 'Can I get your full name for the notes?' : '',
      !hasTimeline ? 'Is there a specific timeline or deadline you are hoping for?' : '',
      !hasAccess ? 'Are there any gate, pet, access, or parking notes we should know about?' : ''
    ].filter(Boolean).join('\n');

    return {
      label: 'Photo Issue',
      step: 'Customer cannot send photos',
      say: 'No problem. Photos usually help us review the scope faster, but I can still collect the details and review the best next step internally.',
      ask: stillMissing || 'Can you describe the area as clearly as possible, including the size, what needs to be done, and whether there are any access issues?',
      endCall: 'End after collecting the remaining details and tell them you will review internally. If a visit or pricing decision is needed, escalate to Bradley instead of promising a visit.'
    };
  }

  if (callRisk) {
    return {
      label: 'Escalate',
      step: 'Protect the call',
      say: 'I understand. I’ll make a clear note of this and have it reviewed internally so we handle it correctly.',
      ask: 'Can you tell me exactly what happened, the best call-back number, and any photo or detail that would help Bradley review it?',
      endCall: 'End after you have the issue summary, call-back number, and any evidence/photos. Do not promise Bradley will call at a specific time.'
    };
  }

  if (wantsEstimate && (!hasAddress || !hasPhotos || missingBasics.length)) {
    const questions = [
      !hasName ? 'Can I get your full name?' : '',
      !hasAddress ? 'What is the property address?' : '',
      !hasPhotos ? 'Can you send photos or a short video of the area?' : '',
      !hasTimeline ? 'Is there a specific timeline or deadline you are hoping for?' : '',
      !hasAccess ? 'Are there any gate, pet, access, or parking notes we should know about?' : ''
    ].filter(Boolean).join('\n');

    return {
      label: 'Estimate Intake',
      step: 'Collect only missing estimate details',
      say: 'Got it. I’ll collect the remaining details so we can review the estimate request properly.',
      ask: questions || 'I have the main details. Is there anything unusual about the property access, pets, gates, or timing?',
      endCall: 'End the call only after the missing details are collected or you have explained that you will review internally.'
    };
  }

  if (wantsEstimate) {
    return {
      label: 'Estimate Ready',
      step: 'Confirm and close the call',
      say: 'Thank you. I have the key details. I’ll review this internally so we can confirm the best next step.',
      ask: 'Before we hang up, is there anything unusual about the property access, pets, gates, or timing that we should know?',
      endCall: 'Yes, you can end after confirming the final access/timing details and telling them you will follow up.'
    };
  }

  if (projectWork) {
    const questions = [
      !hasAddress ? 'What is the property address?' : '',
      !hasPhotos ? 'Can you send photos or a short video of the area?' : '',
      !hasTimeline ? 'Do you have a specific deadline or are you flexible on timing?' : '',
      !hasAccess ? 'Any gate, pet, or access notes?' : ''
    ].filter(Boolean).join('\n');

    return {
      label: 'Project Work',
      step: 'Set project-work expectation',
      say: 'For cleanup or project work, I can gather the remaining details first and set the right expectation before promising timing.',
      ask: questions || 'Confirm if they are okay with reconnecting later or if timing is urgent.',
      endCall: 'End after setting expectation and collecting the missing details. Escalate if timing is urgent, customer is upset, scope/pricing is unusual, or you are not sure.'
    };
  }

  if (/(mow|mowing|lawn|grass|turf|fertilizer|weed control)/i.test(text)) {
    return {
      label: 'Lawn / Turf',
      step: 'Separate mowing vs turf',
      say: 'I can help with that. I just want to confirm whether you are asking about regular mowing or the turf program like fertilizer and weed control.',
      ask: [
        !hasAddress ? 'What is the property address?' : '',
        'Are you looking for mowing, turf treatments, or both?',
        !hasTimeline ? 'When would you like service to start?' : ''
      ].filter(Boolean).join('\n'),
      endCall: 'End after confirming service type, address, and timing. If pricing or scope is unclear, escalate to Bradley.'
    };
  }

  return {
    label: 'Info Gathering',
    step: 'Clarify the request',
    say: 'Got it. I’ll gather the details first so we can decide the correct next step without overpromising.',
    ask: [
      !hasName ? 'Can I get your full name?' : '',
      !hasAddress ? 'What is the property address?' : '',
      'What service are you looking for?',
      !hasTimeline ? 'Do you have a target timeline?' : '',
      !hasAccess ? 'Any access notes, gates, pets, or parking issues?' : ''
    ].filter(Boolean).join('\n'),
    endCall: 'End once the basic intake is complete and you have told them you will review internally and follow up.'
  };
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
  const [turnCoach, setTurnCoach] = useState<LiveTurnCoachResult | null>(null);
  const [turnCoaching, setTurnCoaching] = useState(false);
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
  const lastTurnCoachedRef = useRef('');
  const transcriptBoxRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioMeterFrameRef = useRef<number | null>(null);
  const quietFrameCountRef = useRef(0);
  const latestAudioLevelRef = useRef(0);
  const latestAudioHealthRef = useRef<AudioHealth>('idle');
  const transcribeErrorCountRef = useRef(0);

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
    transcribeErrorCountRef.current = 0;
    latestAudioLevelRef.current = 0;
    latestAudioHealthRef.current = 'idle';
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
        latestAudioLevelRef.current = normalized;
        setAudioLevel(normalized);

        if (normalized >= 3) {
          quietFrameCountRef.current = 0;
          latestAudioHealthRef.current = 'hearing';
          setAudioHealth('hearing');
          setAudioHelp(mode === 'tab-audio'
            ? 'Hearing audio from the selected tab. Keep the Quo/OpenPhone tab open while on the call.'
            : 'Hearing microphone audio.');
        } else {
          quietFrameCountRef.current += 1;
          if (quietFrameCountRef.current > 90) {
            latestAudioHealthRef.current = 'quiet';
            setAudioHealth('quiet');
            setAudioHelp(mode === 'tab-audio'
              ? 'No clear tab audio detected yet. Make sure you selected the Quo/OpenPhone tab, not this app tab, and checked Share tab audio.'
              : 'No clear microphone audio detected yet. Check microphone permissions and input volume.');
          } else {
            latestAudioHealthRef.current = 'idle';
            setAudioHealth('idle');
            setAudioHelp('Waiting for audio. Speak or play sound in the selected call tab.');
          }
        }

        audioMeterFrameRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      latestAudioHealthRef.current = 'no-audio';
      setAudioHealth('no-audio');
      setAudioHelp('Could not start the audio meter. Try Chrome or Edge and capture the call tab again.');
    }
  };


  const transcript = useMemo(() => {
    return [manualContext.trim(), finalTranscript.trim(), interimTranscript.trim() ? `[listening] ${interimTranscript.trim()}` : '']
      .filter(Boolean)
      .join('\n');
  }, [manualContext, finalTranscript, interimTranscript]);

  const instantSuggestion = useMemo(() => getInstantSuggestion(transcript), [transcript]);
  const memorySuggestion = useMemo(() => getMemoryBasedSuggestion(transcript, memories), [transcript, memories]);
  const callStage = useMemo(() => getCallStage(transcript), [transcript]);
  const latestCustomerLine = useMemo(() => getLatestCustomerText(transcript), [transcript]);
  const hasLiveCustomerLine = latestCustomerLine.trim().length > 0;

  const requestTurnCoaching = async (force = false) => {
    const cleanTranscript = transcript.trim();
    const latestLine = getLatestCustomerText(cleanTranscript);
    if (!cleanTranscript || !latestLine) return;
    if (!force && latestLine === lastTurnCoachedRef.current) return;

    lastTurnCoachedRef.current = latestLine;
    setTurnCoaching(true);
    setError('');

    try {
      const nextTurnCoach = await getLiveTurnCoach({
        transcript: cleanTranscript,
        latestCustomerLine: latestLine,
        source,
        topic,
        memories,
        history
      });
      setTurnCoach(nextTurnCoach);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Live turn coach failed.');
    } finally {
      setTurnCoaching(false);
    }
  };


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
    if (transcript.trim().length < 25) return;

    const timer = window.setTimeout(() => {
      void requestCoaching(false);
    }, 1500);

    return () => window.clearTimeout(timer);
  }, [transcript, autoCoach, listening, contextLoading]);

  useEffect(() => {
    if (!autoCoach || contextLoading) return;
    if (transcript.trim().length < 8) return;

    const timer = window.setTimeout(() => {
      void requestTurnCoaching(false);
    }, listening ? 900 : 250);

    return () => window.clearTimeout(timer);
  }, [transcript, autoCoach, listening, contextLoading]);

  useEffect(() => {
    if (!autoCoach || !listening || contextLoading) return;

    const interval = window.setInterval(() => {
      if (transcript.trim().length >= 25) void requestCoaching(false);
    }, 12000);

    return () => window.clearInterval(interval);
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
        transcribeErrorCountRef.current = 0;

        if (text.trim()) {
          appendTranscript(text);
          setError('');
          setAudioHelp('Transcription received. Keep the Quo/OpenPhone tab open while talking.');
        } else {
          setAudioHelp('Audio was received, but no clear speech was detected in that chunk. Keep talking or click Coach Now after more transcript appears.');
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not transcribe tab audio.';
        const lower = message.toLowerCase();
        const isRecoverableAudioChunk =
          lower.includes('corrupted') ||
          lower.includes('unsupported') ||
          lower.includes('invalid file') ||
          lower.includes('no speech') ||
          lower.includes('no usable audio') ||
          lower.includes('audio too short');

        transcribeErrorCountRef.current += 1;

        if (isRecoverableAudioChunk) {
          setAudioHelp('Skipped one noisy/silent audio chunk. This is normal on longer calls. Keep the tab capture running.');
          if (transcribeErrorCountRef.current >= 4) {
            setError('Several audio chunks could not be transcribed. Stop and start Capture Tab Audio again if no transcript appears.');
          }
        } else {
          setError(message);
        }
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
        if (!event.data || event.data.size < 2000) return;

        if (latestAudioHealthRef.current !== 'hearing' && latestAudioLevelRef.current < 3) {
          setAudioHelp('Audio is weak, but I am still trying to transcribe it. If no transcript appears, re-share the Messenger/Quo tab and make sure Share tab audio is checked.');
        }

        enqueueTabAudioTranscription(event.data);
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

      recorder.start(6000);
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

  const addCustomerSaidAndCoach = () => {
    const clean = manualContext.trim();
    if (!clean) {
      setError('Type latest customer line first.');
      return;
    }

    appendTranscript(`Customer: ${clean}`);
    setManualContext('');
    window.setTimeout(() => {
      void requestTurnCoaching(true);
      void requestCoaching(true);
    }, 250);
  };

  const clearCall = () => {
    stopListening();
    setFinalTranscript('');
    setInterimTranscript('');
    setManualContext('');
    setCoach(null);
    setTurnCoach(null);
    setError('');
    setCopied('');
    lastAnalyzedRef.current = '';
    lastTurnCoachedRef.current = '';
    transcribeErrorCountRef.current = 0;
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
            Simple live answer coach. It listens to the customer, then shows the exact line Carl can read next. If audio does not transcribe, type the latest customer line and click Add + Coach.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="rounded-full bg-ga-50 px-3 py-1 font-medium text-ga-800">{memories.length} memories loaded</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">{history.length} cases available</span>
        </div>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <Card className="mb-5 border-ga-200">
        <CardContent className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-ga-700">Live call flow</p>
              <h2 className="mt-1 text-xl font-bold text-slate-950">Read only the right-side coach box while talking.</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                The coach will tell you what to say, what to ask next, and when it is safe to end the call. It uses SOP, AI Memory, and the transcript.
              </p>
            </div>
            <Button type="button" onClick={startTabAudioListening} disabled={listening} leftIcon={<MonitorUp className="h-4 w-4" />}>
              Start Live Answer
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="mb-5 rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <p className="font-semibold">How to connect the call audio</p>
        <p className="mt-1">
          Click <span className="font-semibold">Start Call Audio</span>, choose the Quo/OpenPhone call tab, then check <span className="font-semibold">Share tab audio</span>. If it fails, type what the customer said and click Add + Coach.
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
                Quick test: play audio in the Quo/OpenPhone tab. If this bar does not move, the system is not receiving that tab audio yet. Occasional skipped/corrupted chunks on long calls are okay.
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
                  <CardTitle className="flex items-center gap-2"><PhoneCall className="h-5 w-5 text-ga-700" /> Live input</CardTitle>
                  <CardDescription>Best: Start Call Audio and share the Quo/OpenPhone tab audio. Backup: type only the latest thing customer said, then Add + Coach.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  {listening ? (
                    <Button variant="danger" onClick={stopListening} leftIcon={<MicOff className="h-4 w-4" />}>
                      Stop {listeningMode === 'tab-audio' ? 'Tab Audio' : 'Mic'}
                    </Button>
                  ) : (
                    <>
                      <Button onClick={startMicrophoneListening} leftIcon={<Mic className="h-4 w-4" />}>Mic / Speaker</Button>
                      <Button variant="secondary" onClick={startTabAudioListening} leftIcon={<MonitorUp className="h-4 w-4" />}>Start Call Audio</Button>
                    </>
                  )}
                  <Button variant={autoCoach ? 'warning' : 'secondary'} onClick={() => setAutoCoach((current) => !current)} leftIcon={<Radio className="h-4 w-4" />}>
                    {autoCoach ? 'Auto Coach On' : 'Auto Coach Off'}
                  </Button>
                  <Button variant="secondary" onClick={() => { void requestTurnCoaching(true); void requestCoaching(true); }} disabled={coaching || turnCoaching || contextLoading} leftIcon={coaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}>
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
                  <p>Best live mode. Use this for Quo/OpenPhone browser calls while wearing headphones.</p>
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <Label htmlFor="manual-context">Type latest customer line</Label>
                  <Button type="button" size="sm" variant="secondary" onClick={addCustomerSaidAndCoach} leftIcon={<Sparkles className="h-4 w-4" />}>
                    Add + Coach
                  </Button>
                </div>
                <Textarea
                  id="manual-context"
                  value={manualContext}
                  onChange={(event) => setManualContext(event.target.value)}
                  placeholder="Example: Customer said, I cannot send photos, can someone come here instead?"
                  className="min-h-[90px]"
                />
              </div>

              <div ref={transcriptBoxRef} className="min-h-[320px] max-h-[420px] overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-800">
                {finalTranscript ? <span className="whitespace-pre-wrap">{finalTranscript}</span> : <span className="text-slate-400">Transcript appears here. Every new customer line should update the Live Answer on the right.</span>}
                {interimTranscript ? <span className="whitespace-pre-wrap text-slate-500"> {interimTranscript}</span> : null}
                {transcribing ? <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-blue-600">Transcribing tab audio...</p> : null}
              </div>
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6">
          <Card className="overflow-hidden border-ga-200">
            <CardHeader className="bg-ga-950 text-white">
              <CardTitle className="flex items-center gap-2 text-white"><Sparkles className="h-5 w-5" /> Live Coach</CardTitle>
              <CardDescription className="text-ga-100">Shows the next line to say based on the latest customer message.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <Badge tone={decisionTone(turnCoach?.decision || (callStage.label === 'Escalate' ? 'Needs Bradley' : instantSuggestion.decision))}>
                    {hasLiveCustomerLine ? (turnCoach?.stage || callStage.label) : 'Waiting for customer'}
                  </Badge>
                  <Badge tone="green">{turnCoaching ? 'Updating...' : hasLiveCustomerLine ? 'Live answer' : 'No transcript yet'}</Badge>
                </div>

                {latestCustomerLine ? (
                  <div className="mb-3 rounded-xl border border-emerald-200 bg-white/70 px-3 py-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Latest customer said</p>
                    <p className="mt-1 text-sm leading-5 text-slate-800">{latestCustomerLine}</p>
                  </div>
                ) : null}

                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Say this now</p>
                <p className="mt-1 whitespace-pre-wrap text-base font-bold leading-7 text-emerald-950">{hasLiveCustomerLine ? (turnCoach?.sayThisNow || callStage.say) : 'Waiting for the customer audio or typed customer line. If this stays here, the system is not receiving/transcribing the call yet.'}</p>

                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-emerald-700">Ask next</p>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-emerald-900">{hasLiveCustomerLine ? (turnCoach?.askNext || callStage.ask) : 'Use Start Call Audio and select the Messenger/Quo tab with Share tab audio checked. Or type the latest thing the customer said and click Add + Coach.'}</p>

                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-blue-700">Can I end the call?</p>
                <p className="mt-1 text-sm leading-6 text-blue-900">{hasLiveCustomerLine ? (turnCoach?.canEndCall || callStage.endCall) : 'Not yet. Wait until the coach sees the customer message or type it manually.'}</p>

                <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-red-700">Careful</p>
                <p className="mt-1 text-sm leading-6 text-red-800">{hasLiveCustomerLine ? (turnCoach?.warning || instantSuggestion.warning) : 'Do not rely on the coach until a transcript appears or you type the customer line.'}</p>

                <Button className="mt-3" size="sm" variant="secondary" onClick={() => copy(hasLiveCustomerLine ? (turnCoach?.sayThisNow || callStage.say) : '', 'Current line copied.')} leftIcon={<Clipboard className="h-4 w-4" />}>
                  Copy line
                </Button>
              </div>

              {memorySuggestion ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">AI Memory matched</p>
                  <p className="mt-1 text-sm font-semibold text-amber-950">{memorySuggestion.title}</p>
                  <p className="mt-2 max-h-32 overflow-y-auto whitespace-pre-wrap text-xs leading-5 text-amber-900">{memorySuggestion.summary}</p>
                </div>
              ) : null}

              {coach ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={decisionTone(coach.decision)}>{coach.decision}</Badge>
                    <Badge tone="blue">OpenAI confidence: {coach.confidence}</Badge>
                  </div>

                  <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4">
                    <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">OpenAI refined line</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-6 text-blue-950">{coach.sayThisNext}</p>
                    <Button className="mt-3" size="sm" variant="secondary" onClick={() => copy(coach.sayThisNext, 'Suggested response copied.')} leftIcon={<Clipboard className="h-4 w-4" />}>
                      Copy refined line
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
                  The green Live Suggestion updates immediately from the latest transcript. Click <span className="font-semibold text-slate-900">Coach Now</span> for a deeper OpenAI/SOP review when needed.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><RefreshCw className="h-5 w-5 text-ga-700" /> How to use live coach</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>For live coaching while wearing headphones, use Start Customer Audio and select the Quo/OpenPhone browser tab.</p>
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
