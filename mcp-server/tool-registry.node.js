import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveToolRegistry } from './tool-registry.js';

const tools = [
  { name: 'tool_registry' },
  { name: 'repository_status' },
  { name: 'run_project_checks' },
  { name: 'platform_health' },
];

test('only explicitly allowlisted action tools are exposed', () => {
  const result = resolveToolRegistry(tools, {
    RYANAI_MCP_ENABLED_TOOLS: 'repository_status, platform_health',
  });
  assert.deepEqual(result.tools.map((tool) => tool.name), [
    'tool_registry',
    'repository_status',
    'platform_health',
  ]);
  assert.equal(result.registry.find((entry) => entry.name === 'run_project_checks').enabled, false);
});

test('the read-only registry remains available when no action tools are enabled', () => {
  const result = resolveToolRegistry(tools, {});
  assert.deepEqual(result.tools.map((tool) => tool.name), ['tool_registry']);
  assert.equal(result.registry.every((entry) => entry.name === 'tool_registry' || !entry.enabled), true);
});

test('unknown tool names fail closed instead of silently enabling nothing', () => {
  assert.throws(
    () => resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'repo_status' }),
    /Unknown or non-configurable MCP tool name/,
  );
});

test('the registry tool cannot be configured as an action tool', () => {
  assert.throws(
    () => resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'tool_registry' }),
    /Unknown or non-configurable MCP tool name/,
  );
});

test('registry metadata describes tool risk and explicit enablement', () => {
  const result = resolveToolRegistry(tools, { RYANAI_MCP_ENABLED_TOOLS: 'run_project_checks' });
  const checks = result.registry.find((entry) => entry.name === 'run_project_checks');
  assert.equal(checks.risk, 'code-execution');
  assert.equal(checks.enablement, 'explicit-operator-allowlist');
  assert.equal(checks.enabled, true);
});

test('configured tools missing from this runtime fail closed', () => {
  assert.throws(
    () => resolveToolRegistry([{ name: 'tool_registry' }], {
      RYANAI_MCP_ENABLED_TOOLS: 'repository_status',
    }),
    /Configured MCP tool.*not available in this runtime/,
  );
});
