// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import packageMetadata from '../../package.json';
import AboutModal from './AboutModel';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('About RyanAI release metadata', () => {
  it('uses the package release version instead of a hardcoded marketing version', async () => {
    await act(async () => root.render(<AboutModal open onClose={vi.fn()} />));
    expect(container.textContent).toContain(`Version: ${packageMetadata.version}`);
    expect(container.textContent).not.toContain('Version: 1.0.0');
  });

  it('does not claim runtime health or a generated build date without evidence', async () => {
    await act(async () => root.render(<AboutModal open onClose={vi.fn()} />));
    expect(container.textContent).toContain('Not supplied by the build pipeline');
    expect(container.textContent).toContain('Runtime health not verified');
    expect(container.textContent).not.toContain('Status: Operational');
    expect(container.textContent).toContain('does not probe the API');
  });

  it('renders no About content while the modal is closed', async () => {
    await act(async () => root.render(<AboutModal open={false} onClose={vi.fn()} />));
    expect(container.textContent).not.toContain('RyanAI Autonomous Reasoning Platform');
  });
});
