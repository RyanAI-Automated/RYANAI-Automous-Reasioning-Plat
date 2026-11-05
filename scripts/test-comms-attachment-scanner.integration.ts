import assert from 'node:assert/strict';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { createClient } from '@supabase/supabase-js';
import { startAttachmentScanner } from '../src/server/attachments/scanner.js';
import {
  COMMS_ATTACHMENT_BUCKET,
  cleanCommsAttachmentUrls,
  downloadCleanCommsAttachments,
} from '../src/server/comms/attachments.js';

const INFECTED_FIXTURE_MARKER = 'RYANAI_SYNTHETIC_INFECTED_FIXTURE_ONLY';
const SCAN_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 200;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the local Comms scanner integration test.`);
  return value;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function startFakeClamAv(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    const chunks: Buffer[] = [];
    let replied = false;
    socket.on('data', (chunk) => {
      if (replied) return;
      chunks.push(Buffer.from(chunk));
      const request = Buffer.concat(chunks);
      const hasTerminator = request.length >= 4 && request.subarray(-4).every((byte) => byte === 0);
      if (!hasTerminator) return;
      replied = true;
      const infected = request.includes(Buffer.from(INFECTED_FIXTURE_MARKER));
      socket.end(infected ? 'stream: synthetic-test-signature FOUND\\0' : 'stream: OK\\0');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fake ClamAV did not bind a TCP port.');
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

async function waitForScanResults(
  supabase: ReturnType<typeof createClient>,
  objectNames: string[],
): Promise<Map<string, { status: string; attempts: number }>> {
  const deadline = Date.now() + SCAN_TIMEOUT_MS;
  let latest = new Map<string, { status: string; attempts: number }>();
  while (Date.now() < deadline) {
    const { data, error } = await supabase
      .from('ryanai_attachment_scans')
      .select('object_name,status,attempts')
      .eq('bucket_id', COMMS_ATTACHMENT_BUCKET)
      .in('object_name', objectNames);
    if (error) throw error;
    latest = new Map((data ?? []).map((row: any) => [
      row.object_name,
      { status: String(row.status), attempts: Number(row.attempts) },
    ]));
    if (objectNames.every((name) => ['clean', 'infected', 'failed'].includes(latest.get(name)?.status ?? ''))) {
      return latest;
    }
    await delay(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for scanner outcomes: ${JSON.stringify([...latest.entries()])}`);
}

async function main(): Promise<void> {
  const supabaseUrl = required('SUPABASE_URL');
  const serviceRoleKey = required('SUPABASE_SERVICE_ROLE_KEY');
  required('DATABASE_URL');

  process.env.COMMUNICATIONS_ENABLED = 'true';
  process.env.COMMUNICATION_ATTACHMENTS_ENABLED = 'true';
  process.env.ATTACHMENT_SCANNER_ENABLED = 'true';
  process.env.CLAMAV_HOST = '127.0.0.1';
  process.env.CLAMAV_TIMEOUT_MS = '10000';
  process.env.ATTACHMENT_SCAN_INTERVAL_MS = '1000';
  process.env.ATTACHMENT_QUARANTINE_PURGE_INTERVAL_MS = '86400000';

  const prisma = new PrismaClient();
  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const ownerUserId = randomUUID();
  const conversationId = randomUUID();
  const messageId = randomUUID();
  const cleanAttachmentId = randomUUID();
  const infectedAttachmentId = randomUUID();
  const cleanBytes = Buffer.from('Synthetic clean Comms attachment fixture.\\n', 'utf8');
  const infectedBytes = Buffer.from(`Synthetic file fixture: ${INFECTED_FIXTURE_MARKER}\\n`, 'utf8');
  const cleanObjectName = `${ownerUserId}/${conversationId}/${messageId}/${cleanAttachmentId}.txt`;
  const infectedObjectName = `${ownerUserId}/${conversationId}/${messageId}/${infectedAttachmentId}.txt`;
  const objectNames = [cleanObjectName, infectedObjectName];
  const attachmentIds = [cleanAttachmentId, infectedAttachmentId];
  let scannerStop: (() => void) | undefined;
  let clamAv: Awaited<ReturnType<typeof startFakeClamAv>> | undefined;

  try {
    await prisma.$connect();
    await prisma.communicationConversation.create({
      data: {
        id: conversationId,
        channel: 'email',
        externalAddress: `scanner-${conversationId}@example.test`,
        ownerUserId,
      },
    });
    await prisma.communicationMessage.create({
      data: {
        id: messageId,
        conversationId,
        direction: 'outbound',
        body: 'Local scanner integration fixture; no provider dispatch.',
        status: 'awaiting_attachments',
      },
    });

    await prisma.communicationAttachment.createMany({
      data: [
        {
          id: cleanAttachmentId,
          communicationMessageId: messageId,
          ownerUserId,
          bucketId: COMMS_ATTACHMENT_BUCKET,
          objectName: cleanObjectName,
          fileName: 'scanner-clean.txt',
          mimeType: 'text/plain',
          size: BigInt(cleanBytes.byteLength),
          source: 'integration_test',
        },
        {
          id: infectedAttachmentId,
          communicationMessageId: messageId,
          ownerUserId,
          bucketId: COMMS_ATTACHMENT_BUCKET,
          objectName: infectedObjectName,
          fileName: 'scanner-infected-fixture.txt',
          mimeType: 'text/plain',
          size: BigInt(infectedBytes.byteLength),
          source: 'integration_test',
        },
      ],
    });

    for (const [objectName, bytes] of [
      [cleanObjectName, cleanBytes],
      [infectedObjectName, infectedBytes],
    ] as const) {
      const { error } = await supabase.storage.from(COMMS_ATTACHMENT_BUCKET).upload(objectName, bytes, {
        contentType: 'text/plain',
        upsert: false,
      });
      if (error) throw error;
    }

    const beforeScan = await waitForScanResults(supabase, objectNames);
    for (const objectName of objectNames) {
      assert.equal(beforeScan.get(objectName)?.status, 'pending', 'storage upload must enqueue a pending scan');
    }
    await assert.rejects(
      () => cleanCommsAttachmentUrls(prisma, ownerUserId, [cleanAttachmentId]),
      /unavailable until every security scan is clean/,
      'pending attachments must not receive signed download URLs',
    );

    clamAv = await startFakeClamAv();
    process.env.CLAMAV_PORT = String(clamAv.port);
    scannerStop = startAttachmentScanner();

    const results = await waitForScanResults(supabase, objectNames);
    assert.equal(results.get(cleanObjectName)?.status, 'clean', 'clean fixture must complete the scanner worker');
    assert.equal(results.get(infectedObjectName)?.status, 'infected', 'synthetic detection must be quarantined');
    assert.ok((results.get(cleanObjectName)?.attempts ?? 0) >= 1, 'clean fixture must be claimed by the queue worker');
    assert.ok((results.get(infectedObjectName)?.attempts ?? 0) >= 1, 'infected fixture must be claimed by the queue worker');

    const urls = await cleanCommsAttachmentUrls(prisma, ownerUserId, [cleanAttachmentId], 60);
    assert.ok(urls.get(cleanAttachmentId)?.startsWith(`${supabaseUrl}/storage/v1/object/sign/`));

    const downloads = await downloadCleanCommsAttachments(prisma, ownerUserId, [cleanAttachmentId]);
    assert.equal(downloads.length, 1);
    assert.equal(downloads[0].contentType, 'text/plain');
    assert.equal(downloads[0].content.toString('utf8'), cleanBytes.toString('utf8'));

    await assert.rejects(
      () => cleanCommsAttachmentUrls(prisma, ownerUserId, [infectedAttachmentId]),
      /unavailable until every security scan is clean/,
      'infected attachments must not receive signed download URLs',
    );
    await assert.rejects(
      () => downloadCleanCommsAttachments(prisma, ownerUserId, [infectedAttachmentId]),
      /unavailable until every security scan is clean/,
      'infected attachments must not be downloaded',
    );

    process.stdout.write(JSON.stringify({
      result: 'passed',
      bucket: COMMS_ATTACHMENT_BUCKET,
      cleanScan: results.get(cleanObjectName),
      infectedScan: results.get(infectedObjectName),
      pendingDownloadBlocked: true,
      infectedDownloadBlocked: true,
      cleanDownloadVerified: true,
      providerTraffic: 'none',
    }) + '\\n');
  } finally {
    scannerStop?.();
    if (clamAv) await clamAv.close().catch(() => undefined);
    await supabase.storage.from(COMMS_ATTACHMENT_BUCKET).remove(objectNames).catch(() => undefined);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM public.ryanai_attachment_scans WHERE bucket_id = ${COMMS_ATTACHMENT_BUCKET} AND object_name IN (${Prisma.join(objectNames)})`).catch(() => undefined);
    await prisma.$executeRaw(Prisma.sql`DELETE FROM public.communication_attachment_audit WHERE communication_attachment_id IN (${Prisma.join(attachmentIds)})`).catch(() => undefined);
    await prisma.communicationAttachment.deleteMany({ where: { id: { in: attachmentIds } } }).catch(() => undefined);
    await prisma.communicationMessage.deleteMany({ where: { id: messageId } }).catch(() => undefined);
    await prisma.communicationConversation.deleteMany({ where: { id: conversationId } }).catch(() => undefined);
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('[comms-attachment-scanner-integration] failed', error);
  process.exitCode = 1;
});
