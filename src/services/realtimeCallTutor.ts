export interface TutorChatMessage {
  role: 'customer' | 'coach';
  text: string;
}

export interface TutorChatReply {
  recommendedReply: string;
  nextStep: string;
  escalationNeeded: boolean;
  escalationReason: string;
  missingInfo: string[];
  sourceBasis: string;
}

export interface TutorChatPayload {
  latestCustomerText: string;
  conversation: string;
  messages: TutorChatMessage[];
  aiMemory: string;
  memoryCount: number;
  callerType?: 'lead' | 'customer';
  mode?: 'live' | 'shorter' | 'professional' | 'taglish';
}

interface TutorChatResponse {
  ok: boolean;
  result?: TutorChatReply;
  error?: string;
}

function fallbackReply(payload: TutorChatPayload): TutorChatReply {
  const latest = payload.latestCustomerText.toLowerCase();
  const isExistingCustomer = payload.callerType === 'customer';
  const escalationNeeded = /(price|pricing|cost|quote|estimate|refund|billing|complaint|angry|upset|bradley|call me|damage|not finished|legal)/i.test(latest);

  if (isExistingCustomer && /(missed|not finished|damage|billing|invoice|charged|complaint|upset|schedule|mowing|treatment|crew|bradley|call)/i.test(latest)) {
    return {
      recommendedReply: "I understand. I’ll make a clear note on your account and have this reviewed internally so we handle it correctly. Can I confirm the property address and the best callback number?",
      nextStep: "Confirm the address, callback number, service involved, and the main issue.",
      escalationNeeded: true,
      escalationReason: "Existing customer issue may need Bradley or internal review.",
      missingInfo: ["property address", "callback number", "main issue"],
      sourceBasis: payload.memoryCount ? "Used Call Tutor SOP Memory where available with safe fallback." : "No Call Tutor SOP Memory loaded, used safe fallback."
    };
  }

  if (/(can't send|cannot send|no photo|come here|come out|visit)/i.test(latest)) {
    return {
      recommendedReply: "No problem. I can note that and gather the details first. I can’t promise a visit on this call, but I’ll document the request and review the best next step internally.",
      nextStep: "Ask the customer to describe the area and confirm any timeline or access notes.",
      escalationNeeded: true,
      escalationReason: "Customer is asking for a visit or site review, which should not be promised without owner confirmation.",
      missingInfo: ["area description", "timeline", "access notes"],
      sourceBasis: payload.memoryCount ? "Used Call Tutor SOP Memory where available with safe fallback." : "No Call Tutor SOP Memory loaded, used safe fallback."
    };
  }

  return {
    recommendedReply: "Thanks for sharing that. Let me check the details first so I can give you the correct information.",
    nextStep: "Collect the next missing detail, then continue the call.",
    escalationNeeded,
    escalationReason: escalationNeeded ? "Possible pricing, billing, complaint, owner decision, or unclear scope." : "",
    missingInfo: ["name", "address", "photos/video if relevant", "timeline"],
    sourceBasis: payload.memoryCount ? "Used Call Tutor SOP Memory where available with safe fallback." : "No Call Tutor SOP Memory loaded, used safe fallback."
  };
}

export async function getRealtimeTutorChatReply(payload: TutorChatPayload): Promise<TutorChatReply> {
  try {
    const response = await fetch('/api/realtime-call-tutor-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = (await response.json()) as TutorChatResponse;
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
  if (!data.ok) {
    const message = data.error || 'Could not transcribe audio.';
    if (/corrupt|unsupported|invalid file|could not be decoded|duration/i.test(message)) {
      return '';
    }
    throw new Error(message);
  }
  return (data.text || '').trim();
}
