import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveSupabaseSessionPoolerUrl } from '../src/server/supabasePooler.ts';

const SUPABASE_PROJECT_REF = 'narsvpwymvlrhurqbthu';

function requireValue(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error('Required production backup setting ' + name + ' is missing.');
  }
  return value;
}

function run(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { env, stdio: 'ignore', shell: false });
    child.once('error', () => {
      reject(new Error(command + ' could not start; command output was suppressed.'));
    });
    child.once('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(command + ' failed with exit code ' + (code ?? 'unknown') + '; command output was suppressed.'));
    });
  });
}

function runJson(command, args, env = process.env) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.once('error', () => {
      reject(new Error(command + ' could not start; command output was suppressed.'));
    });
    child.once('close', (code) => {
      if (code !== 0) {
        reject(new Error(command + ' failed with exit code ' + (code ?? 'unknown') + '; command output was suppressed.'));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch {
        reject(new Error(command + ' returned an invalid response; command output was suppressed.'));
      }
    });
  });
}

function sha256(path, encoding = 'hex') {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(path);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', () => resolvePromise(hash.digest(encoding)));
  });
}

function requirePrivateBucketConfiguration(publicAccess, encryption, versioning) {
  const block = publicAccess.PublicAccessBlockConfiguration ?? {};
  const publicAccessBlocked = [
    block.BlockPublicAcls,
    block.IgnorePublicAcls,
    block.BlockPublicPolicy,
    block.RestrictPublicBuckets,
  ].every((value) => value === true);

  if (!publicAccessBlocked) {
    throw new Error('Backup bucket must block all public ACLs and public policies.');
  }

  const rules = encryption.ServerSideEncryptionConfiguration?.Rules ?? [];
  const algorithms = rules
    .map((rule) => rule.ApplyServerSideEncryptionByDefault?.SSEAlgorithm)
    .filter(Boolean);
  const serverEncryption = algorithms.find((value) =>
    ['AES256', 'aws:kms', 'aws:kms:dsse'].includes(value),
  );

  if (!serverEncryption) {
    throw new Error('Backup bucket must have default AES256 or AWS KMS server-side encryption.');
  }

  if (versioning.Status !== 'Enabled') {
    throw new Error('Backup bucket versioning must be enabled before production migration.');
  }

  return serverEncryption;
}

async function verifyPrivateBackupBucket(bucket, region) {
  const common = ['--bucket', bucket, '--region', region, '--output', 'json', '--no-cli-pager'];
  const [publicAccess, encryption, versioning] = await Promise.all([
    runJson('aws', ['s3api', 'get-public-access-block', ...common]),
    runJson('aws', ['s3api', 'get-bucket-encryption', ...common]),
    runJson('aws', ['s3api', 'get-bucket-versioning', ...common]),
  ]);

  return requirePrivateBucketConfiguration(publicAccess, encryption, versioning);
}

export async function createEncryptedProductionBackup() {
  const databaseUrl = requireValue('DATABASE_URL');
  const supabaseUrl = 'https://' + SUPABASE_PROJECT_REF + '.supabase.co';
  const poolerHost = requireValue('SUPABASE_SESSION_POOLER_HOST');
  const rootCertPath = requireValue('SUPABASE_SSL_ROOT_CERT_PATH');
  const recipient = requireValue('BACKUP_AGE_RECIPIENT');
  const identity = requireValue('BACKUP_AGE_IDENTITY');
  const bucket = requireValue('BACKUP_S3_BUCKET');
  const region = requireValue('BACKUP_S3_REGION');
  const accessKey = requireValue('AWS_ACCESS_KEY_ID');
  const secretKey = requireValue('AWS_SECRET_ACCESS_KEY');

  if (!/^age1[0-9a-z]+$/.test(recipient)) {
    throw new Error('BACKUP_AGE_RECIPIENT must be an age public recipient.');
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('BACKUP_S3_BUCKET must be a valid S3 bucket name.');
  }
  if (!/^[a-z0-9-]+$/.test(region)) {
    throw new Error('BACKUP_S3_REGION must be a valid AWS region identifier.');
  }
  if (/[\r\n]/.test(identity)) {
    throw new Error('BACKUP_AGE_IDENTITY contains invalid line breaks.');
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
      || decodeURIComponent(url.username) !== 'postgres.' + SUPABASE_PROJECT_REF
      || url.pathname !== '/postgres'
      || url.searchParams.get('sslmode') !== 'verify-full'
      || url.searchParams.get('sslrootcert') !== rootCertPath
      || url.searchParams.get('sslaccept') !== 'strict') {
    throw new Error('Production backup connection is not pinned to the verified project Session Pooler.');
  }

  const password = decodeURIComponent(url.password);
  if (!password || /[\r\n]/.test(password)) {
    throw new Error('Production backup connection credentials are invalid.');
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

  // Use only explicit environment credentials; do not fall back to local profiles or metadata.
  const awsEnv = {
    ...process.env,
    AWS_ACCESS_KEY_ID: accessKey,
    AWS_SECRET_ACCESS_KEY: secretKey,
    AWS_DEFAULT_REGION: region,
    AWS_EC2_METADATA_DISABLED: 'true',
    AWS_SHARED_CREDENTIALS_FILE: '/dev/null',
    AWS_CONFIG_FILE: '/dev/null',
  };

  const workDir = await mkdtemp(join(tmpdir(), 'ryanai-prod-backup-'));
  const dumpPath = join(workDir, 'ryanai-production.dump');
  const encryptedPath = join(workDir, 'ryanai-production.dump.age');
  const identityPath = join(workDir, 'backup.agekey');
  const verifyPath = join(workDir, 'round-trip.dump');
  const downloadedPath = join(workDir, 'downloaded.dump.age');
  const downloadedVerifyPath = join(workDir, 'downloaded-round-trip.dump');

  try {
    await chmod(workDir, 0o700);
    await writeFile(identityPath, identity.trim() + '\n', { mode: 0o600 });
    await chmod(identityPath, 0o600);

    await run('pg_dump', ['--no-password', '--format=custom', '--file', dumpPath], pgEnv);
    await run('pg_restore', ['--list', dumpPath]);
    await run('age', ['--encrypt', '--recipient', recipient, '--output', encryptedPath, dumpPath]);
    await run('age', ['--decrypt', '--identity', identityPath, '--output', verifyPath, encryptedPath]);
    await run('pg_restore', ['--list', verifyPath]);

    const sourceHash = await sha256(dumpPath);
    if (sourceHash !== await sha256(verifyPath)) {
      throw new Error('Local encrypted backup round-trip verification failed.');
    }

    const serverEncryption = await verifyPrivateBackupBucket(bucket, region);
    const objectKey = 'ryanai/production/' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.dump.age';
    const encryptedHash = await sha256(encryptedPath);
    const encryptedChecksum = await sha256(encryptedPath, 'base64');
    const encryptedSize = (await stat(encryptedPath)).size;

    const put = await runJson('aws', [
      's3api', 'put-object',
      '--bucket', bucket,
      '--key', objectKey,
      '--body', encryptedPath,
      '--checksum-algorithm', 'SHA256',
      '--checksum-sha256', encryptedChecksum,
      '--region', region,
      '--output', 'json',
      '--no-cli-pager',
    ], awsEnv);

    if (!put.VersionId || put.VersionId === 'null') {
      throw new Error('Backup object was uploaded without a version ID; refusing to claim verified storage.');
    }

    const head = await runJson('aws', [
      's3api', 'head-object',
      '--bucket', bucket,
      '--key', objectKey,
      '--version-id', put.VersionId,
      '--checksum-mode', 'ENABLED',
      '--region', region,
      '--output', 'json',
      '--no-cli-pager',
    ], awsEnv);

    if (head.ChecksumSHA256 !== encryptedChecksum
        || head.ServerSideEncryption !== serverEncryption
        || Number(head.ContentLength) !== encryptedSize) {
      throw new Error('Stored backup metadata does not match the encrypted source or bucket security configuration.');
    }

    await run('aws', [
      's3api', 'get-object',
      '--bucket', bucket,
      '--key', objectKey,
      '--version-id', put.VersionId,
      '--checksum-mode', 'ENABLED',
      '--region', region,
      '--output', 'json',
      '--no-cli-pager',
      downloadedPath,
    ], awsEnv);

    if (encryptedHash !== await sha256(downloadedPath)) {
      throw new Error('Downloaded private backup does not match the uploaded encrypted archive.');
    }

    await run('age', ['--decrypt', '--identity', identityPath, '--output', downloadedVerifyPath, downloadedPath]);
    await run('pg_restore', ['--list', downloadedVerifyPath]);
    if (sourceHash !== await sha256(downloadedVerifyPath)) {
      throw new Error('Downloaded encrypted backup failed decryption or archive verification.');
    }

    return {
      backup: 'created and remote object verified',
      storage: 'private S3 bucket; public access blocked; versioning enabled; server-side encryption verified',
      object: 's3://' + bucket + '/' + objectKey,
      versioned: true,
      encryption: 'age encrypted; downloaded, decrypted and pg_restore-verified',
      sha256: encryptedHash,
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
