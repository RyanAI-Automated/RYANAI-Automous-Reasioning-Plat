import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Production migration approval is explicit and narrow. A later migration
// requires its own reviewed change and approval before being added here.
export const PRODUCTION_MIGRATION_ALLOWLIST = Object.freeze([
  '20261102235000_engineering_evidence_workbench',
]);

// This migration is intentionally excluded from this production run.
export const PRODUCTION_MIGRATION_EXCLUSIONS = Object.freeze([
  '20261104120000_isolated_coding_task_queue',
]);

export function assertOnlyApprovedMigrationPending({
  localMigrationNames,
  appliedMigrationNames,
  unresolvedMigrationNames = [],
  migrationName,
}) {
  if (!PRODUCTION_MIGRATION_ALLOWLIST.includes(migrationName)) {
    throw new Error('Requested production migration is not in the reviewed allowlist.');
  }

  if (unresolvedMigrationNames.length > 0) {
    throw new Error('The production database has an unfinished or rolled-back Prisma migration.');
  }

  const localNames = [...new Set(localMigrationNames)].sort();
  const appliedNames = [...new Set(appliedMigrationNames)];
  const localSet = new Set(localNames);
  const missingLocal = appliedNames.filter((name) => !localSet.has(name));
  if (missingLocal.length > 0) {
    throw new Error('The production database contains migration history missing from this checkout.');
  }

  const appliedSet = new Set(appliedNames);
  const pending = localNames.filter((name) => !appliedSet.has(name));
  const excludedPending = pending.filter((name) => PRODUCTION_MIGRATION_EXCLUSIONS.includes(name));
  const unexpectedPending = pending.filter(
    (name) => name !== migrationName && !PRODUCTION_MIGRATION_EXCLUSIONS.includes(name),
  );

  if (!pending.includes(migrationName) || unexpectedPending.length > 0) {
    throw new Error(
      'Production migration preflight expected the approved migration and no other unapproved pending migrations.',
    );
  }

  if (appliedSet.has(PRODUCTION_MIGRATION_EXCLUSIONS[0])) {
    throw new Error('The explicitly excluded coding-task migration is already applied; refusing this run.');
  }

  return {
    migrationName,
    pendingMigrations: [migrationName],
    excludedPendingMigrations: excludedPending,
  };
}

export async function stageApprovedPrismaMigration({
  prismaDirectory,
  migrationName,
  destinationDirectory,
}) {
  if (!PRODUCTION_MIGRATION_ALLOWLIST.includes(migrationName)) {
    throw new Error('Requested production migration is not in the reviewed allowlist.');
  }

  const sourceRoot = resolve(prismaDirectory);
  const sourceMigrations = join(sourceRoot, 'migrations');
  const destinationRoot = resolve(destinationDirectory);
  const destinationMigrations = join(destinationRoot, 'migrations');

  const schema = join(sourceRoot, 'schema.prisma');
  const lock = join(sourceMigrations, 'migration_lock.toml');
  const [schemaInfo, lockInfo] = await Promise.all([
    stat(schema).catch(() => null),
    stat(lock).catch(() => null),
  ]);

  if (!schemaInfo?.isFile() || !lockInfo?.isFile()) {
    throw new Error('Reviewed Prisma schema or migration lock file is missing.');
  }

  const sourceEntries = await readdir(sourceMigrations, { withFileTypes: true });
  const migrationDirectories = sourceEntries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (!migrationDirectories.includes(migrationName)) {
    throw new Error('The approved migration directory is missing from this checkout.');
  }

  const stagedMigrationNames = migrationDirectories.filter(
    (name) => !PRODUCTION_MIGRATION_EXCLUSIONS.includes(name),
  );
  if (stagedMigrationNames.length === 0 || !stagedMigrationNames.includes(migrationName)) {
    throw new Error('The scoped Prisma migration set is invalid.');
  }

  await mkdir(destinationRoot, { recursive: true });
  await mkdir(destinationMigrations, { recursive: true });
  await cp(schema, join(destinationRoot, 'schema.prisma'));
  await cp(lock, join(destinationMigrations, 'migration_lock.toml'));

  // Preserve all historical migrations so Prisma can reconcile its ledger.
  // Only the explicitly excluded, unapproved migration is omitted.
  for (const name of stagedMigrationNames) {
    const sourceMigration = join(sourceMigrations, name);
    const migrationInfo = await stat(sourceMigration).catch(() => null);
    const sqlInfo = await stat(join(sourceMigration, 'migration.sql')).catch(() => null);
    if (!migrationInfo?.isDirectory() || !sqlInfo?.isFile() || sqlInfo.size === 0) {
      throw new Error('A required Prisma migration directory or SQL file is missing or empty: ' + name);
    }
    await cp(sourceMigration, join(destinationMigrations, name), { recursive: true });
  }

  const actualStaged = (await readdir(destinationMigrations))
    .filter((entry) => entry !== 'migration_lock.toml')
    .sort();
  if (JSON.stringify(actualStaged) !== JSON.stringify(stagedMigrationNames)) {
    throw new Error('Scoped Prisma migration directory differs from the validated migration set.');
  }

  return join(destinationRoot, 'schema.prisma');
}
