const PROVIDER_DEFAULTS = {
  nemotron: {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    endpoint: 'https://integrate.api.nvidia.com/v1',
    modelEnv: 'NVIDIA_MODEL',
    endpointEnv: 'NVIDIA_API_ENDPOINT',
    keyEnv: 'NVIDIA_API_KEY',
  },
  qwen: {
    id: 'Qwen/Qwen3-235B-A22B-Instruct-2507-tput',
    endpoint: 'https://api.together.xyz/v1',
    modelEnv: 'QWEN_MODEL',
    endpointEnv: 'QWEN_API_ENDPOINT',
    keyEnv: 'QWEN_API_KEY',
  },
  deepseek: {
    id: 'DeepSeek-V4.1-Flash-1017',
    endpoint: 'http://127.0.0.1:8888/v1',
    modelEnv: 'DEEPSEEK_MODEL',
    endpointEnv: 'DEEPSEEK_API_ENDPOINT',
    keyEnv: 'DEEPSEEK_API_KEY',
  },
};

export function resolveBrain(name = 'nemotron', env = process.env) {
  const defaults = PROVIDER_DEFAULTS[name];
  if (!defaults) throw new Error(`Unknown reasoning provider: ${name}`);
  return {
    id: env[defaults.modelEnv] || defaults.id,
    endpoint: env[defaults.endpointEnv] || defaults.endpoint,
    key: env[defaults.keyEnv] || '',
  };
}

export async function routeReasoning(prompt, name = 'nemotron', options = {}) {
  const brain = resolveBrain(name, options.env || process.env);
  let endpoint;
  try {
    endpoint = new URL('chat/completions', `${brain.endpoint.replace(/\\/+$/, '')}/`);
  } catch {
    throw new Error(`The configured ${name} API endpoint is not a valid URL.`);
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error(`The configured ${name} API endpoint must be a clean HTTP or HTTPS URL without credentials, query strings, or fragments.`);
  }

  const isLoopback = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(endpoint.hostname.toLowerCase());
  if (!brain.key && !isLoopback) {
    throw new Error(`No API key is configured for ${name}; unauthenticated requests are allowed only to a loopback endpoint.`);
  }

  const responseFormat = options.responseFormat || 'text';
  if (!['text', 'json_object'].includes(responseFormat)) {
    throw new Error('responseFormat must be text or json_object.');
  }
  const headers = { 'content-type': 'application/json' };
  if (brain.key) headers.authorization = `Bearer ${brain.key}`;

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
    throw new Error(`${brain.id} provider returned HTTP ${response.status}: ${details}`);
  }

  const payload = await response.json();
  const message = payload.choices?.[0]?.message;
  const content = message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    if (Array.isArray(message?.tool_calls) && message.tool_calls.length) {
      throw new Error(`${brain.id} returned tool calls without text; this route does not execute provider tool calls.`);
    }
    throw new Error(`${brain.id} provider returned no text response.`);
  }

  if (responseFormat === 'json_object') {
    try {
      JSON.parse(content);
    } catch {
      throw new Error(`${brain.id} did not return valid JSON while JSON response mode was requested.`);
    }
  }
  return { mode: 'provider', brain: brain.id, response: content, responseFormat };
}
