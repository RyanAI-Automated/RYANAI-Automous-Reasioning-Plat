import { createClient } from '@supabase/supabase-js';
import net from 'node:net';

type ScanJob = { bucket_id: string; object_name: string; attempt: number };
type ScanResult = 'clean' | 'infected';

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required when attachment scanning is enabled.');
  return value;
}

async function scanWithClamAv(bytes: Uint8Array): Promise<ScanResult> {
  const host = required('CLAMAV_HOST');
  const port = Number(process.env.CLAMAV_PORT || 3310);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CLAMAV_PORT is invalid.');
  const timeoutMs = Math.max(1000, Number(process.env.CLAMAV_TIMEOUT_MS || 60000));

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const response: Buffer[] = [];
    let settled = false;
    const finish = (error?: Error, result?: ScanResult) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    socket.setTimeout(timeoutMs, () => finish(new Error('ClamAV scan timed out.')));
    socket.on('error', (error) => finish(error));
    socket.on('data', (chunk: Buffer) => {
      response.push(chunk);
      const text = Buffer.concat(response).toString('utf8');
      if (text.endsWith('OK\0') || text.endsWith('OK\n')) finish(undefined, 'clean');
      else if (text.includes('FOUND')) finish(undefined, 'infected');
      else if (text.includes('ERROR')) finish(new Error('ClamAV returned an error.'));
    });
    socket.on('connect', () => {
      socket.write(Buffer.from('zINSTREAM\0'));
      const chunkSize = 64 * 1024;
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        const chunk = Buffer.from(bytes.slice(offset, Math.min(offset + chunkSize, bytes.byteLength)));
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length, 0);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
  });
}

export function startAttachmentScanner(): () => void {
  const supabase = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  let stopped = false;
  let active = false;
  const intervalMs = Math.max(1000, Number(process.env.ATTACHMENT_SCAN_INTERVAL_MS || 5000));

  const processOne = async () => {
    if (stopped || active) return;
    active = true;
    try {
      const { data, error } = await supabase.rpc('claim_ryanai_attachment_scan');
      if (error) throw error;
      const job = (data as ScanJob[] | null)?.[0];
      if (!job) return;

      try {
        const { data: file, error: downloadError } = await supabase.storage
          .from(job.bucket_id).download(job.object_name);
        if (downloadError || !file) throw downloadError || new Error('Storage returned no attachment data.');
        const result = await scanWithClamAv(new Uint8Array(await file.arrayBuffer()));
        const { error: finishError } = await supabase.rpc('finish_ryanai_attachment_scan', {
          p_bucket_id: job.bucket_id,
          p_object_name: job.object_name,
          p_status: result,
          p_error: null,
        });
        if (finishError) throw finishError;
        console.info('[attachment-scanner] scan finished', { outcome: result, attempt: job.attempt });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown scanner failure';
        const { error: finishError } = await supabase.rpc('finish_ryanai_attachment_scan', {
          p_bucket_id: job.bucket_id,
          p_object_name: job.object_name,
          p_status: 'failed',
          p_error: message,
        });
        if (finishError) console.error('[attachment-scanner] unable to persist failure state', finishError.message);
        console.error('[attachment-scanner] scan failed', { attempt: job.attempt, message });
      }
    } catch (error) {
      console.error('[attachment-scanner] queue polling failed', error instanceof Error ? error.message : error);
    } finally {
      active = false;
    }
  };

  void processOne();
  const timer = setInterval(() => void processOne(), intervalMs);
  console.info('[attachment-scanner] enabled; polling durable scan queue');
  return () => { stopped = true; clearInterval(timer); };
}
