import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const file = 'patch_update.md';
const number = process.env.PR_NUMBER;
const title = process.env.PR_TITLE;
const mergedAt = process.env.PR_MERGED_AT;
const mergeSha = process.env.PR_MERGE_SHA;
const sourceBranch = process.env.PR_HEAD_REF;
const body = process.env.PR_BODY || '';

if (!/^\d+$/.test(number || '') || !title || !mergedAt || !/^[0-9a-f]{40}$/i.test(mergeSha || '')) {
  throw new Error('Missing or invalid merged pull-request metadata; refusing to update patch_update.md');
}

const existing = existsSync(file) ? readFileSync(file, 'utf8') : '# RyanAI Patch Update Log\n\nThis file records pull requests only after GitHub confirms they are merged into main.\n';
const marker = `## PR #${number} —`;
if (existing.split('\n').some((line) => line.startsWith(marker))) {
  console.log(`patch_update.md already contains PR #${number}; no duplicate entry added.`);
  process.exit(0);
}

const summary = body
  .split('\n')
  .filter((line) => /^[-*] /.test(line.trim()))
  .slice(0, 12)
  .map((line) => line.trim())
  .join('\n') || '- See the merged pull request for the complete change summary.';

const entry = [
  '',
  `## PR #${number} — ${title}`,
  '',
  `- **Merged:** ${mergedAt}`,
  `- **Merge commit:** \`${mergeSha}\``,
  `- **Source branch:** \`${sourceBranch}\``,
  '- **Changes:**',
  summary,
  '- **Record type:** confirmed merge; this entry does not imply deployment or passing post-merge checks.',
  ''
].join('\n');

writeFileSync(file, existing.trimEnd() + '\n' + entry, 'utf8');
console.log(`Recorded confirmed merge PR #${number} in ${file}.`);
