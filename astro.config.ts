import { defineConfig, fontProviders } from "astro/config";
import react from "@astrojs/react";
import tailwindcss from "@tailwindcss/vite";
import sitemap from "@astrojs/sitemap";
import vercel from "@astrojs/vercel";
import gabAstroCompress from "gab-astro-compress";
import { schema } from "./env";

export default defineConfig({
    site: "https://commit.purduehackers.com",
    trailingSlash: "never",
    output: "server",
  adapter: vercel(),
    integrations: [react(), sitemap(), gabAstroCompress()],
    prefetch: {
        prefetchAll: true,
        defaultStrategy: "load",
    },
    experimental: {
        fonts: [
            {
                provider: fontProviders.google(),
                name: "JetBrains Mono",
                cssVariable: "--font-jetbrains-mono",
            },
        ],
    },
    env: {
        schema,
        validateSecrets: true,
    },
    vite: {
        plugins: [tailwindcss()],
        build: {
            sourcemap: true,
        },
    },
});
