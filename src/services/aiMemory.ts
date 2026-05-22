import { supabase } from '@/lib/supabase';
import type { AIMemory, AIMemoryPayload, Escalation } from '@/types';

export type AIMemoryInput = Omit<AIMemoryPayload, 'created_by'>;

export async function listAIMemories(options: { activeOnly?: boolean; limit?: number } = {}) {
  let query = supabase
    .from('ai_memories')
    .select('*')
    .order('created_at', { ascending: false });

  if (options.activeOnly ?? true) {
    query = query.eq('is_active', true);
  }

  if (options.limit) {
    query = query.limit(options.limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as AIMemory[];
}

export async function createAIMemory(input: AIMemoryInput, userId?: string | null) {
  const payload: AIMemoryPayload = {
    ...input,
    tags: input.tags ?? [],
    confidence: input.confidence ?? 'medium',
    is_active: input.is_active ?? true,
    source_escalation_id: input.source_escalation_id ?? null,
    created_by: userId ?? null
  };

  const { data, error } = await supabase
    .from('ai_memories')
    .insert(payload)
    .select('*')
    .single();

  if (error) throw error;
  return data as AIMemory;
}

export async function updateAIMemory(id: string, updates: Partial<AIMemoryInput>) {
  const { data, error } = await supabase
    .from('ai_memories')
    .update(updates)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data as AIMemory;
}

export async function deactivateAIMemory(id: string) {
  return updateAIMemory(id, { is_active: false });
}

export async function deleteAIMemory(id: string) {
  const { error } = await supabase.from('ai_memories').delete().eq('id', id);
  if (error) throw error;
}

function clean(value?: string | null) {
  return (value ?? '').trim();
}

function detectMemoryType(escalation: Escalation): AIMemory['memory_type'] {
  const haystack = [
    escalation.topic,
    escalation.source,
    escalation.situation,
    escalation.reason_for_escalation,
    escalation.proposed_next_step,
    escalation.bradley_note,
    escalation.status
  ].filter(Boolean).join(' ').toLowerCase();

  if (haystack.includes('payment') || haystack.includes('invoice') || haystack.includes('automatic payment')) return 'workflow';
  if (haystack.includes('price') || haystack.includes('pricing') || haystack.includes('estimate') || haystack.includes('quote')) return 'pricing_scope';
  if (haystack.includes('outside service area') || haystack.includes('virginia')) return 'service_area';
  if (haystack.includes('reply') || haystack.includes('respond') || haystack.includes('customer')) return 'customer_reply';
  if (clean(escalation.bradley_note)) return 'bradley_pattern';
  return 'lesson';
}

function detectTags(escalation: Escalation) {
  const tags = new Set<string>();
  const haystack = [
    escalation.topic,
    escalation.source,
    escalation.urgency,
    escalation.status,
    escalation.situation,
    escalation.reason_for_escalation,
    escalation.proposed_next_step,
    escalation.bradley_note
  ].filter(Boolean).join(' ').toLowerCase();

  tags.add(escalation.topic);
  tags.add(escalation.source);
  if (escalation.urgency === 'Urgent / Customer-Sensitive') tags.add('urgent');
  if (haystack.includes('payment') || haystack.includes('invoice')) tags.add('payment');
  if (haystack.includes('pricing') || haystack.includes('price') || haystack.includes('quote') || haystack.includes('estimate')) tags.add('pricing');
  if (haystack.includes('photo') || haystack.includes('picture') || haystack.includes('screenshot')) tags.add('photos');
  if (haystack.includes('call')) tags.add('call');
  if (haystack.includes('complaint') || haystack.includes('frustrated') || haystack.includes('angry') || haystack.includes('upset')) tags.add('complaint');
  if (haystack.includes('scope')) tags.add('scope');
  if (haystack.includes('mowing')) tags.add('mowing');
  if (haystack.includes('turf')) tags.add('turf');
  if (haystack.includes('referral')) tags.add('referral');
  if (haystack.includes('outside service area') || haystack.includes('virginia')) tags.add('service-area');

  return Array.from(tags).filter(Boolean).slice(0, 10);
}

export function buildMemoryFromEscalation(escalation: Escalation): AIMemoryInput {
  const lessonSource = clean(escalation.bradley_note) || clean(escalation.proposed_next_step) || clean(escalation.reason_for_escalation);
  const titleTopic = escalation.topic || 'Escalation';
  const title = `${titleTopic} pattern from ${escalation.customer_name}`;

  const summaryParts = [
    `When a ${escalation.source} item involves ${titleTopic.toLowerCase()} for ${escalation.customer_name}, note this pattern:`,
    clean(escalation.reason_for_escalation) ? `Reason Bradley was needed: ${clean(escalation.reason_for_escalation)}` : '',
    clean(lessonSource) ? `Bradley / final direction: ${lessonSource}` : '',
    clean(escalation.proposed_next_step) ? `Recommended next step used: ${clean(escalation.proposed_next_step)}` : '',
    escalation.status ? `Final status pattern: ${escalation.status}.` : ''
  ].filter(Boolean);

  return {
    memory_type: detectMemoryType(escalation),
    title,
    summary: summaryParts.join('\n'),
    tags: detectTags(escalation),
    source_escalation_id: escalation.id,
    confidence: clean(escalation.bradley_note) || escalation.resolved_at ? 'high' : 'medium',
    is_active: true
  };
}
