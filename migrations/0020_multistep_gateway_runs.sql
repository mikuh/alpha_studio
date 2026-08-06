-- A single Codex turn can contain many Responses API calls (for example, one
-- call to choose a tool and another after the tool result). Keep the run token
-- scoped to that turn while accounting for each upstream request separately.
alter table model_runs
  add column if not exists active_request_id text,
  add column if not exists accumulated_billable_yuan numeric(20, 6) not null default 0,
  add column if not exists request_count bigint not null default 0,
  add column if not exists last_activity_at timestamptz;

update model_runs r
set accumulated_billable_yuan = totals.billable_yuan,
    request_count = totals.request_count,
    last_activity_at = totals.last_activity_at
from (
  select run_id,
    coalesce(sum(billable_yuan), 0::numeric) as billable_yuan,
    count(*)::bigint as request_count,
    max(created_at) as last_activity_at
  from usage_events
  group by run_id
) totals
where totals.run_id = r.id;

alter table model_runs
  drop constraint if exists model_runs_accumulated_billable_yuan_check,
  add constraint model_runs_accumulated_billable_yuan_check
    check (accumulated_billable_yuan >= 0);

create index if not exists idx_model_runs_active_request
  on model_runs (active_request_id)
  where active_request_id is not null;

comment on column model_runs.active_request_id is
  'Request-level lease preventing concurrent upstream calls from sharing one run budget.';
comment on column model_runs.accumulated_billable_yuan is
  'Confirmed cumulative usage for all Responses calls made with this task-scoped run token.';
comment on column model_runs.budget_yuan is
  'Cumulative task safety limit; it does not reserve or deduct tenant balance.';
