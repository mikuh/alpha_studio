alter table model_routes
  add column if not exists supported_reasoning_efforts text[] not null
    default array['low', 'medium', 'high', 'xhigh']::text[],
  add column if not exists default_reasoning_effort text not null default 'medium',
  add column if not exists fast_mode_supported boolean not null default false;

alter table model_routes
  drop constraint if exists model_routes_supported_reasoning_efforts_check,
  add constraint model_routes_supported_reasoning_efforts_check check (
    cardinality(supported_reasoning_efforts) > 0
    and supported_reasoning_efforts <@ array[
      'none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'
    ]::text[]
  ),
  drop constraint if exists model_routes_default_reasoning_effort_check,
  add constraint model_routes_default_reasoning_effort_check check (
    default_reasoning_effort = any(supported_reasoning_efforts)
  );
