import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [evidenceArg, outputArg] = process.argv.slice(2);
if (!evidenceArg || !outputArg) {
  console.error('Usage: node scripts/benchmark-evidence-bundle.mjs <evidence-dir> <output-dir>');
  process.exit(2);
}

const evidenceRoot = path.resolve(evidenceArg);
const outputRoot = path.resolve(outputArg);
if (outputRoot === evidenceRoot || outputRoot.startsWith(evidenceRoot + path.sep)) {
  throw new Error('Output directory must be outside the evidence input directory.');
}

const contractPath = path.resolve('benchmarks/contracts/gate-contracts.json');
const contractBytes = await readFile(contractPath);
const gateContract = JSON.parse(contractBytes.toString('utf8'));
if (gateContract.modelInvocation !== false) {
  throw new Error('Evidence bundling is disabled unless modelInvocation is explicitly false.');
}
if (!Array.isArray(gateContract.gates) || gateContract.gates.length !== 6) {
  throw new Error('Exactly six gate contracts are required.');
}

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const artifacts = [];
const gateInventory = [];

await mkdir(path.join(outputRoot, 'artifacts'), { recursive: true });

for (const gate of gateContract.gates) {
  const gateArtifacts = [];
  for (const filename of gate.passEvidence) {
    const sourcePath = path.resolve(evidenceRoot, filename);
    if (!sourcePath.startsWith(evidenceRoot + path.sep)) {
      throw new Error('Evidence path escaped the input directory.');
    }
    try {
      const stat = await lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size === 0) {
        throw new Error('Evidence artifact must be a non-empty regular file: ' + filename);
      }
      const bytes = await readFile(sourcePath);
      const digest = hash(bytes);
      const destination = path.join(outputRoot, 'artifacts', filename);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(sourcePath, destination);
      const item = { gateId: gate.id, filename, bytes: bytes.length, sha256: digest };
      artifacts.push(item);
      gateArtifacts.push(item);
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        gateArtifacts.push({ gateId: gate.id, filename, present: false });
      } else {
        throw error;
      }
    }
  }
  gateInventory.push({
    gateId: gate.id,
    gateName: gate.name,
    requiredArtifactCount: gate.passEvidence.length,
    presentArtifactCount: gateArtifacts.filter(item => item.present !== false).length,
    missingArtifacts: gateArtifacts.filter(item => item.present === false).map(item => item.filename),
    verdict: 'UNKNOWN'
  });
}

const manifest = {
  schemaVersion: '1.0.0',
  bundleType: 'ryanai-benchmark-readiness-evidence-inventory',
  generatedAt: new Date().toISOString(),
  modelInvocation: false,
  providerCalls: 0,
  providerSpendZar: 0,
  source: {
    gateContractSha256: hash(contractBytes),
    gateContractPath: 'benchmarks/contracts/gate-contracts.json'
  },
  verdictPolicy: 'BUNDLE_GENERATION_NEVER_GRANTS_GATE_PASS',
  overallVerdict: 'UNKNOWN',
  gates: gateInventory,
  artifacts
};

await writeFile(path.join(outputRoot, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'w' });
console.log(JSON.stringify({
  status: 'BUNDLE_GENERATED',
  modelInvocation: false,
  providerCalls: 0,
  overallVerdict: 'UNKNOWN',
  gates: gateInventory.length,
  missingArtifactCount: gateInventory.reduce((sum, gate) => sum + gate.missingArtifacts.length, 0),
  manifest: path.join(outputRoot, 'bundle-manifest.json')
}, null, 2));
