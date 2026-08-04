create table if not exists client_agreement_acceptances (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  device_id text not null references devices(id) on delete cascade,
  service_terms_version text not null,
  privacy_policy_version text not null,
  third_party_model_notice_version text not null,
  research_risk_disclosure_version text not null,
  accepted_at timestamptz not null default now()
);

create index if not exists idx_client_agreement_acceptances_device_accepted
  on client_agreement_acceptances (tenant_id, device_id, accepted_at desc);
