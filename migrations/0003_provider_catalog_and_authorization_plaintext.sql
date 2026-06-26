alter table authorization_codes
  add column if not exists code_plaintext text;

insert into provider_configs (provider, label, base_url, endpoint_path, enabled)
values
  ('openai', 'OpenAI', 'https://api.openai.com/v1', '/responses', false),
  ('deepseek', 'DeepSeek OpenAI-Compatible', 'https://api.deepseek.com/v1', '/responses', false),
  ('anthropic', 'Anthropic', 'https://api.anthropic.com/v1', '/messages', false),
  ('google', 'Google Gemini OpenAI-Compatible', 'https://generativelanguage.googleapis.com/v1beta/openai', '/chat/completions', false),
  ('xai', 'xAI Grok', 'https://api.x.ai/v1', '/chat/completions', false),
  ('mistral', 'Mistral AI', 'https://api.mistral.ai/v1', '/chat/completions', false),
  ('cohere', 'Cohere', 'https://api.cohere.com/compatibility/v1', '/chat/completions', false),
  ('openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1', '/chat/completions', false),
  ('azure-openai', 'Azure OpenAI', 'https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT', '/responses?api-version=2025-04-01-preview', false),
  ('groq', 'Groq', 'https://api.groq.com/openai/v1', '/chat/completions', false),
  ('together', 'Together AI', 'https://api.together.xyz/v1', '/chat/completions', false),
  ('fireworks', 'Fireworks AI', 'https://api.fireworks.ai/inference/v1', '/chat/completions', false),
  ('dashscope', 'Alibaba Cloud DashScope / Qwen', 'https://dashscope.aliyuncs.com/compatible-mode/v1', '/chat/completions', false),
  ('moonshot', 'Moonshot AI / Kimi', 'https://api.moonshot.cn/v1', '/chat/completions', false),
  ('baidu-qianfan', 'Baidu Qianfan', 'https://qianfan.baidubce.com/v2', '/chat/completions', false),
  ('zhipu', 'Zhipu AI / GLM', 'https://open.bigmodel.cn/api/paas/v4', '/chat/completions', false),
  ('siliconflow', 'SiliconFlow', 'https://api.siliconflow.cn/v1', '/chat/completions', false),
  ('minimax', 'MiniMax', 'https://api.minimax.chat/v1', '/text/chatcompletion_v2', false),
  ('volcengine-ark', 'Volcengine Ark', 'https://ark.cn-beijing.volces.com/api/v3', '/chat/completions', false)
on conflict (provider) do update set
  label = excluded.label,
  base_url = excluded.base_url,
  endpoint_path = excluded.endpoint_path,
  updated_at = now();
