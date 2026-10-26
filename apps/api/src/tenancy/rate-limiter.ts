export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Per-key rate limiting. Swap the in-memory bucket for Redis or similar when you run more than one instance. */
export interface RateLimiter {
  consume(key: string): Promise<RateLimitResult>;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token bucket: `burst` requests at once, refilled at `perMinute`. Per process: with N replicas the effective
 * limit is N times higher. The number of tracked keys is capped so random keys cannot exhaust memory.
 */
export class InMemoryTokenBucket implements RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly options: { perMinute: number; burst: number; maxKeys?: number },
    private readonly now: () => number = Date.now,
  ) {}

  async consume(key: string): Promise<RateLimitResult> {
    const now = this.now();
    const ratePerMs = this.options.perMinute / 60_000;
    const existing = this.buckets.get(key);
    const bucket = existing ?? { tokens: this.options.burst, updatedAt: now };
    bucket.tokens = Math.min(this.options.burst, bucket.tokens + (now - bucket.updatedAt) * ratePerMs);
    bucket.updatedAt = now;

    // Re-insert to keep Map order = least recently used first.
    this.buckets.delete(key);
    this.buckets.set(key, bucket);
    const maxKeys = this.options.maxKeys ?? 10_000;
    while (this.buckets.size > maxKeys) this.buckets.delete(this.buckets.keys().next().value!);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return { allowed: false, retryAfterSeconds: Math.ceil((1 - bucket.tokens) / ratePerMs / 1000) };
  }
}
