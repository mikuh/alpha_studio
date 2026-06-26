update provider_configs
set
  base_url = 'https://api.minimaxi.com/v1',
  endpoint_path = '/chat/completions',
  updated_at = now()
where provider = 'minimax'
  and base_url = 'https://api.minimax.io/v1';
