import type { APIRoute } from "astro";
import { getDiscordUser, getAvatarUrl } from "../../../lib/discord";
import sharp from "sharp";

const PIXEL_SIZE = 4;
const DISCORD_ID_PATTERN = /^\d{17,19}$/;

function jsonError(message: string, status: number): Response {
    return new Response(JSON.stringify({ error: message }), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

export const GET: APIRoute = async ({ params, request }) => {
    const { id } = params;

    if (!id) {
        return jsonError("Missing user ID", 400);
    }

    if (!DISCORD_ID_PATTERN.test(id)) {
        return jsonError(
            "Invalid Discord user ID format. Expected 17-19 digit numeric string.",
            400,
        );
    }

    try {
        const user = await getDiscordUser(id);
        const avatarHash = user?.avatar ?? null;
        const avatarUrl = getAvatarUrl(id, avatarHash, 16);

        const etagSource = avatarHash ?? `default-${id}`;
        const etag = `"${etagSource}"`;

        const ifNoneMatch = request.headers.get("If-None-Match");
        if (ifNoneMatch === etag) {
            return new Response(null, {
                status: 304,
                headers: { ETag: etag },
            });
        }

        const avatarResponse = await fetch(avatarUrl);

        if (!avatarResponse.ok) {
            return jsonError("User avatar not found", 404);
        }

        const avatarBuffer = Buffer.from(await avatarResponse.arrayBuffer());

        const pixelatedBuffer = await sharp(avatarBuffer)
            .resize(PIXEL_SIZE, PIXEL_SIZE, { kernel: sharp.kernel.nearest })
            .png()
            .toBuffer();

        return new Response(new Uint8Array(pixelatedBuffer), {
            status: 200,
            headers: {
                "Content-Type": "image/png",
                "Cache-Control":
                    "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
                ETag: etag,
            },
        });
    } catch {
        return jsonError("Internal server error while processing avatar", 500);
    }
};
