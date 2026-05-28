import type { AIMemory, Escalation } from '@/types';

export type LiveCoachDecision = 'Carl can handle' | 'Needs Bradley' | 'Need more info first';
export type LiveCoachConfidence = 'High' | 'Medium' | 'Low';

export interface LiveCoachResult {
  summary: string;
  decision: LiveCoachDecision;
  confidence: LiveCoachConfidence;
  sopTriggers: string[];
  missingInfo: string[];
  sayThisNext: string;
  askNext: string[];
  doNotSay: string[];
  callNotes: string;
}

interface LiveCoachPayload {
  transcript: string;
  source: string;
  topic: string;
  memories: AIMemory[];
  history: Escalation[];
}

interface LiveCoachApiResponse {
  ok: boolean;
  result?: LiveCoachResult;
  error?: string;
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function hasMemory(text: string, memories: AIMemory[], keywords: string[]) {
  return memories.some((memory) => {
    const haystack = `${memory.title} ${memory.summary} ${(memory.tags ?? []).join(' ')}`.toLowerCase();
    return keywords.some((keyword) => haystack.includes(keyword)) && keywords.some((keyword) => text.includes(keyword));
  });
}

function trimHistory(history: Escalation[]) {
  return history
    .slice(0, 12)
    .map((item) => ({
      customer_name: item.customer_name,
      source: item.source,
      urgency: item.urgency,
      topic: item.topic,
      situation: item.situation,
      reason_for_escalation: item.reason_for_escalation,
      proposed_next_step: item.proposed_next_step,
      status: item.status,
      bradley_note: item.bradley_note
    }));
}

function localFallbackCoach({ transcript, source, topic, memories }: LiveCoachPayload, error?: string): LiveCoachResult {
  const text = transcript.toLowerCase();
  const sopTriggers: string[] = [];
  const missingInfo: string[] = [];

  if (includesAny(text, ['call me', 'call back', 'phone call', 'talk to bradley', 'can bradley call', 'speak with bradley'])) {
    sopTriggers.push('Customer wants a call');
  }
  if (includesAny(text, ['angry', 'upset', 'frustrated', 'not happy', 'complaint', 'unacceptable'])) {
    sopTriggers.push('Complaint or emotional tone');
  }
  if (includesAny(text, ['refund', 'discount', 'credit', 'money back'])) {
    sopTriggers.push('Refund / discount / credit request');
  }
  if (includesAny(text, ['damage', 'broken', 'safety', 'dangerous', 'injury', 'hurt'])) {
    sopTriggers.push('Property damage or safety issue');
  }
  if (includesAny(text, ['hoa', 'commercial', 'business', 'multiple locations', 'apartment', 'condo association'])) {
    sopTriggers.push('Commercial / HOA lead');
  }
  if (includesAny(text, ['price', 'pricing', 'quote', 'estimate', 'how much', 'cost']) && !includesAny(text, ['photos', 'picture', 'video'])) {
    sopTriggers.push('Pricing or estimate may be unclear');
  }

  if (!/\b\d{2,6}\s+[a-z0-9 .'-]+\s+(street|st|drive|dr|road|rd|lane|ln|court|ct|avenue|ave|way|circle|cir|place|pl|boulevard|blvd)\b/i.test(transcript)) {
    missingInfo.push('Property address');
  }
  if (!includesAny(text, ['photo', 'photos', 'picture', 'pictures', 'video', 'screenshot'])) {
    missingInfo.push('Photos/video if this is for an estimate');
  }
  if (!includesAny(text, ['timeline', 'deadline', 'when', 'this week', 'today', 'tomorrow', 'as soon'])) {
    missingInfo.push('Desired timeline or hard deadline');
  }

  const cleanupMemoryHit = hasMemory(text, memories, ['cleanup', 'clean up', 'mulch', 'weeding', 'trimming', 'fully booked', 'june']);
  let decision: LiveCoachDecision = sopTriggers.length ? 'Needs Bradley' : 'Need more info first';
  let sayThisNext = 'I can gather the details first and check the best next step internally. Could you send the property address, photos or video, and your desired timeline?';

  if (cleanupMemoryHit && !sopTriggers.some((trigger) => ['Complaint or emotional tone', 'Refund / discount / credit request', 'Property damage or safety issue'].includes(trigger))) {
    decision = 'Carl can handle';
    sayThisNext = 'For cleanup or project work, our project crew is currently booked out. The safe next step is to let them know the earliest cleanup/project availability is around June, and offer to reconnect or refer out if they need it sooner.';
  } else if (sopTriggers.length) {
    decision = 'Needs Bradley';
    sayThisNext = 'I want to make sure I do not overpromise. I’ll capture the details and have Bradley review the best next step before we confirm anything.';
  } else if (missingInfo.length === 0) {
    decision = 'Carl can handle';
    sayThisNext = 'Thank you. I have the key details. I’ll add this to our notes and follow the next SOP step.';
  }

  return {
    summary: transcript.slice(-700) || 'No transcript yet.',
    decision,
    confidence: sopTriggers.length || cleanupMemoryHit ? 'High' : 'Medium',
    sopTriggers: sopTriggers.length ? sopTriggers : ['Normal intake / information gathering'],
    missingInfo,
    sayThisNext,
    askNext: missingInfo.slice(0, 4),
    doNotSay: [
      'Do not promise Bradley will visit or call unless Bradley already confirmed.',
      'Do not quote pricing if scope is unclear.',
      'Do not guarantee schedule availability on the call.'
    ],
    callNotes: [`Source: ${source}`, `Topic: ${topic}`, `Decision: ${decision}`, `Transcript summary: ${transcript.slice(-900)}`].join('\n'),
    ...(error ? { summary: `${transcript.slice(-700) || 'No transcript yet.'}\n\nOpenAI fallback note: ${error}` } : {})
  };
}

export async function getLiveCallCoaching(payload: LiveCoachPayload): Promise<LiveCoachResult> {
  const transcript = payload.transcript.trim();
  if (!transcript) {
    return localFallbackCoach({ ...payload, transcript: 'No transcript yet.' });
  }

  const relevantMemories = payload.memories
    .filter((memory) => memory.is_active)
    .slice(0, 16)
    .map((memory) => ({
      memory_type: memory.memory_type,
      title: memory.title,
      summary: memory.summary,
      tags: memory.tags,
      confidence: memory.confidence
    }));

  try {
    const response = await fetch('/api/live-call-coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript,
        source: payload.source,
        topic: payload.topic,
        memories: relevantMemories,
        recentCases: trimHistory(payload.history)
      })
    });

    const data = (await response.json()) as LiveCoachApiResponse;
    if (data.ok && data.result) return data.result;
    return localFallbackCoach(payload, data.error || 'OpenAI is unavailable.');
  } catch (error) {
    return localFallbackCoach(payload, error instanceof Error ? error.message : 'OpenAI is unavailable.');
  }
}


interface TranscribeApiResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

export async function transcribeCallAudio(blob: Blob): Promise<string> {
  const response = await fetch('/api/live-call-transcribe', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob
  });

  const data = (await response.json()) as TranscribeApiResponse;
  if (!data.ok) throw new Error(data.error || 'Audio transcription failed. If this keeps happening, the selected tab is not sending usable audio.');
  return (data.text || '').trim();
}
