# Live Call Coach: Tab Audio Mode

Use this update when Carl is wearing headphones and the call is inside a browser tab such as Quo or OpenPhone.

## What changed

- Added `Capture Tab Audio` mode to Live Call Coach.
- Added `/api/live-call-transcribe` Vercel function.
- Tab audio is transcribed through OpenAI, then the existing Live Call Coach uses the transcript plus SOP and AI Memory.
- Microphone mode still works for speaker calls.

## How to use

1. Open the Quo/OpenPhone call in a browser tab.
2. Open Green Acres Command Center in another tab.
3. Go to `Live Call Coach`.
4. Click `Capture Tab Audio`.
5. In the browser sharing popup, select the Quo/OpenPhone call tab.
6. Make sure `Share tab audio` is checked.
7. Click `Share`.
8. Keep your headphones on. The system should transcribe the customer audio from the selected tab.

## Environment variables

Required on Vercel:

```env
OPENAI_API_KEY=sk-proj-your-key
```

Optional:

```env
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe
```

## Notes

- Browser security requires the user to choose the tab manually.
- If no audio appears, start again and make sure `Share tab audio` is checked.
- Chrome or Edge is recommended.
- The app cannot secretly capture system audio.
