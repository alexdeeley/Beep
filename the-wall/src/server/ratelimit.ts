import crypto from "node:crypto";

/**
 * Classic token bucket. Sized so a human drawing as fast as physically
 * possible (continuous stroke chunks every ~50ms, i.e. ~20/s, across a
 * couple of overlapping strokes) never runs dry, while a script blasting
 * hundreds of messages a second empties it in well under a second.
 */
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;
  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  take(cost = 1): boolean {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.refillPerSecond);
    this.lastRefill = now;
    if (this.tokens >= cost) {
      this.tokens -= cost;
      return true;
    }
    return false;
  }
}

export const PER_CONNECTION_BUCKET = { capacity: 60, refillPerSecond: 30 };
export const PER_IP_BUCKET = { capacity: 120, refillPerSecond: 40 };

const IP_SALT = process.env.IP_HASH_SALT ?? crypto.randomBytes(16).toString("hex");

/**
 * Only this salted hash is ever kept in memory or logged - raw IPs never
 * appear anywhere past this function, and the hash by itself can't be
 * reversed back to an address.
 */
export function hashIp(ip: string): string {
  return crypto.createHash("sha256").update(IP_SALT).update(ip).digest("hex");
}

export class IpBucketRegistry {
  private buckets = new Map<string, TokenBucket>();

  take(ipHash: string): boolean {
    let bucket = this.buckets.get(ipHash);
    if (!bucket) {
      bucket = new TokenBucket(PER_IP_BUCKET.capacity, PER_IP_BUCKET.refillPerSecond);
      this.buckets.set(ipHash, bucket);
    }
    return bucket.take();
  }

  /** Called periodically so memory doesn't grow forever with one-off visitors. */
  prune(maxEntries = 50_000): void {
    if (this.buckets.size <= maxEntries) return;
    const toRemove = this.buckets.size - maxEntries;
    let removed = 0;
    for (const key of this.buckets.keys()) {
      if (removed >= toRemove) break;
      this.buckets.delete(key);
      removed++;
    }
  }
}
