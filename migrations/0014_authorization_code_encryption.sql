alter table authorization_codes
  add column if not exists code_ciphertext text;

comment on column authorization_codes.code_ciphertext is
  'AES-256-GCM encrypted authorization code; plaintext remains null and code_hash is used for activation checks';
