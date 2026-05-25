# Green Acres Command Center - Live Call Coach

This update adds a new **Live Call Coach** page.

## What it does

- Uses browser microphone speech recognition to create a live transcript.
- Sends the transcript, AI Memory, and recent cases to a Vercel serverless function.
- OpenAI returns short coaching text Carl can read during the call.
- Gives:
  - Decision: Carl can handle / Needs Bradley / Need more info first
  - What to say next
  - What to ask next
  - SOP triggers
  - Missing info
  - Do-not-say warnings
  - Call notes to copy after the call

## Required Vercel environment variables

```env
OPENAI_API_KEY=sk-proj-your-key-here
OPENAI_MODEL=gpt-4.1-mini
```

`OPENAI_MODEL` is optional. If it is missing, the app uses `gpt-4.1-mini`.

Do not use `VITE_` for the OpenAI key. It must stay server-side only.

## Browser note

Live transcription uses the browser SpeechRecognition API. Chrome or Edge is recommended.

If Carl is wearing headphones, the browser microphone may only hear Carl and not the customer. For both sides, use speaker mode or manually type key customer details in the manual context box.

## Cost control

Auto Coach refreshes suggestions while listening. To save OpenAI tokens, turn **Auto Coach Off** and click **Coach Now** only when needed.

## Files added/changed

```text
api/live-call-coach.ts
src/services/liveCallCoach.ts
src/pages/LiveCallCoachPage.tsx
src/App.tsx
src/components/layout/AppLayout.tsx
README_LIVE_CALL_COACH.md
```

No SQL changes are required.
