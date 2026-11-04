import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runGenAICodeTask, genaicodeAdapterPolicy } from '../src/engineering/genaicodeAdapter.mjs';

const temporary = [];
async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ryanai-genaicode-'));
  temporary.push(root);
  const work = path.join(root, 'work');
  await mkdir(work);
  return { root, work };
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((item) => rm(item, { recursive: true, force: true })));
});

function fakeSpawn({ code = 0, output = '{"type":"message","text":"safe result"}\n', onLaunch } = {}) {
  return (binary, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => true;
    onLaunch?.({ binary, args, options, child });
    queueMicrotask(() => {
      child.stdout.write(output);
      child.stdout.end();
      child.stderr.end();
      child.emit('close', code, null);
    });
    return child;
  };
}

describe('RyanAI GenAIcode engineering adapter', () => {
  it('requires explicit approval before starting an agent', async () => {
    const { root, work } = await workspace();
    let launched = false;
    await assert.rejects(runGenAICodeTask({
      agent: 'codex', prompt: 'Inspect this change', workspaceRoot: root, workspacePath: work, approved: false,
    }, { spawn: () => { launched = true; } }), /Explicit engineering-task approval/);
    assert.equal(launched, false);
  });

  it('rejects unsupported agents and workspace paths outside the approved root', async () => {
    const { root, work } = await workspace();
    await assert.rejects(runGenAICodeTask({
      agent: 'unknown', prompt: 'task', workspaceRoot: root, workspacePath: work, approved: true,
    }), /Unsupported coding agent/);
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ryanai-outside-'));
    temporary.push(outside);
    await assert.rejects(runGenAICodeTask({
      agent: 'codex', prompt: 'task', workspaceRoot: root, workspacePath: outside, approved: true,
    }), /inside the approved workspace root/);
  });

  it('rejects symlink escapes after resolving the real workspace path', async () => {
    const { root } = await workspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ryanai-outside-'));
    temporary.push(outside);
    const link = path.join(root, 'escape');
    await symlink(outside, link, 'dir');
    await assert.rejects(runGenAICodeTask({
      agent: 'codex', prompt: 'task', workspaceRoot: root, workspacePath: link, approved: true,
    }), /inside the approved workspace root/);
  });

  it('launches without a shell, sends the prompt on stdin and strips provider secrets', async () => {
    const { root, work } = await workspace();
    let launch;
    const result = await runGenAICodeTask({
      agent: 'codex',
      prompt: 'Do not print secrets',
      workspaceRoot: root,
      workspacePath: work,
      approved: true,
      env: { PATH: '/usr/bin', HOME: '/home/test', OPENAI_API_KEY: 'must-not-pass', NVIDIA_API_KEY: 'must-not-pass' },
    }, { spawn: fakeSpawn({ onLaunch: (value) => { launch = value; } }) });

    assert.equal(launch.binary, 'genaicode');
    assert.deepEqual(launch.args.slice(0, 5), ['run', '--json', '-a', 'codex', '-C']);
    assert.equal(launch.args.at(-1), '-');
    assert.equal(launch.options.shell, false);
    assert.equal(launch.options.cwd, work);
    assert.equal(launch.options.env.HOME, '/home/test');
    assert.equal('OPENAI_API_KEY' in launch.options.env, false);
    assert.equal('NVIDIA_API_KEY' in launch.options.env, false);
    assert.equal(result.status, 'completed');
    assert.equal(result.verification, 'not-run');
    assert.deepEqual(result.events, [{ type: 'message', text: 'safe result' }]);
  });

  it('reports a non-zero agent exit as failure and never claims verification', async () => {
    const { root, work } = await workspace();
    const result = await runGenAICodeTask({
      agent: 'claude', prompt: 'Inspect', workspaceRoot: root, workspacePath: work, approved: true,
    }, { spawn: fakeSpawn({ code: 1 }) });
    assert.equal(result.status, 'failed');
    assert.equal(result.verification, 'not-run');
  });

  it('enforces prompt, timeout and output bounds', async () => {
    const { root, work } = await workspace();
    await assert.rejects(runGenAICodeTask({
      agent: 'codex', prompt: 'x'.repeat(32_001), workspaceRoot: root, workspacePath: work, approved: true,
    }), /32000 characters/);
    await assert.rejects(runGenAICodeTask({
      agent: 'codex', prompt: 'task', workspaceRoot: root, workspacePath: work, approved: true, timeoutMs: 1,
    }), /between 1000 and 1800000/);
    await assert.rejects(runGenAICodeTask({
      agent: 'codex', prompt: 'task', workspaceRoot: root, workspacePath: work, approved: true,
    }, { spawn: fakeSpawn({ output: 'x'.repeat(2 * 1024 * 1024 + 1) }) }), /2 MiB safety limit/);
  });

  it('keeps the policy explicit and fail-closed', () => {
    assert.equal(genaicodeAdapterPolicy.autoApproval, false);
    assert.equal(genaicodeAdapterPolicy.shell, false);
    assert.equal(genaicodeAdapterPolicy.providerCredentialsInherited, false);
    assert.equal(genaicodeAdapterPolicy.verificationRequiredOutsideAdapter, true);
  });
});
