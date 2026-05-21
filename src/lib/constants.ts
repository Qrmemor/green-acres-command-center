import type { OwnerNextAction, Urgency } from '@/types';

export const APP_NAME = 'Green Acres Command Center';

export const DEFAULT_SOURCES = ['Quo', 'Gmail', 'HomeWorks', 'Other'];

export const DEFAULT_TOPICS = [
  'Pricing',
  'Refund',
  'Call Needed',
  'Complaint',
  'Scheduling',
  'Estimate',
  'Scope',
  'Payment',
  'Referral',
  'Turf Program',
  'Mowing',
  'Website Purchase',
  'Other'
];

export const DEFAULT_STATUSES = [
  'Needs Bradley',
  'Waiting on Bradley',
  'Waiting on Customer',
  'Bradley Replied',
  'Approved',
  'Ready for Carl',
  'Follow-Up Needed',
  'Resolved',
  'Closed',
  'Not a Fit'
];

export const URGENCY_OPTIONS: Urgency[] = ['Urgent / Customer-Sensitive', 'Standard / Non-Urgent'];

export const OWNER_NEXT_ACTION_OPTIONS: OwnerNextAction[] = ['Carl', 'Bradley', 'Customer'];

export const ESCALATION_TRIGGERS = [
  'Customer wants a call',
  'Pricing unclear',
  'Refund request',
  'Discount request',
  'Complaint',
  'Angry or emotional tone',
  'Scope dispute',
  'Commercial / HOA lead',
  'Job over $2,000',
  'Outside service area',
  'Property damage',
  'Safety issue',
  'Crew no-show',
  'Collections issue',
  'Anything Carl is not 100% sure about'
];

export const RESOLVED_STATUSES = ['Resolved', 'Closed', 'Not a Fit'];

export const SOURCE_ORDER = ['Quo', 'HomeWorks', 'Gmail', 'Other'];

export const BRADLEY_ACTIONS = [
  {
    label: 'Call Needed',
    status: 'Waiting on Bradley',
    ownerNextAction: 'Bradley',
    note: 'Bradley marked call needed. Open Quo/OpenPhone and call the customer.'
  },
  {
    label: 'Reply Needed',
    status: 'Waiting on Bradley',
    ownerNextAction: 'Bradley',
    note: 'Bradley is preparing a reply note for Carl.'
  },
  {
    label: 'Okay Carl, Work This',
    status: 'Ready for Carl',
    ownerNextAction: 'Carl',
    note: 'Bradley approved this for Carl to work.'
  },
  {
    label: 'Needs More Info',
    status: 'Follow-Up Needed',
    ownerNextAction: 'Carl',
    note: 'Bradley requested more information. Carl to gather details.'
  },
  {
    label: 'I Replied',
    status: 'Bradley Replied',
    ownerNextAction: 'Customer',
    note: 'Bradley replied directly. Waiting on customer if needed.'
  },
  {
    label: 'Resolved',
    status: 'Resolved',
    ownerNextAction: 'Carl',
    note: 'Bradley marked item resolved.'
  }
] as const;
