import { envField } from "astro/config";

export const schema = {
    D1_ACCOUNT_ID: envField.string({ context: "server", access: "secret" }),
    D1_DATABASE_ID: envField.string({ context: "server", access: "secret" }),
    D1_API_TOKEN: envField.string({ context: "server", access: "secret" }),
    DISCORD_CLIENT_ID: envField.string({ context: "server", access: "secret" }),
    DISCORD_CLIENT_SECRET: envField.string({ context: "server", access: "secret" }),
    DISCORD_BOT_TOKEN: envField.string({ context: "server", access: "secret" }),
    KV_REST_API_URL: envField.string({ context: "server", access: "secret" }),
    KV_REST_API_TOKEN: envField.string({ context: "server", access: "secret" }),
    GROQ_API_KEY: envField.string({ context: "server", access: "secret" }),
};
