import type { APIRoute } from "astro";
import {
    getCommitsReceiptData,
    buildCommitLine,
} from "../../../lib/receipt";
import { getDiscordMessage } from "../../../lib/discord";
import { summarizeCommitMessage } from "../../../lib/groq";

interface MessageData {
    content: string;
    attachments: { url: string; content_type?: string }[];
}

export const GET: APIRoute = async ({ url }) => {
    const userId = url.searchParams.get("userId");

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

            const messageDataMap = new Map<number, MessageData>();
            await Promise.all(
                receiptData.commits.map(async (commit) => {
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

            const pending = receiptData.commits.map(async (commit) => {
                const msgData = messageDataMap.get(commit.id);
                let summary: string | null = null;

                if (msgData && (msgData.content || msgData.attachments.length > 0)) {
                    const dayCommitIds = receiptData.commitsByDay.get(commit.day) ?? [];
                    const contextMessages = dayCommitIds
                        .filter((id) => id !== commit.id)
                        .map((id) => messageDataMap.get(id))
                        .filter((m): m is MessageData => !!m && (!!m.content || m.attachments.length > 0))
                        .map((m) => {
                            if (m.content) return m.content.slice(0, 100);
                            return `[${m.attachments.length} attachment(s)]`;
                        });

                    summary = await summarizeCommitMessage(
                        msgData.content,
                        msgData.attachments,
                        contextMessages,
                    );
                }

                return {
                    commitId: commit.id,
                    time: commit.time,
                    summary,
                    line: buildCommitLine(commit.time, summary),
                };
            });

            for (const promise of pending) {
                try {
                    const result = await promise;
                    await new Promise((r) => setTimeout(r, 30));
                    controller.enqueue(
                        encoder.encode(
                            `data: ${JSON.stringify({ type: "summary", ...result })}\n\n`,
                        ),
                    );
                } catch {
                }
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
