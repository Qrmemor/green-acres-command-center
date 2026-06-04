export interface QuoTranscriptResult {
  callId: string;
  transcript: string;
  duration?: number;
}

interface QuoTranscriptApiResponse {
  ok: boolean;
  callId?: string;
  transcript?: string;
  duration?: number;
  error?: string;
}

export async function fetchQuoCallTranscript(callId: string): Promise<QuoTranscriptResult> {
  const response = await fetch('/api/quo-call-transcript', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callId })
  });

  const data = (await response.json()) as QuoTranscriptApiResponse;
  if (!data.ok || !data.transcript) {
    throw new Error(data.error || 'Unable to fetch Quo/OpenPhone transcript.');
  }

  return {
    callId: data.callId || callId,
    transcript: data.transcript,
    duration: data.duration
  };
}
