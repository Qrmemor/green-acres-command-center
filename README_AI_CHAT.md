# Green Acres Command Center v25 - AI Chat Assistant

This update turns the AI Triage page into a ChatGPT-style assistant.

## What changed

- Replaces the old one-shot AI Triage form with a chat interface.
- Supports normal typed chat.
- Supports image attachments.
- Supports screenshot paste with `Win + Shift + S`, then `Ctrl + V` inside the chat box.
- Uses saved AI Memory and previous escalations as context.
- Uses OpenAI through a Vercel serverless API route, so the API key stays server-side.

## Required Vercel env vars

```env
OPENAI_API_KEY=sk-proj-...
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` is optional. If omitted, the API route uses `gpt-4.1-mini`.

## Files included

```text
api/ai-chat.ts
src/services/openaiChat.ts
src/pages/AITriagePage.tsx
README_AI_CHAT.md
```

## Deploy

After copying the files into the project:

```powershell
npm run build
git add .
git commit -m "Add ChatGPT-style AI chat with image paste"
git push
```

Vercel will auto-deploy after the push.
