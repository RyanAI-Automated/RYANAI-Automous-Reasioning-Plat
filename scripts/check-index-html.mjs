#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = (message) => errors.push(message);
const readText = (file) => readFileSync(path.join(root, file), 'utf8');

function getAttribute(tag, name) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(
    new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'),
  );
  return match ? (match[1] ?? match[2] ?? match[3] ?? '') : null;
}

function assertExactlyOne(items, label) {
  if (items.length !== 1) fail(`Expected exactly one ${label}; found ${items.length}`);
  return items[0];
}

let html;
let main;
try {
  html = readText('index.html');
  main = readText('src/main.tsx');
} catch (error) {
  console.error('Index HTML check could not read a required file:', error);
  process.exit(1);
}

if (!/^\s*<!doctype html>/i.test(html)) fail('index.html must begin with an HTML5 doctype');

const htmlTags = [...html.matchAll(/<html\b[^>]*>/gi)].map(([tag]) => tag);
const htmlTag = assertExactlyOne(htmlTags, '<html> element');
if (htmlTag && !getAttribute(htmlTag, 'lang')) fail('<html> must declare a lang attribute');

const titles = [...html.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
const title = assertExactlyOne(titles, '<title>');
if (title && !title[1].replace(/&[^;]+;/g, ' ').trim()) fail('<title> must not be empty');

const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map(([tag]) => tag);
const metaByName = (name, attribute = 'name') =>
  metas.filter((tag) => getAttribute(tag, attribute)?.toLowerCase() === name.toLowerCase());
const charset = assertExactlyOne(metaByName('charset'), 'charset meta tag');
if (charset && !getAttribute(charset, 'charset')) fail('charset meta tag must specify its encoding');

const viewport = assertExactlyOne(metaByName('viewport'), 'viewport meta tag');
if (viewport) {
  const value = getAttribute(viewport, 'content') || '';
  if (!/width\s*=\s*device-width/i.test(value) || !/initial-scale\s*=\s*1(?:\.0+)?/i.test(value)) {
    fail('viewport meta tag must set width=device-width and initial-scale=1');
  }
}

for (const name of ['description', 'theme-color', 'color-scheme']) {
  const tags = assertExactlyOne(metaByName(name), `meta name="${name}"`);
  if (tags && !(getAttribute(tags, 'content') || '').trim()) {
    fail(`meta name="${name}" must have a non-empty content value`);
  }
}
for (const property of ['og:title', 'og:description']) {
  const tags = assertExactlyOne(metaByName(property, 'property'), `meta property="${property}"`);
  if (tags && !(getAttribute(tags, 'content') || '').trim()) {
    fail(`meta property="${property}" must have a non-empty content value`);
  }
}

const roots = [...html.matchAll(/<div\b[^>]*\bid\s*=\s*["']root["'][^>]*>/gi)];
assertExactlyOne(roots, 'root mount element');
if (!/<noscript\b[\s\S]*?<\/noscript\s*>/i.test(html)) {
  fail('index.html must provide a noscript fallback');
}

const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
const script = assertExactlyOne(scripts, 'script element');
if (script) {
  const attrs = script[1];
  if (getAttribute(attrs, 'type')?.toLowerCase() !== 'module') {
    fail('the application entry must use type="module"');
  }
  if (getAttribute(attrs, 'src') !== '/src/main.tsx') {
    fail('index.html must load /src/main.tsx as its only application entry');
  }
  if (script[2].trim()) fail('the application script must be external, not inline');
}
if (/<script\b[^>]*type\s*=\s*["']text\/babel["']/i.test(html) || /ReactDOM\.createRoot/.test(html)) {
  fail('index.html must not mount a second legacy React application');
}
if (!main.includes("import App from './App'")) {
  fail('src/main.tsx must import src/App.tsx');
}
if (!main.includes("import './index.css'")) {
  fail('src/main.tsx must load the application stylesheet');
}

if (errors.length) {
  console.error(errors.map((message) => `ERROR ${message}`).join('\n'));
  process.exit(1);
}

console.log('PASS index.html metadata, root mount, fallback and single Vite/Tauri entry point');
