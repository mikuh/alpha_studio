update provider_configs
set
  base_url = 'https://YOUR_RESOURCE.openai.azure.com/openai/v1',
  endpoint_path = '/responses',
  updated_at = now()
where provider = 'azure-openai'
  and base_url = 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT';

update provider_configs
set
  base_url = 'https://api.minimax.io/v1',
  endpoint_path = '/chat/completions',
  updated_at = now()
where provider = 'minimax'
  and base_url = 'https://api.minimax.chat/v1';
