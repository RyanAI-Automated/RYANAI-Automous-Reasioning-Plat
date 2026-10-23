import crypto from 'crypto';

interface VerifySlackParams {
  signingSecret: string;
  requestSignature: string | undefined;
  timestamp: string | undefined;
  rawBody: string;
}

export function verifySlackSignature({
  signingSecret,
  requestSignature,
  timestamp,
  rawBody,
}: VerifySlackParams): boolean {
  if (!requestSignature || !timestamp) return false;

  // 1. Replay attack protection: Reject requests older than 5 minutes (300 seconds)
  const currentTime = Math.floor(Date.now() / 1000);
  const requestTime = parseInt(timestamp, 10);
  if (isNaN(requestTime) || Math.abs(currentTime - requestTime) > 300) {
    return false;
  }

  // 2. Construct signature base string
  const sigBaseString = `v0:${timestamp}:${rawBody}`;

  // 3. Compute HMAC SHA-256 digest
  const hmac = crypto
    .createHmac('sha256', signingSecret)
    .update(sigBaseString, 'utf8')
    .digest('hex');
  const computedSignature = `v0=${hmac}`;

  // 4. Timing-safe comparison (prevents timing side-channel attacks)
  const computedBuffer = Buffer.from(computedSignature, 'utf8');
  const requestBuffer = Buffer.from(requestSignature, 'utf8');

  if (computedBuffer.length !== requestBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, requestBuffer);
}