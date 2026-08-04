#!/usr/bin/env node

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const AAD = Buffer.from("alpha-studio.provider-api-key.v1");
const PREFIX = "kms-v1.";
const AUTH_TAG_BYTES = 16;
const host = process.env.DEPLOY_HOST || "alpha";
const deployPath = process.env.DEPLOY_PATH || "/root/workspace/alpha_studio";

if (process.argv.length !== 3 || process.argv[2] !== "--apply") {
  console.error("Usage: node scripts/sync-production-models-to-production.mjs --apply");
  process.exit(2);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const stderr = (result.stderr || "").trim();
    throw new Error(`${command} failed with status ${result.status}${stderr ? `: ${stderr}` : ""}`);
  }
  return result.stdout || "";
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function parseEnvFile(path) {
  const values = {};
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values[match[1]] = value;
  }
  return values;
}

function deriveKey(masterKey) {
  return createHash("sha256").update(masterKey, "utf8").digest();
}

function decrypt(ciphertext, masterKey) {
  if (!ciphertext.startsWith(PREFIX)) throw new Error("unsupported provider credential format");
  const sealed = Buffer.from(ciphertext.slice(PREFIX.length), "base64url");
  if (sealed.length <= 12 + AUTH_TAG_BYTES) throw new Error("invalid provider credential");
  const nonce = sealed.subarray(0, 12);
  const encrypted = sealed.subarray(12, -AUTH_TAG_BYTES);
  const tag = sealed.subarray(-AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(masterKey), nonce);
  decipher.setAAD(AAD);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

function encrypt(plaintext, masterKey) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(masterKey), nonce);
  cipher.setAAD(AAD);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const sealed = Buffer.concat([nonce, encrypted, cipher.getAuthTag()]);
  return PREFIX + sealed.toString("base64url");
}

function parseJsonLines(output) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

const localEnv = parseEnvFile(".env");
const localKmsKey = localEnv.PROVIDER_KMS_MASTER_KEY;
if (!localKmsKey) throw new Error("PROVIDER_KMS_MASTER_KEY is missing from local .env");

const localPsqlBase = [
  "compose",
  "exec",
  "-T",
  "postgres",
  "psql",
  "-U",
  localEnv.POSTGRES_USER,
  "-d",
  localEnv.POSTGRES_DB,
  "-At",
  "-v",
  "ON_ERROR_STOP=1",
];

function localQuery(sql) {
  return run("docker", [...localPsqlBase, "-c", sql]);
}

const providerSql = `
select row_to_json(row_data)::text
from (
  select provider, label, base_url, endpoint_path, api_key, api_key_ciphertext,
    api_format, auth_type, auth_header, custom_headers, query_params,
    request_timeout_ms, max_retries, enabled
  from provider_configs
  where enabled = true
  order by provider
) row_data`;

const modelSql = `
select row_to_json(row_data)::text
from (
  select id, model_id, label, provider, mode, base_url, endpoint_path,
    upstream_model, enabled, sort_order,
    input_yuan_per_million::text as input_yuan_per_million,
    output_yuan_per_million::text as output_yuan_per_million,
    reasoning_yuan_per_million::text as reasoning_yuan_per_million,
    cached_input_yuan_per_million::text as cached_input_yuan_per_million,
    markup_bps
  from model_routes
  where enabled = true
  order by sort_order, model_id
) row_data`;

const localProviders = parseJsonLines(localQuery(providerSql));
const localModels = parseJsonLines(localQuery(modelSql));
if (localProviders.length === 0) throw new Error("no enabled local providers found");
if (localModels.length === 0) throw new Error("no enabled local model routes found");

const providerNames = new Set(localProviders.map((provider) => provider.provider));
for (const model of localModels) {
  if (!providerNames.has(model.provider)) {
    throw new Error(`enabled model ${model.model_id} references disabled provider ${model.provider}`);
  }
}

const productionKmsKey = run("ssh", [
  host,
  `cat ${shellQuote(`${deployPath}/secrets/provider_kms_master_key`)}`,
]).trim();
if (!productionKmsKey) throw new Error("production provider KMS key is empty");

const plaintextKeys = new Map();
const productionProviders = localProviders.map((provider) => {
  const plaintext = provider.api_key_ciphertext
    ? decrypt(provider.api_key_ciphertext, localKmsKey)
    : provider.api_key;
  if (provider.auth_type !== "none" && !plaintext) {
    throw new Error(`enabled provider ${provider.provider} has no credential`);
  }
  plaintextKeys.set(provider.provider, plaintext);
  return {
    ...provider,
    api_key: "",
    api_key_ciphertext: plaintext ? encrypt(plaintext, productionKmsKey) : "",
  };
});

const payload = Buffer.from(
  JSON.stringify({ providers: productionProviders, models: localModels }),
  "utf8",
).toString("base64");
const auditId = `audit_model_sync_${Date.now()}_${randomBytes(4).toString("hex")}`;

const applySql = `
begin;
select pg_advisory_xact_lock(hashtext('alpha-studio:model-config-sync'));
with payload as (
  select convert_from(decode('${payload}', 'base64'), 'UTF8')::jsonb as data
)
insert into provider_configs (
  provider, label, base_url, endpoint_path, api_key, api_key_ciphertext,
  api_format, auth_type, auth_header, custom_headers, query_params,
  request_timeout_ms, max_retries, enabled, updated_at
)
select p.provider, p.label, p.base_url, p.endpoint_path, '', p.api_key_ciphertext,
  p.api_format, p.auth_type, p.auth_header, p.custom_headers, p.query_params,
  p.request_timeout_ms, p.max_retries, p.enabled, now()
from payload,
jsonb_to_recordset(payload.data->'providers') as p(
  provider text, label text, base_url text, endpoint_path text,
  api_key_ciphertext text, api_format text, auth_type text, auth_header text,
  custom_headers jsonb, query_params jsonb, request_timeout_ms integer,
  max_retries integer, enabled boolean
)
on conflict (provider) do update set
  label = excluded.label,
  base_url = excluded.base_url,
  endpoint_path = excluded.endpoint_path,
  api_key = '',
  api_key_ciphertext = excluded.api_key_ciphertext,
  api_format = excluded.api_format,
  auth_type = excluded.auth_type,
  auth_header = excluded.auth_header,
  custom_headers = excluded.custom_headers,
  query_params = excluded.query_params,
  request_timeout_ms = excluded.request_timeout_ms,
  max_retries = excluded.max_retries,
  enabled = excluded.enabled,
  updated_at = now();

with payload as (
  select convert_from(decode('${payload}', 'base64'), 'UTF8')::jsonb as data
)
insert into model_routes (
  id, model_id, label, provider, mode, base_url, endpoint_path, upstream_model,
  enabled, sort_order, input_yuan_per_million, output_yuan_per_million,
  reasoning_yuan_per_million, cached_input_yuan_per_million, markup_bps, updated_at
)
select m.id, m.model_id, m.label, m.provider, m.mode, m.base_url,
  m.endpoint_path, m.upstream_model, m.enabled, m.sort_order,
  m.input_yuan_per_million, m.output_yuan_per_million,
  m.reasoning_yuan_per_million, m.cached_input_yuan_per_million,
  m.markup_bps, now()
from payload,
jsonb_to_recordset(payload.data->'models') as m(
  id text, model_id text, label text, provider text, mode text, base_url text,
  endpoint_path text, upstream_model text, enabled boolean, sort_order integer,
  input_yuan_per_million numeric, output_yuan_per_million numeric,
  reasoning_yuan_per_million numeric, cached_input_yuan_per_million numeric,
  markup_bps bigint
)
on conflict (model_id) do update set
  label = excluded.label,
  provider = excluded.provider,
  mode = excluded.mode,
  base_url = excluded.base_url,
  endpoint_path = excluded.endpoint_path,
  upstream_model = excluded.upstream_model,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order,
  input_yuan_per_million = excluded.input_yuan_per_million,
  output_yuan_per_million = excluded.output_yuan_per_million,
  reasoning_yuan_per_million = excluded.reasoning_yuan_per_million,
  cached_input_yuan_per_million = excluded.cached_input_yuan_per_million,
  markup_bps = excluded.markup_bps,
  updated_at = now();

insert into audit_logs (id, tenant_id, actor, action, payload)
values (
  '${auditId}',
  'system',
  'deployment',
  'model_config.sync',
  jsonb_build_object(
    'source', 'local',
    'providers', ${localProviders.length},
    'models', ${localModels.length}
  )
);
commit;
`;

const remotePsql = `cd ${shellQuote(deployPath)} && COMPOSE_PROJECT_NAME=alpha_studio docker compose -f docker-compose.yml -f deploy/production.compose.yml exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -v ON_ERROR_STOP=1'`;
run("ssh", [host, remotePsql], { input: applySql });

function productionQuery(sql) {
  return run("ssh", [host, remotePsql], { input: `${sql};\n` });
}

const verifiedProviders = parseJsonLines(productionQuery(providerSql));
const verifiedModels = parseJsonLines(productionQuery(modelSql));
const verifiedProviderByName = new Map(verifiedProviders.map((item) => [item.provider, item]));
const verifiedModelById = new Map(verifiedModels.map((item) => [item.model_id, item]));

for (const source of localProviders) {
  const target = verifiedProviderByName.get(source.provider);
  if (!target) throw new Error(`production provider ${source.provider} was not found after sync`);
  if (target.api_key !== "") throw new Error(`production provider ${source.provider} retained a plaintext key`);
  const targetPlaintext = target.api_key_ciphertext
    ? decrypt(target.api_key_ciphertext, productionKmsKey)
    : "";
  const sourcePlaintext = plaintextKeys.get(source.provider) || "";
  const sourceBytes = Buffer.from(sourcePlaintext);
  const targetBytes = Buffer.from(targetPlaintext);
  if (
    sourceBytes.length !== targetBytes.length ||
    !timingSafeEqual(sourceBytes, targetBytes)
  ) {
    throw new Error(`production credential verification failed for ${source.provider}`);
  }
  for (const field of [
    "label",
    "base_url",
    "endpoint_path",
    "api_format",
    "auth_type",
    "auth_header",
    "request_timeout_ms",
    "max_retries",
    "enabled",
  ]) {
    if (JSON.stringify(target[field]) !== JSON.stringify(source[field])) {
      throw new Error(`production provider ${source.provider} differs at ${field}`);
    }
  }
}

for (const source of localModels) {
  const target = verifiedModelById.get(source.model_id);
  if (!target) throw new Error(`production model ${source.model_id} was not found after sync`);
  for (const field of [
    "label",
    "provider",
    "mode",
    "base_url",
    "endpoint_path",
    "upstream_model",
    "enabled",
    "sort_order",
    "input_yuan_per_million",
    "output_yuan_per_million",
    "reasoning_yuan_per_million",
    "cached_input_yuan_per_million",
    "markup_bps",
  ]) {
    if (String(target[field]) !== String(source[field])) {
      throw new Error(`production model ${source.model_id} differs at ${field}`);
    }
  }
}

console.log(`Synced and verified ${localProviders.length} providers:`);
for (const provider of localProviders) console.log(`  ${provider.provider} (encrypted key verified)`);
console.log(`Synced and verified ${localModels.length} models:`);
for (const model of localModels) console.log(`  ${model.model_id} -> ${model.provider}`);
