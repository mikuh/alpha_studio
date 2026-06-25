create table if not exists tenants (
  id text primary key,
  name text not null,
  status text not null default 'active',
  max_devices integer not null default 3,
  billing_mode text not null default 'hybrid',
  balance_cents bigint not null default 0,
  subscription_plan text,
  subscription_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists users (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);

create table if not exists devices (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null,
  fingerprint text not null,
  name text not null,
  status text not null default 'active',
  lease_expires_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, fingerprint)
);

create table if not exists model_routes (
  id text primary key,
  model_id text not null unique,
  label text not null,
  provider text not null,
  mode text not null,
  base_url text not null,
  upstream_model text not null,
  enabled boolean not null default true,
  sort_order integer not null default 100,
  input_cents_per_million bigint not null default 0,
  output_cents_per_million bigint not null default 0,
  reasoning_cents_per_million bigint not null default 0,
  cached_input_cents_per_million bigint not null default 0,
  markup_bps bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists model_runs (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null,
  device_id text not null,
  model_id text not null,
  mode text not null,
  status text not null,
  budget_cents bigint not null default 0,
  upstream_status integer,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists usage_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  run_id text not null references model_runs(id) on delete cascade,
  model_id text not null,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  reasoning_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  cost_cents bigint not null default 0,
  billable_cents bigint not null default 0,
  upstream_status integer not null,
  latency_ms bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists billing_ledger (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  run_id text references model_runs(id) on delete set null,
  entry_type text not null,
  amount_cents bigint not null,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id text primary key,
  tenant_id text not null,
  actor text not null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

insert into tenants (id, name, max_devices, balance_cents)
values ('demo', 'Demo Fund', 5, 100000)
on conflict (id) do nothing;

insert into users (id, tenant_id, email, name, role)
values ('user_demo_admin', 'demo', 'admin@demo.local', 'Demo Admin', 'admin')
on conflict (tenant_id, email) do nothing;

insert into model_routes (
  id, model_id, label, provider, mode, base_url, upstream_model, sort_order,
  input_cents_per_million, output_cents_per_million, reasoning_cents_per_million,
  cached_input_cents_per_million, markup_bps
)
values
  (
    'route_gpt_55',
    'gpt-5.5',
    'GPT-5.5 API',
    'openai',
    'gateway_api',
    'https://api.openai.com/v1',
    'gpt-5.5',
    10,
    120,
    480,
    480,
    30,
    2500
  ),
  (
    'route_gpt_54_mini',
    'gpt-5.4-mini',
    'GPT-5.4 Mini API',
    'openai',
    'gateway_api',
    'https://api.openai.com/v1',
    'gpt-5.4-mini',
    20,
    40,
    160,
    160,
    10,
    2500
  )
on conflict (model_id) do update set
  label = excluded.label,
  provider = excluded.provider,
  mode = excluded.mode,
  base_url = excluded.base_url,
  upstream_model = excluded.upstream_model,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  input_cents_per_million = excluded.input_cents_per_million,
  output_cents_per_million = excluded.output_cents_per_million,
  reasoning_cents_per_million = excluded.reasoning_cents_per_million,
  cached_input_cents_per_million = excluded.cached_input_cents_per_million,
  markup_bps = excluded.markup_bps;

create index if not exists idx_devices_tenant_status on devices (tenant_id, status);
create index if not exists idx_model_runs_tenant_created on model_runs (tenant_id, created_at desc);
create index if not exists idx_usage_events_tenant_created on usage_events (tenant_id, created_at desc);
create index if not exists idx_audit_logs_created on audit_logs (created_at desc);
