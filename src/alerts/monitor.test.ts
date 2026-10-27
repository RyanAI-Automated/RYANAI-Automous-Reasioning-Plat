import { describe, expect, it } from 'vitest';
import { describeEvent, initialState, step, type CheckResult, type CheckState } from './monitor.js';

const options = { failuresBeforeAlert: 2, reminderMs: 3_600_000 };
const fail: CheckResult = { status: 'fail', detail: 'HTTP 503' };
const ok: CheckResult = { status: 'ok' };
const skip: CheckResult = { status: 'skip', detail: 'GitHub did not answer' };

/** Feed a list of [result, time] pairs and return the events that came out. */
function play(steps: [CheckResult, number][]) {
  let state: CheckState = initialState;
  const events: (string | null)[] = [];
  for (const [result, at] of steps) {
    const next = step(state, result, at, options);
    state = next.state;
    events.push(next.event);
  }
  return { state, events };
}

describe('step', () => {
  it('stays quiet for one failure and alerts at the second in a row', () => {
    expect(play([[fail, 0], [fail, 1000]]).events).toEqual([null, 'down']);
  });

  it('forgets a single failure when the next check passes', () => {
    const { events, state } = play([[fail, 0], [ok, 1000], [fail, 2000]]);
    expect(events).toEqual([null, null, null]);
    expect(state.failures).toBe(1);
  });

  it('says nothing between the alert and the reminder', () => {
    const { events } = play([[fail, 0], [fail, 1], [fail, 2], [fail, 3_599_999]]);
    expect(events).toEqual([null, 'down', null, null]);
  });

  it('sends a reminder after the reminder time, then waits again', () => {
    const { events } = play([[fail, 0], [fail, 1], [fail, 3_600_001], [fail, 3_600_002], [fail, 7_200_002]]);
    expect(events).toEqual([null, 'down', 'reminder', null, 'reminder']);
  });

  it('reports recovery once, and only after an alert was sent', () => {
    expect(play([[fail, 0], [fail, 1], [ok, 2], [ok, 3]]).events).toEqual([null, 'down', 'recovered', null]);
    expect(play([[fail, 0], [ok, 1]]).events).toEqual([null, null]);
  });

  it('alerts again for a new failure after a recovery', () => {
    const { events } = play([[fail, 0], [fail, 1], [ok, 2], [fail, 3], [fail, 4]]);
    expect(events).toEqual([null, 'down', 'recovered', null, 'down']);
  });

  it('ignores a skipped check and keeps the state', () => {
    const { events, state } = play([[fail, 0], [skip, 1], [fail, 2]]);
    expect(events).toEqual([null, null, 'down']);
    expect(state.failures).toBe(2);
  });

  it('does not report recovery for a skip while an alert is open', () => {
    expect(play([[fail, 0], [fail, 1], [skip, 2]]).events).toEqual([null, 'down', null]);
  });
});

describe('describeEvent', () => {
  it('starts with a headline that names the check', () => {
    expect(describeEvent('Health check https://a.example/health', 'down', 'HTTP 503')).toBe(
      'DOWN: Health check https://a.example/health\nHTTP 503',
    );
    expect(describeEvent('X', 'reminder', 'HTTP 503').startsWith('STILL DOWN: X')).toBe(true);
    expect(describeEvent('X', 'recovered', '')).toBe('RECOVERED: X\nThe check passes again.');
  });
});
