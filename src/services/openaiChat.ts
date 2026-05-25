import type { AIMemory, Escalation } from '@/types';
import { analyzeEscalationDraft } from '@/services/aiTriage';

export interface AIChatImage {
  id: string;
  name: string;
  type: string;
  dataUrl: string;
}

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  images?: AIChatImage[];
  createdAt: string;
}

interface AIChatPayload {
  messages: AIChatMessage[];
  source: string;
  topic: string;
  memories: AIMemory[];
  history: Escalation[];
}

interface AIChatResponse {
  ok: boolean;
  reply?: string;
  error?: string;
}

function buildLocalDraft(message: AIChatMessage, source: string, topic: string) {
  return {
    customer_name: '',
    phone: '',
    email: '',
    source,
    topic,
    situation: message.text,
    last_touch: message.text ? 'Review pasted customer context.' : '',
    reason_for_escalation: '',
    proposed_next_step: '',
    where_to_continue: source === 'Gmail' ? 'team@ Gmail thread' : source === 'Quo' ? 'Quo thread' : source
  };
}

function localFallbackReply(latestUserMessage: AIChatMessage, source: string, topic: string, history: Escalation[], memories: AIMemory[]) {
  const local = analyzeEscalationDraft(buildLocalDraft(latestUserMessage, source, topic), history, memories);

  return [
    `**Recommendation:** ${local.decision}`,
    `**Confidence:** ${local.confidence}`,
    '',
    '**Why:**',
    ...local.reasons.map((reason) => `- ${reason}`),
    local.missingInfo.length ? `\n**Missing info:** ${local.missingInfo.join(', ')}` : '',
    '',
    `**Suggested next step:** ${local.suggestedNextStep}`,
    '',
    '**Suggested reply:**',
    local.suggestedReply,
    '',
    '_OpenAI chat is not available right now, so I used the local SOP triage fallback._'
  ].filter(Boolean).join('\n');
}

export async function sendAIChatMessage({ messages, source, topic, memories, history }: AIChatPayload) {
  const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
  if (!latestUserMessage) return 'Please type a message first.';

  const localAnalysis = analyzeEscalationDraft(buildLocalDraft(latestUserMessage, source, topic), history, memories);
  const relevantMemoryIds = new Set(localAnalysis.memoryMatches.map((memory) => memory.id));
  const relevantMemories = memories
    .filter((memory) => relevantMemoryIds.has(memory.id))
    .concat(memories.filter((memory) => !relevantMemoryIds.has(memory.id)).slice(0, 6))
    .slice(0, 12);

  try {
    const response = await fetch('/api/ai-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages,
        source,
        topic,
        memories: relevantMemories,
        similarCases: localAnalysis.similarCases
      })
    });

    const data = (await response.json()) as AIChatResponse;
    if (data.ok && data.reply) return data.reply;

    return `${localFallbackReply(latestUserMessage, source, topic, history, memories)}\n\nOpenAI error: ${data.error || 'OpenAI is unavailable.'}`;
  } catch (error) {
    return `${localFallbackReply(latestUserMessage, source, topic, history, memories)}\n\nOpenAI error: ${error instanceof Error ? error.message : 'OpenAI is unavailable.'}`;
  }
}
