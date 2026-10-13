import { createClient } from "redis";
import { REDIS_URL } from "astro:env/server";

const redis = createClient({
    url: REDIS_URL,
    socket: { connectTimeout: 5000, reconnectStrategy: false },
    disableOfflineQueue: true,
});
redis.on("error", () => console.error("Redis connection failed"));
let connecting: Promise<unknown> | undefined;

async function getRedis() {
    if (!redis.isOpen) {
        connecting ??= redis.connect().finally(() => {
            connecting = undefined;
        });
    }
    await connecting;
    return redis.withCommandOptions({ timeout: 5000 });
}

// TTL constants in seconds
export const TTL = {
    DISCORD_USER: 86400, // 24 hours
    DISCORD_MESSAGE: 43200, // 12 hours
    DISCORD_CHANNEL: 86400, // 24 hours
    DISCORD_ROLE: 86400, // 24 hours
    FORUM_THREADS: 3600, // 1 hour - updates more frequently
    COMMIT_SUMMARY: 86400, // 1 day
} as const;

export async function cacheGet<T>(key: string): Promise<T | null> {
    const raw = await (await getRedis()).get(key);
    if (raw === null) return null;
    // Upstash stored objects as JSON and strings verbatim. Existing cache
    // entries copied during migration must support both representations.
    try {
        const decoded: unknown = JSON.parse(raw);
        if (typeof decoded === "number" && String(decoded) !== raw) return raw as T;
        return decoded as T;
    } catch {
        return raw as T;
    }
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const encoded = typeof value === "string" ? value : JSON.stringify(value);
    if (encoded === undefined) throw new Error("Cache values must be JSON serializable");
    await (await getRedis()).set(key, encoded, ttlSeconds === undefined ? {} : { EX: ttlSeconds });
}

export async function cacheDel(key: string): Promise<void> {
    await (await getRedis()).del(key);
}

export async function cacheDelPattern(pattern: string): Promise<void> {
    let cursor = "0";
    do {
        const client = await getRedis();
        const { cursor: nextCursor, keys } = await client.scan(cursor, {
            MATCH: pattern,
            COUNT: 100,
        });
        if (keys.length > 0) {
            await client.del(keys);
        }
        cursor = nextCursor;
    } while (cursor !== "0");
}

export async function cached<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds?: number,
): Promise<T> {
    const existing = await cacheGet<T>(key);
    if (existing !== null) {
        return existing;
    }
    const value = await fetcher();
    await cacheSet(key, value, ttlSeconds);
    return value;
}
