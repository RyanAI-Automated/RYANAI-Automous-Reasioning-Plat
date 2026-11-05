import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

// Production execution is deliberately allowlisted. A later migration must be
// added only through a separately reviewed PR and its own explicit approval.
export const PRODUCTION_MIGRATION_ALLOWLIST = Object.freeze([
  '20261102235000_engineering_evidence_workbench',
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
  if (pending.length !== 1 || pending[0] !== migrationName) {
    throw new Error(
      'Production migration preflight expected exactly one pending, allowlisted migration; refusing to apply a broader migration set.',
    );
  }

  return { migrationName, pendingMigrations: pending };
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
  const sourceMigration = join(sourceMigrations, migrationName);
  const destinationRoot = resolve(destinationDirectory);
  const destinationMigrations = join(destinationRoot, 'migrations');
  const destinationMigration = join(destinationMigrations, migrationName);

  const schema = join(sourceRoot, 'schema.prisma');
  const lock = join(sourceMigrations, 'migration_lock.toml');
  const sql = join(sourceMigration, 'migration.sql');

  const [schemaInfo, lockInfo, migrationInfo, sqlInfo] = await Promise.all([
    stat(schema).catch(() => null),
    stat(lock).catch(() => null),
    stat(sourceMigration).catch(() => null),
    stat(sql).catch(() => null),
  ]);

  if (!schemaInfo?.isFile() || !lockInfo?.isFile()
      || !migrationInfo?.isDirectory() || !sqlInfo?.isFile() || sqlInfo.size === 0) {
    throw new Error('Reviewed Prisma schema or migration files are missing or empty.');
  }

  await mkdir(destinationRoot, { recursive: true });
  await mkdir(destinationMigrations, { recursive: true });
  await cp(schema, join(destinationRoot, 'schema.prisma'));
  await cp(lock, join(destinationMigrations, 'migration_lock.toml'));
  await cp(sourceMigration, destinationMigration, { recursive: true });

  const stagedEntries = (await readdir(destinationMigrations))
    .filter((entry) => entry !== 'migration_lock.toml')
    .sort();
  if (stagedEntries.length !== 1 || stagedEntries[0] !== migrationName) {
    throw new Error('Scoped Prisma migration directory contains an unexpected migration.');
  }

  return join(destinationRoot, 'schema.prisma');
}
