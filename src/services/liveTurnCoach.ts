import type { AIMemory, Escalation } from '@/types';

export type LiveTurnDecision = 'Carl can handle' | 'Needs Bradley' | 'Need more info first';

export interface LiveTurnCoachResult {
  stage: string;
  decision: LiveTurnDecision;
  sayThisNow: string;
  askNext: string;
  canEndCall: string;
  warning: string;
  memoryUsed?: string;
}

interface LiveTurnCoachPayload {
  transcript: string;
  latestCustomerLine: string;
  source: string;
  topic: string;
  memories: AIMemory[];
  history: Escalation[];
}

interface LiveTurnCoachResponse {
  ok: boolean;
  result?: LiveTurnCoachResult;
  error?: string;
}

function fallbackTurnCoach(payload: LiveTurnCoachPayload): LiveTurnCoachResult {
  const latest = payload.latestCustomerLine.toLowerCase();
  const transcript = payload.transcript.toLowerCase();

  if (/come here|come to my house|come out|visit|look at it|in person/.test(latest)) {
    return {
      stage: 'Visit request',
      decision: 'Needs Bradley',
      sayThisNow: 'I understand. I can note that you prefer someone to look at it in person, but I cannot promise a visit or timing on this call. I’ll document this and review the best next step internally.',
      askNext: 'Can you briefly describe the area and what needs to be done so I can include it in the notes?',
      canEndCall: 'Yes. End after confirming you will document the request and review internally.',
      warning: 'Do not promise a site visit, price, or Bradley call time.'
    };
  }

  if (/can't send|cannot send|can not send|unable to send|no photos|no photo/.test(latest)) {
    return {
      stage: 'No photos',
      decision: 'Need more info first',
      sayThisNow: 'No problem. Photos usually help us review faster, but I can still collect the details and review the best next step internally.',
      askNext: 'Can you describe the area, approximate size, and what you want done?',
      canEndCall: 'End after collecting the description and any timeline or access notes.',
      warning: 'Do not promise a visit just because they cannot send photos.'
    };
  }

  if (/call me|bradley|upset|frustrated|complaint|not finished|damage|refund|discount/.test(latest + ' ' + transcript)) {
    return {
      stage: 'Escalate',
      decision: 'Needs Bradley',
      sayThisNow: 'I understand. I’ll make a clear note of this and have it reviewed internally so we handle it correctly.',
      askNext: 'What is the best call-back number, and what is the main thing you want Bradley to review?',
      canEndCall: 'End after getting the issue summary and call-back number.',
      warning: 'Do not promise Bradley will call at a specific time.'
    };
  }

  if (/estimate|quote|price|cost|how much/.test(latest + ' ' + transcript)) {
    return {
      stage: 'Estimate',
      decision: 'Need more info first',
      sayThisNow: 'I can help gather the details for an estimate and review the best next step internally.',
      askNext: 'What is the property address, and can you send photos or a short video if possible?',
      canEndCall: 'End only after name, address, scope, timeline, and access notes are captured or requested.',
      warning: 'Do not quote pricing during the call.'
    };
  }

  return {
    stage: 'Continue intake',
    decision: 'Need more info first',
    sayThisNow: 'Got it. I’ll gather the details first so we can decide the correct next step without overpromising.',
    askNext: 'Can you confirm the service needed, property address, timeline, and any access notes?',
    canEndCall: 'End once the basic intake is complete and you tell them you will review internally.',
    warning: 'If you are not 100% sure, do not promise pricing or scheduling.'
  };
}

export async function getLiveTurnCoach(payload: LiveTurnCoachPayload): Promise<LiveTurnCoachResult> {
  if (!payload.latestCustomerLine.trim()) return fallbackTurnCoach(payload);

  const relevantMemories = payload.memories
    .filter((memory) => memory.is_active)
    .slice(0, 10)
    .map((memory) => ({
      title: memory.title,
      summary: memory.summary,
      tags: memory.tags,
      memory_type: memory.memory_type,
      confidence: memory.confidence
    }));

  const recentCases = payload.history.slice(0, 6).map((item) => ({
    customer_name: item.customer_name,
    topic: item.topic,
    situation: item.situation,
    reason_for_escalation: item.reason_for_escalation,
    proposed_next_step: item.proposed_next_step,
    bradley_note: item.bradley_note,
    status: item.status
  }));

  try {
    const response = await fetch('/api/live-turn-coach', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: payload.transcript,
        latestCustomerLine: payload.latestCustomerLine,
        source: payload.source,
        topic: payload.topic,
        memories: relevantMemories,
        recentCases
      })
    });

    const data = (await response.json()) as LiveTurnCoachResponse;
    if (data.ok && data.result) return data.result;
    return fallbackTurnCoach(payload);
  } catch {
    return fallbackTurnCoach(payload);
  }
}
