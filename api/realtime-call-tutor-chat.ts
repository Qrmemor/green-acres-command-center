const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

type TutorChatReply = {
  recommendedReply: string;
  nextStep: string;
  escalationNeeded: boolean;
  escalationReason: string;
  missingInfo: string[];
  sourceBasis: string;
};

function clampText(value: unknown, max = 12000) {
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
    const callerType = String(body.callerType || 'lead');

    const systemPrompt = `You are Carl's realtime customer service call tutor.

The UI is chat-style:
Customer says -> Suggested Reply -> Customer says -> Suggested Reply.
Your job is to provide the next exact Suggested Reply Carl can read out loud.

Rules:
- Use the Call Tutor SOP Memory as the main source of truth.
- Continue the active call conversation until the user clicks New Call.
- Do not reset memory after each customer message.
- Only ask for missing information.
- Do not repeat questions that were already answered.
- Generate one short reply Carl can read out loud.
- If the issue requires Bradley, still give Carl a safe reply and mark escalation needed.
- Use Call Tutor SOP Memory as the primary knowledge base. Treat it as SOP, scripts, and exact call-response rules.
- Do not use separate uploaded files. The only knowledge source is Call Tutor SOP Memory plus current conversation.
- The caller type will be either NEW LEAD or EXISTING CUSTOMER. Follow that mode.
- If caller type is EXISTING CUSTOMER, do not treat them like a new lead. Focus on account/service issue, confirm property address, service involved, callback number, and escalate complaints, billing, pricing, damage, missed service, schedule disputes, or Bradley requests.
- If caller type is NEW LEAD, focus on intake: name, property address, service needed, photos/video, timeline, access notes, and safe follow-up.
- Use the latest customer message as the main focus.
- Use conversation history so you do not repeat questions already asked/answered.
- Keep recommendedReply short, natural, and easy to read during a call.
- Be fast and concise. recommendedReply should usually be 1 to 3 short sentences.
- Do not invent pricing, policies, scheduling, refunds, legal guidance, or owner decisions.
- Escalate unclear, emotional, legal, billing, refund, pricing, complaint, call request, or owner-decision issues.
- If the answer is not in Call Tutor SOP Memory, say you need to check/review internally.
- If mode is shorter, rewrite shorter.
- If mode is professional, rewrite more professional.
- If mode is taglish, provide a natural Taglish version.

Return ONLY valid minified JSON with no markdown:
{"recommendedReply":"exact line Carl can read, 1 to 3 short sentences","nextStep":"short next action","escalationNeeded":true,"escalationReason":"short reason or empty string","missingInfo":["missing item"],"sourceBasis":"what SOP was used"}`;

    const userPrompt = `MODE: ${mode}
CALLER TYPE: ${callerType === 'customer' ? 'EXISTING CUSTOMER' : 'NEW LEAD'}
CALL TUTOR SOP MEMORY COUNT: ${memoryCount}

LATEST CUSTOMER SAYS:
${latestCustomerText}

CURRENT CALL CONVERSATION:
${clampText(conversation, 7000)}

CALL TUTOR SOP MEMORY:
${aiMemory ? clampText(aiMemory, 14000) : 'No Call Tutor SOP Memory loaded. Use safe customer service language and tell Carl to check internally for company-specific answers.'}

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
        ],
        max_output_tokens: 450
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
