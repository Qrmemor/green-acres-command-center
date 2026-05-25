const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

type IncomingPayload = {
  transcript?: string;
  source?: string;
  topic?: string;
  memories?: Array<Record<string, unknown>>;
  recentCases?: Array<Record<string, unknown>>;
};

function clampText(value: unknown, max = 16000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}

function extractOutputText(data: any) {
  if (typeof data?.output_text === 'string') return data.output_text;
  const chunks: string[] = [];
  for (const output of data?.output ?? []) {
    for (const content of output?.content ?? []) {
      if (typeof content?.text === 'string') chunks.push(content.text);
    }
  }
  return chunks.join('\n');
}

function safeParseJson(text: string) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI response was not valid JSON.');
    return JSON.parse(match[0]);
  }
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 8);
}

function normalizeResult(value: any) {
  const decisionValues = ['Carl can handle', 'Needs Bradley', 'Need more info first'];
  const confidenceValues = ['High', 'Medium', 'Low'];

  const decision = decisionValues.includes(value?.decision) ? value.decision : 'Need more info first';
  const confidence = confidenceValues.includes(value?.confidence) ? value.confidence : 'Medium';

  return {
    summary: typeof value?.summary === 'string' ? value.summary.slice(0, 1200) : 'No clear summary generated.',
    decision,
    confidence,
    sopTriggers: cleanStringArray(value?.sopTriggers),
    missingInfo: cleanStringArray(value?.missingInfo),
    sayThisNext: typeof value?.sayThisNext === 'string' ? value.sayThisNext.slice(0, 1400) : 'Gather the missing details first and do not overpromise.',
    askNext: cleanStringArray(value?.askNext),
    doNotSay: cleanStringArray(value?.doNotSay),
    callNotes: typeof value?.callNotes === 'string' ? value.callNotes.slice(0, 2400) : ''
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      error: 'OPENAI_API_KEY is not configured in Vercel. Add it in Project Settings → Environment Variables, then redeploy.'
    });
  }

  try {
    const body: IncomingPayload = req.body ?? {};
    const transcript = typeof body.transcript === 'string' ? body.transcript.slice(-18000) : '';
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    const systemPrompt = `You are the Green Acres Live Call Coach inside Carl's internal VA dashboard.

You help Carl during a live customer call. The customer does not hear you. You must give short text guidance Carl can read while speaking.

Hard rules:
- Never pretend to be Bradley.
- Never say a message was sent.
- Never promise pricing, schedule, a Bradley call, or a site visit unless already confirmed.
- If unsure, recommend gathering information or escalating to Bradley.
- Use Green Acres SOP, saved AI memories, and past cases.
- Carl is Phase 1 VA support and should not make owner-level decisions.

Escalate to Bradley when there is: customer wants a call, pricing unclear, refund/discount, complaint, angry/emotional tone, scope dispute, commercial/HOA lead, likely job over $2,000, outside service area, property damage, safety issue, crew no-show, collections issue, or anything Carl is not 100% sure about.

Normal intake should collect: full name, address, phone/email, service requested, timeline/deadline, photos/video, gate/access, pets, parking, irrigation/invisible fence, obstacles, slopes, and where to continue.

Return only valid JSON with this exact shape:
{
  "summary": "one short call summary",
  "decision": "Carl can handle" | "Needs Bradley" | "Need more info first",
  "confidence": "High" | "Medium" | "Low",
  "sopTriggers": ["short trigger labels"],
  "missingInfo": ["missing detail labels"],
  "sayThisNext": "a short customer-facing sentence Carl can say right now",
  "askNext": ["one-line questions Carl should ask next"],
  "doNotSay": ["short warnings"],
  "callNotes": "clean internal call notes Carl can copy after the call"
}`;

    const userPrompt = `SOURCE: ${body.source || 'Unknown'}
TOPIC: ${body.topic || 'Other'}

SAVED AI MEMORIES:
${clampText((body.memories ?? []).slice(0, 16), 12000)}

RECENT / SIMILAR CASES:
${clampText((body.recentCases ?? []).slice(0, 10), 9000)}

LIVE CALL TRANSCRIPT SO FAR:
${clampText(transcript, 18000)}

Give Carl real-time coaching for what to say or ask next.`;

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
          { role: 'user', content: [{ type: 'input_text', text: userPrompt }] }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(200).json({ ok: false, error: data?.error?.message ?? 'OpenAI live call coach request failed.' });
    }

    const outputText = extractOutputText(data);
    const parsed = safeParseJson(outputText);
    return res.status(200).json({ ok: true, result: normalizeResult(parsed) });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error instanceof Error ? error.message : 'OpenAI live call coach failed.' });
  }
}
