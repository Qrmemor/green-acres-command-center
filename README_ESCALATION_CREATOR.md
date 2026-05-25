# V28 Escalation Creator

Adds an Escalation Creator panel inside AI Triage / AI Chat Assistant.

## What it does

When the AI recommends `Needs Bradley`, the app automatically creates a clean escalation block that Carl can copy into the Add Escalation page's Quick Paste Escalation box.

It generates this format:

```text
ESCALATION — [Topic] — [Customer Name] — [Property Address]

Source / continue here: [Quo/Gmail/HomeWorks]

Situation: ...

Last touch: ...

Reason: ...

Proposed next step: ...
```

## Files included

- `src/pages/AITriagePage.tsx`
- `api/ai-chat.ts`
- `README_ESCALATION_CREATOR.md`

## Deploy

```powershell
npm run build
git add .
git commit -m "Add AI escalation creator"
git push
```
