-- Each agent has one in-flight request; independent spawned agents can share
-- a task without sharing the same spending allowance. Reservations here are
-- task safety accounting only, never a wallet charge.
create table gateway_request_leases (
  id text primary key,
  run_id text not null references model_runs(id) on delete cascade,
  lane text not null,
  reserved_yuan numeric(20,6) not null check (reserved_yuan >= 0),
  provider_key text,
  dispatching boolean not null default false,
  dispatch_expires_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, lane)
);
create index gateway_request_leases_provider on gateway_request_leases(provider_key) where dispatching;

-- Shared across backend processes. Only a hash of provider identity is stored.
create table gateway_provider_cooldowns (
  provider_key text primary key,
  cooldown_until timestamptz not null default now(),
  recovery_until timestamptz not null default now()
);

comment on column model_runs.active_request_id is
  'Compatibility marker for any outstanding request. New clients use gateway_request_leases; legacy clients remain serialized until all requests settle.';
