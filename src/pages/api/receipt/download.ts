import type { APIRoute } from "astro";
import satori from "satori";
import sharp from "sharp";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateSummaryReceipt, generateCommitsReceipt } from "../../../lib/receipt";

let fontCache: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
    if (fontCache) return fontCache;
    const fontPath = fileURLToPath(new URL("../../../assets/fonts/FiraCode-Regular.ttf", import.meta.url));
    const buffer = await readFile(fontPath);
    fontCache = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    return fontCache;
}

function createReceiptElement(receiptText: string, scale: number): React.ReactNode {
    const lines = receiptText.split("\n");

    return {
        type: "div",
        props: {
            style: {
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                padding: 48 * scale,
                backgroundColor: "#0d0d0d",
                width: "100%",
                height: "100%",
            },
            children: {
                type: "div",
                props: {
                    style: {
                        display: "flex",
                        flexDirection: "column",
                        fontFamily: "Fira Code",
                        fontSize: 14 * scale,
                        lineHeight: 1.4,
                        color: "#e0e0e0",
                        backgroundColor: "#0d0d0d",
                        padding: 32 * scale,
                        borderRadius: 8 * scale,
                        border: `${scale}px solid #333`,
                    },
                    children: lines.map((line, i) => ({
                        type: "div",
                        key: String(i),
                        props: {
                            style: {
                                display: "flex",
                                whiteSpace: "pre",
                            },
                            children: line || " ",
                        },
                    })),
                },
            },
        },
    };
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
            loadFont(),
        ]);

        const lines = receiptText.split("\n");
        const scale = 3;
        const width = 700;
        const height = Math.max(400, lines.length * 20 + 160);

        const svg = await satori(createReceiptElement(receiptText, scale), {
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

        return new Response(pngBuffer, {
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
