-- Transactional operation metadata for concurrent cash registers.

alter table public.sales
  add column cash_register_id uuid,
  add column idempotency_key text;

alter table public.sales
  add constraint sales_cash_register_fk
  foreign key (organization_id, cash_register_id)
  references public.cash_registers(organization_id, id);

create unique index sales_idempotency_unique
  on public.sales (organization_id, idempotency_key)
  where idempotency_key is not null;

alter table public.inventory_receipts
  add column idempotency_key text;

create unique index inventory_receipts_idempotency_unique
  on public.inventory_receipts (organization_id, idempotency_key)
  where idempotency_key is not null;

alter table public.dispatches
  add column idempotency_key text;

create unique index dispatches_idempotency_unique
  on public.dispatches (organization_id, idempotency_key)
  where idempotency_key is not null;

create index sales_register_date_idx
  on public.sales (organization_id, cash_register_id, sold_at desc);

