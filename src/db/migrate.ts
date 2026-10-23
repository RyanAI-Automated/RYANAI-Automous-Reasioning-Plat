/**
 * src/db/migrate.ts - Database migration runner
 */
import { createLogger } from '../shared/logger.js';
import { spawn } from 'node:child_process';

const logger = createLogger('db-migrate');

async function runMigrations() {
  logger.info('📡 Running database migrations...');

  return new Promise((resolve, reject) => {
    const proc = spawn('prisma', ['db', 'push'], {
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        logger.info('✓ Migrations complete');
        resolve(0);
      } else {
        logger.error('✗ Migration failed');
        reject(new Error(`Prisma exited with code ${code}`));
      }
    });
  });
}

runMigrations()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error(err);
    process.exit(1);
  });
