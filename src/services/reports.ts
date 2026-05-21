import { supabase } from '@/lib/supabase';
import type { ReportType, SavedReport } from '@/types';

export async function saveReport(reportType: ReportType, reportDate: string, content: string) {
  const { data: userData } = await supabase.auth.getUser();
  const { data, error } = await supabase
    .from('saved_reports')
    .insert({ report_type: reportType, report_date: reportDate, content, created_by: userData.user?.id ?? null })
    .select('*')
    .single();

  if (error) throw error;
  return data as SavedReport;
}

export async function listSavedReports() {
  const { data, error } = await supabase.from('saved_reports').select('*').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as SavedReport[];
}
