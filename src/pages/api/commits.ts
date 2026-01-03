import type { APIRoute } from "astro";
import { queryD1 } from "../../lib/d1";
import { relativeTime } from "../../lib/dates";
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
import { getDiscordMessage } from "../../lib/discord";

const DEFAULT_PAGE_SIZE = 10;
const MAX_PAGE_SIZE = 50;

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
    thread_id: string;
}

interface UserRow {
    id: string;
    discord_username: string;
}

interface CommitItem {
    odId: string;
    username: string;
    avatarUrl: string;
    threadId: string;
    messageId: string;
    messageHtml: string;
    attachments: Array<{ url: string; type: string; filename: string }>;
    committedAt: string;
    relativeTime: string;
}

interface PaginatedCommitsResponse {
    commits: CommitItem[];
    pagination: {
        page: number;
        limit: number;
        hasMore: boolean;
        total: number;
    };
}

async function fetchPaginatedCommits(
    page: number,
    limit: number,
): Promise<PaginatedCommitsResponse> {
    const offset = (page - 1) * limit;

    const [feedCommits, totalResult, allProfiles, users] = await Promise.all([
        queryD1<CommitRow>(
            `SELECT user_id, committed_at, message_id, is_private, is_explicitly_private
             FROM commits
             WHERE approved_at IS NOT NULL AND is_private = 0 AND is_explicitly_private = 0
             ORDER BY committed_at DESC
             LIMIT ? OFFSET ?`,
            [limit + 1, offset], // Fetch one extra to check if there are more
        ),
        queryD1<{ count: number }>(
            `SELECT COUNT(*) as count FROM commits
             WHERE approved_at IS NOT NULL AND is_private = 0 AND is_explicitly_private = 0`,
        ),
        queryD1<ProfileRow>("SELECT user_id, thread_id FROM commit_overflow_profiles"),
        queryD1<UserRow>("SELECT id, discord_username FROM users"),
    ]);

    const hasMore = feedCommits.length > limit;
    const commitsToProcess = feedCommits.slice(0, limit);
    const total = totalResult[0]?.count ?? 0;

    const userMap = new Map(users.map((u) => [u.id, u.discord_username]));
    const profileMap = new Map(allProfiles.map((p) => [p.user_id, p.thread_id]));

    const commits = await Promise.all(
        commitsToProcess.map(async (commit) => {
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
            } satisfies CommitItem;
        }),
    );

    return {
        commits,
        pagination: {
            page,
            limit,
            hasMore,
            total,
        },
    };
}

export const GET: APIRoute = async ({ url }) => {
    try {
        const pageParam = url.searchParams.get("page");
        const limitParam = url.searchParams.get("limit");

        const page = Math.max(1, parseInt(pageParam || "1", 10) || 1);
        const limit = Math.min(
            MAX_PAGE_SIZE,
            Math.max(1, parseInt(limitParam || String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
        );

        const cacheKey = `commits:page:${page}:limit:${limit}`;
        const cacheTTL = 15;

        const result = await cached<PaginatedCommitsResponse>(
            cacheKey,
            () => fetchPaginatedCommits(page, limit),
            cacheTTL,
        );

        return new Response(JSON.stringify(result), {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Cache-Control": "public, max-age=10",
            },
        });
    } catch (error) {
        console.error(error);
        return new Response(JSON.stringify({ error: "Failed to fetch commits" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
