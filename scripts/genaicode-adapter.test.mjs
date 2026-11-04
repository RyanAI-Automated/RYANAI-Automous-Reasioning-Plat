import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { runGenAICodeTask, genaicodeAdapterPolicy } from '../src/engineering/genaicodeAdapter.mjs';

const HASH = 'a'.repeat(64);
const COMMIT_SHA = 'b'.repeat(40);
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

const task = (root, work, overrides = {}) => ({
  taskId: 'job-123', approvalId: 'approval-456', planHash: HASH, baseCommitSha: COMMIT_SHA,
  proposedDiffHash: HASH, agent: 'codex', prompt: 'Inspect this change',
  workspaceRoot: root, workspacePath: work, ...overrides,
});
const approved = async (binding) => ({
  approved: true, ...binding, approverId: 'admin-2', authorId: 'admin-1',
});
const capabilities = {
  filesystemIsolation: true, workspaceMountOnly: true, resourceLimits: true,
  networkPolicy: 'deny-by-default', credentialScope: 'agent-only',
};
function fakeRunner({ code = 0, output = '{"type":"message","text":"safe result"}\n', onLaunch } = {}) {
  return {
    capabilities,
    run: async (launch) => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => true;
      onLaunch?.({ ...launch, child });
      queueMicrotask(() => {
        child.stdout.write(output);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', code, null);
      });
      return child;
    },
  };
}

describe('RyanAI GenAIcode adapter authorization and isolation', () => {
  it('fails closed without the trusted workbench authorization service', async () => {
    const { root, work } = await workspace();
    await assert.rejects(runGenAICodeTask(task(root, work), { sandboxRunner: fakeRunner() }), /authorization service/);
  });

  it('rejects caller-supplied approval booleans and does not launch an agent', async () => {
    const { root, work } = await workspace();
    let launched = false;
    await assert.rejects(runGenAICodeTask(task(root, work, { approved: true }), {
      authorizeTask: async () => null,
      sandboxRunner: fakeRunner({ onLaunch: () => { launched = true; } }),
    }), /valid independent workbench approval/);
    assert.equal(launched, false);
  });

  it('requires independent approval bound to exact task, plan, base and diff digests', async () => {
    const { root, work } = await workspace();
    const binding = { taskId: 'job-123', approvalId: 'approval-456', planHash: HASH, baseCommitSha: COMMIT_SHA, proposedDiffHash: HASH };
    await assert.rejects(runGenAICodeTask(task(root, work), {
      authorizeTask: async () => approved({ ...binding, proposedDiffHash: 'b'.repeat(64) }),
      sandboxRunner: fakeRunner(),
    }), /valid independent workbench approval/);
    await assert.rejects(runGenAICodeTask(task(root, work), {
      authorizeTask: async () => ({ ...await approved(binding), approverId: 'admin-1' }),
      sandboxRunner: fakeRunner(),
    }), /valid independent workbench approval/);
  });

  it('rejects a runner without filesystem, network and resource isolation', async () => {
    const { root, work } = await workspace();
    await assert.rejects(runGenAICodeTask(task(root, work), {
      authorizeTask: async (binding) => approved(binding),
      sandboxRunner: { capabilities: { ...capabilities, networkPolicy: 'allow-all' }, run() {} },
    }), /networkPolicy/);
  });

  it('rejects workspace escapes and symlink escapes', async () => {
    const { root } = await workspace();
    const outside = await mkdtemp(path.join(os.tmpdir(), 'ryanai-outside-'));
    temporary.push(outside);
    await assert.rejects(runGenAICodeTask(task(root, outside), {
      authorizeTask: async (binding) => approved(binding), sandboxRunner: fakeRunner(),
    }), /inside the approved workspace root/);
    const link = path.join(root, 'escape');
    await symlink(outside, link, 'dir');
    await assert.rejects(runGenAICodeTask(task(root, link), {
      authorizeTask: async (binding) => approved(binding), sandboxRunner: fakeRunner(),
    }), /inside the approved workspace root/);
  });

  it('runs through the isolated runner, passes only safe env and never claims verification', async () => {
    const { root, work } = await workspace();
    let launch;
    const binding = { taskId: 'job-123', approvalId: 'approval-456', planHash: HASH, baseCommitSha: COMMIT_SHA, proposedDiffHash: HASH };
    const result = await runGenAICodeTask(task(root, work), {
      authorizeTask: async (received) => {
        assert.deepEqual(received, binding);
        return approved(binding);
      },
      sandboxRunner: fakeRunner({ onLaunch: (value) => { launch = value; } }),
    });
    assert.equal(launch.command, 'genaicode');
    assert.deepEqual(launch.args.slice(0, 5), ['run', '--json', '-a', 'codex', '-C']);
    assert.equal(launch.args.at(-1), '-');
    assert.equal(launch.cwd, work);
    assert.equal(launch.env.PATH, process.env.PATH);
    assert.equal('HOME' in launch.env, false);
    assert.equal('OPENAI_API_KEY' in launch.env, false);
    assert.equal('NVIDIA_API_KEY' in launch.env, false);
    assert.equal(result.status, 'completed');
    assert.equal(result.verification, 'not-run');
    assert.equal(result.taskId, 'job-123');
    assert.equal(result.approvalId, 'approval-456');
    assert.deepEqual(result.events, [{ type: 'message', text: 'safe result' }]);
  });

  it('reports failed exit codes and enforces prompt and timeout bounds', async () => {
    const { root, work } = await workspace();
    const dependencies = {
      authorizeTask: async (binding) => approved(binding),
      sandboxRunner: fakeRunner({ code: 1 }),
    };
    const result = await runGenAICodeTask(task(root, work), dependencies);
    assert.equal(result.status, 'failed');
    assert.equal(result.verification, 'not-run');
    await assert.rejects(runGenAICodeTask(task(root, work, { prompt: 'x'.repeat(32_001) }), dependencies), /32000 characters/);
    await assert.rejects(runGenAICodeTask(task(root, work, { timeoutMs: 1 }), dependencies), /between 1000 and 1800000/);
  });

  it('keeps the fail-closed policy explicit', () => {
    assert.equal(genaicodeAdapterPolicy.directHostExecution, false);
    assert.equal(genaicodeAdapterPolicy.independentWorkbenchApprovalRequired, true);
    assert.equal(genaicodeAdapterPolicy.filesystemIsolationRequired, true);
    assert.equal(genaicodeAdapterPolicy.networkPolicy, 'deny-by-default');
    assert.equal(genaicodeAdapterPolicy.verificationRequiredOutsideAdapter, true);
  });
});
