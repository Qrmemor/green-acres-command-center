import type { AIMemory, Escalation } from '@/types';
import { analyzeEscalationDraft, type AITriageAnalysis, type TriageDraft } from '@/services/aiTriage';

interface OpenAITriageResponse {
  ok: boolean;
  fallback?: boolean;
  error?: string;
  analysis?: AITriageAnalysis & { engine?: string };
}

export async function analyzeEscalationDraftWithOpenAI(
  draft: TriageDraft,
  history: Escalation[] = [],
  memories: AIMemory[] = []
): Promise<AITriageAnalysis & { engine?: string; openAIError?: string }> {
  const localAnalysis = analyzeEscalationDraft(draft, history, memories) as AITriageAnalysis & { engine?: string; openAIError?: string };
  localAnalysis.engine = 'Local SOP';

  try {
    const response = await fetch('/api/ai-triage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        draft,
        localAnalysis,
        memories: localAnalysis.memoryMatches.map((match) => ({
          id: match.id,
          title: match.title,
          memory_type: match.memory_type,
          confidence: match.confidence,
          tags: match.tags,
          summary: match.summary,
          score: match.score
        })),
        similarCases: localAnalysis.similarCases
      })
    });

    const data = (await response.json()) as OpenAITriageResponse;
    if (data.ok && data.analysis) {
      return { ...localAnalysis, ...data.analysis, engine: 'OpenAI' };
    }

    return { ...localAnalysis, openAIError: data.error || 'OpenAI is unavailable, so local SOP triage was used.' };
  } catch (error) {
    return {
      ...localAnalysis,
      openAIError: error instanceof Error ? error.message : 'OpenAI is unavailable, so local SOP triage was used.'
    };
  }
}
