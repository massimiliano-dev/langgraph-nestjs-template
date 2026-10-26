import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Keys are random, at least 32 characters (enforced by the config schema), and their digests live only in
 * memory, so a slow password hash (scrypt/argon2) would add latency to every request without adding
 * protection. HMAC-SHA256 with a fixed domain-separation key gives equal-length values for constant-time
 * comparison and a fingerprint that is stable across instances, for logs.
 */
const DOMAIN = 'langgraph-nestjs-template/api-key/v1';
const digestOf = (value: string) => createHmac('sha256', DOMAIN).update(value, 'utf8').digest();

/**
 * Constant-time API-key check. Every configured key is compared, so timing reveals neither the key nor which
 * key matched.
 */
export class ApiKeyVerifier {
  private readonly digests: Buffer[];

  constructor(keys: readonly string[]) {
    this.digests = keys.map(digestOf);
  }

  /** Returns a non-secret fingerprint of the matching key (for logs and spans), or null. */
  verify(candidate: string): string | null {
    const digest = digestOf(candidate);
    let match: Buffer | null = null;
    for (const known of this.digests) {
      if (timingSafeEqual(digest, known)) match = known;
    }
    return match ? match.subarray(0, 4).toString('hex') : null;
  }
}
