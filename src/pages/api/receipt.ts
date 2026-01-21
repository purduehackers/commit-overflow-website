import type { APIRoute } from "astro";
import { generateSummaryReceipt, generateCommitsReceipt } from "../../lib/receipt";
import { queryD1 } from "../../lib/d1";

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
    const type = url.searchParams.get("type") || "summary";
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

    try {
        const receipt = type === "commits"
            ? await generateCommitsReceipt(userId)
            : await generateSummaryReceipt(userId);

        return new Response(JSON.stringify({ receipt }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
        });
    } catch (error) {
        console.error("Receipt generation error:", error);
        return new Response(JSON.stringify({ error: "Failed to generate receipt" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
