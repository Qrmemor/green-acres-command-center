const OPENAI_TRANSCRIPT_URL = 'https://api.openai.com/v1/audio/transcriptions';

export const config = {
  api: {
    bodyParser: false
  }
};

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
    if (!audioBuffer.length || audioBuffer.length < 2000) {
      return res.status(200).json({ ok: false, error: 'No usable audio received. Make sure Share tab audio is checked and audio is playing in the selected call tab.' });
    }

    const rawContentType = String(req.headers['content-type'] || 'audio/webm');
    const contentType = rawContentType.split(';')[0] || 'audio/webm';
    const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
    const extension = contentType.includes('ogg')
      ? 'ogg'
      : contentType.includes('mp4')
        ? 'mp4'
        : contentType.includes('mpeg')
          ? 'mp3'
          : 'webm';

    const formData = new FormData();
    const audioArrayBuffer = audioBuffer.buffer.slice(audioBuffer.byteOffset, audioBuffer.byteOffset + audioBuffer.byteLength);
    const audioBlob = new Blob([audioArrayBuffer], { type: contentType });
    formData.append('file', audioBlob, `call-audio.${extension}`);
    formData.append('model', model);
    formData.append('response_format', 'json');
    formData.append('language', 'en');

    const response = await fetch(OPENAI_TRANSCRIPT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(200).json({ ok: false, error: data?.error?.message ?? 'OpenAI transcription failed.' });
    }

    return res.status(200).json({ ok: true, text: typeof data?.text === 'string' ? data.text : '' });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error instanceof Error ? error.message : 'Audio transcription failed.' });
  }
}
