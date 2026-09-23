-- Server-side synchronization state and user access metadata.

alter table public.app_users
  add column must_change_password boolean not null default false;

alter table public.organization_members
  add column permissions text[];

create table public.erp_state_snapshots (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  version bigint not null default 1 check (version > 0),
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create trigger erp_state_snapshots_set_updated_at
before update on public.erp_state_snapshots
for each row execute function public.set_updated_at();

