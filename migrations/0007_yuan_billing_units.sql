do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'tenants'
      and column_name = 'balance_cents'
  ) then
    alter table tenants rename column balance_cents to balance_yuan;
    alter table tenants
      alter column balance_yuan type double precision using balance_yuan::double precision / 100.0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'model_runs'
      and column_name = 'budget_cents'
  ) then
    alter table model_runs rename column budget_cents to budget_yuan;
    alter table model_runs
      alter column budget_yuan type double precision using budget_yuan::double precision / 100.0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'usage_events'
      and column_name = 'cost_cents'
  ) then
    alter table usage_events rename column cost_cents to cost_yuan;
    alter table usage_events
      alter column cost_yuan type double precision using cost_yuan::double precision / 100.0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'usage_events'
      and column_name = 'billable_cents'
  ) then
    alter table usage_events rename column billable_cents to billable_yuan;
    alter table usage_events
      alter column billable_yuan type double precision using billable_yuan::double precision / 100.0;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = current_schema()
      and table_name = 'billing_ledger'
      and column_name = 'amount_cents'
  ) then
    alter table billing_ledger rename column amount_cents to amount_yuan;
    alter table billing_ledger
      alter column amount_yuan type double precision using amount_yuan::double precision / 100.0;
  end if;
end $$;
