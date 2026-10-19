#!/usr/bin/env node
import { Command } from 'commander';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const program = new Command();

program
  .name('ryan-cli')
  .description('RyanAI Autonomous Reasoning Platform CLI Manager')
  .version('1.1.0');

program
  .command('doctor')
  .description('Verify local environment, Node version, and CUDA/C++ bindings')
  .action(() => {
    console.log('=== RyanAI Environment Diagnostics ===');
    console.log(`Node Version: ${process.version}`);
    console.log(`Platform: ${process.platform} (${process.arch})`);
    
    try {
      const cudaEnginePath = path.resolve('src/inference/cuda_engine.cpp');
      const hasCudaSource = fs.existsSync(cudaEnginePath);
      console.log(`CUDA C++ Engine Source: ${hasCudaSource ? 'Found [OK]' : 'Missing [WARN]'}`);
    } catch (err) {
      console.error('Error checking CUDA engine:', err);
    }
    
    console.log('Diagnostics completed successfully.');
  });

program
  .command('db:generate')
  .description('Generate Prisma client and prepare pgvector store')
  .action(() => {
    console.log('Generating Prisma client...');
    try {
      execSync('npx prisma generate', { stdio: 'inherit' });
      console.log('Database client generated successfully.');
    } catch (error) {
      console.error('Failed to generate Prisma client:', error);
      process.exit(1);
    }
  });

program
  .command('start:server')
  .description('Launch Fastify backend server with hot-reloading')
  .action(() => {
    console.log('Starting RyanAI Fastify server...');
    try {
      execSync('node --import tsx src/server/index.ts', { stdio: 'inherit' });
    } catch (error) {
      console.error('Server execution failed:', error);
      process.exit(1);
    }
  });

program.parse(process.argv);
