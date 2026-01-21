import type { APIRoute } from "astro";
import satori from "satori";
import sharp from "sharp";
import { generateSummaryReceipt, generateCommitsReceipt } from "../../../lib/receipt";
import { ReceiptImage } from "../../../lib/ReceiptImage";

let fontCache: ArrayBuffer | null = null;

async function loadFont(baseUrl: string): Promise<ArrayBuffer> {
    if (fontCache) return fontCache;
    const fontUrl = new URL("/fonts/FiraCode-Regular.ttf", baseUrl);
    const response = await fetch(fontUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch font: ${response.status}`);
    }
    fontCache = await response.arrayBuffer();
    return fontCache;
}

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
        const [receiptText, fontData] = await Promise.all([
            type === "commits"
                ? generateCommitsReceipt(userId)
                : generateSummaryReceipt(userId),
            loadFont(url.origin),
        ]);

        const lines = receiptText.split("\n");
        const scale = 3;
        const width = 700;
        const height = Math.max(400, lines.length * 20 + 160);

        const svg = await satori(ReceiptImage({ receiptText, scale }), {
            width: width * scale,
            height: height * scale,
            fonts: [
                {
                    name: "Fira Code",
                    data: fontData,
                    weight: 400,
                    style: "normal",
                },
            ],
        });

        const pngBuffer = await sharp(Buffer.from(svg))
            .png()
            .toBuffer();

        return new Response(new Uint8Array(pngBuffer), {
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
