import { supabase } from '@/lib/supabase';
import { isResolvedStatus } from '@/lib/utils';
import type { ActivityLog, Comment, Escalation, EscalationFilters, EscalationPayload, OwnerNextAction } from '@/types';

function applyFilters(query: ReturnType<typeof supabase.from> extends never ? never : any, filters?: EscalationFilters) {
  let nextQuery = query;

  if (filters?.resolved === true) {
    nextQuery = nextQuery.not('resolved_at', 'is', null);
  } else if (filters?.resolved === false) {
    nextQuery = nextQuery.is('resolved_at', null);
  }

  if (filters?.source) nextQuery = nextQuery.eq('source', filters.source);
  if (filters?.urgency) nextQuery = nextQuery.eq('urgency', filters.urgency);
  if (filters?.status) nextQuery = nextQuery.eq('status', filters.status);
  if (filters?.topic) nextQuery = nextQuery.eq('topic', filters.topic);
  if (filters?.search) {
    const term = filters.search.replace(/%/g, '').trim();
    if (term) {
      nextQuery = nextQuery.or(
        `customer_name.ilike.%${term}%,address.ilike.%${term}%,topic.ilike.%${term}%,situation.ilike.%${term}%,reason_for_escalation.ilike.%${term}%`
      );
    }
  }

  const today = new Date().toISOString().split('T')[0];
  if (filters?.followUp === 'today') nextQuery = nextQuery.eq('follow_up_date', today);
  if (filters?.followUp === 'overdue') nextQuery = nextQuery.lt('follow_up_date', today).is('resolved_at', null);
  if (filters?.followUp === 'upcoming') nextQuery = nextQuery.gt('follow_up_date', today).is('resolved_at', null);

  return nextQuery;
}

export async function listEscalations(filters?: EscalationFilters) {
  let query = supabase.from('escalations').select('*, attachments:escalation_attachments(*)').order('created_at', { ascending: false });
  query = applyFilters(query, filters);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Escalation[];
}

export async function getEscalation(id: string) {
  const { data, error } = await supabase.from('escalations').select('*, attachments:escalation_attachments(*)').eq('id', id).single();
  if (error) throw error;
  return data as Escalation;
}

export async function createEscalation(payload: Omit<EscalationPayload, 'created_by'>) {
  const { data: userData } = await supabase.auth.getUser();
  const values = {
    ...payload,
    created_by: userData.user?.id ?? null,
    resolved_at: isResolvedStatus(payload.status) ? new Date().toISOString() : null
  };

  const { data, error } = await supabase.from('escalations').insert(values).select('*').single();
  if (error) throw error;

  await createActivityLog(data.id, 'Created escalation', 'Created escalation');
  return data as Escalation;
}

export async function updateEscalation(id: string, payload: Partial<EscalationPayload>, activityNote = 'Carl updated escalation') {
  const nextPayload = {
    ...payload,
    resolved_at: payload.status ? (isResolvedStatus(payload.status) ? new Date().toISOString() : null) : undefined
  };

  const { data, error } = await supabase.from('escalations').update(nextPayload).eq('id', id).select('*').single();
  if (error) throw error;

  await createActivityLog(id, activityNote, activityNote);
  return data as Escalation;
}

export async function updateEscalationStatus(id: string, status: string, note?: string) {
  return updateEscalation(id, { status }, note ?? `Status changed to ${status}`);
}

export async function updateBradleyAction(
  id: string,
  status: string,
  ownerNextAction: OwnerNextAction,
  note?: string,
  extraPayload: Partial<EscalationPayload> = {}
) {
  return updateEscalation(
    id,
    { ...extraPayload, status, owner_next_action: ownerNextAction },
    note ?? `Bradley action: ${status}`
  );
}

export async function archiveEscalation(id: string) {
  return updateEscalation(id, { status: 'Closed' }, 'Archived escalation');
}

export async function deleteEscalation(id: string) {
  const { error } = await supabase.from('escalations').delete().eq('id', id);
  if (error) throw error;
}

export async function listActivityLogs(escalationId: string) {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('escalation_id', escalationId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as ActivityLog[];
}

export async function createActivityLog(escalationId: string, actionType: string, note?: string) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('activity_logs')
    .insert({ escalation_id: escalationId, action_type: actionType, note: note ?? null, created_by: userData.user?.id ?? null })
    .select('*')
    .single();

  if (error) throw error;
  return data as ActivityLog;
}

export async function listComments(escalationId: string) {
  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .eq('escalation_id', escalationId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Comment[];
}

export async function addComment(escalationId: string, comment: string) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('comments')
    .insert({ escalation_id: escalationId, comment, created_by: userData.user?.id ?? null })
    .select('*')
    .single();

  if (error) throw error;
  await createActivityLog(escalationId, 'Comment added', 'Comment added');
  return data as Comment;
}
