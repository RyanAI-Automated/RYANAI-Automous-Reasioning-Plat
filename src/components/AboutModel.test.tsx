// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import packageMetadata from '../../package.json';
import AboutModal from './AboutModel';

const { usePlatformHealthMock } = vi.hoisted(() => ({
  usePlatformHealthMock: vi.fn(),
}));

vi.mock('@/hooks/usePlatformHealth', () => ({
  usePlatformHealth: usePlatformHealthMock,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  usePlatformHealthMock.mockReturnValue({
    health: null,
    error: null,
    checking: true,
    refresh: vi.fn(),
  });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('About RyanAI release metadata and live diagnostics', () => {
  it('uses the package release version instead of a hardcoded marketing version', async () => {
    await act(async () => root.render(<AboutModal open onClose={vi.fn()} />));
    expect(container.textContent).toContain(`Version: ${packageMetadata.version}`);
    expect(container.textContent).not.toContain('Version: 1.0.0');
  });

  it('shows checking and unverified external integrations before a probe returns', async () => {
    await act(async () => root.render(<AboutModal open onClose={vi.fn()} />));
    expect(container.textContent).toContain('Overall: Checking');
    expect(container.textContent).toContain('Model providers');
    expect(container.textContent).toContain('GitHub authorization');
    expect(container.textContent).toContain('Not probed');
  });

  it('renders real dependency states only from a fresh readiness snapshot', async () => {
    usePlatformHealthMock.mockReturnValue({
      health: {
        status: 'degraded',
        timestamp: new Date().toISOString(),
        services: { api: true, database: false, redis: true, agentCheckpointer: false },
      },
      error: null,
      checking: false,
      refresh: vi.fn(),
    });
    await act(async () => root.render(<AboutModal open onClose={vi.fn()} />));
    expect(container.textContent).toContain('Overall: Degraded');
    expect(container.textContent).toContain('API process');
    expect(container.textContent).toContain('PostgreSQL');
    expect(container.textContent).toContain('Unavailable');
    expect(container.textContent).toContain('Ready');
    expect(container.textContent).toContain('Not probed');
  });

  it('does not display stale readiness as current healthy status', async () => {
    usePlatformHealthMock.mockReturnValue({
      health: {
        status: 'online',
        timestamp: '2020-01-01T00:00:00.000Z',
        services: { api: true, database: true, redis: true, agentCheckpointer: true },
      },
      error: null,
      checking: false,
      refresh: vi.fn(),
    });
    await act(async () => root.render(<AboutModal open onClose={vi.fn()} />));
    expect(container.textContent).toContain('Overall: Stale');
    expect(container.textContent).not.toContain('PostgreSQLReady');
  });

  it('does not claim runtime health when the API cannot be reached', async () => {
    usePlatformHealthMock.mockReturnValue({
      health: null,
      error: 'network failure',
      checking: false,
      refresh: vi.fn(),
    });
    await act(async () => root.render(<AboutModal open onClose={vi.fn()} />));
    expect(container.textContent).toContain('Overall: Unreachable');
    expect(container.textContent).toContain('Live readiness could not be retrieved');
  });

  it('renders no About content while the modal is closed', async () => {
    await act(async () => root.render(<AboutModal open={false} onClose={vi.fn()} />));
    expect(container.textContent).not.toContain('RyanAI Autonomous Reasoning Platform');
  });
});
