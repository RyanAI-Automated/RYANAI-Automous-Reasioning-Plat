import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SystemStatus } from '@/lib/types';
import TelemetryPanel from './TelemetryPanel';

const status: SystemStatus = {
  cpu: null,
  memory: null,
  latency: null,
  tokensIn: 0,
  tokensOut: 0,
  uptime: '00:00:00',
  model: 'test-model',
  state: 'idle',
};

describe('telemetry metrics', () => {
  it('renders unreported metrics without throwing or implying zero usage', () => {
    const html = renderToStaticMarkup(
      <TelemetryPanel status={status} steps={[]} sending={false} />,
    );
    expect(html.match(/Not reported/g)).toHaveLength(2);
    expect(html).toContain('—');
    expect(html).not.toContain('NaN');
  });

  it('distinguishes reported zero metrics from missing telemetry', () => {
    const html = renderToStaticMarkup(
      <TelemetryPanel
        status={{ ...status, cpu: 0, memory: 0, latency: 0 }}
        steps={[]}
        sending={false}
      />,
    );
    expect(html).not.toContain('Not reported');
    expect(html.match(/0\.0%/g)).toHaveLength(2);
    expect(html).toContain('0ms');
  });
});
