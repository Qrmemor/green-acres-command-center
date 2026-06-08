const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

type LiveTurnDecision = 'Carl can handle' | 'Needs Bradley' | 'Need more info first';

type LiveTurnResult = {
  stage: string;
  decision: LiveTurnDecision;
  sayThisNow: string;
  askNext: string;
  canEndCall: string;
  warning: string;
  memoryUsed?: string;
};

function clampText(value: unknown, max = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}

function extractJson(text: string): LiveTurnResult | null {
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
    const transcript = String(body.transcript || '');
    const latestCustomerLine = String(body.latestCustomerLine || '');
    const model = process.env.OPENAI_LIVE_COACH_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    const systemPrompt = `You are Carl's real-time Green Acres call coach. Carl is on a live call and needs ONE short line to read next.

Rules:
- Focus mainly on the LATEST CUSTOMER LINE, but use the full transcript so you do not repeat questions Carl already asked.
- Do not ask again for information already present in the transcript.
- Give Carl a natural sentence he can read out loud.
- If the customer refuses photos or asks someone to come out, do not promise a visit. Tell Carl to document and review internally.
- If customer asks for Bradley, is upset, complaint, damage, refund/discount, call request, unclear pricing/scope, or site visit request, mark Needs Bradley.
- If normal intake, collect only the next missing detail.
- Keep it short and call-friendly.

Return ONLY valid JSON:
{
  "stage": "short stage name",
  "decision": "Carl can handle" | "Needs Bradley" | "Need more info first",
  "sayThisNow": "one or two sentences Carl can read",
  "askNext": "one next question or short list",
  "canEndCall": "tell Carl whether he can end the call now and why",
  "warning": "what Carl must not promise",
  "memoryUsed": "memory title if relevant, otherwise empty"
}`;

    const userPrompt = `SOURCE: ${body.source || 'Quo'}
TOPIC: ${body.topic || 'Call Needed'}

LATEST CUSTOMER LINE:
${latestCustomerLine}

FULL CALL TRANSCRIPT:
${clampText(transcript, 9000)}

AI MEMORY / SOP:
${clampText((body.memories ?? []).slice(0, 10), 10000)}

RECENT CASES:
${clampText((body.recentCases ?? []).slice(0, 6), 7000)}

Generate the next live call coaching output now.`;

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
      return res.status(200).json({ ok: false, error: data?.error?.message || 'OpenAI live turn coach failed.' });
    }

    const outputText = typeof data?.output_text === 'string'
      ? data.output_text
      : (data?.output ?? [])
          .flatMap((item: any) => item?.content ?? [])
          .map((item: any) => item?.text || '')
          .join('\n');

    const result = extractJson(outputText);
    if (!result) {
      return res.status(200).json({ ok: false, error: 'Live coach returned invalid JSON.' });
    }

    return res.status(200).json({ ok: true, result });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error instanceof Error ? error.message : 'Live turn coach failed.' });
  }
}
