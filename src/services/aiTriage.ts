import type { AIMemory, Escalation, OwnerNextAction, Urgency } from '@/types';

export type TriageDecision = 'Needs Bradley' | 'Need more info first' | 'Carl can handle';
export type TriageConfidence = 'High' | 'Medium' | 'Low';

export interface TriageDraft {
  customer_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  source?: string | null;
  topic?: string | null;
  urgency?: Urgency | null;
  situation?: string | null;
  last_touch?: string | null;
  reason_for_escalation?: string | null;
  proposed_next_step?: string | null;
  bradley_note?: string | null;
  where_to_continue?: string | null;
  hasEstimatePhotos?: boolean;
  hasNeedsMoreInfoScreenshots?: boolean;
}

export interface SimilarCase {
  id: string;
  customer_name: string;
  topic: string;
  source: string;
  status: string;
  urgency: Urgency;
  score: number;
  learned_from: string;
}

export interface MemoryMatch {
  id: string;
  title: string;
  memory_type: AIMemory['memory_type'];
  confidence: AIMemory['confidence'];
  tags: string[];
  score: number;
  summary: string;
}

export interface AITriageAnalysis {
  decision: TriageDecision;
  confidence: TriageConfidence;
  shouldEscalate: boolean;
  recommendedStatus: string;
  ownerNextAction: OwnerNextAction;
  recommendedUrgency: Urgency;
  sopTriggers: string[];
  missingInfo: string[];
  reasons: string[];
  suggestedNextStep: string;
  suggestedReply: string;
  bradleySummary: string;
  patternSummary: string;
  memoryPatternSummary: string;
  similarCases: SimilarCase[];
  memoryMatches: MemoryMatch[];
}

const HIGH_RISK_TRIGGERS = new Set([
  'Refund request',
  'Discount request',
  'Complaint / angry tone',
  'Scope dispute',
  'Commercial / HOA lead',
  'Job over $2,000',
  'Outside service area',
  'Property damage',
  'Safety issue',
  'Crew no-show',
  'Collections issue',
  'Anything Carl is not 100% sure about'
]);

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'was', 'were', 'are', 'you', 'your',
  'customer', 'bradley', 'carl', 'green', 'acres', 'please', 'they', 'them', 'their', 'about', 'into', 'onto'
]);

function text(value?: string | null) {
  return (value ?? '').trim();
}

function joinedDraft(draft: TriageDraft) {
  return [
    draft.customer_name,
    draft.address,
    draft.source,
    draft.topic,
    draft.situation,
    draft.last_touch,
    draft.reason_for_escalation,
    draft.proposed_next_step,
    draft.bradley_note,
    draft.where_to_continue
  ]
    .filter(Boolean)
    .join('\n')
    .toLowerCase();
}

function hasAny(haystack: string, terms: string[]) {
  return terms.some((term) => haystack.includes(term));
}

function detectTriggers(haystack: string, draft: TriageDraft) {
  const triggers: string[] = [];

  if (hasAny(haystack, ['call', 'called', 'callback', 'phone call', 'speak', 'talk to', 'missed call'])) triggers.push('Customer wants a call');
  if (hasAny(haystack, ['price', 'pricing', 'quote', 'estimate', 'cost', 'invoice', 'payment setup', 'automatic payment'])) triggers.push('Pricing unclear');
  if (hasAny(haystack, ['refund', 'reimburse'])) triggers.push('Refund request');
  if (hasAny(haystack, ['discount', 'cheaper', 'lower price'])) triggers.push('Discount request');
  if (hasAny(haystack, ['complaint', 'angry', 'upset', 'frustrated', 'unhappy', 'disappointed', 'mad', 'not happy'])) triggers.push('Complaint / angry tone');
  if (hasAny(haystack, ['scope dispute', 'not included', 'included', 'extra work', 'change order', 'different scope', 'scope unclear'])) triggers.push('Scope dispute');
  if (hasAny(haystack, ['commercial', 'hoa', 'property manager', 'multiple locations', 'apartment', 'condo association'])) triggers.push('Commercial / HOA lead');
  if (/\$\s?(?:[2-9]\d{3}|\d{1,3},\d{3,})/.test(haystack) || hasAny(haystack, ['over 2000', 'over $2000', 'over $2,000'])) triggers.push('Job over $2,000');
  if (hasAny(haystack, ['virginia', ' va ', 'outside service area', 'out of service area'])) triggers.push('Outside service area');
  if (hasAny(haystack, ['damage', 'damaged', 'broke', 'broken', 'property damage'])) triggers.push('Property damage');
  if (hasAny(haystack, ['safety', 'dangerous', 'steep', 'muddy', 'wet slope', 'liability', 'unsafe'])) triggers.push('Safety issue');
  if (hasAny(haystack, ['no-show', 'no show', 'did not show', 'crew did not come', 'crew never came'])) triggers.push('Crew no-show');
  if (hasAny(haystack, ['collections', 'overdue balance', 'past due', 'unpaid', 'payment failed'])) triggers.push('Collections issue');
  if (hasAny(haystack, ['not sure', 'unsure', 'confirm before', 'want to confirm', 'need direction', 'need review'])) triggers.push('Anything Carl is not 100% sure about');

  if (draft.topic === 'Refund' && !triggers.includes('Refund request')) triggers.push('Refund request');
  if (draft.topic === 'Complaint' && !triggers.includes('Complaint / angry tone')) triggers.push('Complaint / angry tone');
  if (draft.topic === 'Pricing' && !triggers.includes('Pricing unclear')) triggers.push('Pricing unclear');
  if (draft.topic === 'Scope' && !triggers.includes('Scope dispute')) triggers.push('Scope dispute');
  if (draft.topic === 'Payment' && !triggers.includes('Pricing unclear')) triggers.push('Pricing unclear');
  if (draft.topic === 'Call Needed' && !triggers.includes('Customer wants a call')) triggers.push('Customer wants a call');

  return Array.from(new Set(triggers));
}

function detectMissingInfo(draft: TriageDraft, haystack: string) {
  const missing: string[] = [];
  if (!text(draft.customer_name)) missing.push('Customer name');
  if (!text(draft.address)) missing.push('Property address');
  if (!text(draft.phone) && !text(draft.email)) missing.push('Customer phone or email');
  if (!text(draft.source)) missing.push('Source');
  if (!text(draft.situation)) missing.push('Clear situation summary');
  if (!text(draft.last_touch)) missing.push('Last touch / current ball-in-court');
  if (!text(draft.where_to_continue)) missing.push('Where to continue');

  const likelyEstimate = ['estimate', 'quote', 'pricing', 'price', 'scope', 'cleanup', 'mulch', 'turf', 'mowing', 'lawn', 'bed'].some((term) => haystack.includes(term));
  if (likelyEstimate && !draft.hasEstimatePhotos && !haystack.includes('photo') && !haystack.includes('picture') && !haystack.includes('video')) {
    missing.push('Photos/video or note that photos were requested');
  }

  return missing;
}

function words(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function similarityScore(a: string, b: string) {
  const aWords = new Set(words(a));
  const bWords = new Set(words(b));
  if (!aWords.size || !bWords.size) return 0;
  let overlap = 0;
  aWords.forEach((word) => {
    if (bWords.has(word)) overlap += 1;
  });
  return Math.round((overlap / Math.sqrt(aWords.size * bWords.size)) * 100);
}

function findSimilarCases(draft: TriageDraft, history: Escalation[]) {
  const draftText = joinedDraft(draft);
  return history
    .map((item) => {
      const caseText = [
        item.customer_name,
        item.topic,
        item.source,
        item.urgency,
        item.situation,
        item.reason_for_escalation,
        item.proposed_next_step,
        item.bradley_note,
        item.status
      ].filter(Boolean).join('\n');

      let score = similarityScore(draftText, caseText);
      if (draft.topic && item.topic === draft.topic) score += 18;
      if (draft.source && item.source === draft.source) score += 7;
      if (draft.urgency && item.urgency === draft.urgency) score += 5;
      score = Math.min(score, 100);

      const learnedFrom = item.bradley_note || item.proposed_next_step || item.reason_for_escalation || item.status;
      return {
        id: item.id,
        customer_name: item.customer_name,
        topic: item.topic,
        source: item.source,
        status: item.status,
        urgency: item.urgency,
        score,
        learned_from: learnedFrom
      } satisfies SimilarCase;
    })
    .filter((item) => item.score >= 18)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}


function findMemoryMatches(draft: TriageDraft, memories: AIMemory[]) {
  const draftText = joinedDraft(draft);

  return memories
    .filter((memory) => memory.is_active)
    .map((memory) => {
      const memoryText = [memory.title, memory.summary, ...(memory.tags ?? [])].filter(Boolean).join('\n');
      let score = similarityScore(draftText, memoryText);
      const draftTopic = text(draft.topic).toLowerCase();
      const draftSource = text(draft.source).toLowerCase();
      const tags = (memory.tags ?? []).map((tag) => tag.toLowerCase());

      if (draftTopic && tags.includes(draftTopic)) score += 20;
      if (draftSource && tags.includes(draftSource)) score += 8;
      if (memory.confidence === 'high') score += 8;
      if (memory.memory_type === 'sop_rule') score += 5;
      score = Math.min(score, 100);

      return {
        id: memory.id,
        title: memory.title,
        memory_type: memory.memory_type,
        confidence: memory.confidence,
        tags: memory.tags ?? [],
        score,
        summary: memory.summary
      } satisfies MemoryMatch;
    })
    .filter((item) => item.score >= 16)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

function makeSuggestedReply(decision: TriageDecision, draft: TriageDraft, missingInfo: string[]) {
  const name = text(draft.customer_name).split(' ')[0] || 'there';
  const topic = text(draft.topic).toLowerCase();

  if (decision === 'Need more info first') {
    const missingText = missingInfo.slice(0, 4).join(', ').toLowerCase();
    return `Hi ${name}, this is Carl with Green Acres. Thanks for reaching out. To help us review this properly, could you please send the missing details${missingText ? ` (${missingText})` : ''}? Photos or a short video are usually the fastest way for us to understand the scope. Thank you.`;
  }

  if (decision === 'Carl can handle') {
    return `Hi ${name}, this is Carl with Green Acres. Thank you for the update. I’ll note this on our side and keep the next step tracked. I’ll follow up if we need anything else.`;
  }

  if (topic.includes('payment')) {
    return `Hi ${name}, this is Carl with Green Acres. Thank you for reaching out. I’m going to confirm the payment/invoice setup internally first so I can send you the correct next step.`;
  }

  return `Hi ${name}, this is Carl with Green Acres. Thank you for the details. I’m going to review this internally first so we can give you the right next step.`;
}

export function analyzeEscalationDraft(draft: TriageDraft, history: Escalation[] = [], memories: AIMemory[] = []): AITriageAnalysis {
  const haystack = joinedDraft(draft);
  const sopTriggers = detectTriggers(haystack, draft);
  const missingInfo = detectMissingInfo(draft, haystack);
  const similarCases = findSimilarCases(draft, history);
  const memoryMatches = findMemoryMatches(draft, memories);
  const hasHighRisk = sopTriggers.some((trigger) => HIGH_RISK_TRIGGERS.has(trigger));
  const hasPricingOrOwnerDecision = sopTriggers.some((trigger) => ['Pricing unclear', 'Customer wants a call'].includes(trigger));
  const similarNeedsBradley = similarCases.some((item) => ['Needs Bradley', 'Waiting on Bradley'].includes(item.status) || item.urgency === 'Urgent / Customer-Sensitive');
  const memorySuggestsEscalation = memoryMatches.some((item) => /needs bradley|owner review|escalate|bradley should|bradley needs/i.test(item.summary));
  const memorySuggestsCarlCanHandle = memoryMatches.some((item) => /carl can handle|do not escalate|ask for photos|request photos|collect missing/i.test(item.summary));

  let decision: TriageDecision;
  if (hasHighRisk || hasPricingOrOwnerDecision || similarNeedsBradley || memorySuggestsEscalation) {
    decision = 'Needs Bradley';
  } else if (missingInfo.length > 0 || memorySuggestsCarlCanHandle) {
    decision = 'Need more info first';
  } else {
    decision = 'Carl can handle';
  }

  const recommendedUrgency: Urgency = hasHighRisk ? 'Urgent / Customer-Sensitive' : 'Standard / Non-Urgent';
  const recommendedStatus = decision === 'Needs Bradley' ? 'Needs Bradley' : decision === 'Need more info first' ? 'Follow-Up Needed' : 'Waiting on Customer';
  const ownerNextAction: OwnerNextAction = decision === 'Needs Bradley' ? 'Bradley' : 'Carl';

  const reasons: string[] = [];
  if (sopTriggers.length) reasons.push(`SOP trigger${sopTriggers.length > 1 ? 's' : ''}: ${sopTriggers.join(', ')}.`);
  if (missingInfo.length && decision !== 'Needs Bradley') reasons.push(`Missing intake details: ${missingInfo.join(', ')}.`);
  if (similarCases.length) reasons.push(`Found ${similarCases.length} similar past case${similarCases.length > 1 ? 's' : ''} in the dashboard.`);
  if (memoryMatches.length) reasons.push(`Found ${memoryMatches.length} AI memory match${memoryMatches.length > 1 ? 'es' : ''} from prior Bradley/Carl decisions.`);
  if (!reasons.length) reasons.push('No high-risk escalation trigger found from the current text.');

  const confidence: TriageConfidence = hasHighRisk || sopTriggers.length >= 2 || similarCases[0]?.score >= 45 || memoryMatches.some((item) => item.confidence === 'high' && item.score >= 35)
    ? 'High'
    : sopTriggers.length || missingInfo.length || similarCases.length
      ? 'Medium'
      : 'Low';

  const suggestedNextStep = decision === 'Needs Bradley'
    ? 'Escalate to Bradley with a short decision request, reason, and proposed next step.'
    : decision === 'Need more info first'
      ? `Do not escalate yet. Ask the customer for: ${missingInfo.slice(0, 4).join(', ') || 'the missing intake details'}.`
      : 'Carl can reply using the SOP and keep the item tracked without sending it to Bradley.';

  const bradleySummary = decision === 'Needs Bradley'
    ? `${text(draft.customer_name) || 'Customer'} needs Bradley direction. ${text(draft.reason_for_escalation) || sopTriggers.join(', ') || 'Owner decision appears needed.'}`
    : `${text(draft.customer_name) || 'Customer'} likely does not need Bradley yet. ${suggestedNextStep}`;

  const patternSummary = similarCases.length
    ? similarCases.map((item) => `${item.customer_name}: ${item.status} / ${item.topic}`).join(' | ')
    : 'No strong matching past cases found yet. The AI will become more useful as more Bradley decisions are stored.';

  const memoryPatternSummary = memoryMatches.length
    ? memoryMatches.map((item) => `${item.title}: ${item.summary.replace(/\s+/g, ' ').slice(0, 180)}`).join(' | ')
    : 'No saved AI memory matched this draft yet.';

  return {
    decision,
    confidence,
    shouldEscalate: decision === 'Needs Bradley',
    recommendedStatus,
    ownerNextAction,
    recommendedUrgency,
    sopTriggers,
    missingInfo,
    reasons,
    suggestedNextStep,
    suggestedReply: makeSuggestedReply(decision, draft, missingInfo),
    bradleySummary,
    patternSummary,
    memoryPatternSummary,
    similarCases,
    memoryMatches
  };
}
