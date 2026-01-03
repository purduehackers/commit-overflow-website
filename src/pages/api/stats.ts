import type { APIRoute } from "astro";
import { queryD1 } from "../../lib/d1";
import { getCommitOverflowStats, getDiscordMessage } from "../../lib/discord";
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
import {
    rehypeDiscord,
    rehypeGitLinks,
    rehypeLinkAttributes,
    remarkAutolink,
    smartTruncate,
} from "../../lib/transform";
import type { SortKey } from "../../components/Leaderboard";

// Cache TTL for the full stats response (in seconds)
const STATS_CACHE_TTL = 15;

// Reuse a single unified processor instance for all markdown conversions
// This avoids the overhead of recreating the pipeline for each message
const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkAutolink)
    .use(remarkRehype)
    .use(rehypeSanitize)
    .use(rehypeDiscord)
    .use(rehypeGitLinks)
    .use(rehypeLinkAttributes)
    .use(rehypeStringify);

async function markdownToHtml(markdown: string): Promise<string> {
    const result = await markdownProcessor.process(markdown);
    return result.toString();
}

interface CommitRow {
    user_id: string;
    committed_at: string;
    message_id: string;
    is_private: number;
    is_explicitly_private: number;
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

interface LeaderboardRow {
    rank: number;
    odId: string;
    username: string;
    avatarUrl: string;
    totalCommits: number;
    totalDays: number;
    currentStreak: number;
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
    leaderboards: Record<SortKey, LeaderboardRow[]>;
    recentCommits: Array<{
        odId: string;
        username: string;
        avatarUrl: string;
        threadId: string;
        messageId: string;
        messageHtml: string;
        attachments: Array<{ url: string; type: string; filename: string }>;
        committedAt: string;
        relativeTime: string;
    }>;
    lastUpdated: string;
}

async function computeStats(): Promise<StatsResponse> {
    const [allCommits, allProfiles, users, discordStats] = await Promise.all([
        queryD1<CommitRow>(
            "SELECT user_id, committed_at, message_id, is_private, is_explicitly_private FROM commits WHERE approved_at IS NOT NULL ORDER BY committed_at DESC",
        ),
        queryD1<ProfileRow>(
            "SELECT user_id, timezone, thread_id, is_private FROM commit_overflow_profiles",
        ),
        queryD1<UserRow>("SELECT id, discord_username FROM users"),
        getCommitOverflowStats(),
    ]);

    const publicUserIds = new Set(
        allProfiles.filter((p) => p.is_private === 0).map((p) => p.user_id),
    );
    const leaderboardCommits = allCommits.filter((c) => publicUserIds.has(c.user_id));
    const feedCommits = allCommits.filter(
        (c) => c.is_private === 0 && c.is_explicitly_private === 0,
    );

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

    const toLeaderboardRow = (user: (typeof userStats)[number], index: number) => {
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
    };
    const leaderboards: StatsResponse["leaderboards"] = {
        commits: userStats
            .toSorted((a, b) => b.totalCommits - a.totalCommits)
            .slice(0, 10)
            .map(toLeaderboardRow),
        days: userStats
            .toSorted((a, b) => b.totalDays - a.totalDays)
            .slice(0, 10)
            .map(toLeaderboardRow),
        streak: userStats
            .toSorted((a, b) => b.currentStreak - a.currentStreak)
            .slice(0, 10)
            .map(toLeaderboardRow),
    };

    const today = getCommitDay(new Date().toISOString(), DEFAULT_TIMEZONE);
    const commitsToday = commitsByDay[today] || 0;

    const profileMap = new Map(allProfiles.map((p) => [p.user_id, p.thread_id]));

    const recentCommits = await Promise.all(
        feedCommits.slice(0, 10).map(async (commit: CommitRow) => {
            const username = userMap.get(commit.user_id) || "Unknown";
            const avatarUrl = `/api/avatar/${commit.user_id}.png`;
            const threadId = profileMap.get(commit.user_id) || "";
            const message = threadId ? await getDiscordMessage(threadId, commit.message_id) : null;

            const isForwarded = message?.message_reference?.type === 1;
            const forwardedMessage = isForwarded ? message?.message_snapshots?.[0]?.message : null;

            const rawMessageText = forwardedMessage?.content || message?.content || "";
            const truncatedText = smartTruncate(rawMessageText, 50);
            const messageHtml = await markdownToHtml(truncatedText);

            const rawAttachments = forwardedMessage?.attachments || message?.attachments || [];
            const attachments = rawAttachments.map((a) => ({
                url: a.url,
                type: a.content_type || "",
                filename: a.filename,
            }));
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
        leaderboards,
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
    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: "Failed to fetch stats" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
