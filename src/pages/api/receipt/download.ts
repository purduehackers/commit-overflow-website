import type { APIRoute } from "astro";
import { generateSummaryReceipt, generateCommitsReceipt } from "../../../lib/receipt";

const RAYSO_API = "https://rayso-c3754cd07bd3.herokuapp.com/api";

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
        const receiptText = type === "commits"
            ? await generateCommitsReceipt(userId)
            : await generateSummaryReceipt(userId);

        const raysoResponse = await fetch(RAYSO_API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                code: receiptText,
                title: `Commit Overflow 2025 - ${type === "commits" ? "Commit Log" : "Summary"}`,
                theme: "vercel",
                background: true,
                darkMode: true,
                padding: 64,
                language: "text",
            }),
        });

        if (!raysoResponse.ok) {
            throw new Error(`Ray.so API error: ${raysoResponse.status}`);
        }

        const imageBuffer = await raysoResponse.arrayBuffer();

        return new Response(imageBuffer, {
            status: 200,
            headers: {
                "Content-Type": "image/png",
                "Content-Disposition": `attachment; filename="commit-overflow-${type}-receipt.png"`,
                "Cache-Control": "no-cache",
            },
        });
    } catch (error) {
        console.error("Receipt download error:", error);
        return new Response(JSON.stringify({ error: "Failed to generate image" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
        });
    }
};
