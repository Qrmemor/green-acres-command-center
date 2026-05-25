# Green Acres Command Center v24 - OpenAI Triage

This update adds an optional OpenAI-powered triage engine.

## Files included

- `api/ai-triage.ts` - Vercel serverless API route that calls OpenAI safely on the server
- `src/services/openaiTriage.ts` - frontend helper that calls the server route and falls back to local SOP triage
- `src/pages/AITriagePage.tsx` - AI Triage page now uses OpenAI when available
- `src/components/forms/EscalationForm.tsx` - Add/Edit form AI analysis now uses OpenAI when available

## Required Vercel environment variable

Add this in Vercel Project Settings > Environment Variables:

```env
OPENAI_API_KEY=sk-proj-your-key-here
```

Optional:

```env
OPENAI_MODEL=gpt-4.1-mini
```

Do not add `VITE_` to the OpenAI key. It must stay server-only.

## Existing required environment variables

Keep your Supabase variables:

```env
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## Deployment

After copying files:

```powershell
npm run build
git add .
git commit -m "Add OpenAI powered triage"
git push
```

Vercel will redeploy automatically.

## Behavior

- If `OPENAI_API_KEY` is configured, AI Triage uses OpenAI + AI Memory + similar cases.
- If OpenAI fails or is not configured, the system still uses the local SOP triage fallback.
