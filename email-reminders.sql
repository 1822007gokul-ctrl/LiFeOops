-- Run this manually in the Supabase SQL editor.
-- This table is only for reminder idempotency and does not modify public.tasks.

create table if not exists public.task_reminders (
    id uuid primary key default gen_random_uuid(),
    task_id uuid not null references public.tasks(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    reminder_type text not null,
    due_at timestamptz not null,
    email_address text not null,
    sent_at timestamptz not null default now(),
    created_at timestamptz not null default now()
);

create unique index if not exists task_reminders_task_type_due_unique
    on public.task_reminders (task_id, reminder_type, due_at);

alter table public.task_reminders enable row level security;

drop policy if exists "task_reminders_no_public_select" on public.task_reminders;
create policy "task_reminders_no_public_select"
on public.task_reminders
for select
using (false);

drop policy if exists "task_reminders_no_public_insert" on public.task_reminders;
create policy "task_reminders_no_public_insert"
on public.task_reminders
for insert
with check (false);

drop policy if exists "task_reminders_no_public_update" on public.task_reminders;
create policy "task_reminders_no_public_update"
on public.task_reminders
for update
using (false)
with check (false);

drop policy if exists "task_reminders_no_public_delete" on public.task_reminders;
create policy "task_reminders_no_public_delete"
on public.task_reminders
for delete
using (false);

comment on table public.task_reminders is 'Stores reminder delivery records for de-duping email notifications. Used by the service role only.';
comment on column public.task_reminders.task_id is 'The task that the reminder corresponds to.';
comment on column public.task_reminders.user_id is 'The authenticated user who owns the task.';
comment on column public.task_reminders.reminder_type is 'Reminder schedule identifier, for example 30min.';
comment on column public.task_reminders.due_at is 'The original task due time associated with the reminder.';
comment on column public.task_reminders.email_address is 'The email address used when the reminder was sent.';
