-- New model runs no longer reserve account balance. When an upstream response
-- cannot provide reliable usage, record the event for reconciliation without
-- estimating a charge from the per-run safety limit.
alter table usage_events
  drop constraint if exists usage_events_metering_status_check,
  add constraint usage_events_metering_status_check
    check (metering_status in ('reported', 'budget_fallback', 'usage_unavailable'));

comment on column model_runs.budget_yuan is
  'Per-run safety limit used to cap output; it does not reserve or deduct tenant balance.';
