alter table public.dispatches
  add column if not exists completed_at timestamptz;

create index if not exists dispatches_active_status_idx
  on public.dispatches (organization_id, branch_id, status, created_at desc)
  where completed_at is null;
