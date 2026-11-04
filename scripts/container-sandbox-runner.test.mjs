import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createContainerSandboxRunner, containerSandboxPolicy } from '../src/engineering/containerSandboxRunner.mjs';

const IMAGE = 'ghcr.io/ryanai/genaicode-sandbox@sha256:' + 'a'.repeat(64);
const temporary = [];
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ryanai-container-sandbox-'));
  temporary.push(root);
  const nested = path.join(root, 'repo');
  await mkdir(nested);
  return { root, nested };
}
function fakeChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => true;
  return child;
}
test.after(async () => {
  await Promise.all(temporary.map((item) => rm(item, { recursive: true, force: true })));
});

test('requires an immutable digest-pinned sandbox image', () => {
  assert.throws(() => createContainerSandboxRunner({ image: 'latest' }), /sha256 image digest/);
});

test('declares restrictive capabilities and policy', () => {
  const runner = createContainerSandboxRunner({ image: IMAGE, spawn: () => fakeChild() });
  assert.deepEqual(runner.capabilities, {
    filesystemIsolation: true,
    workspaceMountOnly: true,
    resourceLimits: true,
    networkPolicy: 'deny-by-default',
    credentialScope: 'agent-only',
  });
  assert.equal(containerSandboxPolicy.network, 'none');
  assert.equal(containerSandboxPolicy.hostCredentialsPassed, false);
});

test('launches only with network, privilege, filesystem and resource restrictions', async () => {
  const { root, nested } = await workspace();
  let invocation;
  const runner = createContainerSandboxRunner({
    image: IMAGE,
    spawn: (...args) => { invocation = args; return fakeChild(); },
  });
  await runner.run({
    command: 'genaicode',
    args: ['run', '--json', '-'],
    cwd: nested,
    workspaceRoot: root,
    env: { LANG: 'C.UTF-8', CI: 'true', OPENAI_API_KEY: 'must-not-pass' },
  });
  const [binary, args, options] = invocation;
  assert.equal(binary, 'docker');
  assert.ok(args.includes('--network=none'));
  assert.ok(args.includes('--read-only'));
  assert.ok(args.includes('--cap-drop=ALL'));
  assert.ok(args.includes('--security-opt=no-new-privileges:true'));
  assert.ok(args.includes('--pids-limit=128'));
  assert.ok(args.includes('--memory=2g'));
  assert.ok(args.includes('--cpus=2'));
  assert.ok(args.includes('--user=10001:10001'));
  assert.ok(args.includes('type=bind,src=' + nested + ',dst=/workspace'));
  assert.ok(args.includes('/workspace'));
  assert.ok(args.includes('--env'));
  assert.ok(args.includes('LANG=C.UTF-8'));
  assert.ok(!args.some((arg) => arg.includes('OPENAI_API_KEY')));
  assert.ok(!JSON.stringify(options.env).includes('OPENAI_API_KEY'));
});

test('rejects a working directory outside the approved root', async () => {
  const { root } = await workspace();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'ryanai-outside-'));
  temporary.push(outside);
  const runner = createContainerSandboxRunner({ image: IMAGE, spawn: () => fakeChild() });
  await assert.rejects(() => runner.run({
    command: 'genaicode', args: [], cwd: outside, workspaceRoot: root, env: {},
  }), /inside the approved workspace root/);
});

test('rejects command and argument injection shapes before spawning', async () => {
  const { root, nested } = await workspace();
  let called = false;
  const runner = createContainerSandboxRunner({ image: IMAGE, spawn: () => { called = true; return fakeChild(); } });
  await assert.rejects(() => runner.run({
    command: 'sh -c', args: [], cwd: nested, workspaceRoot: root, env: {},
  }), /simple executable name/);
  await assert.rejects(() => runner.run({
    command: 'genaicode', args: ['bad\0arg'], cwd: nested, workspaceRoot: root, env: {},
  }), /safe strings/);
  assert.equal(called, false);
});

test('cancellation awaits successful Docker termination before stopping the client', async () => {
  const { root, nested } = await workspace();
  const invocations = [];
  const runner = createContainerSandboxRunner({
    image: IMAGE,
    spawn: (...args) => {
      invocations.push(args);
      const child = fakeChild();
      if (args[1]?.[0] === 'kill') setImmediate(() => child.emit('close', 0, null));
      return child;
    },
  });
  const child = await runner.run({ command: 'genaicode', args: [], cwd: nested, workspaceRoot: root, env: {} });
  await child.terminate();
  assert.ok(invocations.some(([binary, args]) => binary === 'docker' && args[0] === 'kill' && args[1].startsWith('ryanai-genai-')));
});

test('expired container cleanup inspects, kills and removes the task-scoped container', async () => {
  const invocations = [];
  const runner = createContainerSandboxRunner({
    image: IMAGE,
    spawn: (...args) => {
      invocations.push(args[1]);
      const child = fakeChild();
      setImmediate(() => {
        if (args[1][0] === 'inspect') child.stdout.end('true');
        child.emit('close', 0, null);
      });
      return child;
    },
  });
  const name = 'ryanai-genai-' + 'a'.repeat(32) + '-1';
  assert.equal(await runner.stopContainer(name), true);
  assert.deepEqual(invocations.map((args) => args[0]), ['inspect', 'kill', 'rm']);
  assert.equal(await runner.stopContainer('unsafe-name'), false);
});
