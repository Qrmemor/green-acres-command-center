const OPENAI_API_URL = 'https://api.openai.com/v1/responses';

type ChatImage = {
  name?: string;
  type?: string;
  dataUrl: string;
};

type ChatMessage = {
  role: 'user' | 'assistant';
  text: string;
  images?: ChatImage[];
};

type IncomingPayload = {
  messages?: ChatMessage[];
  source?: string;
  topic?: string;
  memories?: Array<Record<string, unknown>>;
  similarCases?: Array<Record<string, unknown>>;
};

function clampText(value: unknown, max = 14000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2);
  return text.length > max ? `${text.slice(0, max)}\n...[trimmed]` : text;
}

function safeMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((message) => message && (message.role === 'user' || message.role === 'assistant'))
    .map((message) => ({
      role: message.role,
      text: typeof message.text === 'string' ? message.text : '',
      images: Array.isArray(message.images)
        ? message.images
            .filter((image: ChatImage) => typeof image?.dataUrl === 'string' && image.dataUrl.startsWith('data:image/'))
            .slice(0, 8)
        : []
    }));
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

function buildTranscript(messages: ChatMessage[]) {
  return messages
    .slice(-12)
    .map((message, index) => {
      const label = message.role === 'assistant' ? 'AI' : 'Carl';
      const imageNote = message.images?.length ? `\n[${message.images.length} image(s) attached to this message]` : '';
      return `${index + 1}. ${label}: ${message.text || '[no text]'}${imageNote}`;
    })
    .join('\n\n');
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
    const messages = safeMessages(body.messages).slice(-12);
    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user');
    const latestImages = (latestUserMessage?.images ?? []).slice(0, 8);
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    const systemPrompt = `You are the Green Acres Command Center AI assistant inside Carl's internal dashboard.\n\nYou help Carl, the VA, decide what to do before escalating to Bradley, the owner. You can read pasted text and screenshots.\n\nCore rules:\n- Never pretend to be Bradley.\n- Never claim a message was sent. You only advise Carl.\n- Respect Green Acres SOP and saved AI memories.\n- If a customer is angry, asks for a call, requests refund/discount, has a complaint, scope dispute, property damage, safety concern, commercial/HOA lead, collections issue, crew no-show, outside service area, job likely over $2,000, or Carl is not 100% sure, recommend escalating to Bradley.\n- If it is normal intake, ask for missing info first: full name, property address, service requested, timeline, photos/video, gate/access, pets, parking, irrigation/invisible fence, obstacles, and where to continue.\n- If saved AI Memory clearly gives a Carl-safe SOP reply, suggest that instead of escalating, unless there is a high-risk trigger.\n- For cleanup/project work that is fully booked until June, Carl can usually send the fully booked message unless the customer is upset, timing is urgent, scope/pricing is unusual, or it is mowing/turf.\n- Keep replies concise, practical, and SOP-locked.\n\nWhen helpful, answer with:\n1. Recommendation\n2. Why\n3. Missing info\n4. Suggested next step\n5. Suggested customer reply\n\nIf your recommendation is Needs Bradley, include enough detail for Carl to create an escalation. Use concise labels and avoid vague filler. The app may convert your answer into an escalation draft.\n\nFor screenshots, read the visible conversation carefully and summarize only what matters.`;

    const contextText = `SOURCE: ${body.source || 'Unknown'}\nTOPIC: ${body.topic || 'Other'}\n\nSAVED AI MEMORIES:\n${clampText((body.memories ?? []).slice(0, 12), 12000)}\n\nSIMILAR PAST CASES:\n${clampText((body.similarCases ?? []).slice(0, 6), 8000)}\n\nCHAT TRANSCRIPT:\n${clampText(buildTranscript(messages), 14000)}`;

    const content: Array<Record<string, unknown>> = [
      { type: 'input_text', text: contextText }
    ];

    for (const image of latestImages) {
      content.push({ type: 'input_image', image_url: image.dataUrl });
    }

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
          { role: 'user', content }
        ]
      })
    });

    const data = await response.json();
    if (!response.ok) {
      return res.status(200).json({ ok: false, error: data?.error?.message ?? 'OpenAI chat request failed.' });
    }

    const reply = extractOutputText(data).trim();
    return res.status(200).json({ ok: true, reply: reply || 'I could not generate a response. Please try again with more context.' });
  } catch (error) {
    return res.status(200).json({ ok: false, error: error instanceof Error ? error.message : 'OpenAI chat failed.' });
  }
}
