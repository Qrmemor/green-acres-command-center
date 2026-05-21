# Green Acres Command Center

Internal escalation decision dashboard for Green Acres Landscaping.

This app helps Carl, the VA/operator, manually enter escalations from Quo, HomeWorks, and Gmail team@ so Bradley can review one clean dashboard instead of long scattered threads.

## What this MVP includes

- Supabase email/password authentication
- Protected routes
- Dashboard summary cards
- Urgent / Customer-Sensitive section
- Standard / Non-Urgent section
- Waiting on Bradley section
- Open Loops section
- Add escalation form
- Edit escalation form
- Escalation detail page
- Comments
- Activity logs
- Bradley simplified review page
- Bradley quick actions
- SOD / EOD report generator
- Copy report to clipboard
- Save generated reports
- Resolved / closed escalation archive
- Search and filters
- Settings page for users and options
- Responsive layout
- Supabase SQL schema and RLS policies

## Tech stack

- React
- TypeScript
- Vite
- Tailwind CSS
- ShadCN-style local UI components
- Lucide icons
- Framer Motion
- Supabase Auth
- Supabase PostgreSQL
- Supabase RLS

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

Go to Supabase and create a new project.

### 3. Run the SQL schema

Open Supabase SQL Editor and run:

```sql
-- paste the full content of supabase/schema.sql
```

This creates:

- users_profile
- escalations
- activity_logs
- comments
- saved_reports
- settings_options
- RLS policies
- profile trigger for new auth users
- default source/topic/status options

### 4. Create your `.env` file

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Add your Supabase values:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

You can find these in Supabase:

Project Settings → API

### 5. Create users in Supabase Auth

Create users under:

Authentication → Users

Suggested users:

- Carl: role `carl`
- Bradley: role `bradley`
- Admin: role `admin`

The SQL trigger automatically creates a row in `users_profile` when a Supabase Auth user is created.

If the role defaults to `carl`, update it from the Settings page or directly in SQL:

```sql
update public.users_profile
set role = 'bradley'
where email = 'bradley@example.com';
```

### 6. Run locally

```bash
npm run dev
```

Open:

```bash
http://localhost:5173
```

## Deployment

### Vercel

1. Push this project to GitHub.
2. Import the repo in Vercel.
3. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
4. Deploy.

### Netlify

1. Push this project to GitHub.
2. Import the repo in Netlify.
3. Build command:

```bash
npm run build
```

4. Publish directory:

```bash
dist
```

5. Add environment variables:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`

## Workflow notes

Carl should review inbound items in this order:

1. Quo
2. HomeWorks texts
3. Gmail team@

Each escalation should include:

- Customer Name
- Source
- Situation
- Last Touch
- Reason
- Proposed Next Step
- Where Bradley should continue
- Status
- Follow-Up Date

Escalation triggers include:

- Customer wants a call
- Pricing unclear
- Refund request
- Discount request
- Complaint
- Angry or emotional tone
- Scope dispute
- Commercial / HOA lead
- Job over $2,000
- Outside service area
- Property damage
- Safety issue
- Crew no-show
- Collections issue
- Anything Carl is not 100% sure about

When any trigger is selected in the form, the status is automatically set to `Needs Bradley`.

## Manual-first MVP

This first version does not integrate directly with Gmail, Quo, or HomeWorks APIs.

Carl manually enters escalations into the dashboard. Future integrations can be added later by creating inbound connectors that write into the `escalations` table.

## Future integration ideas

- Gmail team@ import
- Quo webhook/import
- HomeWorks text import
- Bradley approval notifications
- Daily report scheduling
- AI-generated situation summaries
- Owner-only mobile view
- Slack/email summary notifications
