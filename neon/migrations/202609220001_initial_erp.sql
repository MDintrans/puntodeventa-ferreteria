-- Ferreteria Los Nogales ERP - Neon/PostgreSQL initial schema
-- Monetary values are stored as integer Chilean pesos. Quantities allow fractions.
-- This migration intentionally creates no business records.

create type public.app_role as enum ('admin', 'seller', 'warehouse');
create type public.document_type as enum ('sale', 'receipt', 'dispatch', 'quote', 'return');
create type public.sale_status as enum ('draft', 'completed', 'voided', 'partially_refunded', 'refunded');
create type public.payment_status as enum ('pending', 'completed', 'voided', 'refunded');
create type public.receipt_status as enum ('draft', 'received', 'voided');
create type public.dispatch_status as enum ('preparing', 'dispatched', 'delivered', 'voided');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'expired', 'voided');
create type public.return_status as enum ('draft', 'completed', 'voided');
create type public.cash_session_status as enum ('open', 'closed');
create type public.cash_movement_type as enum ('opening', 'income', 'expense', 'withdrawal', 'adjustment', 'closing');
create type public.stock_movement_type as enum (
  'opening',
  'purchase',
  'sale',
  'dispatch',
  'return_in',
  'return_out',
  'adjustment_in',
  'adjustment_out',
  'reservation',
  'release'
);
create type public.import_entity_type as enum ('products', 'customers', 'suppliers', 'inventory', 'complete');
create type public.import_status as enum ('pending', 'processing', 'completed', 'failed');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 2),
  legal_name text,
  rut text,
  email text,
  phone text,
  address text,
  commune text,
  timezone text not null default 'America/Santiago',
  currency_code text not null default 'CLP' check (currency_code ~ '^[A-Z]{3}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index organizations_rut_unique
  on public.organizations (upper(regexp_replace(rut, '[^0-9Kk]', '', 'g')))
  where rut is not null and trim(rut) <> '';

create table public.app_users (
  id uuid primary key default gen_random_uuid(),
  username text not null check (username = trim(username) and length(username) between 3 and 60),
  email text,
  full_name text not null check (length(trim(full_name)) >= 2),
  phone text,
  password_hash text,
  password_algorithm text not null default 'bcrypt' check (password_algorithm in ('bcrypt', 'external')),
  external_auth_id text,
  active boolean not null default true,
  password_changed_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (password_algorithm = 'bcrypt' and password_hash is not null and external_auth_id is null)
    or (password_algorithm = 'external' and password_hash is null and external_auth_id is not null)
  )
);

create unique index app_users_username_unique on public.app_users (lower(username));
create unique index app_users_email_unique
  on public.app_users (lower(email))
  where email is not null and trim(email) <> '';
create unique index app_users_external_auth_unique
  on public.app_users (external_auth_id)
  where external_auth_id is not null;

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role public.app_role not null default 'seller',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx on public.organization_members (user_id, active);

create table public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  token_hash text not null unique check (length(token_hash) >= 32),
  ip_address inet,
  user_agent text,
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, user_id)
    references public.organization_members(organization_id, user_id) on delete cascade
);

create index user_sessions_active_idx on public.user_sessions (user_id, expires_at)
  where revoked_at is null;

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null check (length(trim(code)) >= 2),
  name text not null check (length(trim(name)) >= 2),
  address text,
  commune text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index branches_code_unique on public.branches (organization_id, lower(code));

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) >= 2),
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index product_categories_name_unique
  on public.product_categories (organization_id, lower(name));

create table public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid,
  sku text not null check (length(trim(sku)) >= 2),
  barcode text,
  name text not null check (length(trim(name)) >= 2),
  description text,
  brand text,
  unit text not null default 'un' check (length(trim(unit)) >= 1),
  cost_amount bigint not null default 0 check (cost_amount >= 0),
  sale_price bigint not null default 0 check (sale_price >= 0),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  tax_rate numeric(5,2) not null default 19 check (tax_rate between 0 and 100),
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  updated_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, category_id)
    references public.product_categories(organization_id, id)
);

create unique index products_sku_unique on public.products (organization_id, lower(sku));
create unique index products_barcode_unique
  on public.products (organization_id, barcode)
  where barcode is not null and trim(barcode) <> '';
create index products_search_idx on public.products (organization_id, active, name);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  customer_type text not null default 'company' check (customer_type in ('person', 'company')),
  rut text,
  name text not null check (length(trim(name)) >= 2),
  trade_name text,
  contact_name text,
  email text,
  phone text,
  address text,
  commune text,
  credit_limit bigint not null default 0 check (credit_limit >= 0),
  notes text,
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index customers_rut_unique
  on public.customers (organization_id, upper(regexp_replace(rut, '[^0-9Kk]', '', 'g')))
  where rut is not null and trim(rut) <> '';
create index customers_search_idx on public.customers (organization_id, active, name);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  rut text,
  name text not null check (length(trim(name)) >= 2),
  category text,
  contact_name text,
  contact_role text,
  email text,
  phone text,
  address text,
  commune text,
  website text,
  payment_terms text,
  lead_time text,
  notes text,
  favorite boolean not null default false,
  active boolean not null default true,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create unique index suppliers_rut_unique
  on public.suppliers (organization_id, upper(regexp_replace(rut, '[^0-9Kk]', '', 'g')))
  where rut is not null and trim(rut) <> '';
create index suppliers_search_idx on public.suppliers (organization_id, active, name);

create table public.branch_inventory (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  product_id uuid not null,
  on_hand numeric(14,3) not null default 0 check (on_hand >= 0),
  reserved numeric(14,3) not null default 0 check (reserved >= 0 and reserved <= on_hand),
  available numeric(14,3) generated always as (on_hand - reserved) stored,
  location text,
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (branch_id, product_id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete cascade
);

create index branch_inventory_product_idx on public.branch_inventory (organization_id, product_id);
create index branch_inventory_low_stock_idx on public.branch_inventory (organization_id, branch_id, available);

create table public.document_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  document_type public.document_type not null,
  next_value bigint not null default 1 check (next_value > 0),
  updated_at timestamptz not null default now(),
  primary key (branch_id, document_type),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade
);

create table public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  code text not null,
  name text not null check (length(trim(name)) >= 2),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id)
);

create unique index cash_registers_code_unique on public.cash_registers (branch_id, lower(code));

create table public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  cash_register_id uuid not null,
  status public.cash_session_status not null default 'open',
  opening_amount bigint not null default 0 check (opening_amount >= 0),
  expected_amount bigint,
  closing_amount bigint check (closing_amount is null or closing_amount >= 0),
  difference_amount bigint,
  opened_by uuid not null references public.app_users(id),
  closed_by uuid references public.app_users(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, cash_register_id)
    references public.cash_registers(organization_id, id),
  check (
    (status = 'open' and closed_at is null and closed_by is null)
    or (status = 'closed' and closed_at is not null and closed_by is not null and closing_amount is not null)
  )
);

create unique index cash_sessions_one_open_per_register
  on public.cash_sessions (cash_register_id)
  where status = 'open';
create index cash_sessions_date_idx on public.cash_sessions (organization_id, branch_id, opened_at desc);

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_session_id uuid not null,
  movement_type public.cash_movement_type not null,
  amount bigint not null check (amount <> 0),
  reason text not null check (length(trim(reason)) >= 3),
  reference_type text,
  reference_id uuid,
  created_by uuid not null references public.app_users(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, cash_session_id)
    references public.cash_sessions(organization_id, id)
);

create index cash_movements_session_idx on public.cash_movements (cash_session_id, created_at);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  cash_session_id uuid,
  folio bigint not null check (folio > 0),
  customer_id uuid,
  customer_name_snapshot text not null default 'Público general',
  customer_rut_snapshot text,
  status public.sale_status not null default 'draft',
  net_amount bigint not null default 0 check (net_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  total_amount bigint not null default 0 check (total_amount >= 0),
  notes text,
  sold_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, cash_session_id)
    references public.cash_sessions(organization_id, id),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id),
  check (net_amount + tax_amount - discount_amount = total_amount)
);

create index sales_date_idx on public.sales (organization_id, branch_id, sold_at desc);
create index sales_customer_idx on public.sales (organization_id, customer_id, sold_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid,
  sku_snapshot text not null,
  name_snapshot text not null,
  unit_snapshot text not null default 'un',
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5,2) not null default 19 check (tax_rate between 0 and 100),
  line_total bigint not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (sale_id, line_number),
  foreign key (organization_id, sale_id)
    references public.sales(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
);

create index sale_items_sale_idx on public.sale_items (sale_id);

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  cash_session_id uuid,
  method text not null check (length(trim(method)) >= 2),
  status public.payment_status not null default 'completed',
  amount bigint not null check (amount > 0),
  reference text,
  paid_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, sale_id)
    references public.sales(organization_id, id) on delete cascade,
  foreign key (organization_id, cash_session_id)
    references public.cash_sessions(organization_id, id)
);

create index sale_payments_sale_idx on public.sale_payments (sale_id, status);

create table public.held_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  customer_id uuid,
  customer_name_snapshot text not null default 'Público general',
  payment_method text,
  notes text,
  held_by uuid not null references public.app_users(id),
  held_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id)
);

create index held_sales_branch_idx on public.held_sales (organization_id, branch_id, held_at desc);

create table public.held_sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  held_sale_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  created_at timestamptz not null default now(),
  unique (held_sale_id, line_number),
  foreign key (organization_id, held_sale_id)
    references public.held_sales(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
);

create table public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  folio bigint not null check (folio > 0),
  supplier_id uuid,
  supplier_name_snapshot text,
  supplier_document text,
  status public.receipt_status not null default 'draft',
  total_amount bigint not null default 0 check (total_amount >= 0),
  received_at timestamptz,
  notes text,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id)
);

create index inventory_receipts_date_idx
  on public.inventory_receipts (organization_id, branch_id, created_at desc);

create table public.inventory_receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost bigint not null check (unit_cost >= 0),
  line_total bigint not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (receipt_id, line_number),
  foreign key (organization_id, receipt_id)
    references public.inventory_receipts(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
);

create index inventory_receipt_items_receipt_idx on public.inventory_receipt_items (receipt_id);

create table public.dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  folio bigint not null check (folio > 0),
  customer_id uuid,
  customer_name_snapshot text not null check (length(trim(customer_name_snapshot)) >= 2),
  contact_name text,
  contact_phone text,
  delivery_address text not null check (length(trim(delivery_address)) >= 5),
  delivery_commune text,
  order_reference text,
  status public.dispatch_status not null default 'preparing',
  scheduled_at timestamptz,
  dispatched_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id)
);

create index dispatches_status_idx
  on public.dispatches (organization_id, branch_id, status, created_at desc);

create table public.dispatch_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dispatch_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid not null,
  sku_snapshot text not null,
  name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
  unique (dispatch_id, line_number),
  foreign key (organization_id, dispatch_id)
    references public.dispatches(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
);

create index dispatch_items_dispatch_idx on public.dispatch_items (dispatch_id);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  folio bigint not null check (folio > 0),
  customer_id uuid,
  customer_name_snapshot text not null default 'Público general',
  customer_rut_snapshot text,
  status public.quote_status not null default 'draft',
  net_amount bigint not null default 0 check (net_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  total_amount bigint not null default 0 check (total_amount >= 0),
  valid_until date not null,
  notes text,
  created_by uuid references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id),
  check (net_amount + tax_amount - discount_amount = total_amount)
);

create index quotes_validity_idx on public.quotes (organization_id, status, valid_until);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null,
  line_number integer not null check (line_number > 0),
  product_id uuid,
  sku_snapshot text not null,
  name_snapshot text not null,
  unit_snapshot text not null default 'un',
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  tax_rate numeric(5,2) not null default 19 check (tax_rate between 0 and 100),
  line_total bigint not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  unique (quote_id, line_number),
  foreign key (organization_id, quote_id)
    references public.quotes(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
);

create index quote_items_quote_idx on public.quote_items (quote_id);

create table public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  sale_id uuid not null,
  folio bigint not null check (folio > 0),
  status public.return_status not null default 'draft',
  total_amount bigint not null default 0 check (total_amount >= 0),
  reason text not null check (length(trim(reason)) >= 3),
  created_by uuid references public.app_users(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, sale_id)
    references public.sales(organization_id, id)
);

create index sale_returns_sale_idx on public.sale_returns (sale_id, created_at desc);

create table public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  return_id uuid not null,
  sale_item_id uuid not null,
  product_id uuid,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_amount bigint not null check (unit_amount >= 0),
  line_total bigint not null check (line_total >= 0),
  restock boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (organization_id, return_id)
    references public.sale_returns(organization_id, id) on delete cascade,
  foreign key (organization_id, sale_item_id)
    references public.sale_items(organization_id, id),
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
);

create index sale_return_items_return_idx on public.sale_return_items (return_id);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  product_id uuid not null,
  movement_type public.stock_movement_type not null,
  quantity_delta numeric(14,3) not null default 0,
  reserved_delta numeric(14,3) not null default 0,
  on_hand_after numeric(14,3) not null check (on_hand_after >= 0),
  reserved_after numeric(14,3) not null check (reserved_after >= 0 and reserved_after <= on_hand_after),
  source_type public.document_type,
  source_id uuid,
  reason text,
  occurred_at timestamptz not null default now(),
  created_by uuid references public.app_users(id) on delete set null,
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, product_id)
    references public.products(organization_id, id),
  check (quantity_delta <> 0 or reserved_delta <> 0)
);

create index stock_movements_history_idx
  on public.stock_movements (organization_id, branch_id, product_id, occurred_at desc);
create index stock_movements_source_idx on public.stock_movements (source_type, source_id)
  where source_id is not null;

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_by uuid references public.app_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid,
  entity_type public.import_entity_type not null,
  file_name text not null,
  status public.import_status not null default 'pending',
  total_rows integer not null default 0 check (total_rows >= 0),
  valid_rows integer not null default 0 check (valid_rows >= 0),
  error_rows integer not null default 0 check (error_rows >= 0),
  summary jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  imported_by uuid not null references public.app_users(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  check (valid_rows + error_rows <= total_rows)
);

create index import_batches_date_idx on public.import_batches (organization_id, created_at desc);

create table public.import_batch_errors (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  import_batch_id uuid not null,
  row_number integer not null check (row_number > 0),
  field_name text,
  error_message text not null,
  raw_data jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, import_batch_id)
    references public.import_batches(organization_id, id) on delete cascade
);

create index import_batch_errors_batch_idx on public.import_batch_errors (import_batch_id, row_number);

create table public.audit_logs (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.app_users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  old_data jsonb,
  new_data jsonb,
  ip_address inet,
  created_at timestamptz not null default now()
);

create index audit_logs_org_date_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id, created_at desc);

create table public.user_notification_reads (
  user_id uuid not null references public.app_users(id) on delete cascade,
  notification_key text not null,
  read_at timestamptz not null default now(),
  primary key (user_id, notification_key)
);

-- Keep updated_at consistent without relying on application code.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'organizations', 'app_users', 'organization_members', 'branches',
    'product_categories', 'products', 'customers', 'suppliers',
    'branch_inventory', 'document_sequences', 'cash_registers', 'cash_sessions',
    'sales', 'held_sales', 'inventory_receipts', 'dispatches', 'quotes',
    'sale_returns', 'organization_settings', 'import_batches'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

-- An organization must always keep at least one active administrator.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_removing_admin boolean := false;
begin
  if not exists (
    select 1 from public.organizations where id = old.organization_id
  ) then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if old.role = 'admin' and old.active then
    if tg_op = 'DELETE' then
      v_removing_admin := true;
    else
      v_removing_admin := new.role <> 'admin' or not new.active;
    end if;
  end if;

  if v_removing_admin then
    if not exists (
      select 1
      from public.organization_members member
      where member.organization_id = old.organization_id
        and member.user_id <> old.user_id
        and member.role = 'admin'
        and member.active
    ) then
      raise exception 'La organización debe conservar al menos un administrador activo';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger organization_members_protect_last_admin
before update or delete on public.organization_members
for each row execute function public.protect_last_admin();

create or replace function public.has_org_role(
  p_user_id uuid,
  p_organization_id uuid,
  p_roles public.app_role[]
)
returns boolean
language sql
stable
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members member
    join public.app_users app_user on app_user.id = member.user_id and app_user.active
    where member.user_id = p_user_id
      and member.organization_id = p_organization_id
      and member.active
      and member.role = any(p_roles)
  );
$$;

-- Atomically reserves and returns the next folio for a document type.
create or replace function public.next_document_folio(
  p_organization_id uuid,
  p_branch_id uuid,
  p_document_type public.document_type
)
returns bigint
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_folio bigint;
begin
  if not exists (
    select 1 from public.branches branch
    where branch.id = p_branch_id
      and branch.organization_id = p_organization_id
      and branch.active
  ) then
    raise exception 'Sucursal inexistente o inactiva';
  end if;

  insert into public.document_sequences (
    organization_id,
    branch_id,
    document_type,
    next_value
  )
  values (p_organization_id, p_branch_id, p_document_type, 2)
  on conflict (branch_id, document_type)
  do update set
    next_value = public.document_sequences.next_value + 1,
    updated_at = now()
  returning next_value - 1 into v_folio;

  return v_folio;
end;
$$;

-- Creates only the structural records required for the first login.
-- Products, customers, suppliers and stock remain empty.
create or replace function public.bootstrap_business(
  p_user_id uuid,
  p_name text,
  p_branch_name text default 'Casa Matriz',
  p_rut text default null
)
returns table (organization_id uuid, branch_id uuid)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_branch_id uuid;
begin
  if not exists (select 1 from public.app_users where id = p_user_id and active) then
    raise exception 'Usuario inexistente o inactivo';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'El nombre de la empresa es obligatorio';
  end if;
  if length(trim(coalesce(p_branch_name, ''))) < 2 then
    raise exception 'El nombre de la sucursal es obligatorio';
  end if;
  if exists (select 1 from public.organization_members where user_id = p_user_id and active) then
    raise exception 'El usuario ya pertenece a una organización';
  end if;

  insert into public.organizations (name, legal_name, rut)
  values (trim(p_name), trim(p_name), nullif(trim(p_rut), ''))
  returning id into v_organization_id;

  insert into public.branches (organization_id, code, name)
  values (v_organization_id, 'MATRIZ', trim(p_branch_name))
  returning id into v_branch_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, p_user_id, 'admin');

  insert into public.document_sequences (organization_id, branch_id, document_type)
  select v_organization_id, v_branch_id, sequence_type.document_type
  from unnest(enum_range(null::public.document_type)) as sequence_type(document_type);

  insert into public.cash_registers (organization_id, branch_id, code, name)
  values (v_organization_id, v_branch_id, 'CAJA-01', 'Caja principal');

  insert into public.organization_settings (organization_id, settings, updated_by)
  values (
    v_organization_id,
    jsonb_build_object(
      'inventory', jsonb_build_object('preventNegative', true, 'defaultMinStock', 5),
      'sales', jsonb_build_object(
        'defaultPayment', 'Débito',
        'paymentMethods', jsonb_build_array('Efectivo', 'Débito', 'Crédito', 'Transferencia')
      ),
      'documents', jsonb_build_object('quoteValidityDays', 15)
    ),
    p_user_id
  );

  return query select v_organization_id, v_branch_id;
end;
$$;

-- Atomic opening-stock/manual adjustment. Authorization is checked in the database.
create or replace function public.adjust_inventory(
  p_actor_user_id uuid,
  p_branch_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reason text
)
returns table (
  branch_id uuid,
  product_id uuid,
  on_hand numeric,
  reserved numeric,
  available numeric
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_organization_id uuid;
  v_inventory public.branch_inventory%rowtype;
  v_movement_type public.stock_movement_type;
begin
  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'El ajuste debe ser distinto de cero';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Debe indicar el motivo del ajuste';
  end if;

  select branch.organization_id into v_organization_id
  from public.branches branch
  where branch.id = p_branch_id and branch.active;

  if v_organization_id is null or not public.has_org_role(
    p_actor_user_id,
    v_organization_id,
    array['admin'::public.app_role, 'warehouse'::public.app_role]
  ) then
    raise exception 'Sucursal inexistente o permisos insuficientes';
  end if;

  if not exists (
    select 1 from public.products product
    where product.id = p_product_id
      and product.organization_id = v_organization_id
      and product.active
  ) then
    raise exception 'Producto inexistente o inactivo';
  end if;

  insert into public.branch_inventory (
    organization_id, branch_id, product_id, on_hand, reserved, updated_by
  )
  values (v_organization_id, p_branch_id, p_product_id, 0, 0, p_actor_user_id)
  on conflict on constraint branch_inventory_pkey do nothing;

  select inventory.* into v_inventory
  from public.branch_inventory inventory
  where inventory.branch_id = p_branch_id and inventory.product_id = p_product_id
  for update;

  if v_inventory.on_hand + p_quantity_delta < v_inventory.reserved then
    raise exception 'El ajuste dejaría el stock bajo la cantidad reservada';
  end if;

  update public.branch_inventory inventory
  set on_hand = inventory.on_hand + p_quantity_delta,
      updated_by = p_actor_user_id
  where inventory.branch_id = p_branch_id and inventory.product_id = p_product_id
  returning inventory.* into v_inventory;

  v_movement_type := case
    when p_quantity_delta > 0 then 'adjustment_in'::public.stock_movement_type
    else 'adjustment_out'::public.stock_movement_type
  end;

  insert into public.stock_movements (
    organization_id, branch_id, product_id, movement_type, quantity_delta,
    on_hand_after, reserved_after, reason, created_by
  )
  values (
    v_organization_id, p_branch_id, p_product_id, v_movement_type,
    p_quantity_delta, v_inventory.on_hand, v_inventory.reserved,
    trim(p_reason), p_actor_user_id
  );

  return query select
    v_inventory.branch_id,
    v_inventory.product_id,
    v_inventory.on_hand,
    v_inventory.reserved,
    v_inventory.available;
end;
$$;

create view public.product_stock as
select
  product.organization_id,
  branch.id as branch_id,
  branch.name as branch_name,
  product.id as product_id,
  product.sku,
  product.barcode,
  product.name,
  category.name as category,
  product.brand,
  product.unit,
  product.cost_amount,
  product.sale_price,
  product.minimum_stock,
  coalesce(inventory.on_hand, 0) as on_hand,
  coalesce(inventory.reserved, 0) as reserved,
  coalesce(inventory.available, 0) as available,
  inventory.location,
  product.active
from public.products product
join public.branches branch
  on branch.organization_id = product.organization_id and branch.active
left join public.branch_inventory inventory
  on inventory.organization_id = product.organization_id
 and inventory.branch_id = branch.id
 and inventory.product_id = product.id
left join public.product_categories category
  on category.organization_id = product.organization_id
 and category.id = product.category_id;

create view public.inventory_valuation as
select
  inventory.organization_id,
  inventory.branch_id,
  sum(inventory.on_hand) as total_units,
  sum(inventory.on_hand * product.cost_amount) as cost_value,
  sum(inventory.on_hand * product.sale_price) as sale_value
from public.branch_inventory inventory
join public.products product
  on product.organization_id = inventory.organization_id
 and product.id = inventory.product_id
group by inventory.organization_id, inventory.branch_id;

comment on schema public is
  'ERP schema for Neon. Database credentials are server-only; tenant authorization is enforced by the API and role-checking functions.';
