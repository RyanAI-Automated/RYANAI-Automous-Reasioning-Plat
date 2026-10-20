#!/usr/bin/env node
import { Command } from 'commander';
import { getSystemDiagnostics, testCudaAddonLoad, runCommand } from './nodeSupport.js';

const program = new Command();

program
  .name('ryan-cli')
  .description('RyanAI Autonomous Reasoning Platform CLI Manager')
  .version('1.0.0');

program
  .command('doctor')
  .description('Verify local environment, Node version, and CUDA/C++ bindings')
  .action(() => {
    console.log('=== RyanAI Environment Diagnostics ===');
    const diag = getSystemDiagnostics();

    console.log(`Node Version:             ${diag.nodeVersion}`);
    console.log(`Platform & Arch:          ${diag.platform} (${diag.arch})`);
    console.log(`System Memory:            ${diag.freeMemoryGB} GB free / ${diag.totalMemoryGB} GB total`);
    console.log(`CUDA C++ Source:          ${diag.cudaSourceExists ? 'Found [OK]' : 'Missing [WARN]'}`);
    console.log(`CUDA Compiled Binding:    ${diag.cudaCompiledBindingExists ? 'Found [OK]' : 'Not Compiled [WARN]'}`);

    // Test native addon loading
    const addonTest = testCudaAddonLoad();
    if (addonTest.loaded) {
      console.log('CUDA Addon Load Test:     Successfully Bound [OK]');
    } else {
      console.log(`CUDA Addon Load Test:     Failed [WARN] (${addonTest.error})`);
    }

    console.log('======================================');
    console.log('Diagnostics completed successfully.');
  });

program
  .command('db:generate')
  .description('Generate Prisma client and prepare pgvector store')
  .action(() => {
    console.log('Generating Prisma client...');
    const success = runCommand('pnpm prisma generate');
    if (!success) process.exit(1);
    console.log('✓ Database client generated successfully.');
  });

program
  .command('start:server')
  .description('Launch Fastify backend server with hot-reloading')
  .action(() => {
    console.log('Starting RyanAI Fastify server...');
    const success = runCommand('node --import tsx/esm src/server/index.ts');
    if (!success) process.exit(1);
  });

program.parse(process.argv);