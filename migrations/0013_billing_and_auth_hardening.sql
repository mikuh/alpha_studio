alter table usage_events
  add column if not exists settlement_key text,
  add column if not exists metering_status text not null default 'reported',
  add column if not exists billing_note text not null default '';

create unique index if not exists idx_usage_events_settlement_key
  on usage_events (settlement_key)
  where settlement_key is not null;

alter table billing_ledger
  add column if not exists operation_key text;

create unique index if not exists idx_billing_ledger_operation_key
  on billing_ledger (operation_key)
  where operation_key is not null;

alter table usage_events
  drop constraint if exists usage_events_metering_status_check,
  add constraint usage_events_metering_status_check
    check (metering_status in ('reported', 'budget_fallback'));

alter table model_routes
  drop constraint if exists model_routes_safe_pricing_check,
  add constraint model_routes_safe_pricing_check check (
    input_yuan_per_million >= 0 and input_yuan_per_million < 'Infinity'::double precision and
    output_yuan_per_million >= 0 and output_yuan_per_million < 'Infinity'::double precision and
    reasoning_yuan_per_million >= 0 and reasoning_yuan_per_million < 'Infinity'::double precision and
    cached_input_yuan_per_million >= 0 and cached_input_yuan_per_million < 'Infinity'::double precision and
    markup_bps between 0 and 100000
  ) not valid;

alter table model_runs
  drop constraint if exists model_runs_safe_budget_check,
  add constraint model_runs_safe_budget_check
    check (budget_yuan > 0 and budget_yuan < 'Infinity'::double precision) not valid;

alter table tenants
  drop constraint if exists tenants_finite_balance_check,
  add constraint tenants_finite_balance_check
    check (balance_yuan > '-Infinity'::double precision and balance_yuan < 'Infinity'::double precision) not valid;

-- Authorization codes are bearer credentials. Keep only their one-way hashes;
-- the plaintext is returned once by the creation endpoint.
update authorization_codes set code_plaintext = null where code_plaintext is not null;
