alter table model_routes
  add column if not exists max_output_tokens integer not null default 32000;

alter table model_routes
  drop constraint if exists model_routes_max_output_tokens_check,
  add constraint model_routes_max_output_tokens_check check (
    max_output_tokens between 1000 and 1000000
  );

-- Verified against the Volcengine Ark model catalog on 2026-08-09.
-- Ark documents these limits as 1024k/128k/384k; k is the binary model
-- capacity unit used by the catalog (1024 tokens).
update model_routes
set context_window_tokens = 1048576,
    max_output_tokens = 131072
where lower(model_id) like 'glm-5.2%'
   or lower(model_id) like 'glm-5-2%'
   or lower(upstream_model) like 'glm-5-2%';

update model_routes
set context_window_tokens = 1048576,
    max_output_tokens = 393216
where lower(model_id) like 'deepseek-v4-flash%'
   or lower(model_id) like 'deepseek-v4-pro%'
   or lower(upstream_model) like 'deepseek-v4-flash%'
   or lower(upstream_model) like 'deepseek-v4-pro%';

-- Replace display/series aliases only on Ark routes; versioned IDs already
-- configured by an administrator are preserved.
update model_routes
set upstream_model = 'glm-5-2-260617'
where (provider = 'volcengine-ark' or lower(base_url) like '%ark.cn-beijing.volces.com%')
  and lower(upstream_model) in ('glm-5.2', 'glm-5-2');

update model_routes
set upstream_model = 'deepseek-v4-flash-ga-260731'
where (provider = 'volcengine-ark' or lower(base_url) like '%ark.cn-beijing.volces.com%')
  and lower(upstream_model) = 'deepseek-v4-flash';

-- Keep Ark base-cost metadata aligned with the same official price table.
-- Markup remains administrator-controlled and is intentionally untouched.
update model_routes
set input_yuan_per_million = 8.00,
    output_yuan_per_million = 28.00,
    reasoning_yuan_per_million = 28.00,
    cached_input_yuan_per_million = 2.00
where (provider = 'volcengine-ark' or lower(base_url) like '%ark.cn-beijing.volces.com%')
  and (
    lower(model_id) like 'glm-5.2%'
    or lower(model_id) like 'glm-5-2%'
    or lower(upstream_model) like 'glm-5-2%'
  );

update model_routes
set input_yuan_per_million = 1.00,
    output_yuan_per_million = 2.00,
    reasoning_yuan_per_million = 2.00,
    cached_input_yuan_per_million = 0.20
where (provider = 'volcengine-ark' or lower(base_url) like '%ark.cn-beijing.volces.com%')
  and (
    lower(model_id) like 'deepseek-v4-flash%'
    or lower(upstream_model) like 'deepseek-v4-flash%'
  );
