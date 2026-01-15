import { betterAuth } from "better-auth";
import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from "astro:env/server";
import { d1Adapter } from "./d1-adapter";

export const auth = betterAuth({
    database: d1Adapter(),
    socialProviders: {
        discord: {
            clientId: DISCORD_CLIENT_ID,
            clientSecret: DISCORD_CLIENT_SECRET,
        },
    },
    user: {
        modelName: "ba_user",
    },
    session: {
        modelName: "ba_session",
        expiresIn: 60 * 60 * 24 * 7,
        updateAge: 60 * 60 * 24,
        cookieCache: {
            enabled: true,
            maxAge: 5 * 60,
        },
    },
    account: {
        modelName: "ba_account",
    },
    verification: {
        modelName: "ba_verification",
    },
});
