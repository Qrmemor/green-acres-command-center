const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

type TriageDecision = 'Needs Bradley' | 'Need more info first' | 'Carl can handle';
type TriageConfidence = 'High' | 'Medium' | 'Low';

type IncomingPayload = {
  draft: Record<string, unknown>;
  localAnalysis: Record<string, unknown>;
  memories?: Array<Record<string, unknown>>;
  similarCases?: Array<Record<string, unknown>>;
};

function clampText(value: unknown, max = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}

function safeArray(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function cleanAnalysis(raw: any, fallback: any) {
  const decisionOptions: TriageDecision[] = ['Needs Bradley', 'Need more info first', 'Carl can handle'];
  const confidenceOptions: TriageConfidence[] = ['High', 'Medium', 'Low'];

  const decision: TriageDecision = decisionOptions.includes(raw?.decision) ? raw.decision : fallback.decision ?? 'Need more info first';
  const confidence: TriageConfidence = confidenceOptions.includes(raw?.confidence) ? raw.confidence : fallback.confidence ?? 'Medium';

  const recommendedStatus =
    typeof raw?.recommendedStatus === 'string'
      ? raw.recommendedStatus
      : decision === 'Needs Bradley'
        ? 'Needs Bradley'
        : decision === 'Need more info first'
          ? 'Follow-Up Needed'
          : 'Waiting on Customer';

  const ownerNextAction = decision === 'Needs Bradley' ? 'Bradley' : 'Carl';
  const recommendedUrgency = raw?.recommendedUrgency === 'Urgent / Customer-Sensitive' ? 'Urgent / Customer-Sensitive' : fallback.recommendedUrgency ?? 'Standard / Non-Urgent';

  return {
    ...fallback,
    ...raw,
    engine: 'OpenAI',
    decision,
    confidence,
    shouldEscalate: decision === 'Needs Bradley',
    recommendedStatus,
    ownerNextAction,
    recommendedUrgency,
    sopTriggers: safeArray(raw?.sopTriggers).map(String),
    missingInfo: safeArray(raw?.missingInfo).map(String),
    reasons: safeArray(raw?.reasons).map(String).length ? safeArray(raw?.reasons).map(String) : fallback.reasons ?? [],
    suggestedNextStep: typeof raw?.suggestedNextStep === 'string' ? raw.suggestedNextStep : fallback.suggestedNextStep ?? '',
    suggestedReply: typeof raw?.suggestedReply === 'string' ? raw.suggestedReply : fallback.suggestedReply ?? '',
    bradleySummary: typeof raw?.bradleySummary === 'string' ? raw.bradleySummary : fallback.bradleySummary ?? '',
    patternSummary: typeof raw?.patternSummary === 'string' ? raw.patternSummary : fallback.patternSummary ?? '',
    memoryPatternSummary: typeof raw?.memoryPatternSummary === 'string' ? raw.memoryPatternSummary : fallback.memoryPatternSummary ?? '',
    similarCases: fallback.similarCases ?? [],
    memoryMatches: fallback.memoryMatches ?? []
  };
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

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(200).json({ ok: false, fallback: true, error: 'OPENAI_API_KEY is not configured.' });
  }

  try {
    const body: IncomingPayload = req.body ?? {};
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
    const memories = (body.memories ?? []).slice(0, 10);
    const similarCases = (body.similarCases ?? []).slice(0, 6);

    const systemPrompt = `You are the Green Acres Command Center AI Triage Assistant for Carl, the VA, and Bradley, the owner.\n\nYour job is to decide if a customer issue should be escalated to Bradley, handled by Carl using SOP, or if Carl should collect more info first.\n\nRules:\n- Never pretend to be Bradley.\n- Never send anything to customers. You only recommend.\n- If safety, property damage, angry complaint, refund, discount, scope dispute, collections, outside service area, commercial/HOA, crew no-show, job over $2,000, or Carl is unsure, recommend Needs Bradley.\n- If saved AI Memory clearly says Carl can handle it, prefer Carl can handle unless a high-risk trigger appears.\n- For cleanup/project work fully booked until June memory: Carl can usually send the fully-booked message without escalating unless the customer pushes back, timing is urgent, pricing/scope is unusual, or it involves mowing/turf program.\n- For normal intake, prefer Need more info first if missing address, contact info, photos/video, timeline, or where to continue.\n- Keep answers concise, practical, and SOP-locked.\n\nReturn ONLY valid JSON with these fields:\n{\n  "decision": "Needs Bradley" | "Need more info first" | "Carl can handle",\n  "confidence": "High" | "Medium" | "Low",\n  "recommendedStatus": string,\n  "recommendedUrgency": "Urgent / Customer-Sensitive" | "Standard / Non-Urgent",\n  "sopTriggers": string[],\n  "missingInfo": string[],\n  "reasons": string[],\n  "suggestedNextStep": string,\n  "suggestedReply": string,\n  "bradleySummary": string,\n  "patternSummary": string,\n  "memoryPatternSummary": string\n}`;

    const userPrompt = `Analyze this Green Acres case.\n\nDRAFT:\n${clampText(body.draft, 9000)}\n\nLOCAL RULE-BASED ANALYSIS TO IMPROVE OR OVERRIDE IF NEEDED:\n${clampText(body.localAnalysis, 7000)}\n\nRELEVANT AI MEMORIES:\n${clampText(memories, 9000)}\n\nSIMILAR PAST CASES:\n${clampText(similarCases, 5000)}`;

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
      return res.status(200).json({ ok: false, fallback: true, error: data?.error?.message ?? 'OpenAI request failed.' });
    }

    const outputText = extractOutputText(data).trim();
    const cleanedOutput = outputText
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    let parsed: unknown;
    try {
      parsed = JSON.parse(cleanedOutput);
    } catch {
      return res.status(200).json({ ok: false, fallback: true, error: 'OpenAI returned an unreadable response.' });
    }

    return res.status(200).json({ ok: true, analysis: cleanAnalysis(parsed, body.localAnalysis ?? {}) });
  } catch (error) {
    return res.status(200).json({ ok: false, fallback: true, error: error instanceof Error ? error.message : 'OpenAI triage failed.' });
  }
}
