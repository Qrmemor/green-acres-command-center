const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

type TutorResult = {
  recommendedReply: string;
  nextStep: string;
  escalationNeeded: boolean;
  escalationReason: string;
  followUpQuestions: string[];
  missingInfo: string[];
  warning: string;
  sourceBasis: string;
};

function clampText(value: unknown, max = 20000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}

function extractJson(text: string): TutorResult | null {
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
    const transcript = String(body.transcript || '');
    const knowledge = String(body.knowledge || '');
    const hasKnowledge = Boolean(body.hasKnowledge);
    const mode = String(body.mode || 'live');

    const systemPrompt = `You are a realtime AI customer service call tutor.

The user is currently on a customer service, VA, lead, support, or client call.
Your job is to give the exact short reply the user can read out loud next.

STRICT RULES:
- Prioritize uploaded files/SOP/FAQ/company notes over general knowledge.
- If the uploaded files do not contain the answer, do not invent it.
- If unclear, use safe language like: "Let me check that for you and get back to you."
- Do not invent pricing, policies, scheduling, refunds, legal guidance, billing decisions, or company commitments.
- Escalate unclear, emotional, legal, billing, refund, pricing, complaint, or owner-decision issues.
- Keep the recommended reply short, natural, and easy to read during a live call.
- Help the user sound confident and professional.
- Use the active transcript as memory. Do not reset unless the session is new.
- If mode is shorter, rewrite shorter.
- If mode is professional, rewrite more professional.
- If mode is taglish, provide a natural Taglish version.

Return ONLY valid JSON:
{
  "recommendedReply": "short exact wording to say",
  "nextStep": "what the user should do next",
  "escalationNeeded": true,
  "escalationReason": "short reason or empty string",
  "followUpQuestions": ["question 1", "question 2"],
  "missingInfo": ["missing item"],
  "warning": "what not to promise",
  "sourceBasis": "uploaded files / no file answer / general safe customer service"
}`;

    const userPrompt = `MODE: ${mode}

LATEST CUSTOMER MESSAGE:
${latestCustomerText}

ACTIVE CALL TRANSCRIPT:
${clampText(transcript, 12000)}

UPLOADED FILE KNOWLEDGE BASE:
${hasKnowledge ? clampText(knowledge, 26000) : 'No uploaded file text was processed. If the answer requires company-specific information, say it must be checked.'}

Generate the next customer service coaching response.`;

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
      return res.status(200).json({ ok: false, error: data?.error?.message || 'OpenAI call tutor request failed.' });
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
    return res.status(200).json({ ok: false, error: error instanceof Error ? error.message : 'Realtime call tutor failed.' });
  }
}
