import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export class EbpfSentinelService {
  private mapPath = '/sys/fs/bpf/blocked_pids';

  /**
   * Mark a PID in the pinned eBPF map, falling back to process.kill with SIGKILL.
   * Map-update and fallback-kill errors are caught; resolution does not confirm termination.
   */
  async terminatePidInKernel(pid: number): Promise<void> {
    try {
      // Pin/Update PID key in pinned BPF map via bpftool
      const command = `bpftool map update pinned ${this.mapPath} key hex ${this.pidToHex(pid)} value hex 01`;
      await execAsync(command);
      
      console.warn(`[TRANSCEND_eBPF] Marked PID ${pid} in eBPF map for SIGKILL.`);
    } catch (error) {
      console.error(`[TRANSCEND_eBPF_ERR] Failed to insert PID ${pid} into eBPF map:`, error);
      
      // Fallback user-space kill signal if eBPF map update fails
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process may already be dead
      }
    }
  }

  /**
   * Helper to format 32-bit Little Endian PID into hex byte sequence
   */
  private pidToHex(pid: number): string {
    const buf = Buffer.alloc(4);
    buf.writeUInt32LE(pid, 0);
    return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join(' ');
  }
}