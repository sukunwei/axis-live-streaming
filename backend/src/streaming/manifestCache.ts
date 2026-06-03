/**
 * Tiny LRU cache, Map-backed. Eviction order is insertion order — reads
 * (via get) touch the key, moving it to the back. New keys at capacity
 * evict the oldest.
 *
 * This is small on purpose: the use site (upstream manifest cache) only
 * stores { fetched, expiresAt } values, and a full Map iteration is fine
 * up to a few hundred entries. When you outgrow this, switch to a doubly
 * linked list — not before.
 */
export class LruCache<K, V> {
  private readonly map = new Map<K, V>();
  constructor(private readonly capacity: number) {
    if (capacity < 1) throw new Error('LruCache capacity must be >= 1');
  }

  get size(): number {
    return this.map.size;
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  /** Returns value and bumps key to the back (most-recently used). */
  get(key: K): V | undefined {
    const v = this.map.get(key);
    if (v === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, v);
    return v;
  }

  /** Insert or overwrite. Evicts the oldest entry if at capacity and key is new. */
  set(key: K, value: V): void {
    if (!this.map.has(key) && this.map.size >= this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, value);
  }
}
