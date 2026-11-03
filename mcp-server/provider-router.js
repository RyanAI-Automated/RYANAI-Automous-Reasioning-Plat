const PROVIDER_DEFAULTS = {
  nemotron: { id: 'nvidia/nemotron-3-ultra-550b-a55b', endpoint: 'https://integrate.api.nvidia.com/v1', modelEnv: 'NVIDIA_MODEL', endpointEnv: 'NVIDIA_API_ENDPOINT', keyEnv: 'NVIDIA_API_KEY' },
  qwen: { id: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput', endpoint: 'https://api.together.xyz/v1', modelEnv: 'QWEN_MODEL', endpointEnv: 'QWEN_API_ENDPOINT', keyEnv: 'QWEN_API_KEY' },
  deepseek: { id: 'DeepSeek-V4.1-Flash-1017', endpoint: 'http://127.0.0.1:8888/v1', modelEnv: 'DEEPSEEK_MODEL', endpointEnv: 'DEEPSEEK_API_ENDPOINT', keyEnv: 'DEEPSEEK_API_KEY' },
  torch_tpu: { id: '', endpoint: 'http://127.0.0.1:8000/v1', modelEnv: 'TORCHTPU_MODEL', endpointEnv: 'TORCHTPU_API_ENDPOINT', keyEnv: 'TORCHTPU_API_KEY' },
};

export function resolveBrain(name = 'nemotron', env = process.env) {
  const defaults = PROVIDER_DEFAULTS[name];
  if (!defaults) throw new Error('Unknown reasoning provider: ' + name);
  return {
    id: env[defaults.modelEnv] || defaults.id,
    endpoint: env[defaults.endpointEnv] || defaults.endpoint,
    key: env[defaults.keyEnv] || '',
  };
}

export async function routeReasoning(prompt, name = 'openai', options = {}) {
  if (name === 'openai') return routeOpenAIGateway(prompt, options);
  const brain = resolveBrain(name, options.env || process.env);
  if (!brain.id.trim()) {
    throw new Error('The configured ' + name + ' provider requires its model id to be set.');
  }

  let baseUrl;
  try {
    baseUrl = new URL(brain.endpoint);
  } catch {
    throw new Error('The configured ' + name + ' API endpoint is not a valid URL.');
  }
  if (
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    !baseUrl.hostname ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error('The configured ' + name + ' API endpoint must be a clean HTTP or HTTPS URL without credentials, query strings, or fragments.');
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(baseUrl.hostname.toLowerCase());
  if (!isLoopback && baseUrl.protocol !== 'https:') {
    throw new Error('Remote ' + name + ' API endpoints must use HTTPS.');
  }
  if (!brain.key && !isLoopback) {
    throw new Error('No API key is configured for ' + name + '; unauthenticated requests are allowed only to a loopback endpoint.');
  }

  const baseHref = baseUrl.href.endsWith('/') ? baseUrl.href : baseUrl.href + '/';
  const endpoint = new URL('chat/completions', baseHref);
  const responseFormat = options.responseFormat || 'text';
  if (!['text', 'json_object'].includes(responseFormat)) {
    throw new Error('responseFormat must be text or json_object.');
  }

  const headers = { 'content-type': 'application/json' };
  if (brain.key) headers.authorization = 'Bearer ' + brain.key;
  const response = await (options.fetch || fetch)(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: brain.id,
      temperature: name === 'qwen' ? 0.1 : 0.2,
      messages: [{ role: 'user', content: prompt }],
      ...(responseFormat === 'json_object' ? { response_format: { type: 'json_object' } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(brain.id + ' provider returned HTTP ' + response.status + ': ' + details);
  }

  const payload = await response.json();
  const message = payload.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
      throw new Error(brain.id + ' returned tool calls without text; this route does not execute provider tool calls.');
    }
    throw new Error(brain.id + ' provider returned no text response.');
  }
  if (responseFormat === 'json_object') {
    try {
      JSON.parse(content);
    } catch {
      throw new Error(brain.id + ' did not return valid JSON while JSON response mode was requested.');
    }
  }
  return { mode: 'provider', brain: brain.id, response: content, responseFormat };
}


/** MCP reaches the API-owned OpenAI key through an authenticated private gateway. */
export async function routeOpenAIGateway(prompt, options = {}) {
  const env = options.env || process.env;
  const endpoint = env.RYANAI_OPENAI_GATEWAY_URL || 'http://api:3000/api/internal/openai/chat';
  const token = env.RYANAI_OPENAI_GATEWAY_TOKEN || '';
  if (!token || token.length < 32) throw new Error('RyanAI OpenAI gateway service token is not configured.');
  let url;
  try { url = new URL(endpoint); } catch { throw new Error('RyanAI OpenAI gateway URL is invalid.'); }
  const localHost = ['localhost', '127.0.0.1', '::1', '[::1]', 'api'].includes(url.hostname.toLowerCase());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !localHost)) {
    throw new Error('RyanAI OpenAI gateway must use HTTPS, except for the private Docker API service or loopback.');
  }
  if (url.pathname !== '/api/internal/openai/chat') throw new Error('RyanAI OpenAI gateway path is not allowlisted.');
  const response = await (options.fetch || fetch)(url, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ prompt }), signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error('RyanAI OpenAI gateway returned HTTP ' + response.status + '.');
  const payload = await response.json();
  if (payload?.success !== true || typeof payload.response !== 'string' || !payload.response.trim()) throw new Error('RyanAI OpenAI gateway returned an invalid response.');
  return { mode: 'gateway', brain: 'openai', response: payload.response, responseFormat: 'text' };
}
