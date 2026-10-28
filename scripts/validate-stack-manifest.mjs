#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
const { parse: parseYaml } = yaml;

const root = process.cwd();
const realRoot = realpathSync(root);
const manifestPath = path.join(root, 'stacks', 'ryanai.stack.json');
const schemaPath = path.join(root, 'stacks', 'ryanai.stack.schema.json');
const errors = [];
const fail = (message) => errors.push(message);

function resolveRepoPath(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return null;
  if (path.isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate) || candidate.startsWith('\\\\')) return null;
  if (candidate.split(/[\\/]+/).includes('..')) return null;

  const resolved = path.resolve(root, candidate);
  const relativePath = path.relative(root, resolved);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    return null;
  }

  // Also reject symlinks whose targets escape the repository, not just lexical traversal.
  try {
    const actualPath = realpathSync(resolved);
    const actualRelativePath = path.relative(realRoot, actualPath);
    if (
      actualRelativePath === '..' ||
      actualRelativePath.startsWith('..' + path.sep) ||
      path.isAbsolute(actualRelativePath)
    ) {
      return null;
    }
    return actualPath;
  } catch {
    // The caller reports a clear missing-target error if the candidate does not exist.
    return resolved;
  }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(path.relative(root, file) + ': ' + (error instanceof Error ? error.message : String(error)));
    return undefined;
  }
}

if (!existsSync(manifestPath)) fail('stacks/ryanai.stack.json is missing');
if (!existsSync(schemaPath)) fail('stacks/ryanai.stack.schema.json is missing');
const manifest = readJson(manifestPath);
const schema = readJson(schemaPath);

if (manifest !== undefined) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    fail('Stack manifest root must be a JSON object');
  } else {
    if (manifest.schemaVersion !== 'ryanai.stack/v1') fail('Unexpected stack schemaVersion');
    if (manifest.name !== 'ryanai') fail('Stack name must be ryanai');
    if (typeof manifest.version !== 'string' || !manifest.version) fail('Stack version is required');
    if (!Array.isArray(manifest.services)) fail('Stack services must be an array');

    const services = Array.isArray(manifest.services) ? manifest.services : [];
    const validServices = services.filter((service) => service && typeof service === 'object' && !Array.isArray(service));
    if (validServices.length !== services.length) fail('Each stack service must be an object');
    const names = validServices.map((service) => service.name);
    if (new Set(names).size !== names.length) fail('Stack service names must be unique');

    for (const name of ['api', 'web', 'mcp-server', 'postgres', 'redis']) {
      if (!names.includes(name)) fail('Missing required stack service: ' + name);
    }

    for (const service of validServices) {
      if (!Number.isInteger(service.port) || service.port < 1 || service.port > 65535) {
        fail('Invalid port for stack service: ' + String(service.name));
      }
      if (typeof service.dockerfile === 'string') {
        const dockerfilePath = resolveRepoPath(service.dockerfile);
        if (!dockerfilePath) {
          fail('Dockerfile path must stay inside the repository for ' + String(service.name));
        } else if (!existsSync(dockerfilePath)) {
          fail('Missing Dockerfile for ' + String(service.name) + ': ' + service.dockerfile);
        }
      }
    }

    const composePath = path.join(root, 'docker-compose.yml');
    if (existsSync(composePath)) {
      try {
        const compose = parseYaml(readFileSync(composePath, 'utf8'));
        const configuredVolumes = compose?.volumes || {};
        for (const service of validServices) {
          if (
            typeof service.persistentVolume === 'string' &&
            !Object.prototype.hasOwnProperty.call(configuredVolumes, service.persistentVolume)
          ) {
            fail('Persistent volume is not declared in docker-compose.yml: ' + service.persistentVolume);
          }
        }
      } catch (error) {
        fail('docker-compose.yml could not be parsed: ' + (error instanceof Error ? error.message : String(error)));
      }
    } else {
      fail('docker-compose.yml is missing');
    }

    const targets = [
      manifest.deploymentTargets?.dockerCompose,
      manifest.deploymentTargets?.render,
      manifest.deploymentTargets?.vercel,
      ...(Array.isArray(manifest.deploymentTargets?.kubernetes) ? manifest.deploymentTargets.kubernetes : []),
    ];
    for (const target of targets) {
      const targetPath = resolveRepoPath(target);
      if (!targetPath) {
        fail('Deployment target must be a repository-relative path: ' + String(target));
      } else if (!existsSync(targetPath)) {
        fail('Missing deployment target: ' + target);
      }
    }

    if (manifest.integrations?.jarvis?.enabledByDefault !== false) {
      fail('Jarvis sync must remain disabled by default');
    }

    const forbiddenKey = /(?:^|_)(?:token|api_?key|access_?token|refresh_?token|password|passwd|secret(?:value)?|credential(?:value)?|private_?key|client_?secret|authorization)(?:_|$)/i;
    function findInlineSecrets(value, location = '$') {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        const normalizedKey = key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/-/g, '_');
        // requiresSecret names an environment variable; it does not contain the secret value.
        if (key.toLowerCase() !== 'requiressecret' && forbiddenKey.test(normalizedKey)) {
          fail('Do not store credentials in stack manifest at ' + location + '.' + key);
        }
        findInlineSecrets(child, location + '.' + key);
      }
    }
    findInlineSecrets(manifest);
  }
}

if (schema !== undefined) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    fail('Stack JSON Schema root must be a JSON object');
  } else if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
    fail('Stack JSON Schema draft declaration is missing or unsupported');
  } else if (manifest !== undefined) {
    try {
      const ajv = new Ajv2020({ allErrors: true, strict: true });
      const validateManifest = ajv.compile(schema);
      if (!validateManifest(manifest)) {
        const details = (validateManifest.errors ?? []).map((error) => {
          const location = error.instancePath || '/';
          const extra = error.params?.additionalProperty
            ? ` (property "${error.params.additionalProperty}")`
            : '';
          return `${location}: ${error.message || 'invalid'}${extra}`;
        });
        fail('Stack manifest does not conform to schema: ' + details.join('; '));
        const details = (validateManifest.errors || []).map((issue) => {
          const location = issue.instancePath || '/';
          const property = issue.params?.additionalProperty;
          const extra = property ? ` (property "${property}")` : '';
          return `${location}: ${issue.message || 'invalid'}${extra}`;
        }).join('; ');
        fail('Stack manifest does not conform to schema: ' + details);
      }
    } catch (error) {
      fail('Stack JSON Schema could not be compiled: ' + (error instanceof Error ? error.message : String(error)));
    }
  }
}

if (errors.length) {
  console.error(errors.map((message) => 'ERROR ' + message).join('\n'));
  process.exit(1);
}
console.log('PASS RyanAI stack manifest, schema, path, and credential policy validated');
