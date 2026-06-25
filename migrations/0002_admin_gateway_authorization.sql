alter table tenants
  add column if not exists company_key text,
  add column if not exists codex_subscription_enabled boolean not null default false,
  add column if not exists codex_subscription_plan text,
  add column if not exists codex_subscription_expires_at timestamptz;

update tenants
set company_key = lower(regexp_replace(trim(name), '\s+', ' ', 'g'))
where company_key is null;

create unique index if not exists idx_tenants_company_key on tenants (company_key);

alter table model_routes
  add column if not exists endpoint_path text not null default '/responses',
  add column if not exists updated_at timestamptz not null default now();

create table if not exists provider_configs (
  provider text primary key,
  label text not null,
  base_url text not null,
  endpoint_path text not null default '/responses',
  api_key text not null default '',
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into provider_configs (provider, label, base_url, endpoint_path, enabled)
values
  ('openai', 'OpenAI', 'https://api.openai.com/v1', '/responses', false),
  ('deepseek', 'DeepSeek OpenAI-Compatible', 'https://api.deepseek.com/v1', '/responses', false),
  ('anthropic', 'Anthropic', 'https://api.anthropic.com/v1', '/messages', false)
on conflict (provider) do nothing;

create table if not exists authorization_codes (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  code_hash text not null unique,
  code_hint text not null,
  max_devices integer not null,
  status text not null default 'active',
  expires_at timestamptz,
  last_used_at timestamptz,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists codex_accounts (
  id text primary key,
  tenant_id text references tenants(id) on delete set null,
  email text not null,
  login_secret text not null default '',
  login_hint text not null default '',
  plan text not null default 'monthly',
  status text not null default 'active',
  seat_limit integer not null default 1,
  expires_at timestamptz,
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_authorization_codes_tenant on authorization_codes (tenant_id, status);
create index if not exists idx_codex_accounts_tenant on codex_accounts (tenant_id, status);
