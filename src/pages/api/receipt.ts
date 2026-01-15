import type { APIRoute } from "astro";
import { generateSummaryReceipt, generateCommitsReceipt } from "../../lib/receipt";

export const GET: APIRoute = async ({ url }) => {
    const type = url.searchParams.get("type") || "summary";
    const userId = url.searchParams.get("userId");

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
