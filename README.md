# Commit Overflow

> **21 Days of Code.** Purdue Hackers' annual winter break coding challenge.

![Commit Overflow Screenshot](TODO: Add screenshot)

This repository contains the source code for the Commit Overflow 2025-2026 website. It tracks participants' daily git commits, visualizing their progress and maintaining a live leaderboard during the event (Dec 22, 2025 - Jan 12, 2026).

## Tech Stack

Built with the [T3 Stack](https://create.t3.gg/) philosophy in mind, but adapted for the edge.

- **Framework:** [Astro 5](https://astro.build/) (SSR)
- **UI:** React 19, Tailwind CSS
- **Database:** Cloudflare D1
- **Cache/KV:** Redis over TCP/TLS
- **Integrations:** Discord API
- **Deployment:** Vercel

## Local Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+) or [Bun](https://bun.sh/) (recommended)
- Git

### Environment Variables

Create a `.env` file in the root directory with the following keys (see `env.ts` for schema):

```bash
# Cloudflare D1 (Database)
D1_ACCOUNT_ID=
D1_DATABASE_ID=
D1_API_TOKEN=

# Discord API (Auth & Bot)
DISCORD_CLIENT_ID=
DISCORD_BOT_TOKEN=

# Redis (use rediss:// with the commit ACL user in production)
REDIS_URL=redis://localhost:6379
```

### Running Locally

```bash
# Install dependencies
bun install

# Start development server
bun dev
```

The site will be available at `http://localhost:4321`.

### Commands

| Command       | Description                          |
| :------------ | :----------------------------------- |
| `bun dev`     | Start local dev server               |
| `bun build`   | Type-check and build for production  |
| `bun preview` | Preview the production build locally |
| `bun lint`    | Run Oxlint for code analysis         |
| `bun format`  | Format code with Oxfmt               |

## Project Structure

```text
src/
├── components/   # UI components (React & Astro)
│   ├── CommitChart.tsx   # Activity visualization
│   ├── Leaderboard.tsx   # Ranking system
│   └── ...
├── lib/          # Backend logic & utilities
│   ├── d1.ts     # Database interactions
│   ├── redis.ts  # Caching layer
│   └── ...
├── pages/        # File-based routing
│   ├── api/      # Server-side API endpoints
│   └── index.astro
└── styles/       # Global Tailwind styles
```

## Deployment

This project is configured for deployment on **Vercel** with the Astro Vercel Adapter.
Pushes to `main` should trigger a production build.

## Links

- [Purdue Hackers](https://purduehackers.com)
- [Astro Documentation](https://docs.astro.build)

## Redis deployment

Set the server-only `REDIS_URL` in Vercel to
`rediss://commit:<password>@redis.server.purduehackers.com:6379`. The cache uses
a lazy native Redis connection with TLS certificate verification and ACL
authentication. The old `KV_REST_API_*` variables are no longer used.

Redis holds rebuildable Discord data and generated summaries. Starting empty
causes cache misses, including new summary-generation requests; copy the cache
with its remaining TTLs if avoiding that work matters. Existing keys and JSON
values remain compatible. D1 records and authentication are unchanged.

Pattern invalidation uses `SCAN` and deletes only matching keys.
