#!/bin/bash

API_URL="http://localhost:3000"

echo "=== 1. Testing Signup Validation Failure (Weak Password) ==="
curl -s -X POST "\$API_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"email": "architect@ryanai.internal", "password": "weak", "name": "System Architect"}' | jq .

echo -e "\n=== 2. Testing Valid Signup ==="
SIGNUP_RESPONSE=\$(curl -s -X POST "\$API_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d '{"email": "architect@ryanai.internal", "password": "SecurePassword123!", "name": "System Architect"}')
echo "\$SIGNUP_RESPONSE" | jq .

# Extract JWT Token for subsequent requests
TOKEN=$(echo "$SIGNUP_RESPONSE" | jq -r '.token // empty')

echo -e "\n=== 3. Testing Signin ==="
SIGNIN_RESPONSE=\$(curl -s -X POST "\$API_URL/api/auth/signin" \
  -H "Content-Type: application/json" \
  -d '{"email": "architect@ryanai.internal", "password": "SecurePassword123!"}')
echo "\$SIGNIN_RESPONSE" | jq .

TOKEN=$(echo "$SIGNIN_RESPONSE" | jq -r '.token // empty')

if [ -n "$TOKEN" ] && [ "$TOKEN" != "null" ]; then
  echo -e "\n=== 4. Testing Protected Profile Endpoint (/api/auth/me) ==="
  curl -s -X GET "\$API_URL/api/auth/me" \
    -H "Authorization: Bearer \$TOKEN" | jq .
else
  echo -e "\n[!] Token acquisition skipped due to existing user state."
fi
