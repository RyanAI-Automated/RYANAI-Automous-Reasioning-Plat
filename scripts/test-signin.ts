// Run with: npx tsx scripts/test-signin.ts
const BASE_URL = 'http://localhost:3000'; // Adjust port if running on 3001

async function testSignin() {
  console.log('🧪 Testing Sign-In Endpoint...\n');

  // Test 1: Missing Payload (Expected: 400 Bad Request)
  console.log('1. Testing missing credentials...');
  let res = await fetch(`${BASE_URL}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  console.log(`Status: ${res.status}`, await res.json());

  // Test 2: Invalid Credentials (Expected: 401 Unauthorized)
  console.log('\n2. Testing invalid credentials...');
  res = await fetch(`${BASE_URL}/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@ryanai.local', password: 'wrongpassword' }),
  });
  console.log(`Status: ${res.status}`, await res.json());

  // Test 3: Rate Limiting Test (Firing 6 requests rapidly, 5th/6th should hit 429)
  console.log('\n3. Testing rate limiter (firing rapid requests)...');
  for (let i = 1; i <= 6; i++) {
    const rateRes = await fetch(`${BASE_URL}/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'rate@ryanai.local', password: 'test' }),
    });
    console.log(`Attempt ${i} Status: ${rateRes.status}`);
  }

  console.log('\n✅ Verification sequence completed.');
}

testSignin().catch(console.error);
