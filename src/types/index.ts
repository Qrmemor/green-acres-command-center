export type Role = 'carl' | 'bradley' | 'admin';
export type ReportType = 'SOD' | 'EOD';
export type Urgency = 'Urgent / Customer-Sensitive' | 'Standard / Non-Urgent';
export type OwnerNextAction = 'Carl' | 'Bradley' | 'Customer';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string | null;
  role: Role;
  created_at: string;
}


export interface EscalationAttachment {
  id: string;
  escalation_id: string;
  file_name: string;
  file_path: string;
  file_url: string;
  file_type: string | null;
  file_size: number | null;
  created_by: string | null;
  created_at: string;
}

export interface Escalation {
  id: string;
  customer_name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  source_detail: string | null;
  call_link: string | null;
  thread_link: string | null;
  where_to_continue: string;
  urgency: Urgency;
  topic: string;
  situation: string;
  last_touch: string;
  reason_for_escalation: string;
  proposed_next_step: string;
  bradley_note: string | null;
  status: string;
  follow_up_date: string | null;
  owner_next_action: OwnerNextAction;
  created_by: string | null;
  assigned_to: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  attachments?: EscalationAttachment[];
}

export type EscalationPayload = Omit<Escalation, 'id' | 'created_at' | 'updated_at' | 'resolved_at' | 'attachments'> & {
  resolved_at?: string | null;
};

export interface ActivityLog {
  id: string;
  escalation_id: string;
  action_type: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  created_by_profile?: UserProfile | null;
}

export interface Comment {
  id: string;
  escalation_id: string;
  comment: string;
  created_by: string | null;
  created_at: string;
  created_by_profile?: UserProfile | null;
}

export interface SavedReport {
  id: string;
  report_type: ReportType;
  report_date: string;
  content: string;
  created_by: string | null;
  created_at: string;
}

export interface WorkspaceOption {
  id: string;
  category: 'source' | 'topic' | 'status';
  label: string;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
}

export interface EscalationFilters {
  search?: string;
  source?: string;
  urgency?: string;
  status?: string;
  topic?: string;
  followUp?: 'today' | 'overdue' | 'upcoming' | '';
  resolved?: boolean;
}

export interface DashboardStats {
  totalOpen: number;
  urgent: number;
  standard: number;
  waitingOnBradley: number;
  waitingOnCustomer: number;
  resolvedToday: number;
}
