alter table provider_configs
  add column if not exists api_format text not null default 'auto',
  add column if not exists auth_type text not null default 'bearer',
  add column if not exists auth_header text not null default 'authorization',
  add column if not exists custom_headers jsonb not null default '{}'::jsonb,
  add column if not exists query_params jsonb not null default '{}'::jsonb,
  add column if not exists request_timeout_ms integer not null default 300000,
  add column if not exists max_retries integer not null default 2;

update provider_configs
set
  api_format = case
    when provider = 'anthropic' or lower(split_part(endpoint_path, '?', 1)) like '%/messages' then 'anthropic_messages'
    when lower(split_part(endpoint_path, '?', 1)) like '%/chat/completions' then 'chat_completions'
    when lower(split_part(endpoint_path, '?', 1)) like '%:generatecontent' then 'gemini_generate_content'
    else 'responses'
  end,
  auth_type = case
    when provider = 'anthropic' then 'api_key_header'
    when provider = 'azure-openai' then 'api_key_header'
    else auth_type
  end,
  auth_header = case
    when provider = 'anthropic' then 'x-api-key'
    when provider = 'azure-openai' then 'api-key'
    else auth_header
  end,
  custom_headers = case
    when provider = 'anthropic' then custom_headers || '{"anthropic-version":"2023-06-01"}'::jsonb
    else custom_headers
  end,
  query_params = case
    when provider = 'azure-openai' then query_params || '{"api-version":"2025-04-01-preview"}'::jsonb
    else query_params
  end,
  updated_at = now();

update provider_configs
set
  api_format = 'chat_completions',
  auth_type = 'bearer',
  auth_header = 'authorization',
  updated_at = now()
where provider = 'google'
  and base_url like '%/openai%';

insert into provider_configs (
  provider, label, base_url, endpoint_path, api_format, auth_type, auth_header, enabled
)
values
  ('ollama', 'Ollama (Local)', 'http://host.docker.internal:11434/v1', '/chat/completions', 'chat_completions', 'none', 'authorization', false)
on conflict (provider) do nothing;

alter table provider_configs
  drop constraint if exists provider_configs_api_format_check,
  add constraint provider_configs_api_format_check
    check (api_format in ('auto', 'responses', 'chat_completions', 'anthropic_messages', 'gemini_generate_content')),
  drop constraint if exists provider_configs_auth_type_check,
  add constraint provider_configs_auth_type_check
    check (auth_type in ('bearer', 'api_key_header', 'query_param', 'none')),
  drop constraint if exists provider_configs_request_timeout_check,
  add constraint provider_configs_request_timeout_check
    check (request_timeout_ms between 1000 and 900000),
  drop constraint if exists provider_configs_max_retries_check,
  add constraint provider_configs_max_retries_check
    check (max_retries between 0 and 5);
