import { DISCORD_BOT_TOKEN } from "astro:env/server";
import { cacheGet, cacheSet, TTL } from "./redis";

const DISCORD_API = "https://discord.com/api/v10";
const FETCH_TIMEOUT_MS = 10000;

function createTimeoutSignal(): AbortSignal {
    return AbortSignal.timeout(FETCH_TIMEOUT_MS);
}

interface DiscordUser {
    id: string;
    username: string;
    avatar: string | null;
    discriminator: string;
    global_name: string | null;
}

interface DiscordChannel {
    id: string;
    name: string;
    type: number;
}

interface DiscordRole {
    id: string;
    name: string;
    color: number;
}

export async function getRole(roleId: string): Promise<DiscordRole | null> {
    const roles = await getGuildRoles(COMMIT_OVERFLOW_GUILD_ID);
    return roles.find((r) => r.id === roleId) || null;
}

export async function getDiscordUser(userId: string): Promise<DiscordUser | null> {
    const cacheKey = `discord:user:${userId}`;
    const cached = await cacheGet<DiscordUser>(cacheKey);
    if (cached) return cached;

    try {
        const response = await fetch(`${DISCORD_API}/users/${userId}`, {
            headers: {
                Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
            },
            signal: createTimeoutSignal(),
        });

        if (!response.ok) {
            return null;
        }

        const user: DiscordUser = await response.json();
        await cacheSet(cacheKey, user, TTL.DISCORD_USER);
        return user;
    } catch {
        return null;
    }
}

export function getAvatarUrl(userId: string, avatarHash: string | null, size: number = 32): string {
    if (avatarHash) {
        const ext = avatarHash.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=${size}`;
    }

    const defaultAvatarIndex = Number(BigInt(userId) >> 22n) % 6;
    return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarIndex}.png`;
}

export function getThreadUrl(guildId: string, threadId: string): string {
    return `https://discord.com/channels/${guildId}/${threadId}`;
}

export const COMMIT_OVERFLOW_GUILD_ID = "772576325897945119";
export const COMMIT_OVERFLOW_FORUM_ID = "1452388241796894941";

interface DiscordThread {
    id: string;
    name: string;
    owner_id: string;
    message_count: number;
    member_count: number;
}

interface ThreadsResponse {
    threads: DiscordThread[];
    has_more: boolean;
}

export async function getForumThreads(): Promise<DiscordThread[]> {
    const cacheKey = "discord:threads:forum";
    const cachedThreads = await cacheGet<DiscordThread[]>(cacheKey);
    if (cachedThreads) return cachedThreads;

    try {
        const [activeRes, archivedRes] = await Promise.all([
            fetch(`${DISCORD_API}/guilds/${COMMIT_OVERFLOW_GUILD_ID}/threads/active`, {
                headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
                signal: createTimeoutSignal(),
            }),
            fetch(
                `${DISCORD_API}/channels/${COMMIT_OVERFLOW_FORUM_ID}/threads/archived/public?limit=100`,
                {
                    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
                    signal: createTimeoutSignal(),
                },
            ),
        ]);

        const allThreads: DiscordThread[] = [];

        if (activeRes.ok) {
            const activeData = await activeRes.json();
            const forumThreads = (activeData.threads || []).filter(
                (t: DiscordThread & { parent_id?: string }) =>
                    t.parent_id === COMMIT_OVERFLOW_FORUM_ID,
            );
            allThreads.push(...forumThreads);
        }

        if (archivedRes.ok) {
            const archivedData: ThreadsResponse = await archivedRes.json();
            allThreads.push(...(archivedData.threads || []));
        }

        const uniqueThreads = Array.from(new Map(allThreads.map((t) => [t.id, t])).values());

        await cacheSet(cacheKey, uniqueThreads, TTL.FORUM_THREADS);
        return uniqueThreads;
    } catch {
        return [];
    }
}

interface MessageSnapshotFields {
    content: string;
    attachments: Attachment[];
    embeds: unknown[];
    timestamp: string;
    edited_timestamp: string | null;
    flags: number;
    mentions: unknown[];
    mention_roles: string[];
    type: number;
}

export interface Attachment {
    url: string;
    content_type?: string;
    filename: string;
    title?: string;
}

interface MessageSnapshot {
    message: MessageSnapshotFields;
}

interface MessageReference {
    type?: number; // 0 = reply, 1 = forward
    message_id?: string;
    channel_id?: string;
    guild_id?: string;
}

interface DiscordMessage {
    id: string;
    content: string;
    author: {
        id: string;
        username: string;
    };
    attachments: Attachment[];
    message_reference?: MessageReference;
    message_snapshots?: MessageSnapshot[];
}

export async function getDiscordMessage(
    channelId: string,
    messageId: string,
): Promise<DiscordMessage | null> {
    const cacheKey = `discord:message:${channelId}:${messageId}`;
    const cachedMessage = await cacheGet<DiscordMessage>(cacheKey);
    if (cachedMessage) return cachedMessage;

    try {
        const response = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
            signal: createTimeoutSignal(),
        });

        if (!response.ok) return null;

        const message: DiscordMessage = await response.json();
        await cacheSet(cacheKey, message, TTL.DISCORD_MESSAGE);
        return message;
    } catch {
        return null;
    }
}

export async function getCommitOverflowStats(): Promise<{
    totalMessages: number;
    activeHackers: number;
    threadCount: number;
}> {
    const threads = await getForumThreads();

    const totalMessages = threads.reduce((sum, t) => sum + (t.message_count || 0), 0);
    const uniqueOwners = new Set(threads.map((t) => t.owner_id));

    return {
        totalMessages,
        activeHackers: uniqueOwners.size,
        threadCount: threads.length,
    };
}

export async function getDiscordChannel(channelId: string): Promise<DiscordChannel | null> {
    const cacheKey = `discord:channel:${channelId}`;
    const cachedChannel = await cacheGet<DiscordChannel>(cacheKey);
    if (cachedChannel) return cachedChannel;

    try {
        const response = await fetch(`${DISCORD_API}/channels/${channelId}`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
            signal: createTimeoutSignal(),
        });

        if (!response.ok) return null;

        const channel: DiscordChannel = await response.json();
        await cacheSet(cacheKey, channel, TTL.DISCORD_CHANNEL);
        return channel;
    } catch {
        return null;
    }
}

export async function getGuildRoles(guildId: string): Promise<DiscordRole[]> {
    const cacheKey = `discord:roles:${guildId}`;
    const cachedRoles = await cacheGet<DiscordRole[]>(cacheKey);
    if (cachedRoles) return cachedRoles;

    try {
        const response = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
            headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}` },
            signal: createTimeoutSignal(),
        });

        if (!response.ok) return [];

        const roles: DiscordRole[] = await response.json();
        await cacheSet(cacheKey, roles, TTL.DISCORD_ROLE);
        return roles;
    } catch {
        return [];
    }
}

export async function resolveDiscordMentions(content: string): Promise<string> {
    if (!content) return content;

    let resolved = content;

    // Resolve user mentions: <@userId> or <@!userId>
    const userMentionRegex = /<@!?(\d+)>/g;
    const userMatches = [...content.matchAll(userMentionRegex)];
    for (const match of userMatches) {
        const userId = match[1];
        const user = await getDiscordUser(userId);
        const displayName = user?.global_name || user?.username || "Unknown User";
        resolved = resolved.replace(match[0], `@${displayName}`);
    }

    // Resolve channel mentions: <#channelId>
    const channelMentionRegex = /<#(\d+)>/g;
    const channelMatches = [...content.matchAll(channelMentionRegex)];
    for (const match of channelMatches) {
        const channelId = match[1];
        const channel = await getDiscordChannel(channelId);
        const channelName = channel?.name || "unknown-channel";
        resolved = resolved.replace(match[0], `#${channelName}`);
    }

    // Resolve role mentions: <@&roleId>
    const roleMentionRegex = /<@&(\d+)>/g;
    const roleMatches = [...content.matchAll(roleMentionRegex)];
    if (roleMatches.length > 0) {
        const roles = await getGuildRoles(COMMIT_OVERFLOW_GUILD_ID);
        const roleMap = new Map(roles.map((r) => [r.id, r.name]));
        for (const match of roleMatches) {
            const roleId = match[1];
            const roleName = roleMap.get(roleId) || "unknown-role";
            resolved = resolved.replace(match[0], `@${roleName}`);
        }
    }

    return resolved;
}
