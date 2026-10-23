const brains = {
  nemotron: {
    id: process.env.NVIDIA_MODEL || 'nvidia/nemotron-3-ultra',
    endpoint: process.env.NVIDIA_API_ENDPOINT || 'https://integrate.api.nvidia.com/v1',
    key: process.env.NVIDIA_API_KEY,
  },
  qwen: {
    id: process.env.QWEN_MODEL || 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    endpoint: process.env.QWEN_API_ENDPOINT || 'https://api.together.xyz/v1',
    key: process.env.QWEN_API_KEY,
  },
};

export function resolveBrain(name = 'nemotron') {
  const brain = brains[name];
  if (!brain) throw new Error(`Unknown reasoning provider: ${name}`);
  return brain;
}

export async function routeReasoning(prompt, name = 'nemotron') {
  const brain = resolveBrain(name);
  if (!brain.key) throw new Error(`No API key is configured for ${name}.`);

  let endpoint;
  try {
    endpoint = new URL('chat/completions', `${brain.endpoint.replace(/\/+$/, '')}/`);
  } catch {
    throw new Error(`The configured ${name} API endpoint is not a valid URL.`);
  }
  if (!['http:', 'https:'].includes(endpoint.protocol)) {
    throw new Error(`The configured ${name} API endpoint must use HTTP or HTTPS.`);
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${brain.key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: brain.id,
      temperature: name === 'qwen' ? 0.1 : 0.2,
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500);
    throw new Error(`${brain.id} provider returned HTTP ${response.status}: ${details}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`${brain.id} provider returned no text response.`);
  }
  return { mode: 'provider', brain: brain.id, response: content };
}
