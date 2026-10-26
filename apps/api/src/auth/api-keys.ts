import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest();

/**
 * Constant-time API-key check. Keys are compared as SHA-256 digests (equal length by construction) and every
 * configured key is checked, so timing reveals neither the key nor which key matched.
 */
export class ApiKeyVerifier {
  private readonly digests: Buffer[];

  constructor(keys: readonly string[]) {
    this.digests = keys.map(sha256);
  }

  /** Returns a non-secret fingerprint of the matching key (for logs and spans), or null. */
  verify(candidate: string): string | null {
    const digest = sha256(candidate);
    let match: Buffer | null = null;
    for (const known of this.digests) {
      if (timingSafeEqual(digest, known)) match = known;
    }
    return match ? match.subarray(0, 4).toString('hex') : null;
  }
}
