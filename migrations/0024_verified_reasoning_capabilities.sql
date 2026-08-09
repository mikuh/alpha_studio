-- Reasoning controls are model capabilities, not a provider-wide universal enum.
-- `ultra` remains a Codex orchestration mode, but is not a standard gateway
-- reasoning effort. `minimal` is a real OpenAI/Gemini-compatible effort.
alter table model_routes
  drop constraint if exists model_routes_supported_reasoning_efforts_check,
  drop constraint if exists model_routes_default_reasoning_effort_check;

update model_routes
set supported_reasoning_efforts = array_remove(supported_reasoning_efforts, 'ultra'),
    default_reasoning_effort = case
      when default_reasoning_effort = 'ultra' then 'high'
      else default_reasoning_effort
    end;

update model_routes
set supported_reasoning_efforts = array['none']::text[],
    default_reasoning_effort = 'none'
where cardinality(supported_reasoning_efforts) = 0;

-- DeepSeek V4 Pro and GLM-5.2 expose none/high/max through their native APIs;
-- V4 Flash additionally has a distinct native low level.
-- Ark's public Chat contract only promises low/medium/high, so Ark routes use
-- that conservative provider contract instead of leaking native-only values.
update model_routes
set supported_reasoning_efforts = case
      when provider like 'volcengine-ark%'
        or lower(base_url) like '%ark.cn-beijing.volces.com%'
      then array['low', 'medium', 'high']::text[]
      when lower(model_id) like 'deepseek-v4-flash%'
        or lower(upstream_model) like 'deepseek-v4-flash%'
      then array['none', 'low', 'high', 'max']::text[]
      else array['none', 'high', 'max']::text[]
    end,
    default_reasoning_effort = case
      when provider like 'volcengine-ark%'
        or lower(base_url) like '%ark.cn-beijing.volces.com%'
      then 'high'
      when provider = 'zhipu'
        and (lower(model_id) like 'glm-5.2%' or lower(upstream_model) like 'glm-5.2%')
      then 'max'
      else 'high'
    end
where lower(model_id) like 'deepseek-v4-pro%'
   or lower(model_id) like 'deepseek-v4-flash%'
   or lower(upstream_model) like 'deepseek-v4-pro%'
   or lower(upstream_model) like 'deepseek-v4-flash%'
   or lower(model_id) like 'glm-5.2%'
   or lower(model_id) like 'glm-5-2%'
   or lower(upstream_model) like 'glm-5.2%'
   or lower(upstream_model) like 'glm-5-2%';

-- OpenAI public Responses effort matrices, verified per model page.
update model_routes
set supported_reasoning_efforts = array['none', 'low', 'medium', 'high', 'xhigh', 'max']::text[],
    default_reasoning_effort = 'medium'
where lower(model_id) ~ '^gpt-5[.-]6($|-)' or lower(upstream_model) ~ '^gpt-5[.-]6($|-)';

update model_routes
set supported_reasoning_efforts = array['none', 'low', 'medium', 'high', 'xhigh']::text[],
    default_reasoning_effort = 'medium'
where lower(model_id) ~ '^gpt-5[.-]5($|-)' or lower(upstream_model) ~ '^gpt-5[.-]5($|-)';

update model_routes
set supported_reasoning_efforts = array['none', 'low', 'medium', 'high', 'xhigh']::text[],
    default_reasoning_effort = 'none'
where lower(model_id) ~ '^gpt-5[.-](4|2)($|-)' or lower(upstream_model) ~ '^gpt-5[.-](4|2)($|-)';

update model_routes
set supported_reasoning_efforts = array['none', 'low', 'medium', 'high']::text[],
    default_reasoning_effort = 'none'
where lower(model_id) ~ '^gpt-5[.-]1($|-)' or lower(upstream_model) ~ '^gpt-5[.-]1($|-)';

update model_routes
set supported_reasoning_efforts = array['minimal', 'low', 'medium', 'high']::text[],
    default_reasoning_effort = 'medium'
where lower(model_id) = 'gpt-5' or lower(upstream_model) = 'gpt-5';

update model_routes
set supported_reasoning_efforts = array['medium', 'high', 'xhigh']::text[],
    default_reasoning_effort = case
      when lower(model_id) like 'gpt-5.5-pro%' or lower(upstream_model) like 'gpt-5.5-pro%'
      then 'high'
      else 'medium'
    end
where lower(model_id) ~ '^gpt-5[.-](5|4|2)-pro($|-)' or lower(upstream_model) ~ '^gpt-5[.-](5|4|2)-pro($|-)';

update model_routes
set supported_reasoning_efforts = array['high']::text[],
    default_reasoning_effort = 'high'
where lower(model_id) ~ '^gpt-5-pro($|-)' or lower(upstream_model) ~ '^gpt-5-pro($|-)';

update model_routes
set supported_reasoning_efforts = array['low', 'medium', 'high', 'xhigh']::text[],
    default_reasoning_effort = 'medium'
where lower(model_id) ~ '^gpt-5[.-](2|3)-codex($|-)' or lower(upstream_model) ~ '^gpt-5[.-](2|3)-codex($|-)';

update model_routes
set supported_reasoning_efforts = array['none']::text[],
    default_reasoning_effort = 'none'
where lower(model_id) ~ '^gpt-(4[.-]1|4o)($|-)' or lower(upstream_model) ~ '^gpt-(4[.-]1|4o)($|-)';

-- Claude native Messages uses output_config.effort and a separate thinking
-- mode. These arrays describe only the values supported by each model family.
update model_routes
set supported_reasoning_efforts = array['none', 'low', 'medium', 'high', 'xhigh', 'max']::text[],
    default_reasoning_effort = 'high'
where lower(model_id) ~ '^claude-(opus-(4[.-](7|8)|5)|sonnet-5)($|-)'
   or lower(upstream_model) ~ '^claude-(opus-(4[.-](7|8)|5)|sonnet-5)($|-)';

update model_routes
set supported_reasoning_efforts = array['none', 'low', 'medium', 'high', 'max']::text[],
    default_reasoning_effort = 'high'
where lower(model_id) ~ '^claude-(opus|sonnet)-4[.-]6($|-)'
   or lower(upstream_model) ~ '^claude-(opus|sonnet)-4[.-]6($|-)';

-- Gemini native GenerateContent is translated to thinkingLevel (3.x) or a
-- documented thinkingBudget compatibility mapping (2.5).
update model_routes
set supported_reasoning_efforts = array['low', 'medium', 'high']::text[],
    default_reasoning_effort = 'high'
where lower(model_id) ~ '^gemini-3[.-]1-pro($|-)' or lower(upstream_model) ~ '^gemini-3[.-]1-pro($|-)';

update model_routes
set supported_reasoning_efforts = array['minimal', 'low', 'medium', 'high']::text[],
    default_reasoning_effort = case
      when lower(model_id) like '%flash-lite%' or lower(upstream_model) like '%flash-lite%' then 'minimal'
      else 'medium'
    end
where lower(model_id) ~ '^gemini-3([.-][0-9]+)?-(flash|flash-lite)($|-)'
   or lower(upstream_model) ~ '^gemini-3([.-][0-9]+)?-(flash|flash-lite)($|-)';

update model_routes
set supported_reasoning_efforts = array['minimal', 'low', 'medium', 'high']::text[],
    default_reasoning_effort = 'medium'
where lower(model_id) ~ '^gemini-2[.-]5-pro($|-)' or lower(upstream_model) ~ '^gemini-2[.-]5-pro($|-)';

update model_routes
set supported_reasoning_efforts = array['none', 'minimal', 'low', 'medium', 'high']::text[],
    default_reasoning_effort = case
      when lower(model_id) like '%flash-lite%' or lower(upstream_model) like '%flash-lite%' then 'none'
      else 'medium'
    end
where lower(model_id) ~ '^gemini-2[.-]5-flash($|-)' or lower(upstream_model) ~ '^gemini-2[.-]5-flash($|-)';

-- Common DashScope hybrid/fixed-thinking families.
update model_routes
set supported_reasoning_efforts = array['none', 'low', 'medium', 'xhigh']::text[],
    default_reasoning_effort = 'xhigh'
where lower(model_id) ~ '^qwen3[.-]8-max($|-)' or lower(upstream_model) ~ '^qwen3[.-]8-max($|-)';

update model_routes
set supported_reasoning_efforts = array['none', 'high']::text[],
    default_reasoning_effort = 'high'
where lower(model_id) ~ '^qwen3[.-](5|6|7)($|-)' or lower(upstream_model) ~ '^qwen3[.-](5|6|7)($|-)'
   or lower(model_id) ~ '^kimi-k2[.-](5|6)($|-)' or lower(upstream_model) ~ '^kimi-k2[.-](5|6)($|-)';

alter table model_routes
  add constraint model_routes_supported_reasoning_efforts_check check (
    cardinality(supported_reasoning_efforts) > 0
    and supported_reasoning_efforts <@ array[
      'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'
    ]::text[]
  ),
  add constraint model_routes_default_reasoning_effort_check check (
    default_reasoning_effort = any(supported_reasoning_efforts)
  );
