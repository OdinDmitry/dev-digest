import { createHmac, timingSafeEqual } from 'node:crypto';

/** Verify a GitHub webhook's `X-Hub-Signature-256` HMAC over the raw body. */
export function verifySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? '');
  return a.length === b.length && timingSafeEqual(a, b);
}
