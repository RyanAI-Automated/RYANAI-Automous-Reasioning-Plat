import WebSocket from 'ws';

const apiKey = process.env.OPENAI_API_KEY?.trim();
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is not configured; no Live voice request was made.');
}

const model = process.env.RYANAI_REALTIME_MODEL?.trim() || 'gpt-live-1';
const socket = new WebSocket('wss://api.openai.com/v1/live/sessions', {
  headers: { Authorization: `Bearer ${apiKey}` },
  maxPayload: 64 * 1024,
});

const seen = [];
const waiters = new Set();
let audioBytesReceived = 0;
let sessionId = null;

function waitFor(type, timeoutMs) {
  const existing = seen.find((event) => event.type === type);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve, reject) => {
    const waiter = { type, resolve, reject };
    const timer = setTimeout(() => {
      waiters.delete(waiter);
      reject(new Error(`Timed out waiting for Live event: ${type}`));
    }, timeoutMs);
    waiter.resolve = (event) => {
      clearTimeout(timer);
      resolve(event);
    };
    waiter.reject = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    waiters.add(waiter);
  });
}

socket.on('message', (data) => {
  let event;
  try {
    event = JSON.parse(data.toString());
  } catch {
    for (const waiter of waiters) waiter.reject(new Error('Live returned a non-JSON event.'));
    waiters.clear();
    return;
  }

  if (!event || typeof event.type !== 'string') return;
  seen.push(event);

  if (event.type === 'error') {
    const code = typeof event.error?.code === 'string' ? event.error.code : 'provider_error';
    for (const waiter of waiters) waiter.reject(new Error(`Live provider rejected the smoke test (${code}).`));
    waiters.clear();
    return;
  }

  if (event.type === 'session.output_audio.delta' && typeof event.delta === 'string') {
    audioBytesReceived += Buffer.from(event.delta, 'base64').length;
  }

  for (const waiter of [...waiters]) {
    if (waiter.type === event.type) {
      waiters.delete(waiter);
      waiter.resolve(event);
    }
  }
});

socket.on('error', () => {
  for (const waiter of waiters) waiter.reject(new Error('Live WebSocket transport failed.'));
  waiters.clear();
});

try {
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', () => reject(new Error('Could not connect to the Live WebSocket endpoint.')));
  });

  socket.send(JSON.stringify({
    type: 'session.start',
    event_id: 'ryanai-live-smoke-start',
    session: {
      model,
      instructions: 'This is a short automated audio transport check. Speak the phrase: RyanAI live voice check passed.',
      audio: {
        format: { type: 'audio/pcm', rate: 24000 },
        output: { voice: 'marin' },
      },
    },
  }));

  const started = await waitFor('session.started', 20_000);
  sessionId = started.session?.id ?? null;

  // Send a bounded 100 ms mono PCM16 silence frame to exercise the real
  // upstream input-audio transport without using a microphone or user audio.
  const silence = Buffer.alloc(24_000 / 10 * 2);
  socket.send(JSON.stringify({
    type: 'session.input_audio.append',
    audio: silence.toString('base64'),
  }));

  socket.send(JSON.stringify({
    type: 'session.commentary.append',
    event_id: 'ryanai-live-smoke-speak',
    delegation_id: null,
    content: 'Please speak the phrase: RyanAI live voice check passed.',
  }));

  await waitFor('session.output_audio.delta', 30_000);
  if (audioBytesReceived <= 0) {
    throw new Error('Live session started but returned no audio bytes.');
  }

  socket.send(JSON.stringify({
    type: 'session.close',
    event_id: 'ryanai-live-smoke-close',
  }));
  await waitFor('session.closed', 15_000);

  const summary = {
    status: 'PASS',
    model,
    sessionStarted: true,
    inputAudioFrameSent: true,
    outputAudioBytesReceived: audioBytesReceived,
    sessionFinalized: true,
    sessionIdPresent: Boolean(sessionId),
  };
  console.log(JSON.stringify(summary));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import('node:fs');
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
      '## GPT-Live audio transport smoke test',
      '',
      '| Check | Result |',
      '|---|---|',
      '| Session started | PASS |',
      '| 100 ms PCM16 input frame sent | PASS |',
      '| Provider audio received | PASS |',
      '| Session finalized | PASS |',
      `| Model | ${model} |`,
      `| Output audio bytes | ${audioBytesReceived} |`,
      '',
      'This validates a real provider audio session and audio output. It does not replace a microphone/browser acceptance test.',
      '',
    ].join('\\n') + '\\n');
  }
} finally {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close();
  }
}
