import { createHash, randomUUID } from 'node:crypto';
import { chmod, mkdir, rm, writeFile, createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveSupabaseSessionPoolerUrl } from '../src/server/supabasePooler.ts';

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('Required production migration setting ' + name + ' is missing.');
  return value;
}

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: 'ignore', shell: false });
    child.once('error', () => reject(new Error(command + ' could not start; command output was suppressed.')));
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(command + ' failed with exit code ' + (code ?? 'unknown') + '; command output was suppressed.'));
    });
  });
}

function sha256(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolvePromise(hash.digest('hex')));
  });
}

export async function createEncryptedProductionBackup() {
  const databaseUrl = requireValue('DATABASE_URL');
  const supabaseUrl = 'https://narsvpwymvlrhurqbthu.supabase.co';
  const poolerHost = requireValue('SUPABASE_SESSION_POOLER_HOST');
  const rootCertPath = requireValue('SUPABASE_SSL_ROOT_CERT_PATH');
  const recipient = requireValue('BACKUP_AGE_RECIPIENT');
  const identity = requireValue('BACKUP_AGE_IDENTITY');
  const outputPath = resolve(requireValue('BACKUP_OUTPUT_PATH'));

  if (!/^age1[0-9a-z]+$/.test(recipient)) {
    throw new Error('BACKUP_AGE_RECIPIENT must be an age public recipient.');
  }

  const resolution = resolveSupabaseSessionPoolerUrl(
    databaseUrl, supabaseUrl, poolerHost, rootCertPath,
  );
  if (!resolution.databaseUrl || !['rewritten', 'already-pooled'].includes(resolution.reason)) {
    throw new Error('Production backup connection validation failed (' + resolution.reason + ').');
  }

  const url = new URL(resolution.databaseUrl);
  if (url.hostname !== poolerHost.toLowerCase()
      || url.port !== '5432'
      || decodeURIComponent(url.username) !== 'postgres.narsvpwymvlrhurqbthu'
      || url.pathname !== '/postgres'
      || url.searchParams.get('sslmode') !== 'verify-full'
      || url.searchParams.get('sslrootcert') !== rootCertPath
      || url.searchParams.get('sslaccept') !== 'strict') {
    throw new Error('Production backup connection is not pinned to the verified project Session Pooler.');
  }

  const password = decodeURIComponent(url.password);
  if (!password || /[\r\n]/.test(password) || /[\r\n]/.test(identity)) {
    throw new Error('Production backup credentials contain invalid characters.');
  }

  const pgEnv = {
    ...process.env,
    PGHOST: url.hostname,
    PGPORT: '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: password,
    PGDATABASE: 'postgres',
    PGSSLMODE: 'verify-full',
    PGSSLROOTCERT: rootCertPath,
  };

  const workDir = join(tmpdir(), 'ryanai-prod-backup-' + randomUUID());
  const dumpPath = join(workDir, 'ryanai-production.dump');
  const identityPath = join(workDir, 'backup.agekey');
  const verifyPath = join(workDir, 'round-trip.dump');

  try {
    await mkdir(workDir, { recursive: true, mode: 0o700 });
    await chmod(workDir, 0o700);
    await mkdir(resolve(outputPath, '..'), { recursive: true, mode: 0o700 });
    await writeFile(identityPath, identity.endsWith('\n') ? identity : identity + '\n', { mode: 0o600 });
    await chmod(identityPath, 0o600);

    await run('pg_dump', ['--no-password', '--format=custom', '--file', dumpPath], pgEnv);
    await run('pg_restore', ['--list', dumpPath]);
    await run('age', ['--encrypt', '--recipient', recipient, '--output', outputPath, dumpPath]);
    await run('age', ['--decrypt', '--identity', identityPath, '--output', verifyPath, outputPath]);
    await run('pg_restore', ['--list', verifyPath]);

    const originalHash = await sha256(dumpPath);
    const restoredHash = await sha256(verifyPath);
    if (originalHash !== restoredHash) {
      throw new Error('Encrypted backup round-trip verification failed.');
    }

    return {
      backup: 'created',
      archive: 'pg_dump custom format',
      encryption: 'age encrypted and round-trip verified',
      sha256: await sha256(outputPath),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createEncryptedProductionBackup()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error('BLOCKED: ' + (error instanceof Error ? error.message : 'backup failed'));
      process.exitCode = 1;
    });
}
