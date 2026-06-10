const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

type TutorChatReply = {
  recommendedReply: string;
  nextStep: string;
  escalationNeeded: boolean;
  escalationReason: string;
  missingInfo: string[];
  sourceBasis: string;
};

function clampText(value: unknown, max = 24000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}

function extractJson(text: string): TutorChatReply | null {
  const cleaned = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ ok: false, error: 'OPENAI_API_KEY is not configured.' });
  }

  try {
    const body = req.body ?? {};
    const model = process.env.OPENAI_CALL_TUTOR_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const latestCustomerText = String(body.latestCustomerText || '');
    const conversation = String(body.conversation || '');
    const aiMemory = String(body.aiMemory || '');
    const memoryCount = Number(body.memoryCount || 0);
    const mode = String(body.mode || 'live');

    const systemPrompt = `You are Carl's realtime customer service call tutor.

The UI is chat-style:
Customer says -> Suggested Reply -> Customer says -> Suggested Reply.
Your job is to provide the next exact Suggested Reply Carl can read out loud.

Rules:
- Use Call Tutor Memory as the primary knowledge base.
- Do not use separate uploaded files. The only knowledge source is Call Tutor Memory plus current conversation.
- Use the latest customer message as the main focus.
- Use conversation history so you do not repeat questions already asked/answered.
- Keep recommendedReply short, natural, and easy to read during a call.
- Do not invent pricing, policies, scheduling, refunds, legal guidance, or owner decisions.
- Escalate unclear, emotional, legal, billing, refund, pricing, complaint, call request, or owner-decision issues.
- If the answer is not in Call Tutor Memory, say you need to check/review internally.
- If mode is shorter, rewrite shorter.
- If mode is professional, rewrite more professional.
- If mode is taglish, provide a natural Taglish version.

Return ONLY valid JSON:
{
  "recommendedReply": "exact line Carl can read",
  "nextStep": "what Carl should do next",
  "escalationNeeded": true,
  "escalationReason": "short reason or empty string",
  "missingInfo": ["missing item"],
  "sourceBasis": "what Call Tutor Memory/general safe basis was used"
}`;

    const userPrompt = `MODE: ${mode}
CALL TUTOR MEMORY COUNT: ${memoryCount}

LATEST CUSTOMER SAYS:
${latestCustomerText}

CURRENT CALL CONVERSATION:
${clampText(conversation, 12000)}

CALL TUTOR MEMORY:
${aiMemory ? clampText(aiMemory, 28000) : 'No Call Tutor Memory loaded. Use safe customer service language and tell Carl to check internally for company-specific answers.'}

Generate the next Suggested Reply now.`;

    const response = await fetch(OPENAI_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(200).json({ ok: false, error: data?.error?.message || 'OpenAI request failed.' });
    }

    const outputText = typeof data?.output_text === 'string'
      ? data.output_text
      : (data?.output ?? [])
          .flatMap((item: any) => item?.content ?? [])
          .map((item: any) => item?.text || '')
          .join('\n');

    const result = extractJson(outputText);
    if (!result) {
      return res.status(200).json({ ok: false, error: 'AI returned invalid JSON.' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error instanceof Error ? error.message : 'Realtime tutor failed.' });
  }
}
