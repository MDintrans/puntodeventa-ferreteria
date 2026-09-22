-- Ferreteria ERP - initial PostgreSQL/Supabase schema
-- Money is stored as integer Chilean pesos. Quantities support fractional units.

create type public.app_role as enum ('admin', 'seller', 'warehouse');
create type public.document_type as enum ('sale', 'receipt', 'dispatch', 'quote');
create type public.sale_status as enum ('draft', 'completed', 'voided');
create type public.receipt_status as enum ('draft', 'received', 'voided');
create type public.dispatch_status as enum ('preparing', 'dispatched', 'delivered', 'voided');
create type public.quote_status as enum ('draft', 'sent', 'accepted', 'expired', 'voided');
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

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) >= 2),
  legal_name text,
  rut text,
  email text,
  phone text,
  address text,
  timezone text not null default 'America/Santiago',
  currency_code text not null default 'CLP' check (currency_code ~ '^[A-Z]{3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index organizations_rut_unique
  on public.organizations (upper(regexp_replace(rut, '[^0-9Kk]', '', 'g')))
  where rut is not null and trim(rut) <> '';

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null default 'seller',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index organization_members_user_idx
  on public.organization_members (user_id, active);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  code text not null,
  name text not null check (length(trim(name)) >= 2),
  address text,
  phone text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, code)
);

create table public.product_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(trim(name)) >= 2),
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
  brand text,
  unit text not null default 'un' check (length(trim(unit)) >= 1),
  cost_amount bigint not null default 0 check (cost_amount >= 0),
  sale_price bigint not null default 0 check (sale_price >= 0),
  minimum_stock numeric(14,3) not null default 0 check (minimum_stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, id),
  foreign key (organization_id, category_id)
    references public.product_categories(organization_id, id) on delete set null (category_id)
);

create unique index products_sku_unique
  on public.products (organization_id, lower(sku));

create unique index products_barcode_unique
  on public.products (organization_id, barcode)
  where barcode is not null and trim(barcode) <> '';

create index products_search_idx
  on public.products (organization_id, active, name);

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, id)
);

create unique index customers_rut_unique
  on public.customers (organization_id, upper(regexp_replace(rut, '[^0-9Kk]', '', 'g')))
  where rut is not null and trim(rut) <> '';

create index customers_search_idx
  on public.customers (organization_id, active, name);

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
  website text,
  payment_terms text,
  lead_time text,
  notes text,
  favorite boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, id)
);

create unique index suppliers_rut_unique
  on public.suppliers (organization_id, upper(regexp_replace(rut, '[^0-9Kk]', '', 'g')))
  where rut is not null and trim(rut) <> '';

create index suppliers_search_idx
  on public.suppliers (organization_id, active, name);

create table public.branch_inventory (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  product_id uuid not null,
  on_hand numeric(14,3) not null default 0 check (on_hand >= 0),
  reserved numeric(14,3) not null default 0 check (reserved >= 0 and reserved <= on_hand),
  location text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null,
  primary key (branch_id, product_id),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete cascade
);

create index branch_inventory_product_idx
  on public.branch_inventory (organization_id, product_id);

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

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  folio bigint not null check (folio > 0),
  customer_id uuid,
  status public.sale_status not null default 'draft',
  payment_method text not null,
  net_amount bigint not null default 0 check (net_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  total_amount bigint not null default 0 check (total_amount >= 0),
  notes text,
  sold_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id) on delete set null (customer_id),
  check (net_amount + tax_amount = total_amount)
);

create index sales_date_idx
  on public.sales (organization_id, branch_id, sold_at desc);

create table public.sale_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null,
  product_id uuid,
  sku_snapshot text not null,
  name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  line_total bigint not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, sale_id)
    references public.sales(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete set null (product_id)
);

create index sale_items_sale_idx on public.sale_items (sale_id);

create table public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  folio bigint not null check (folio > 0),
  supplier_id uuid,
  supplier_document text,
  status public.receipt_status not null default 'draft',
  total_amount bigint not null default 0 check (total_amount >= 0),
  received_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, supplier_id)
    references public.suppliers(organization_id, id) on delete set null (supplier_id)
);

create index inventory_receipts_date_idx
  on public.inventory_receipts (organization_id, branch_id, created_at desc);

create table public.inventory_receipt_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  receipt_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost bigint not null check (unit_cost >= 0),
  line_total bigint not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, receipt_id)
    references public.inventory_receipts(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id)
);

create index inventory_receipt_items_receipt_idx
  on public.inventory_receipt_items (receipt_id);

create table public.dispatches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  branch_id uuid not null,
  folio bigint not null check (folio > 0),
  customer_id uuid,
  order_reference text,
  status public.dispatch_status not null default 'preparing',
  scheduled_at timestamptz,
  delivered_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id) on delete set null (customer_id)
);

create index dispatches_status_idx
  on public.dispatches (organization_id, branch_id, status, created_at desc);

create table public.dispatch_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  dispatch_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  created_at timestamptz not null default now(),
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
  status public.quote_status not null default 'draft',
  net_amount bigint not null default 0 check (net_amount >= 0),
  tax_amount bigint not null default 0 check (tax_amount >= 0),
  total_amount bigint not null default 0 check (total_amount >= 0),
  valid_until date not null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  unique (organization_id, id),
  unique (branch_id, folio),
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, customer_id)
    references public.customers(organization_id, id) on delete set null (customer_id),
  check (net_amount + tax_amount = total_amount)
);

create index quotes_validity_idx
  on public.quotes (organization_id, status, valid_until);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  quote_id uuid not null,
  product_id uuid,
  sku_snapshot text not null,
  name_snapshot text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price bigint not null check (unit_price >= 0),
  discount_amount bigint not null default 0 check (discount_amount >= 0),
  line_total bigint not null check (line_total >= 0),
  created_at timestamptz not null default now(),
  foreign key (organization_id, quote_id)
    references public.quotes(organization_id, id) on delete cascade,
  foreign key (organization_id, product_id)
    references public.products(organization_id, id) on delete set null (product_id)
);

create index quote_items_quote_idx on public.quote_items (quote_id);

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
  created_by uuid references public.profiles(id) on delete set null,
  foreign key (organization_id, branch_id)
    references public.branches(organization_id, id),
  foreign key (organization_id, product_id)
    references public.products(organization_id, id),
  check (quantity_delta <> 0 or reserved_delta <> 0)
);

create index stock_movements_history_idx
  on public.stock_movements (organization_id, branch_id, product_id, occurred_at desc);

create index stock_movements_source_idx
  on public.stock_movements (source_type, source_id)
  where source_id is not null;

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id) on delete set null
);

-- Shared timestamp trigger.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger organizations_set_updated_at before update on public.organizations
  for each row execute function public.set_updated_at();
create trigger profiles_set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger organization_members_set_updated_at before update on public.organization_members
  for each row execute function public.set_updated_at();
create trigger branches_set_updated_at before update on public.branches
  for each row execute function public.set_updated_at();
create trigger product_categories_set_updated_at before update on public.product_categories
  for each row execute function public.set_updated_at();
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger customers_set_updated_at before update on public.customers
  for each row execute function public.set_updated_at();
create trigger suppliers_set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
create trigger sales_set_updated_at before update on public.sales
  for each row execute function public.set_updated_at();
create trigger inventory_receipts_set_updated_at before update on public.inventory_receipts
  for each row execute function public.set_updated_at();
create trigger dispatches_set_updated_at before update on public.dispatches
  for each row execute function public.set_updated_at();
create trigger quotes_set_updated_at before update on public.quotes
  for each row execute function public.set_updated_at();
create trigger branch_inventory_set_updated_at before update on public.branch_inventory
  for each row execute function public.set_updated_at();
create trigger document_sequences_set_updated_at before update on public.document_sequences
  for each row execute function public.set_updated_at();
create trigger organization_settings_set_updated_at before update on public.organization_settings
  for each row execute function public.set_updated_at();

-- Keep a public profile synchronized with every Supabase Auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_auth_user();

-- An organization must always retain at least one active administrator.
create or replace function public.protect_last_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_removes_admin boolean;
begin
  if tg_op = 'DELETE' then
    v_removes_admin := true;
  else
    v_removes_admin := new.role <> 'admin'::public.app_role or not new.active;
  end if;

  if old.role = 'admin'::public.app_role
     and old.active
     and v_removes_admin
     and not exists (
       select 1
       from public.organization_members membership
       where membership.organization_id = old.organization_id
         and membership.user_id <> old.user_id
         and membership.role = 'admin'::public.app_role
         and membership.active
     ) then
    raise exception 'The organization must keep at least one active administrator';
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

-- RLS helper functions are SECURITY DEFINER to avoid recursive membership policies.
create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.active
  );
$$;

create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.active
      and membership.role = any(p_roles)
  );
$$;

create or replace function public.shares_organization(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
     and theirs.active
    where mine.user_id = auth.uid()
      and mine.active
      and theirs.user_id = p_user_id
  );
$$;

-- Called once by the first authenticated account to create the business.
create or replace function public.bootstrap_business(
  p_name text,
  p_branch_name text default 'Casa Matriz',
  p_rut text default null
)
returns table (organization_id uuid, branch_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_branch_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Business name is required';
  end if;

  if length(trim(coalesce(p_branch_name, ''))) < 2 then
    raise exception 'Branch name is required';
  end if;

  if exists (
    select 1 from public.organization_members where user_id = v_user_id and active
  ) then
    raise exception 'The user already belongs to an organization';
  end if;

  insert into public.profiles (id, full_name)
  select users.id, coalesce(users.raw_user_meta_data ->> 'full_name', users.email, '')
  from auth.users users
  where users.id = v_user_id
  on conflict (id) do nothing;

  insert into public.organizations (name, legal_name, rut)
  values (trim(p_name), trim(p_name), nullif(trim(p_rut), ''))
  returning id into v_organization_id;

  insert into public.branches (organization_id, code, name)
  values (v_organization_id, 'MATRIZ', trim(p_branch_name))
  returning id into v_branch_id;

  insert into public.organization_members (organization_id, user_id, role)
  values (v_organization_id, v_user_id, 'admin');

  insert into public.product_categories (organization_id, name)
  values
    (v_organization_id, 'Herramientas'),
    (v_organization_id, 'Accesorios'),
    (v_organization_id, 'Fijaciones'),
    (v_organization_id, 'Pinturas'),
    (v_organization_id, 'Adhesivos'),
    (v_organization_id, 'Seguridad'),
    (v_organization_id, 'Electricidad'),
    (v_organization_id, 'Gasfitería');

  insert into public.document_sequences (organization_id, branch_id, document_type)
  select v_organization_id, v_branch_id, sequence_type.document_type
  from unnest(enum_range(null::public.document_type)) as sequence_type(document_type);

  insert into public.organization_settings (organization_id, settings)
  values (
    v_organization_id,
    jsonb_build_object(
      'inventory', jsonb_build_object('preventNegative', true, 'defaultMinStock', 5),
      'sales', jsonb_build_object(
        'defaultPayment', 'Débito',
        'paymentMethods', jsonb_build_array('Efectivo', 'Débito', 'Crédito', 'Transferencia')
      ),
      'documents', jsonb_build_object('quoteValidityDays', 15)
    )
  );

  return query select v_organization_id, v_branch_id;
end;
$$;

-- Atomic stock adjustment used for opening stock and manual corrections.
create or replace function public.adjust_inventory(
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
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_inventory public.branch_inventory%rowtype;
  v_movement_type public.stock_movement_type;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_quantity_delta is null or p_quantity_delta = 0 then
    raise exception 'Quantity adjustment must be different from zero';
  end if;

  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Adjustment reason is required';
  end if;

  select branch.organization_id
    into v_organization_id
  from public.branches branch
  where branch.id = p_branch_id
    and branch.active
    and public.has_org_role(
      branch.organization_id,
      array['admin'::public.app_role, 'warehouse'::public.app_role]
    );

  if v_organization_id is null then
    raise exception 'Branch not found or insufficient permissions';
  end if;

  if not exists (
    select 1
    from public.products product
    where product.id = p_product_id
      and product.organization_id = v_organization_id
      and product.active
  ) then
    raise exception 'Product not found';
  end if;

  insert into public.branch_inventory (
    organization_id,
    branch_id,
    product_id,
    on_hand,
    reserved,
    updated_by
  )
  values (v_organization_id, p_branch_id, p_product_id, 0, 0, v_user_id)
  on conflict (branch_id, product_id) do nothing;

  select inventory.*
    into v_inventory
  from public.branch_inventory inventory
  where inventory.branch_id = p_branch_id
    and inventory.product_id = p_product_id
  for update;

  if v_inventory.on_hand + p_quantity_delta < v_inventory.reserved then
    raise exception 'Adjustment would leave stock below reserved quantity';
  end if;

  update public.branch_inventory inventory
  set on_hand = inventory.on_hand + p_quantity_delta,
      updated_at = now(),
      updated_by = v_user_id
  where inventory.branch_id = p_branch_id
    and inventory.product_id = p_product_id
  returning inventory.* into v_inventory;

  v_movement_type := case
    when p_quantity_delta > 0 then 'adjustment_in'::public.stock_movement_type
    else 'adjustment_out'::public.stock_movement_type
  end;

  insert into public.stock_movements (
    organization_id,
    branch_id,
    product_id,
    movement_type,
    quantity_delta,
    on_hand_after,
    reserved_after,
    reason,
    created_by
  )
  values (
    v_organization_id,
    p_branch_id,
    p_product_id,
    v_movement_type,
    p_quantity_delta,
    v_inventory.on_hand,
    v_inventory.reserved,
    trim(p_reason),
    v_user_id
  );

  return query
  select
    v_inventory.branch_id,
    v_inventory.product_id,
    v_inventory.on_hand,
    v_inventory.reserved,
    v_inventory.on_hand - v_inventory.reserved;
end;
$$;

-- Read models for the frontend and reports. security_invoker keeps base-table RLS active.
create view public.product_stock
with (security_invoker = true)
as
select
  product.organization_id,
  branch.id as branch_id,
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
  coalesce(inventory.on_hand - inventory.reserved, 0) as available,
  inventory.location,
  product.active
from public.products product
join public.branches branch
  on branch.organization_id = product.organization_id
 and branch.active
left join public.branch_inventory inventory
  on inventory.organization_id = product.organization_id
 and inventory.branch_id = branch.id
 and inventory.product_id = product.id
left join public.product_categories category
  on category.organization_id = product.organization_id
 and category.id = product.category_id;

create view public.inventory_valuation
with (security_invoker = true)
as
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

-- Row Level Security.
alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.organization_members enable row level security;
alter table public.branches enable row level security;
alter table public.product_categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.branch_inventory enable row level security;
alter table public.document_sequences enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_items enable row level security;
alter table public.dispatches enable row level security;
alter table public.dispatch_items enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.stock_movements enable row level security;
alter table public.organization_settings enable row level security;

create policy organizations_select on public.organizations
  for select to authenticated using (public.is_org_member(id));
create policy organizations_update on public.organizations
  for update to authenticated
  using (public.has_org_role(id, array['admin'::public.app_role]))
  with check (public.has_org_role(id, array['admin'::public.app_role]));

create policy profiles_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_organization(id));
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy organization_members_select on public.organization_members
  for select to authenticated using (public.is_org_member(organization_id));
create policy organization_members_insert on public.organization_members
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role]));
create policy organization_members_update on public.organization_members
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role]));
create policy organization_members_delete on public.organization_members
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role]));

create policy branches_select on public.branches
  for select to authenticated using (public.is_org_member(organization_id));
create policy branches_insert on public.branches
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role]));
create policy branches_update on public.branches
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role]));

create policy product_categories_select on public.product_categories
  for select to authenticated using (public.is_org_member(organization_id));
create policy product_categories_insert on public.product_categories
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]));
create policy product_categories_update on public.product_categories
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]));

create policy products_select on public.products
  for select to authenticated using (public.is_org_member(organization_id));
create policy products_insert on public.products
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]));
create policy products_update on public.products
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]));

create policy customers_select on public.customers
  for select to authenticated using (public.is_org_member(organization_id));
create policy customers_insert on public.customers
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));
create policy customers_update on public.customers
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));

create policy suppliers_select on public.suppliers
  for select to authenticated using (public.is_org_member(organization_id));
create policy suppliers_insert on public.suppliers
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]));
create policy suppliers_update on public.suppliers
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'warehouse'::public.app_role]));

create policy branch_inventory_select on public.branch_inventory
  for select to authenticated using (public.is_org_member(organization_id));
create policy document_sequences_select on public.document_sequences
  for select to authenticated using (public.is_org_member(organization_id));

create policy sales_select on public.sales
  for select to authenticated using (public.is_org_member(organization_id));
create policy sale_items_select on public.sale_items
  for select to authenticated using (public.is_org_member(organization_id));
create policy inventory_receipts_select on public.inventory_receipts
  for select to authenticated using (public.is_org_member(organization_id));
create policy inventory_receipt_items_select on public.inventory_receipt_items
  for select to authenticated using (public.is_org_member(organization_id));
create policy dispatches_select on public.dispatches
  for select to authenticated using (public.is_org_member(organization_id));
create policy dispatch_items_select on public.dispatch_items
  for select to authenticated using (public.is_org_member(organization_id));
create policy stock_movements_select on public.stock_movements
  for select to authenticated using (public.is_org_member(organization_id));

create policy quotes_select on public.quotes
  for select to authenticated using (public.is_org_member(organization_id));
create policy quotes_insert on public.quotes
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));
create policy quotes_update on public.quotes
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));
create policy quotes_delete on public.quotes
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));

create policy quote_items_select on public.quote_items
  for select to authenticated using (public.is_org_member(organization_id));
create policy quote_items_insert on public.quote_items
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));
create policy quote_items_update on public.quote_items
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));
create policy quote_items_delete on public.quote_items
  for delete to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role, 'seller'::public.app_role]));

create policy organization_settings_select on public.organization_settings
  for select to authenticated using (public.is_org_member(organization_id));
create policy organization_settings_insert on public.organization_settings
  for insert to authenticated
  with check (public.has_org_role(organization_id, array['admin'::public.app_role]));
create policy organization_settings_update on public.organization_settings
  for update to authenticated
  using (public.has_org_role(organization_id, array['admin'::public.app_role]))
  with check (public.has_org_role(organization_id, array['admin'::public.app_role]));

-- Explicit grants complement RLS. No business table is exposed to unauthenticated users.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all tables in schema public from authenticated;
revoke all on all sequences in schema public from authenticated;

grant select, update on public.organizations to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.organization_members to authenticated;
grant select, insert, update on public.branches to authenticated;
grant select, insert, update on public.product_categories to authenticated;
grant select, insert, update on public.products to authenticated;
grant select, insert, update on public.customers to authenticated;
grant select, insert, update on public.suppliers to authenticated;
grant select on public.branch_inventory to authenticated;
grant select on public.document_sequences to authenticated;
grant select on public.sales, public.sale_items to authenticated;
grant select on public.inventory_receipts, public.inventory_receipt_items to authenticated;
grant select on public.dispatches, public.dispatch_items to authenticated;
grant select, insert, update, delete on public.quotes, public.quote_items to authenticated;
grant select on public.stock_movements to authenticated;
grant select, insert, update on public.organization_settings to authenticated;
grant select on public.product_stock, public.inventory_valuation to authenticated;

revoke all on function public.set_updated_at() from public;
revoke all on function public.handle_new_auth_user() from public;
revoke all on function public.protect_last_admin() from public;
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.has_org_role(uuid, public.app_role[]) from public;
revoke all on function public.shares_organization(uuid) from public;
revoke all on function public.bootstrap_business(text, text, text) from public;
revoke all on function public.adjust_inventory(uuid, uuid, numeric, text) from public;

grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.shares_organization(uuid) to authenticated;
grant execute on function public.bootstrap_business(text, text, text) to authenticated;
grant execute on function public.adjust_inventory(uuid, uuid, numeric, text) to authenticated;
