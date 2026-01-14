export interface TimedOutRequestTrackerOptions {
  ttlMs: number;
  maxSize?: number;
}

/**
 * Track request IDs that timed out on the JS side so late Python responses can be
 * safely ignored instead of treated as protocol errors.
 */
export class TimedOutRequestTracker {
  private readonly ttlMs: number;
  private readonly maxSize: number;
  private readonly items = new Map<number, number>();

  constructor(options: TimedOutRequestTrackerOptions) {
    this.ttlMs = options.ttlMs;
    this.maxSize = options.maxSize ?? 1000;
  }

  clear(): void {
    this.items.clear();
  }

  mark(id: number): void {
    const now = Date.now();
    this.pruneOld(now);
    this.items.set(id, now);
    this.pruneMax();
  }

  consume(id: number): boolean {
    if (!this.items.has(id)) {
      return false;
    }
    this.items.delete(id);
    return true;
  }

  private pruneOld(now: number): void {
    const cutoff = now - this.ttlMs;
    for (const [key, ts] of this.items) {
      if (ts >= cutoff) {
        break;
      }
      this.items.delete(key);
    }
  }

  private pruneMax(): void {
    while (this.items.size > this.maxSize) {
      const oldest = this.items.keys().next();
      if (oldest.done) {
        break;
      }
      this.items.delete(oldest.value);
    }
  }
}
