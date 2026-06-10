const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions';

async function readRequestBuffer(req: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
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
    const audioBuffer = await readRequestBuffer(req);
    if (!audioBuffer.length) {
      return res.status(200).json({ ok: false, error: 'No audio received.' });
    }

    const contentType = req.headers['content-type'] || 'audio/webm';
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

    const formData = new FormData();
    const audioArrayBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);
    const normalizedContentType = String(contentType).split(';')[0] || 'audio/webm';
    const extension = normalizedContentType.includes('mp4') ? 'mp4' : normalizedContentType.includes('mpeg') ? 'mp3' : normalizedContentType.includes('wav') ? 'wav' : 'webm';
    const audioBlob = new Blob([audioArrayBuffer], { type: normalizedContentType });
    formData.append('file', audioBlob, `call-audio.${extension}`);
    formData.append('model', model);
    formData.append('response_format', 'json');
    formData.append('language', 'en');
    formData.append('prompt', 'Transcribe only clear English customer service call audio. If the audio is unclear, silent, or not English, return an empty transcription.');

    const response = await fetch(OPENAI_TRANSCRIPT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      const message = data?.error?.message ?? 'OpenAI transcription failed.';
      if (/corrupt|unsupported|invalid file|could not be decoded|duration/i.test(message)) {
        return res.status(200).json({ ok: false, error: 'Audio segment could not be decoded. This usually happens when the chunk is silent, too short, or the browser produced an incomplete audio segment.' });
      }
      return res.status(200).json({ ok: false, error: message });
    }

    return res.status(200).json({ ok: true, text: typeof data?.text === 'string' ? data.text : '' });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error instanceof Error ? error.message : 'Realtime call transcription failed.' });
  }
}
