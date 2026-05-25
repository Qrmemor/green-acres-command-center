import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Clipboard, FileText, ImagePlus, Loader2, RefreshCw, Send, Sparkles, Trash2, Upload, User, Wand2, X } from 'lucide-react';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { DEFAULT_TOPICS } from '@/lib/constants';
import { listAIMemories } from '@/services/aiMemory';
import { listEscalations } from '@/services/escalations';
import { sendAIChatMessage, type AIChatImage, type AIChatMessage } from '@/services/openaiChat';
import type { AIMemory, Escalation } from '@/types';

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

function makeId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function fileToChatImage(file: File): Promise<AIChatImage> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error(`${file.name} is not an image.`));
      return;
    }

    if (file.size > MAX_IMAGE_SIZE) {
      reject(new Error(`${file.name} is too large. Max image size is 10 MB.`));
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        id: makeId(),
        name: file.name || `pasted-screenshot-${Date.now()}.png`,
        type: file.type || 'image/png',
        dataUrl: String(reader.result)
      });
    };
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function createAssistantWelcome(): AIChatMessage {
  return {
    id: makeId(),
    role: 'assistant',
    text: 'Hi Carl. Paste the customer message or screenshot here. I can help check if this needs Bradley, what info is missing, and what reply you can send based on SOP and AI Memory.',
    createdAt: new Date().toISOString()
  };
}


function cleanLine(value: string) {
  return value.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
}

function truncate(value: string, max = 700) {
  const text = cleanLine(value);
  return text.length > max ? `${text.slice(0, max).trim()}...` : text;
}

function extractSection(text: string, labels: string[]) {
  const lines = text.split(/\r?\n/);
  const labelPattern = labels.map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const startIndex = lines.findIndex((line) => new RegExp(`^\\s*(?:\\*\\*)?(${labelPattern})(?:\\*\\*)?\\s*:?`, 'i').test(line));
  if (startIndex === -1) return '';

  const collected: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*(?:\*\*)?(Recommendation|Why|Missing info|Suggested next step|Suggested customer reply|Escalation Creator|SOP triggered|Confidence)(?:\*\*)?\s*:?/i.test(line)) break;
    if (line.trim()) collected.push(line.replace(/^\s*[-•]\s*/, ''));
  }
  return truncate(collected.join(' '), 650);
}

function firstMeaningfulLines(value: string, maxLines = 4) {
  return value
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter(Boolean)
    .slice(0, maxLines)
    .join(' ');
}

function guessCustomerName(text: string) {
  const escalationMatch = text.match(/ESCALATION\s*[—-]\s*[^—\n-]+[—-]\s*([^—\n-]+)\s*[—-]/i);
  if (escalationMatch?.[1]) return cleanLine(escalationMatch[1]);

  const customerMatch = text.match(/(?:customer|client|name)\s*[:\-]\s*([^\n,]+)/i);
  if (customerMatch?.[1]) return cleanLine(customerMatch[1]);

  const capitalizedName = text.match(/\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b/);
  return capitalizedName?.[1] ? cleanLine(capitalizedName[1]) : '[Customer Name]';
}

function guessAddress(text: string) {
  const escalationMatch = text.match(/ESCALATION\s*[—-]\s*[^—\n-]+[—-]\s*[^—\n-]+[—-]\s*([^\n]+)/i);
  if (escalationMatch?.[1]) return cleanLine(escalationMatch[1]);

  const addressMatch = text.match(/(?:address|property)\s*[:\-]\s*([^\n]+)/i);
  if (addressMatch?.[1]) return cleanLine(addressMatch[1]);

  const streetMatch = text.match(/\b\d{2,6}\s+[A-Za-z0-9 .'-]+\s+(?:St|Street|Ave|Avenue|Rd|Road|Dr|Drive|Ct|Court|Ln|Lane|Way|Blvd|Boulevard)\b[^\n]*/i);
  return streetMatch?.[0] ? cleanLine(streetMatch[0]) : '[Property Address]';
}

function extractInlineField(text: string, labels: string[]) {
  for (const label of labels) {
    const match = text.match(new RegExp(`${label}\\s*[:\\-]\\s*([^\\n]+)`, 'i'));
    if (match?.[1]) return truncate(match[1], 450);
  }
  return '';
}

function shouldCreateEscalation(reply: string, userText: string) {
  const recommendation = reply.match(/Recommendation\s*:?\s*\*?\*?([^\n]+)/i)?.[1] ?? '';
  const stronglyNeedsBradley = /needs\s+bradley|escalate\s+to\s+bradley|owner\s+review|bradley\s+needs/i.test(recommendation);
  const explicitEscalation = /ESCALATION\s*[—-]|create\s+an?\s+escalation|escalation\s+draft/i.test(userText);
  const notEscalation = /carl\s+can\s+handle|need\s+more\s+info\s+first|do\s+not\s+escalate|not\s+need\s+bradley/i.test(recommendation);
  return explicitEscalation || (stronglyNeedsBradley && !notEscalation);
}

function buildEscalationTemplateFromChat(params: {
  source: string;
  topic: string;
  userText: string;
  assistantText: string;
}) {
  const { source, topic, userText, assistantText } = params;
  const combined = `${userText}\n${assistantText}`;
  const customerName = guessCustomerName(combined);
  const address = guessAddress(combined);
  const sourceDetail = source === 'Gmail' ? 'team@ email' : source === 'HomeWorks' ? 'HomeWorks text/thread' : source === 'Quo' ? 'Quo thread' : source;

  const situation =
    extractInlineField(userText, ['Situation']) ||
    extractSection(assistantText, ['Situation', 'Summary']) ||
    truncate(firstMeaningfulLines(userText, 5), 800) ||
    '[Short situation summary]';

  const reason =
    extractInlineField(userText, ['Reason']) ||
    extractSection(assistantText, ['Why', 'Reason']) ||
    'Bradley direction is needed before Carl replies or commits to the next step.';

  const proposed =
    extractInlineField(userText, ['Proposed next step', 'Next step']) ||
    extractSection(assistantText, ['Suggested next step', 'Next step']) ||
    'Please confirm the next step Carl should take.';

  const lastTouch = extractInlineField(userText, ['Last touch']) || `[Add date/time] via ${source}`;

  return `ESCALATION — ${topic || 'Other'} — ${customerName} — ${address}\n\nSource / continue here: ${sourceDetail}\n\nSituation: ${situation}\n\nLast touch: ${lastTouch}\n\nReason: ${reason}\n\nProposed next step: ${proposed}`;
}

function MessageBubble({ message, onCopy }: { message: AIChatMessage; onCopy: (value: string) => void }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser ? (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
          <Bot className="h-5 w-5" />
        </div>
      ) : null}

      <div className={`max-w-[86%] rounded-3xl border px-4 py-3 shadow-sm ${isUser ? 'border-ga-100 bg-ga-700 text-white' : 'border-slate-200 bg-white text-slate-800'}`}>
        {message.images?.length ? (
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {message.images.map((image) => (
              <a key={image.id} href={image.dataUrl} target="_blank" rel="noreferrer" className="group overflow-hidden rounded-2xl border border-white/40 bg-white/20">
                <img src={image.dataUrl} alt={image.name} className="h-24 w-full object-cover transition group-hover:scale-[1.02]" />
              </a>
            ))}
          </div>
        ) : null}

        <div className="whitespace-pre-wrap text-sm leading-6">{message.text}</div>

        {!isUser ? (
          <div className="mt-3 flex justify-end">
            <Button size="sm" variant="secondary" onClick={() => onCopy(message.text)} leftIcon={<Clipboard className="h-3.5 w-3.5" />}>
              Copy
            </Button>
          </div>
        ) : null}
      </div>

      {isUser ? (
        <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-ga-50 text-ga-700">
          <User className="h-5 w-5" />
        </div>
      ) : null}
    </div>
  );
}

export function AITriagePage() {
  const [source, setSource] = useState('Quo');
  const [topic, setTopic] = useState('Other');
  const [messages, setMessages] = useState<AIChatMessage[]>([createAssistantWelcome()]);
  const [input, setInput] = useState('');
  const [pendingImages, setPendingImages] = useState<AIChatImage[]>([]);
  const [history, setHistory] = useState<Escalation[]>([]);
  const [memories, setMemories] = useState<AIMemory[]>([]);
  const [loading, setLoading] = useState(false);
  const [contextLoading, setContextLoading] = useState(true);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [escalationDraft, setEscalationDraft] = useState('');
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let mounted = true;

    async function loadContext() {
      setContextLoading(true);
      try {
        const [nextHistory, nextMemories] = await Promise.all([listEscalations(), listAIMemories({ activeOnly: true })]);
        if (!mounted) return;
        setHistory(nextHistory);
        setMemories(nextMemories);
      } catch (err) {
        if (mounted) setError(err instanceof Error ? err.message : 'Unable to load AI context.');
      } finally {
        if (mounted) setContextLoading(false);
      }
    }

    loadContext();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const activeMemoryCount = useMemo(() => memories.filter((memory) => memory.is_active).length, [memories]);

  const addFiles = async (files: File[]) => {
    setError('');
    const images: AIChatImage[] = [];
    for (const file of files) {
      try {
        images.push(await fileToChatImage(file));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not attach an image.');
      }
    }
    if (images.length) setPendingImages((current) => [...current, ...images].slice(0, 8));
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    await addFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handlePaste = async (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (imageFiles.length) {
      await addFiles(imageFiles);
    }
  };

  const getLatestUserMessage = () => [...messages].reverse().find((message) => message.role === 'user');

  const createEscalationDraft = (assistantText?: string, userMessage?: AIChatMessage) => {
    const latestUserMessage = userMessage ?? getLatestUserMessage();
    if (!latestUserMessage) {
      setError('Send a customer message or screenshot first, then create the escalation draft.');
      return '';
    }

    const latestAssistantText = assistantText ?? [...messages].reverse().find((message) => message.role === 'assistant')?.text ?? '';
    const draft = buildEscalationTemplateFromChat({
      source,
      topic,
      userText: latestUserMessage.text,
      assistantText: latestAssistantText
    });
    setEscalationDraft(draft);
    return draft;
  };

  const send = async () => {
    const text = input.trim();
    if (!text && !pendingImages.length) {
      setError('Type a message or paste a screenshot first.');
      return;
    }

    const userMessage: AIChatMessage = {
      id: makeId(),
      role: 'user',
      text: text || 'Please review the attached screenshot(s).',
      images: pendingImages,
      createdAt: new Date().toISOString()
    };

    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);
    setInput('');
    setPendingImages([]);
    setError('');
    setCopied('');
    setLoading(true);

    try {
      const reply = await sendAIChatMessage({ messages: nextMessages, source, topic, history, memories });
      setMessages((current) => [
        ...current,
        {
          id: makeId(),
          role: 'assistant',
          text: reply,
          createdAt: new Date().toISOString()
        }
      ]);

      if (shouldCreateEscalation(reply, userMessage.text)) {
        setEscalationDraft(buildEscalationTemplateFromChat({ source, topic, userText: userMessage.text, assistantText: reply }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI chat failed.');
    } finally {
      setLoading(false);
    }
  };

  const copy = async (value: string) => {
    await navigator.clipboard.writeText(value);
    setCopied('Copied.');
    window.setTimeout(() => setCopied(''), 1800);
  };

  const clearChat = () => {
    setMessages([createAssistantWelcome()]);
    setInput('');
    setPendingImages([]);
    setError('');
    setCopied('');
    setEscalationDraft('');
  };

  return (
    <div className="page-shell max-w-6xl">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="page-kicker">AI COMMAND CENTER</p>
          <h1 className="page-title">AI Chat Assistant</h1>
          <p className="page-subtitle">
            Chat with your Green Acres AI. Paste customer messages, internal notes, or screenshots, then ask if Carl can handle it or if Bradley needs to decide.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-500">
          <span className="rounded-full bg-ga-50 px-3 py-1 font-medium text-ga-800">{activeMemoryCount} memories loaded</span>
          <span className="rounded-full bg-blue-50 px-3 py-1 font-medium text-blue-700">{history.length} cases available</span>
        </div>
      </div>

      {error ? <Alert className="mb-5 text-red-700">{error}</Alert> : null}
      {copied ? <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{copied}</div> : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-slate-100">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-ga-700" /> Chat before you escalate
                </CardTitle>
                <CardDescription>It does not send anything to customers or Bradley. It only gives recommendations.</CardDescription>
              </div>
              <Button variant="secondary" onClick={clearChat} leftIcon={<RefreshCw className="h-4 w-4" />}>
                New chat
              </Button>
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="h-[560px] space-y-5 overflow-y-auto bg-slate-50/70 px-4 py-5 sm:px-6">
              {messages.map((message) => <MessageBubble key={message.id} message={message} onCopy={copy} />)}
              {loading ? (
                <div className="flex gap-3">
                  <div className="mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-700">
                    <Bot className="h-5 w-5" />
                  </div>
                  <div className="rounded-3xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                    <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Thinking...</span>
                  </div>
                </div>
              ) : null}
              <div ref={chatEndRef} />
            </div>

            <div className="border-t border-slate-100 bg-white p-4">
              {pendingImages.length ? (
                <div className="mb-3 grid gap-2 sm:grid-cols-4">
                  {pendingImages.map((image) => (
                    <div key={image.id} className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                      <img src={image.dataUrl} alt={image.name} className="h-24 w-full object-cover" />
                      <button
                        type="button"
                        onClick={() => setPendingImages((current) => current.filter((item) => item.id !== image.id))}
                        className="absolute right-2 top-2 rounded-full bg-white/90 p-1 text-slate-600 shadow-sm hover:text-red-600"
                        aria-label="Remove image"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onPaste={handlePaste}
                className="min-h-[120px]"
                placeholder="Type your question, paste the customer message, or press Ctrl + V after taking a screenshot with Win + Shift + S."
              />

              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap gap-2">
                  <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileChange} />
                  <Button variant="secondary" onClick={() => fileInputRef.current?.click()} leftIcon={<ImagePlus className="h-4 w-4" />}>
                    Attach image
                  </Button>
                  <Button variant="ghost" onClick={() => setPendingImages([])} leftIcon={<Trash2 className="h-4 w-4" />} disabled={!pendingImages.length}>
                    Clear images
                  </Button>
                </div>
                <Button onClick={send} disabled={loading || contextLoading} leftIcon={<Send className="h-4 w-4" />}>
                  {loading ? 'Sending...' : 'Send to AI'}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Context</CardTitle>
              <CardDescription>Choose the source/topic so the AI gives better SOP guidance.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="ai-source">Source</Label>
                <Select id="ai-source" value={source} onChange={(event) => setSource(event.target.value)} options={['Quo', 'HomeWorks', 'Gmail', 'Other']} />
              </div>
              <div>
                <Label htmlFor="ai-topic">Topic</Label>
                <Select id="ai-topic" value={topic} onChange={(event) => setTopic(event.target.value)} options={DEFAULT_TOPICS} />
              </div>
              <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
                <p className="font-semibold">Screenshot paste tip</p>
                <p className="mt-1">Use Win + Shift + S, select the conversation, click the chat box, then press Ctrl + V.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5 text-ga-700" /> Escalation Creator</CardTitle>
              <CardDescription>If AI says this needs Bradley, this creates a clean escalation block you can copy into Add Escalation Quick Paste.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {escalationDraft ? (
                <>
                  <Textarea value={escalationDraft} readOnly className="min-h-[260px] text-xs leading-5" />
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => copy(escalationDraft)} leftIcon={<Clipboard className="h-4 w-4" />}>
                      Copy escalation
                    </Button>
                    <Button variant="secondary" onClick={() => createEscalationDraft()} leftIcon={<Wand2 className="h-4 w-4" />}>
                      Regenerate
                    </Button>
                    <Button variant="ghost" onClick={() => setEscalationDraft('')}>
                      Clear
                    </Button>
                  </div>
                  <p className="text-xs leading-5 text-slate-500">
                    Paste this into Add Escalation → Quick Paste Escalation, then fill anything missing like exact customer name, address, date, or where to continue.
                  </p>
                </>
              ) : (
                <>
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                    No escalation draft yet. If the AI recommends Needs Bradley, it will appear here automatically.
                  </div>
                  <Button variant="secondary" onClick={() => createEscalationDraft()} leftIcon={<Wand2 className="h-4 w-4" />}>
                    Create from latest chat
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5 text-ga-700" /> What to paste</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-600">
              <p>Paste customer messages, Quo screenshots, Gmail replies, HomeWorks notes, or your draft escalation.</p>
              <p>Ask things like:</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Does this need Bradley?</li>
                <li>What info is missing?</li>
                <li>Can Carl reply using SOP?</li>
                <li>Draft a safe customer reply.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
