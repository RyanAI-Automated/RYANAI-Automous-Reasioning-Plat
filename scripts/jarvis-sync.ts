import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { jarvisClient, type JarvisPatchSubmission } from '../src/integrations/jarvis/client.js';
import { buildRyanAIStackManifest, type StackEnvironment } from '../src/integrations/jarvis/stackManifest.js';

function print(value: unknown) {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function usage(): never {
  throw new Error(
    'Usage: jarvis:status | jarvis:publish-stack [development|staging|production] [branch] [commitSha] | jarvis:submit-patch <patch.json>',
  );
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'status') {
    const status = await jarvisClient.status();
    print(status);
    if (status.reachable !== true) process.exitCode = 1;
    return;
  }

  if (command === 'publish-stack') {
    const environment = (args[0] || 'staging') as StackEnvironment;
    if (!['development', 'staging', 'production'].includes(environment)) usage();
    const manifest = buildRyanAIStackManifest(environment, {
      branch: args[1],
      commitSha: args[2],
    });
    print(await jarvisClient.publishStack(manifest));
    return;
  }

  if (command === 'submit-patch') {
    if (!args[0]) usage();
    const raw = await readFile(args[0], 'utf8');
    const patch = JSON.parse(raw) as JarvisPatchSubmission;
    print(await jarvisClient.submitPatch(patch));
    return;
  }

  usage();
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});