-- Monetary values are exact decimals with micro-yuan precision. JavaScript
-- clients still receive the existing *Yuan API fields, but storage and all
-- server-side settlement arithmetic no longer use binary floating point.
alter table model_routes drop constraint if exists model_routes_safe_pricing_check;
alter table model_runs drop constraint if exists model_runs_safe_budget_check;
alter table tenants drop constraint if exists tenants_finite_balance_check;

alter table tenants
  alter column balance_yuan type numeric(20, 6)
    using round(balance_yuan::numeric, 6);

alter table model_runs
  alter column budget_yuan type numeric(20, 6)
    using round(budget_yuan::numeric, 6);

alter table usage_events
  alter column cost_yuan type numeric(20, 6)
    using round(cost_yuan::numeric, 6),
  alter column billable_yuan type numeric(20, 6)
    using round(billable_yuan::numeric, 6);

alter table billing_ledger
  alter column amount_yuan type numeric(20, 6)
    using round(amount_yuan::numeric, 6);

alter table model_routes
  alter column input_yuan_per_million type numeric(20, 6)
    using round(input_yuan_per_million::numeric, 6),
  alter column output_yuan_per_million type numeric(20, 6)
    using round(output_yuan_per_million::numeric, 6),
  alter column reasoning_yuan_per_million type numeric(20, 6)
    using round(reasoning_yuan_per_million::numeric, 6),
  alter column cached_input_yuan_per_million type numeric(20, 6)
    using round(cached_input_yuan_per_million::numeric, 6);

alter table model_routes
  add constraint model_routes_safe_pricing_check check (
    input_yuan_per_million >= 0 and
    output_yuan_per_million >= 0 and
    reasoning_yuan_per_million >= 0 and
    cached_input_yuan_per_million >= 0 and
    markup_bps between 0 and 100000
  );

alter table model_runs
  add constraint model_runs_safe_budget_check
    check (budget_yuan > 0 and budget_yuan <= 10000);

alter table tenants
  add constraint tenants_finite_balance_check
    check (balance_yuan between -10000000000000 and 10000000000000);

-- Bring pre-existing balances under the immutable ledger before enabling
-- reconciliation. This records only the exact delta not already represented
-- by historical ledger entries.
insert into billing_ledger (
  id, tenant_id, run_id, entry_type, amount_yuan, description, operation_key
)
select
  'ledger_opening_' || md5(t.id),
  t.id,
  null,
  'opening_balance',
  t.balance_yuan - coalesce(sum(l.amount_yuan), 0::numeric),
  'Opening balance captured during decimal billing migration',
  'opening-balance:' || t.id
from tenants t
left join billing_ledger l on l.tenant_id = t.id
group by t.id, t.balance_yuan
having t.balance_yuan - coalesce(sum(l.amount_yuan), 0::numeric) <> 0
on conflict (operation_key) where operation_key is not null do nothing;

create table if not exists offline_payment_records (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  record_type text not null,
  amount_yuan numeric(20, 6) not null,
  reference text not null,
  note text not null default '',
  received_at timestamptz not null,
  reverses_record_id text references offline_payment_records(id),
  operation_key text not null unique,
  recorded_by text not null,
  created_at timestamptz not null default now(),
  check (record_type in ('offline_receipt', 'correction')),
  check (
    (record_type = 'offline_receipt' and amount_yuan > 0 and reverses_record_id is null)
    or (record_type = 'correction' and amount_yuan <> 0 and reverses_record_id is not null)
  )
);

create index if not exists idx_offline_payment_records_tenant_received
  on offline_payment_records (tenant_id, received_at desc, created_at desc);

comment on table offline_payment_records is
  'Administrative records for money received outside Alpha Studio. This table does not initiate payments or refunds.';
