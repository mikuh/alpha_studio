create table if not exists codex_account_tenants (
  account_id text not null references codex_accounts(id) on delete cascade,
  tenant_id text not null references tenants(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (account_id, tenant_id)
);

insert into codex_account_tenants (account_id, tenant_id, assigned_at)
select id, tenant_id, coalesce(assigned_at, now())
from codex_accounts
where tenant_id is not null
on conflict (account_id, tenant_id) do nothing;

create index if not exists idx_codex_account_tenants_tenant
  on codex_account_tenants (tenant_id, account_id);
