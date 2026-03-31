import { visit } from "unist-util-visit";
import type { Node } from "unist";
import type { Element } from "hast";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";
import {
    remarkDiscord,
    discordRemarkRehypeHandlers,
} from "@purduehackers/discord-markdown-utils";
import { getDiscordChannel, getDiscordUser, getRole } from "./discord";

const AWKWARD_END_WORDS = new Set([
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "was",
    "are",
    "were",
    "been",
    "be",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "could",
    "should",
    "may",
    "might",
    "must",
    "shall",
    "can",
    "need",
    "dare",
    "ought",
    "used",
    "this",
    "that",
    "these",
    "those",
    "i",
    "you",
    "he",
    "she",
    "it",
    "we",
    "they",
    "my",
    "your",
    "his",
    "her",
    "its",
    "our",
    "their",
    "what",
    "which",
    "who",
    "whom",
    "whose",
    "where",
    "when",
    "why",
    "how",
    "if",
    "then",
    "so",
    "than",
    "such",
    "both",
    "each",
    "few",
    "more",
    "most",
    "other",
    "some",
    "any",
    "no",
    "not",
    "only",
    "own",
    "same",
    "just",
    "also",
    "very",
    "even",
    "still",
]);

const resolver = {
    async user({ id }: { type: "user"; id: string }) {
        const user = await getDiscordUser(id);
        const name = user?.global_name ?? user?.username ?? null;
        return name ? `@${name}` : null;
    },
    async role({ id }: { type: "role"; id: string }) {
        const role = await getRole(id);
        if (!role) return null;
        const color =
            role.color && role.color !== 0
                ? `#${role.color.toString(16).padStart(6, "0")}`
                : undefined;
        return { name: `@${role.name}`, color };
    },
    async channel({ id }: { type: "channel"; id: string }) {
        const channel = await getDiscordChannel(id);
        return channel ? `#${channel.name}` : null;
    },
    async emoji({ animated, id }: { type: "emoji"; animated: boolean; name: string; id: string }) {
        const query = animated ? "?animated=true" : "";
        return `https://cdn.discordapp.com/emojis/${id}.webp${query}`;
    },
    async timestamp({ date }: { type: "timestamp"; date: Date }) {
        return date.toLocaleString();
    },
};

const markdownProcessor = unified()
    .use(remarkParse)
    .use(remarkDiscord, { resolver })
    .use(remarkRehype, { handlers: discordRemarkRehypeHandlers })
    .use(rehypeGitLinks)
    .use(rehypeLinkAttributes)
    .use(rehypeStringify);

export async function markdownToHtml(markdown: string): Promise<string> {
    const result = await markdownProcessor.process(markdown);
    return result.toString();
}

// Check with me (Kian) before updating these; I fixed some issues in the
// previous ones and want to make sure they don't get re-introduced.
const COMMIT_PATTERN =
    /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)\/commit\/(?<sha>[a-f0-9]+)$/i;
const DIFF_PATTERN =
    /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)\/compare\/(?<from>.+)(?<dots>\.\.\.?)(?<to>.+)$/i;
const ISSUE_PULL_PATTERN =
    /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)\/(?:pull|issues)\/(?<num>\d+)$/i;
const FILE_PATTERN =
    /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)\/(?:tree|blob)\/(?<rev>[^/]+)\/(?<path>.*)$/;
const REPO_PATTERN = /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)$/i;
export function rehypeGitLinks() {
    return (tree: Node) => {
        visit(tree, "element", (link: Element) => {
            // Skip non-link elements
            if (link.tagName !== "a") return;

            // Skip elements missing an href
            const href = link.properties.href;
            if (!href || typeof href !== "string") return;

            // Skip elements with content other than simple text
            if (link.children.length !== 1 || link.children[0].type !== "text") return;

            // Skip links with custom text
            const text = link.children[0].value;
            if (text != href) return;

            const repoName = (domain: string, user: string, repo: string) =>
                domain === "github.com" ? `${user}/${repo}` : `${domain}:${user}/${repo}`;
            let match;
            let newContent: [string, string][];
            if ((match = href.match(COMMIT_PATTERN))) {
                const { domain, user, repo, sha } = match.groups!;
                newContent = [
                    ["github-repo", repoName(domain, user, repo)],
                    ["github-sha", abbreviateRev(sha)],
                ];
            } else if ((match = href.match(DIFF_PATTERN))) {
                const { domain, user, repo, from, to, dots } = match.groups!;
                newContent = [
                    ["github-repo", repoName(domain, user, repo)],
                    ["github-sha", `${abbreviateRev(from)}${dots}${abbreviateRev(to)}`],
                ];
            } else if ((match = href.match(ISSUE_PULL_PATTERN))) {
                const { domain, user, repo, num } = match.groups!;
                newContent = [
                    ["github-repo", repoName(domain, user, repo)],
                    ["github-num", `#${num}`],
                ];
            } else if ((match = href.match(FILE_PATTERN))) {
                const { domain, user, repo, rev, path } = match.groups!;
                newContent = [
                    ["github-repo", repoName(domain, user, repo)],
                    ["github-file", `${path}`],
                    ["github-sha", abbreviateRev(rev)],
                ];
            } else if ((match = href.match(REPO_PATTERN))) {
                const { domain, user, repo } = match.groups!;
                newContent = [["github-repo", repoName(domain, user, repo)]];
            } else {
                // Don't affect non-Git links
                return;
            }

            link.properties.className = ["github-commit"];
            link.children = newContent.map(([clazz, text]) => ({
                type: "element",
                tagName: "span",
                properties: { className: [clazz] },
                children: [{ type: "text", value: text }],
            }));
        });
    };
}

/**
 * Plugin that adds target=_blank and rel="nofollow noopener noreferrer"
 * attributes to all <a> tags.
 */
export function rehypeLinkAttributes() {
    return (tree: Node) => {
        visit(tree, "element", (el: Element) => {
            if (el.tagName !== "a") return;
            el.properties.target = "_blank";
            el.properties.rel = ["nofollow", "noopener", "noreferrer"];
        });
    };
}

/**
 * Takes a Git revision (commit SHA, branch/tag, etc.)
 * @returns the abbreviated SHA if the input is a SHA, otherwise the unchanged input
 */
function abbreviateRev(rev: string): string {
    if (rev.match(/[0-9a-f]{40}/i)) {
        return rev.slice(0, 7);
    }
    return rev;
}

export function smartTruncate(text: string, maxWords: number = 50): string {
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    if (words.length <= maxWords) return text;

    const windowStart = Math.max(0, maxWords - 10);
    const windowEnd = Math.min(words.length, maxWords + 5);

    let bestEnd = -1;
    for (let i = windowStart; i < windowEnd; i++) {
        if (/[.!?]["')]?$/.test(words[i])) {
            bestEnd = i;
            if (i >= maxWords - 5) break;
        }
    }

    if (bestEnd === -1) {
        for (let i = maxWords; i > windowStart; i--) {
            const normalized = words[i - 1].toLowerCase().replace(/[^a-z]/g, "");
            if (!AWKWARD_END_WORDS.has(normalized)) {
                bestEnd = i - 1;
                break;
            }
        }
    }

    if (bestEnd === -1) bestEnd = maxWords - 1;

    return words.slice(0, bestEnd + 1).join(" ") + "...";
}
