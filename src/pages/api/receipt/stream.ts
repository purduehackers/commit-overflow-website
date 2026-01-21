import type { APIRoute } from "astro";
import {
    getCommitsReceiptData,
    buildCommitLine,
} from "../../../lib/receipt";
import { getDiscordMessage } from "../../../lib/discord";
import { summarizeCommitMessage } from "../../../lib/groq";
import { queryD1 } from "../../../lib/d1";
import { cacheGet, cacheSet, TTL } from "../../../lib/redis";

interface DaySummaryCache {
    summaries: Map<number, string | null>;
}

interface CommitSummaryResult {
    commitId: number;
    time: string;
    summary: string | null;
    line: string;
}

async function resolveUserId(userId: string | null, username: string | null): Promise<string | null> {
    if (userId) return userId;
    if (!username) return null;

    if (import.meta.env.DEV) {
        const users = await queryD1<{ id: string }>(
            "SELECT id FROM users WHERE discord_username = ? LIMIT 1",
            [username],
        );
        return users[0]?.id ?? null;
    }

    return null;
}

export const GET: APIRoute = async ({ url }) => {
    const userId = await resolveUserId(
        url.searchParams.get("userId"),
        url.searchParams.get("user"),
    );

    if (!userId) {
        return new Response(JSON.stringify({ error: "Missing userId parameter" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
        });
    }

    const receiptData = await getCommitsReceiptData(userId);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
        async start(controller) {
            controller.enqueue(
                encoder.encode(
                    `data: ${JSON.stringify({ type: "init", receipt: receiptData.baseReceipt })}\n\n`,
                ),
            );

            if (receiptData.commits.length === 0 || !receiptData.threadId) {
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
                controller.close();
                return;
            }

            const commitsByDay = new Map<string, typeof receiptData.commits>();
            for (const commit of receiptData.commits) {
                const dayCommits = commitsByDay.get(commit.day) ?? [];
                dayCommits.push(commit);
                commitsByDay.set(commit.day, dayCommits);
            }

            const sortedDays = [...commitsByDay.keys()].sort((a, b) => b.localeCompare(a));

            for (const day of sortedDays) {
                const dayCommits = commitsByDay.get(day) ?? [];
                const cacheKey = `receipt:day:${userId}:${day}`;

                controller.enqueue(
                    encoder.encode(
                        `data: ${JSON.stringify({ type: "day_start", day })}\n\n`,
                    ),
                );

                const cached = await cacheGet<Record<number, string | null>>(cacheKey);
                const commitsNeedingRetry: typeof dayCommits = [];

                if (cached) {
                    for (const commit of dayCommits) {
                        const summary = cached[commit.id];
                        if (summary === null || summary === undefined) {
                            commitsNeedingRetry.push(commit);
                        } else {
                            const result: CommitSummaryResult = {
                                commitId: commit.id,
                                time: commit.time,
                                summary,
                                line: buildCommitLine(commit.time, summary),
                            };
                            controller.enqueue(
                                encoder.encode(
                                    `data: ${JSON.stringify({ type: "summary", day, ...result })}\n\n`,
                                ),
                            );
                        }
                    }

                    if (commitsNeedingRetry.length === 0) {
                        controller.enqueue(
                            encoder.encode(
                                `data: ${JSON.stringify({ type: "day_done", day })}\n\n`,
                            ),
                        );
                        continue;
                    }
                }

                const commitsToProcess = cached ? commitsNeedingRetry : dayCommits;

                const messageDataMap = new Map<number, { content: string; attachments: { url: string; content_type?: string }[] }>();
                await Promise.all(
                    commitsToProcess.map(async (commit) => {
                        const message = await getDiscordMessage(
                            receiptData.threadId,
                            commit.messageId,
                        );
                        if (message) {
                            const isForwarded = message.message_reference?.type === 1;
                            const forwardedMessage = isForwarded
                                ? message.message_snapshots?.[0]?.message
                                : null;

                            messageDataMap.set(commit.id, {
                                content: forwardedMessage?.content || message.content || "",
                                attachments: forwardedMessage?.attachments || message.attachments || [],
                            });
                        }
                    }),
                );

                const daySummaries: Record<number, string | null> = cached ? { ...cached } : {};
                const completedSummaries: string[] = [];

                for (const commit of commitsToProcess) {
                    const msgData = messageDataMap.get(commit.id);
                    let summary: string | null = null;

                    if (msgData && (msgData.content || msgData.attachments.length > 0)) {
                        const contextMessages = dayCommits
                            .filter((c) => c.id !== commit.id)
                            .map((c) => {
                                const existingSummary = daySummaries[c.id];
                                if (existingSummary) return existingSummary;
                                const m = messageDataMap.get(c.id);
                                if (!m) return null;
                                if (m.content) return m.content.slice(0, 100);
                                return `[${m.attachments.length} attachment(s)]`;
                            })
                            .filter((m): m is string => m !== null);

                        summary = await summarizeCommitMessage(
                            msgData.content,
                            msgData.attachments,
                            contextMessages,
                        );
                    }

                    daySummaries[commit.id] = summary;
                    if (summary) completedSummaries.push(summary);

                    const result: CommitSummaryResult = {
                        commitId: commit.id,
                        time: commit.time,
                        summary,
                        line: buildCommitLine(commit.time, summary),
                    };
                    controller.enqueue(
                        encoder.encode(
                            `data: ${JSON.stringify({ type: "summary", day, ...result })}\n\n`,
                        ),
                    );
                }

                controller.enqueue(
                    encoder.encode(
                        `data: ${JSON.stringify({ type: "day_done", day })}\n\n`,
                    ),
                );

                await cacheSet(cacheKey, daySummaries, TTL.COMMIT_SUMMARY);
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
            controller.close();
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        },
    });
};
