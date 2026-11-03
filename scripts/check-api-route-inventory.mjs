#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { parse as parseYaml } from 'yaml';

const root = process.cwd();
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const inventory = parseYaml(readText('docs/api/route-inventory.yaml'));
const openapi = parseYaml(readText('docs/api/openapi.yaml'));
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const discovered = new Map();
const errors = [];
const key = (method, routePath) => `${method.toUpperCase()} ${routePath}`;

for (const file of inventory.route_sources ?? []) {
  let sourceText;
  try {
    sourceText = readText(file);
  } catch {
    errors.push(`Route source is missing: ${file}`);
    continue;
  }
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text.toLowerCase();
      const routeArg = node.arguments[0];
      if (methods.has(method) && routeArg && ts.isStringLiteralLike(routeArg)) {
        const routeKey = key(method, routeArg.text);
        const previous = discovered.get(routeKey);
        if (previous && previous !== file) {
          errors.push(`Duplicate active route declaration: ${routeKey} in ${previous} and ${file}`);
        } else {
          discovered.set(routeKey, file);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}

for (const derived of inventory.derived_routes ?? []) {
  const text = readText(derived.source);
  if (!text.includes(derived.expression)) {
    errors.push(`Derived route expression no longer exists: ${derived.source}: ${derived.expression}`);
  }
  const routeKey = key(derived.method, derived.path);
  if (!discovered.has(routeKey)) discovered.set(routeKey, derived.source);
}

const declared = new Map();
for (const route of inventory.routes ?? []) {
  const routeKey = key(route.method, route.path);
  if (declared.has(routeKey)) errors.push(`Duplicate route inventory entry: ${routeKey}`);
  declared.set(routeKey, route.source);
}
for (const routeKey of discovered.keys()) {
  if (!declared.has(routeKey)) errors.push(`Runtime route is missing from inventory: ${routeKey}`);
}
for (const routeKey of declared.keys()) {
  if (!discovered.has(routeKey)) errors.push(`Inventory route is not registered by the launcher: ${routeKey}`);
}

const pathToRuntime = (value) => value.replace(/\{([^}]+)\}/g, ':$1');
for (const [routePath, operations] of Object.entries(openapi.paths ?? {})) {
  for (const method of Object.keys(operations ?? {})) {
    if (!methods.has(method)) continue;
    const routeKey = key(method, pathToRuntime(routePath));
    if (!declared.has(routeKey)) errors.push(`OpenAPI operation has no registered route: ${routeKey}`);
  }
}
if (openapi.openapi !== '3.1.0') errors.push('OpenAPI contract must use version 3.1.0.');
if (openapi.info?.title !== 'RyanAI Gateway API') errors.push('Unexpected OpenAPI API title.');

if (errors.length) {
  console.error(errors.map((error) => `ERROR ${error}`).join('\n'));
  process.exit(1);
}
console.log(`PASS API route inventory: ${declared.size} routes across ${inventory.route_sources.length} runtime modules; OpenAPI operations are registered.`);
