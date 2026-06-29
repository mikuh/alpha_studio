update provider_configs
set
  endpoint_path = '/chat/completions',
  updated_at = now()
where provider = 'deepseek'
  and endpoint_path = '/responses';

update model_routes
set
  endpoint_path = '/chat/completions',
  updated_at = now()
where provider = 'deepseek'
  and endpoint_path = '/responses';
