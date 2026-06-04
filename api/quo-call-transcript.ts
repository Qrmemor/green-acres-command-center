type DialogueLine = {
  content?: string;
  start?: number;
  end?: number;
  identifier?: string;
  userId?: string;
};

function cleanCallId(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(seconds?: number) {
  if (typeof seconds !== 'number' || Number.isNaN(seconds)) return '';
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function buildTranscript(dialogue: DialogueLine[]) {
  return dialogue
    .map((line) => {
      const speaker = line.identifier || line.userId || 'Speaker';
      const timestamp = typeof line.start === 'number' ? `[${formatTime(line.start)}] ` : '';
      const content = (line.content || '').trim();
      if (!content) return '';
      return `${timestamp}${speaker}: ${content}`;
    })
    .filter(Boolean)
    .join('\n');
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const apiKey = process.env.QUO_API_KEY || process.env.OPENPHONE_API_KEY;
  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      error: 'QUO_API_KEY or OPENPHONE_API_KEY is not configured in Vercel. Add it in Project Settings → Environment Variables, then redeploy.'
    });
  }

  const callId = cleanCallId(req.body?.callId);
  if (!callId || !/^AC/i.test(callId)) {
    return res.status(200).json({
      ok: false,
      error: 'Invalid Call ID. Paste a completed Quo/OpenPhone call ID that starts with AC.'
    });
  }

  try {
    const response = await fetch(`https://api.openphone.com/v1/call-transcripts/${encodeURIComponent(callId)}`, {
      method: 'GET',
      headers: {
        Authorization: apiKey
      }
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(200).json({
        ok: false,
        error: data?.message || data?.error?.message || 'Quo/OpenPhone transcript request failed. Make sure this call has a completed transcript and your plan supports transcripts.'
      });
    }

    const dialogue = Array.isArray(data?.data?.dialogue) ? data.data.dialogue : [];
    const transcript = buildTranscript(dialogue);

    if (!transcript) {
      return res.status(200).json({
        ok: false,
        error: 'Transcript exists but no dialogue text was returned yet. Try again after the call transcript is completed.'
      });
    }

    return res.status(200).json({
      ok: true,
      callId: data?.data?.callId || callId,
      transcript,
      duration: data?.data?.duration
    });
  } catch (error) {
    return res.status(200).json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to fetch Quo/OpenPhone transcript.'
    });
  }
}
