alter table provider_configs
  add column if not exists api_key_ciphertext text not null default '';

comment on column provider_configs.api_key_ciphertext is
  'AES-256-GCM envelope ciphertext protected by the deployment KMS master key';

alter table codex_accounts
  add column if not exists login_secret_ciphertext text not null default '';

comment on column codex_accounts.login_secret_ciphertext is
  'AES-256-GCM envelope ciphertext protected by the deployment KMS master key';

create table if not exists admin_login_security (
  principal text primary key,
  failed_attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists idx_admin_login_security_locked_until
  on admin_login_security (locked_until)
  where locked_until is not null;
