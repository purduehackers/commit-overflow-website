import { Redis } from "@upstash/redis";
import { KV_REST_API_TOKEN, KV_REST_API_URL } from "astro:env/server";

const redis = new Redis({
    url: KV_REST_API_URL,
    token: KV_REST_API_TOKEN,
});

// TTL constants in seconds
export const TTL = {
    DISCORD_USER: 86400, // 24 hours
    DISCORD_MESSAGE: 43200, // 12 hours
    DISCORD_CHANNEL: 86400, // 24 hours
    DISCORD_ROLE: 86400, // 24 hours
    FORUM_THREADS: 3600, // 1 hour - updates more frequently
} as const;

export async function cacheGet<T>(key: string): Promise<T | null> {
    return redis.get<T>(key);
}

export async function cacheSet<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds !== undefined) {
        await redis.set(key, value, { ex: ttlSeconds });
    } else {
        await redis.set(key, value);
    }
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
