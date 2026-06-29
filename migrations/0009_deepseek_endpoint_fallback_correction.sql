update provider_configs
set
  endpoint_path = '/chat/completions',
  updated_at = now()
where provider = 'deepseek'
  and trim(coalesce(endpoint_path, '')) in ('', '/', '/responses');

update model_routes
set
  endpoint_path = '/chat/completions',
  updated_at = now()
where provider = 'deepseek'
  and trim(coalesce(endpoint_path, '')) in ('', '/', '/responses');
