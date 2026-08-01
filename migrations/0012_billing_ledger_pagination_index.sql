create index if not exists idx_billing_ledger_tenant_created_id
  on billing_ledger (tenant_id, created_at desc, id desc);
