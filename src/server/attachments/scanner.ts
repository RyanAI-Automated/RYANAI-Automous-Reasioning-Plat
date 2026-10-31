import { createClient } from '@supabase/supabase-js';
import net from 'node:net';

type ScanJob = { bucket_id: string; object_name: string; attempt: number };
type ScanResult = 'clean' | 'infected';

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const MAX_CLAMAV_RESPONSE_BYTES = 4096;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(name + ' is required when attachment scanning is enabled.');
  return value;
}

function boundedInteger(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(name + ` must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export async function scanWithClamAv(bytes: Uint8Array): Promise<ScanResult> {
  const host = required('CLAMAV_HOST');
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error('Attachment size is outside the scanner limit.');
  }
  const port = boundedInteger('CLAMAV_PORT', 3310, 1, 65535);
  const timeoutMs = boundedInteger('CLAMAV_TIMEOUT_MS', 60000, 1000, 300000);

  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const response: Buffer[] = [];
    let responseBytes = 0;
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
      responseBytes += chunk.length;
      if (responseBytes > MAX_CLAMAV_RESPONSE_BYTES) {
        finish(new Error('ClamAV response exceeded the allowed size.'));
        return;
      }
      response.push(chunk);
      const text = Buffer.concat(response, responseBytes).toString('utf8');
      const complete = text.endsWith('\\0') || text.endsWith('\\n');
      if (!complete) return;
      if (/\\bFOUND(?:\\0|\\n)$/.test(text)) finish(undefined, 'infected');
      else if (/\\bOK(?:\\0|\\n)$/.test(text)) finish(undefined, 'clean');
      else finish(new Error('ClamAV returned an unrecognized response.'));
    });
    socket.on('connect', () => {
      socket.write(Buffer.from('zINSTREAM\\0'));
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
  const intervalMs = boundedInteger('ATTACHMENT_SCAN_INTERVAL_MS', 5000, 1000, 300000);

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
        if (file.size === 0 || file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error('Attachment size is outside the scanner limit.');
        }
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
