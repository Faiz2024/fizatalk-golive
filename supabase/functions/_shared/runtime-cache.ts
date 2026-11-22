interface CacheEntry<V> {
  value: V;
  expiresAt: number;
}

// Cache RAM kecil dengan TTL dan batas entri agar penggunaan memori tetap terkendali.
export class TtlCache<K, V> {
  private readonly entries = new Map<K, CacheEntry<V>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new Error("TTL must be positive");
    }
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("maxEntries must be positive");
    }
  }

  get(key: K, now = Date.now()): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: K, value: V, now = Date.now()): void {
    this.entries.delete(key);
    this.pruneExpired(now);
    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
    }
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  delete(key: K): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
