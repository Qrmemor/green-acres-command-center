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
  const recent = messages.slice(-12);
  return recent
    .map((message, index) => {
      const label = message.role === 'assistant' ? 'AI' : 'Carl';
      const imageNote = message.images?.length
        ? `\n[${message.images.length} screenshot/image attachment(s) on this ${label} message. These images are included after the transcript as visual context.]`
        : '';
      return `Message ${index + 1} - ${label}: ${message.text || '[no text]'}${imageNote}`;
    })
    .join('\n\n');
}

function collectRecentImages(messages: ChatMessage[]) {
  const recent = messages.slice(-12);
  const images: Array<{ messageNumber: number; role: 'user' | 'assistant'; image: ChatImage; imageNumber: number }> = [];

  recent.forEach((message, messageIndex) => {
    (message.images ?? []).forEach((image, imageIndex) => {
      images.push({
        messageNumber: messageIndex + 1,
        role: message.role,
        image,
        imageNumber: imageIndex + 1
      });
    });
  });

  // Keep the newest images, but preserve the original order for the model.
  return images.slice(-8);
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
    const recentImages = collectRecentImages(messages);
    const model = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

    const systemPrompt = `You are the Green Acres Command Center AI assistant inside Carl's internal dashboard.\n\nYou help Carl, the VA, decide what to do before escalating to Bradley, the owner. You can read pasted text and screenshots.\n\nCore rules:\n- Never pretend to be Bradley.\n- Never claim a message was sent. You only advise Carl.\n- Respect Green Acres SOP and saved AI memories.\n- If a customer is angry, asks for a call, requests refund/discount, has a complaint, scope dispute, property damage, safety concern, commercial/HOA lead, collections issue, crew no-show, outside service area, job likely over $2,000, or Carl is not 100% sure, recommend escalating to Bradley.\n- If it is normal intake, ask for missing info first: full name, property address, service requested, timeline, photos/video, gate/access, pets, parking, irrigation/invisible fence, obstacles, and where to continue.\n- If saved AI Memory clearly gives a Carl-safe SOP reply, suggest that instead of escalating, unless there is a high-risk trigger.\n- For cleanup/project work that is fully booked until June, Carl can usually send the fully booked message unless the customer is upset, timing is urgent, scope/pricing is unusual, or it is mowing/turf.\n- Keep replies concise, practical, and SOP-locked.\n- Maintain the chat context until Carl clicks New chat. If Carl asks a follow-up like "where did you see that?" or "saan mo nakita yan?", use the previous messages and screenshots already in this same chat. Do not say there is no screenshot if earlier messages had screenshots.\n- When referring to screenshot evidence, briefly say what visible text or clue you used.\n\nWhen helpful, answer with:\n1. Recommendation\n2. Why\n3. Missing info\n4. Suggested next step\n5. Suggested customer reply\n\nIf your recommendation is Needs Bradley, include enough detail for Carl to create an escalation. Use concise labels and avoid vague filler. The app may convert your answer into an escalation draft.\n\nFor screenshots, read the visible conversation carefully and summarize only what matters.`;

    const contextText = `SOURCE: ${body.source || 'Unknown'}\nTOPIC: ${body.topic || 'Other'}\n\nIMPORTANT CONTINUITY RULE:\nThis is one ongoing chat session. Use previous user messages, assistant replies, and prior screenshots/images until Carl clicks New chat. If Carl asks a follow-up, answer from the previous context instead of asking him to upload the same screenshot again.\n\nSAVED AI MEMORIES:\n${clampText((body.memories ?? []).slice(0, 12), 12000)}\n\nSIMILAR PAST CASES:\n${clampText((body.similarCases ?? []).slice(0, 6), 8000)}\n\nCHAT TRANSCRIPT:\n${clampText(buildTranscript(messages), 14000)}\n\nRECENT SCREENSHOTS INCLUDED: ${recentImages.length}`;

    const content: Array<Record<string, unknown>> = [
      { type: 'input_text', text: contextText }
    ];

    for (const item of recentImages) {
      const label = item.role === 'assistant' ? 'AI' : 'Carl';
      content.push({
        type: 'input_text',
        text: `Screenshot/image ${item.imageNumber} from Message ${item.messageNumber} (${label}). Use this as visual context for follow-up questions. File name: ${item.image.name || 'pasted screenshot'}`
      });
      content.push({ type: 'input_image', image_url: item.image.dataUrl });
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
