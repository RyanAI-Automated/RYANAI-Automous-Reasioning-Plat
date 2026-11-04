import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { isEligiblePatchLogEvent } from './update-patch-log-guards.mjs';

const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');
const event = JSON.parse(readFileSync(eventPath, 'utf8'));
const pr = event.pull_request;
if (!isEligiblePatchLogEvent(pr)) {
  throw new Error('Refusing to update patch_update.md: only confirmed merges into main from non-patch-log branches are eligible');
}

const number = String(pr.number ?? '');
const title = String(pr.title ?? '(untitled)').replace(/[\r\n]/g, ' ');
const mergedAt = pr.merged_at;
const mergeSha = pr.merge_commit_sha;
const sourceBranch = String(pr.head?.ref ?? '(unknown)').replace(/[\r\n]/g, ' ');
const body = String(pr.body ?? '');
if (!/^\d+$/.test(number) || !mergedAt || !/^[0-9a-f]{40}$/i.test(mergeSha ?? '')) {
  throw new Error('Merged pull request metadata is incomplete; refusing to update patch_update.md');
}

const file = 'patch_update.md';
const existing = existsSync(file)
  ? readFileSync(file, 'utf8')
  : '# RyanAI Patch Update Log\n\nThis file records pull requests only after GitHub confirms they are merged into main.\n';
const marker = '## PR #' + number + ' —';
if (existing.split('\n').some((line) => line.startsWith(marker))) {
  console.log('patch_update.md already contains PR #' + number + '; no duplicate entry added.');
  process.exit(0);
}

const summary = body.split('\n')
  .filter((line) => /^[-*] /.test(line.trim()))
  .slice(0, 12)
  .map((line) => line.trim())
  .join('\n') || '- See the merged pull request for the complete change summary.';
const entry = [
  '',
  '## PR #' + number + ' — ' + title,
  '',
  '- **Merged:** ' + mergedAt,
  '- **Merge commit:** \x60' + mergeSha + '\x60',
  '- **Source branch:** \x60' + sourceBranch + '\x60',
  '- **Changes:**',
  summary,
  '- **Record type:** confirmed merge; this entry does not imply deployment or passing post-merge checks.',
  ''
].join('\n');

writeFileSync(file, existing.trimEnd() + '\n' + entry, 'utf8');
console.log('Recorded confirmed merge PR #' + number + ' in ' + file + '.');
