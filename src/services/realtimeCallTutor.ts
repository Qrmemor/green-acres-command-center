export interface RealtimeTutorResult {
  recommendedReply: string;
  nextStep: string;
  escalationNeeded: boolean;
  escalationReason: string;
  followUpQuestions: string[];
  missingInfo: string[];
  warning: string;
  sourceBasis: string;
}

export interface RealtimeTutorPayload {
  latestCustomerText: string;
  transcript: string;
  knowledge: string;
  hasKnowledge: boolean;
  mode: 'live' | 'shorter' | 'professional' | 'taglish';
}

interface RealtimeTutorResponse {
  ok: boolean;
  result?: RealtimeTutorResult;
  text?: string;
  error?: string;
}

function fallbackReply(payload: RealtimeTutorPayload): RealtimeTutorResult {
  const latest = payload.latestCustomerText.toLowerCase();
  const needsEscalation = /(refund|discount|angry|upset|complaint|legal|billing|price|pricing|quote|estimate|bradley|call me|damage|not finished)/i.test(latest);

  let recommendedReply = "Thanks for sharing that. Let me check the details first so I can give you the correct information.";
  const followUpQuestions: string[] = [];

  if (/(estimate|quote|service|lawn|cleanup|mulch|mowing)/i.test(latest)) {
    recommendedReply = "Thanks for reaching out. I can gather the details first so we can review the best next step.";
    followUpQuestions.push("Can I confirm your name, property address, and the best email or phone number?");
    followUpQuestions.push("Can you send photos or a short video of the area if possible?");
  }

  if (/(can't send|cannot send|no photos|come out|visit)/i.test(latest)) {
    recommendedReply = "No problem. I can note that and gather the details first. I cannot promise a visit on this call, but I can review the best next step internally.";
    followUpQuestions.push("Can you describe the area and what needs to be done?");
  }

  return {
    recommendedReply,
    nextStep: followUpQuestions[0] || "Collect the key details and review internally before promising anything.",
    escalationNeeded: needsEscalation,
    escalationReason: needsEscalation ? "This may involve pricing, complaint, billing, call request, or unclear decision-making." : "",
    followUpQuestions,
    missingInfo: ["Name", "Address", "Photos/video if available", "Timeline"].filter((item) => !payload.transcript.toLowerCase().includes(item.toLowerCase())),
    warning: "Do not invent pricing, policy, scheduling, or owner decisions. If the SOP is unclear, say you will check and follow up.",
    sourceBasis: payload.hasKnowledge ? "Used uploaded document memory where available. Fallback used because AI request failed." : "No uploaded document text found. Use safe check-and-follow-up language."
  };
}

export async function getRealtimeTutorReply(payload: RealtimeTutorPayload): Promise<RealtimeTutorResult> {
  try {
    const response = await fetch('/api/realtime-call-tutor', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = (await response.json()) as RealtimeTutorResponse;
    if (data.ok && data.result) return data.result;
    return fallbackReply(payload);
  } catch {
    return fallbackReply(payload);
  }
}

interface TranscribeResponse {
  ok: boolean;
  text?: string;
  error?: string;
}

export async function transcribeTutorAudio(blob: Blob): Promise<string> {
  const response = await fetch('/api/realtime-call-transcribe', {
    method: 'POST',
    headers: { 'Content-Type': blob.type || 'audio/webm' },
    body: blob
  });

  const data = (await response.json()) as TranscribeResponse;
  if (!data.ok) throw new Error(data.error || 'Could not transcribe audio.');
  return (data.text || '').trim();
}
