#!/usr/bin/env node
/**
 * scripts/cmake.mjs - CMake build wrapper
 */
import { spawn } from 'node:child_process';
import { createLogger } from '../src/shared/logger.js';

const logger = createLogger('cmake');

function runCMake(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cmake', args, {
      stdio: 'inherit',
      shell: true,
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(code);
      } else {
        reject(new Error(`CMake exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      logger.error(`CMake error: ${err.message}`);
      reject(err);
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  
  if (!args.length) {
    logger.info('CMake wrapper - pass CMake arguments directly');
    logger.info('Usage: npm run cmake:configure -- -S . -B build');
    process.exit(1);
  }

  try {
    logger.info(`Running: cmake ${args.join(' ')}`);
    await runCMake(args);
    logger.info('✓ CMake completed');
    process.exit(0);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

main();
