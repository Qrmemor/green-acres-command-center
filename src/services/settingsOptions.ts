import { DEFAULT_SOURCES, DEFAULT_STATUSES, DEFAULT_TOPICS } from '@/lib/constants';
import { supabase } from '@/lib/supabase';
import type { WorkspaceOption } from '@/types';

export interface WorkspaceOptions {
  sources: string[];
  topics: string[];
  statuses: string[];
}

export const fallbackOptions: WorkspaceOptions = {
  sources: DEFAULT_SOURCES,
  topics: DEFAULT_TOPICS,
  statuses: DEFAULT_STATUSES
};

export async function getWorkspaceOptions(): Promise<WorkspaceOptions> {
  const { data, error } = await supabase
    .from('settings_options')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (error) {
    console.warn('Using fallback options because settings_options could not be loaded.', error.message);
    return fallbackOptions;
  }

  const rows = (data ?? []) as WorkspaceOption[];
  const byCategory = (category: WorkspaceOption['category'], fallback: string[]) => {
    const values = rows.filter((row) => row.category === category).map((row) => row.label);
    return values.length > 0 ? values : fallback;
  };

  return {
    sources: byCategory('source', DEFAULT_SOURCES),
    topics: byCategory('topic', DEFAULT_TOPICS),
    statuses: byCategory('status', DEFAULT_STATUSES)
  };
}

export async function getAllWorkspaceOptions() {
  const { data, error } = await supabase
    .from('settings_options')
    .select('*')
    .order('category', { ascending: true })
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });

  if (error) throw error;
  return (data ?? []) as WorkspaceOption[];
}

export async function createWorkspaceOption(category: WorkspaceOption['category'], label: string) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('settings_options')
    .insert({ category, label, created_by: userData.user?.id ?? null })
    .select('*')
    .single();

  if (error) throw error;
  return data as WorkspaceOption;
}

export async function updateWorkspaceOption(id: string, values: Partial<Pick<WorkspaceOption, 'label' | 'is_active' | 'sort_order'>>) {
  const { data, error } = await supabase.from('settings_options').update(values).eq('id', id).select('*').single();
  if (error) throw error;
  return data as WorkspaceOption;
}

export async function deleteWorkspaceOption(id: string) {
  const { error } = await supabase.from('settings_options').delete().eq('id', id);
  if (error) throw error;
}
