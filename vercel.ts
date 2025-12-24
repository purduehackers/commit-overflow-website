import { routes, type VercelConfig } from "@vercel/config/v1";

export const config: VercelConfig = {
  framework: "astro",
  cleanUrls: true,
  trailingSlash: false,

  headers: [
    routes.cacheControl("/api/avatar/(.*)", {
      public: true,
      maxAge: "1day",
      sMaxAge: "7days",
      staleWhileRevalidate: "1day",
    }),
    routes.cacheControl("/_astro/(.*)", {
      public: true,
      maxAge: "1year",
      immutable: true,
    }),
    routes.cacheControl("/favicon.png", {
      public: true,
      maxAge: "1day",
    }),
    routes.cacheControl("/manifest.json", {
      public: true,
      maxAge: "1day",
    }),
    routes.header("/(.*)", [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
    ]),
  ],
};
