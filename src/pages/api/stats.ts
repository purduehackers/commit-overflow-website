import type { APIRoute } from "astro";
import { queryD1 } from "../../lib/d1";
import {
    getCommitOverflowStats,
    getDiscordMessage,
    getDiscordUser,
    getDiscordChannel,
    getRole,
} from "../../lib/discord";
import {
    getEventProgress,
    getCommitDay,
    calculateStreaks,
    relativeTime,
    getDateRange,
    EVENT_START,
    EVENT_END,
    DEFAULT_TIMEZONE,
} from "../../lib/dates";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";
import { cached } from "../../lib/redis";

// Cache TTL for the full stats response (in seconds)
const STATS_CACHE_TTL = 15;

// Reuse a single unified processor instance for all markdown conversions
// This avoids the overhead of recreating the pipeline for each message
const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeStringify);

function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

async function markdownToHtml(markdown: string): Promise<string> {
    const result = await markdownProcessor.process(markdown);
    return String(result);
}

function escapeDiscordSyntax(text: string): string {
    return text
        .replace(/<@!?(\d+)>/g, "%%MENTION_USER_$1%%")
        .replace(/<#(\d+)>/g, "%%MENTION_CHANNEL_$1%%")
        .replace(/<@&(\d+)>/g, "%%MENTION_ROLE_$1%%")
        .replace(/<a:(\w+):(\d+)>/g, "%%EMOJI_ANIMATED_$1_$2%%")
        .replace(/<:(\w+):(\d+)>/g, "%%EMOJI_STATIC_$1_$2%%")
        .replace(/<t:(\d+)(?::[tTdDfFR])?>/g, "%%TIMESTAMP_$1%%");
}

async function restoreDiscordSyntax(html: string): Promise<string> {
    let result = html;

    const userMatches = [...result.matchAll(/%%MENTION_USER_(\d+)%%/g)];
    const channelMatches = [...result.matchAll(/%%MENTION_CHANNEL_(\d+)%%/g)];
    const roleMatches = [...result.matchAll(/%%MENTION_ROLE_(\d+)%%/g)];

    const [userResults, channelResults, roleResults] = await Promise.all([
        Promise.all(userMatches.map((match) => getDiscordUser(match[1]))),
        Promise.all(channelMatches.map((match) => getDiscordChannel(match[1]))),
        Promise.all(roleMatches.map((match) => getRole(match[1]))),
    ]);

    userMatches.forEach((match, i) => {
        const user = userResults[i];
        const name = escapeHtml(user?.global_name || user?.username || "user");
        result = result.replace(match[0], `<span class="mention mention-user">@${name}</span>`);
    });

    channelMatches.forEach((match, i) => {
        const channel = channelResults[i];
        const name = escapeHtml(channel?.name || "channel");
        result = result.replace(match[0], `<span class="mention mention-channel">#${name}</span>`);
    });

    roleMatches.forEach((match, i) => {
        const role = roleResults[i];
        const name = escapeHtml(role?.name || "role");
        const color = role?.color ? `#${role.color.toString(16).padStart(6, "0")}` : null;
        const style =
            color && color !== "#000000" ? ` style="color: ${color}; background: ${color}20"` : "";
        result = result.replace(
            match[0],
            `<span class="mention mention-role"${style}>@${name}</span>`,
        );
    });

    result = result.replace(
        /%%EMOJI_ANIMATED_(\w+)_(\d+)%%/g,
        '<img src="https://cdn.discordapp.com/emojis/$2.gif" alt=":$1:" class="discord-emoji" />',
    );
    result = result.replace(
        /%%EMOJI_STATIC_(\w+)_(\d+)%%/g,
        '<img src="https://cdn.discordapp.com/emojis/$2.png" alt=":$1:" class="discord-emoji" />',
    );
    result = result.replace(/%%TIMESTAMP_(\d+)%%/g, (_, ts) => {
        const date = new Date(parseInt(ts) * 1000);
        return `<time>${date.toLocaleString()}</time>`;
    });

    return result;
}

function parseGitHubLinks(html: string): string {
    let parsed = html;

    parsed = parsed.replace(
        /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/commit\/([a-f0-9]+)/gi,
        (_, user, repo, sha) => {
            const safeUser = escapeHtml(user);
            const safeRepo = escapeHtml(repo);
            const safeSha = escapeHtml(sha);
            return `<a href="https://github.com/${safeUser}/${safeRepo}/commit/${safeSha}" target="_blank" rel="noopener noreferrer" class="github-commit"><span class="github-repo">${safeUser}/${safeRepo}</span><span class="github-sha">${safeSha}</span></a>`;
        },
    );

    parsed = parsed.replace(
        /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/gi,
        (_, user, repo, num) => {
            const safeUser = escapeHtml(user);
            const safeRepo = escapeHtml(repo);
            return `<a href="https://github.com/${safeUser}/${safeRepo}/pull/${num}" target="_blank" rel="noopener noreferrer" class="github-commit"><span class="github-repo">${safeUser}/${safeRepo}</span><span class="github-num">#${num}</span></a>`;
        },
    );

    parsed = parsed.replace(
        /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)/gi,
        (_, user, repo, num) => {
            const safeUser = escapeHtml(user);
            const safeRepo = escapeHtml(repo);
            return `<a href="https://github.com/${safeUser}/${safeRepo}/issues/${num}" target="_blank" rel="noopener noreferrer" class="github-commit"><span class="github-repo">${safeUser}/${safeRepo}</span><span class="github-num">#${num}</span></a>`;
        },
    );

    parsed = parsed.replace(
        /https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)(?=[\s)\],.!?]|$)/gi,
        (_, user, repo) => {
            const safeUser = escapeHtml(user);
            const safeRepo = escapeHtml(repo);
            return `<a href="https://github.com/${safeUser}/${safeRepo}" target="_blank" rel="noopener noreferrer" class="github-commit"><span class="github-repo">${safeUser}/${safeRepo}</span></a>`;
        },
    );

    return parsed;
}

const AWKWARD_END_WORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "my",
    "your",
    "his",
    "her",
    "its",
    "our",
    "their",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "where",
    "when",
    "why",
    "how",
    "if",
    "then",
    "so",
    "than",
    "such",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "any",
    "no",
    "not",
    "only",
    "own",
    "same",
    "just",
    "also",
    "very",
    "even",
    "still",
]);

function smartTruncate(text: string, maxWords: number = 50): string {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= maxWords) return text;

    const windowStart = Math.max(0, maxWords - 10);
    const windowEnd = Math.min(words.length, maxWords + 5);

    let bestEnd = -1;
    for (let i = windowStart; i < windowEnd; i++) {
        if (/[.!?]$/.test(words[i]) || /[.!?]["')]$/.test(words[i])) {
            bestEnd = i;
            if (i >= maxWords - 5) break;
        }
    }

    if (bestEnd === -1) {
        for (let i = maxWords; i > windowStart; i--) {
            const normalized = words[i - 1].toLowerCase().replace(/[^a-z]/g, "");
            if (!AWKWARD_END_WORDS.has(normalized)) {
                bestEnd = i - 1;
                break;
            }
        }
    }

    if (bestEnd === -1) bestEnd = maxWords - 1;

    return words.slice(0, bestEnd + 1).join(" ") + "...";
}

interface CommitRow {
    user_id: string;
    committed_at: string;
    message_id: string;
    is_private: number;
}

interface ProfileRow {
    user_id: string;
    timezone: string;
    thread_id: string;
    is_private: number;
}

interface UserRow {
    id: string;
    discord_username: string;
}

interface StatsResponse {
    event: ReturnType<typeof getEventProgress>;
    stats: {
        totalCommits: number;
        activeHackers: number;
        messagesSent: number;
        commitsToday: number;
    };
    commitsByDay: Record<string, number>;
    leaderboard: Array<{
        rank: number;
        odId: string;
        username: string;
        avatarUrl: string;
        totalCommits: number;
        totalDays: number;
        currentStreak: number;
    }>;
    recentCommits: Array<{
        odId: string;
        username: string;
        avatarUrl: string;
        threadId: string;
        messageId: string;
        messageHtml: string;
        attachments: Array<{ url: string; type: string }>;
        committedAt: string;
        relativeTime: string;
    }>;
    lastUpdated: string;
}

async function computeStats(): Promise<StatsResponse> {
    const [allCommits, allProfiles, users, discordStats] = await Promise.all([
        queryD1<CommitRow>(
            "SELECT user_id, committed_at, message_id, is_private FROM commits WHERE approved_at IS NOT NULL ORDER BY committed_at DESC",
        ),
        queryD1<ProfileRow>(
            "SELECT user_id, timezone, thread_id, is_private FROM commit_overflow_profiles",
        ),
        queryD1<UserRow>("SELECT id, discord_username FROM users"),
        getCommitOverflowStats(),
    ]);

    const publicUserIds = new Set(allProfiles.filter((p) => p.is_private === 0).map((p) => p.user_id));
    const leaderboardCommits = allCommits.filter((c) => publicUserIds.has(c.user_id));
    const feedCommits = allCommits.filter((c) => c.is_private === 0);

    const userMap = new Map(users.map((u: UserRow) => [u.id, u.discord_username]));
    const timezoneMap = new Map(allProfiles.map((p: ProfileRow) => [p.user_id, p.timezone]));

    const eventProgress = getEventProgress();
    const allDates = getDateRange(EVENT_START, EVENT_END);

    const commitsByDay: Record<string, number> = {};
    allDates.forEach((date) => {
        commitsByDay[date] = 0;
    });

    for (const commit of allCommits) {
        const timezone = timezoneMap.get(commit.user_id) || DEFAULT_TIMEZONE;
        const commitDay = getCommitDay(commit.committed_at, timezone);

        if (commitsByDay[commitDay] !== undefined) {
            commitsByDay[commitDay]++;
        }
    }

    const userCommits = new Map<string, string[]>();

    for (const commit of leaderboardCommits) {
        if (!userCommits.has(commit.user_id)) {
            userCommits.set(commit.user_id, []);
        }
        userCommits.get(commit.user_id)!.push(commit.committed_at);
    }

    const userStats: Array<{
        odId: string;
        username: string;
        totalCommits: number;
        totalDays: number;
        currentStreak: number;
        longestStreak: number;
    }> = [];

    for (const [odId, timestamps] of userCommits) {
        const timezone = timezoneMap.get(odId) || DEFAULT_TIMEZONE;
        const { currentStreak, longestStreak, totalDays } = calculateStreaks(timestamps, timezone);

        const username = userMap.get(odId) || "Unknown";

        userStats.push({
            odId,
            username,
            totalCommits: timestamps.length,
            totalDays,
            currentStreak,
            longestStreak,
        });
    }

    userStats.sort((a, b) => b.totalCommits - a.totalCommits);

    const leaderboard = userStats.slice(0, 10).map((user, index) => {
        const avatarUrl = `/api/avatar/${user.odId}.png`;
        return {
            rank: index + 1,
            odId: user.odId,
            username: user.username,
            avatarUrl,
            totalCommits: user.totalCommits,
            totalDays: user.totalDays,
            currentStreak: user.currentStreak,
        };
    });

    const today = getCommitDay(new Date().toISOString(), DEFAULT_TIMEZONE);
    const commitsToday = commitsByDay[today] || 0;

    const profileMap = new Map(allProfiles.map((p) => [p.user_id, p.thread_id]));

    const recentCommits = await Promise.all(
        feedCommits.slice(0, 10).map(async (commit: CommitRow) => {
            const username = userMap.get(commit.user_id) || "Unknown";
            const avatarUrl = `/api/avatar/${commit.user_id}.png`;
            const threadId = profileMap.get(commit.user_id) || "";
            const message = threadId ? await getDiscordMessage(threadId, commit.message_id) : null;
            const rawMessageText = message?.content || "";
            const escaped = escapeDiscordSyntax(rawMessageText);
            const truncatedText = smartTruncate(escaped, 50);
            const sanitizedHtml = await markdownToHtml(truncatedText);
            const withDiscord = await restoreDiscordSyntax(sanitizedHtml);
            const messageHtml = parseGitHubLinks(withDiscord);
            const attachments =
                message?.attachments?.map((a) => ({
                    url: a.url,
                    type: a.content_type || "",
                })) || [];
            return {
                odId: commit.user_id,
                username,
                avatarUrl,
                threadId,
                messageId: commit.message_id,
                messageHtml,
                attachments,
                committedAt: commit.committed_at,
                relativeTime: relativeTime(commit.committed_at),
            };
        }),
    );

    return {
        event: eventProgress,
        stats: {
            totalCommits: allCommits.length,
            activeHackers: discordStats.activeHackers,
            messagesSent: discordStats.totalMessages,
            commitsToday,
        },
        commitsByDay,
        leaderboard,
        recentCommits,
        lastUpdated: new Date().toISOString(),
    };
}

export const GET: APIRoute = async () => {
    try {
        const stats = await cached<StatsResponse>("stats:response", computeStats, STATS_CACHE_TTL);

        return new Response(JSON.stringify(stats), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=10",
            },
        });
    } catch {
        return new Response(JSON.stringify({ error: "Failed to fetch stats" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
