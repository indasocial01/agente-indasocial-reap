-- Indasocial × Reap: tablas para la compra del kit de producción (Asistente Inda).
-- Aplicar en un proyecto de Supabase de staging primero.
-- Supone que ya existen las tablas profiles y proposals (o equivalentes).

-- Presupuesto de producción por propuesta (aparte del fee del creador,
-- que se cobra por el riel de Indasocial / Stripe Connect).
alter table proposals
  add column if not exists production_budget_amount numeric(12,2),
  add column if not exists production_budget_currency text default 'USD';

-- Tarjeta guardada por la marca en Reap (solo el ID; nunca datos de tarjeta).
create table if not exists reap_enrollments (
  brand_id uuid primary key references profiles(id) on delete cascade,
  enrollment_id text not null unique,
  status text not null,               -- PENDING | ACTIVE | REVOKED ...
  updated_at timestamptz not null default now()
);

create table if not exists campaign_kit_plans (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references proposals(id) on delete cascade,
  brand_id uuid not null references profiles(id),
  creator_id uuid not null references profiles(id),
  budget_amount numeric(12,2) not null,
  budget_currency text not null,
  request text,
  created_at timestamptz not null default now()
);

create table if not exists campaign_kit_orders (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references campaign_kit_plans(id) on delete cascade,
  proposal_id uuid not null references proposals(id) on delete cascade,
  brand_id uuid not null references profiles(id),
  merchant text not null,
  items jsonb not null,                 -- [{productId, variantId, name, price, reason}]
  quote_id text not null,
  quote_expires_at timestamptz,
  amount numeric(12,2) not null,        -- total cotizado
  currency text not null,
  checkout_id text unique,
  approval_url text,
  status text not null,                 -- QUOTED | AWAITING_APPROVAL | COMPLETED | CANCELED | FAILED | EXPIRED
  reap_status text,
  reap_order_id text,                   -- referencia del comercio
  final_amount numeric(12,2),           -- lo realmente cobrado (conciliar contra esto)
  flag text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists campaign_kit_orders_plan_idx on campaign_kit_orders(plan_id);

-- Seguridad: la marca ve y gestiona sus pedidos; el creador solo los ve.
alter table reap_enrollments enable row level security;
alter table campaign_kit_plans enable row level security;
alter table campaign_kit_orders enable row level security;

create policy "marca ve su tarjeta" on reap_enrollments
  for select using (auth.uid() = brand_id);

create policy "partes ven sus planes" on campaign_kit_plans
  for select using (auth.uid() in (brand_id, creator_id));

create policy "partes ven sus pedidos" on campaign_kit_orders
  for select using (
    auth.uid() = brand_id
    or auth.uid() = (select creator_id from campaign_kit_plans p where p.id = plan_id)
  );

-- Las escrituras las hace solo el backend con la service role key,
-- así que no se crean políticas de insert/update para usuarios.
