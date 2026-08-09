alter table model_routes
  add column if not exists context_window_tokens integer not null default 64000;

update model_routes
set context_window_tokens = 258000
where context_window_tokens = 64000
  and (provider = 'openai' or lower(model_id) like 'gpt-%');

alter table model_routes
  drop constraint if exists model_routes_context_window_tokens_check,
  add constraint model_routes_context_window_tokens_check check (
    context_window_tokens between 16000 and 2000000
  );
