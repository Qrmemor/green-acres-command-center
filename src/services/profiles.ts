import { supabase } from '@/lib/supabase';
import type { Role, UserProfile } from '@/types';

export async function listProfiles() {
  const { data, error } = await supabase.from('users_profile').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as UserProfile[];
}

export async function updateProfileRole(id: string, role: Role) {
  const { data, error } = await supabase.from('users_profile').update({ role }).eq('id', id).select('*').single();
  if (error) throw error;
  return data as UserProfile;
}

export async function updateProfileName(id: string, fullName: string) {
  const { data, error } = await supabase.from('users_profile').update({ full_name: fullName }).eq('id', id).select('*').single();
  if (error) throw error;
  return data as UserProfile;
}
