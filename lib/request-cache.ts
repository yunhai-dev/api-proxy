/**
 * 进程内 TTL 缓存，用于消除代理热路径中的重复数据库查询。
 * - 单例，通过 globalThis 跨热重载保持状态
 * - TTL 到期后下次访问时惰性清除
 * - 不跨实例共享；多实例部署中各实例独立缓存，依赖 TTL 收敛一致性
 */

type CacheEntry<T> = { value: T; expiresAt: number };

class RequestCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): T {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    return value;
  }

  /** 主动失效，管理员写入时调用 */
  invalidate(key: string) {
    this.store.delete(key);
  }

  /** 前缀失效，如 invalidatePrefix("channel:") */
  invalidatePrefix(prefix: string) {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __requestCache: RequestCache | undefined;
}

export const requestCache: RequestCache =
  globalThis.__requestCache ??= new RequestCache();
globalThis.__requestCache = requestCache;

export const SETTINGS_TTL_MS = 30_000;   // settings 变动不频繁，30s
export const CHANNEL_TTL_MS = 5_000;     // 渠道/目录/价格，5s
