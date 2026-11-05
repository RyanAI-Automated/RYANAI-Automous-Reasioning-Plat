// Run with: npx tsx scripts/test-signin.ts
const BASE_URL = 'http://localhost:3000';

async function assertRetired(path: string) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'legacy@example.test', password: 'not-used' }),
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 410 || body.error !== 'Gone') {
    throw new Error(`Expected ${path} to be retired with HTTP 410; received ${response.status}.`);
  }
  console.log(`PASS ${path}: HTTP 410 (local password authentication retired)`);
}

async function main() {
  await assertRetired('/api/auth/signin');
  await assertRetired('/signin');
}

main().catch((error) => {
  console.error('Legacy sign-in verification failed:', error);
  process.exitCode = 1;
});
