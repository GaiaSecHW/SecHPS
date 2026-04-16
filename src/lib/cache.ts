// src/lib/cache.ts

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  ksize: number;
  vsize: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>> = new Map();
  private maxKeys: number;
  private defaultTTL: number;
  private stats = { hits: 0, misses: 0 };

  constructor(maxKeys: number = 500, defaultTTL: number = 60000) {
    this.maxKeys = maxKeys;
    this.defaultTTL = defaultTTL;
  }

  get(key: string): T | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.stats.misses++;
      return undefined;
    }

    // Move to end (most recently used)
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: T, ttl?: number): void {
    // Evict oldest if at capacity
    if (this.cache.size >= this.maxKeys && !this.cache.has(key)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(key, {
      value,
      expiresAt: Date.now() + (ttl ?? this.defaultTTL),
      createdAt: Date.now(),
    });
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
    this.stats = { hits: 0, misses: 0 };
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      keys: this.cache.size,
      ksize: this.cache.size,
      vsize: this.cache.size,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  keys(): string[] {
    return Array.from(this.cache.keys());
  }
}

// Global cache instances
export const userCache = new LRUCache<any>(200, 5 * 60 * 1000); // 5 minutes
export const permissionCache = new LRUCache<any>(500, 10 * 60 * 1000); // 10 minutes
export const configCache = new LRUCache<any>(50, 30 * 60 * 1000); // 30 minutes
export const skillCache = new LRUCache<any>(100, 15 * 60 * 1000); // 15 minutes
export const patternCache = new LRUCache<any>(100, 15 * 60 * 1000); // 15 minutes

// Cache key generators
export const cacheKeys = {
  user: (userId: string) => `user:${userId}`,
  userPermissions: (userId: string) => `user:perms:${userId}`,
  config: (configId: string) => `config:${configId}`,
  skill: (skillId: string) => `skill:${skillId}`,
  skillList: (category?: string) => `skills:${category || 'all'}`,
  pattern: (patternId: string) => `pattern:${patternId}`,
  patternList: (category?: string) => `patterns:${category || 'all'}`,
};

// Utility function to get with fallback
export async function getOrSet<T>(
  cache: LRUCache<T>,
  key: string,
  fetcher: () => Promise<T>,
  ttl?: number
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const value = await fetcher();
  cache.set(key, value, ttl);
  return value;
}

// Invalidate related caches
export function invalidateUserCaches(userId: string): void {
  userCache.delete(cacheKeys.user(userId));
  userCache.delete(cacheKeys.userPermissions(userId));
}

export function clearAllCaches(): void {
  userCache.clear();
  permissionCache.clear();
  configCache.clear();
  skillCache.clear();
  patternCache.clear();
}

export function getAllCacheStats(): Record<string, ReturnType<LRUCache<unknown>['getStats']>> {
  return {
    user: userCache.getStats(),
    permission: permissionCache.getStats(),
    config: configCache.getStats(),
    skill: skillCache.getStats(),
    pattern: patternCache.getStats(),
  };
}
