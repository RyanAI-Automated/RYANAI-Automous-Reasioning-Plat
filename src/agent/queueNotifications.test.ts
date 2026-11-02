import { describe, expect, it, vi } from 'vitest';
import { publishAgentTaskNotification } from './queueNotifications.js';

describe('durable agent queue notification', () => {
  it('publishes a wake-up for the already-persisted run ID', async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    await expect(publishAgentTaskNotification('run-123', notify)).resolves.toBe(true);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith('run-123');
  });

  it('does not turn a committed queued task into an API enqueue failure when NOTIFY is unavailable', async () => {
    const notify = vi.fn().mockRejectedValue(new Error('listener notification unavailable'));
    await expect(publishAgentTaskNotification('run-456', notify)).resolves.toBe(false);
    expect(notify).toHaveBeenCalledWith('run-456');
  });
});
