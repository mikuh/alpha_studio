-- Explicit opt-in for both existing and new customers. Never grant modules
-- merely because a tenant is active or has a model subscription.
ALTER TABLE tenants ADD COLUMN enabled_modules text[] NOT NULL DEFAULT '{}';
