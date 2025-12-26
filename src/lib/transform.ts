import { visit } from "unist-util-visit";
import type { Node } from "unist";
import type { Parent, Text, Element, RootContent } from "hast";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
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

export function remarkAutolink(this: any) {
    const data = this.data();

    // 1. Add the syntax extension to the parser (micromark)
    add("micromarkExtensions", gfmAutolinkLiteral());

    // 2. Add the tree extension to the AST builder (mdast)
    add("fromMarkdownExtensions", gfmAutolinkLiteralFromMarkdown());

    function add(field: string, value: any) {
        const list = data[field] ? data[field] : (data[field] = []);
        list.push(value);
    }
}

const ENTITY_PREFIX_MAP: Record<string, "user" | "channel" | "role"> = {
    "@": "user",
    "@!": "user",
    "#": "channel",
    "@&": "role",
};
/** Converts Discord syntax to HTML elements */
export function rehypeDiscord() {
    return async (tree: Node) => {
        const promises: Promise<unknown>[] = [];
        visit(tree, "text", (node: Text, index: number, parent: Parent) => {
            const origText = node.value;
            // Find all Discord mentions
            const entityMatches = origText
                .matchAll(/<(@!?|#|@&)(\d+)>/g)
                .map((match) => ({ match, type: "entity" }));
            const emojiMatches = origText
                .matchAll(/<(a?):(\w+):(\d+)>/g)
                .map((match) => ({ match, type: "emoji" }));
            const timestampMatches = origText
                .matchAll(/<t:(\d+)(?::[tTdDfFR])?>/g)
                .map((match) => ({ match, type: "timestamp" }));
            const allMatches = [...entityMatches, ...emojiMatches, ...timestampMatches];
            if (allMatches.length === 0) return;
            allMatches.sort((a, b) => a.match.index - b.match.index);

            let lastMatchEnd = 0;
            const components: RootContent[] = [];
            for (const { match, type } of allMatches) {
                // Keep text between last match and this one
                if (match.index > lastMatchEnd) {
                    components.push({
                        type: "text",
                        value: origText.slice(lastMatchEnd, match.index),
                    } satisfies Text);
                }

                // Turn match into mention type
                let mention: Mention;
                if (type === "entity") {
                    mention = { type: ENTITY_PREFIX_MAP[match[1]], id: match[2]! };
                } else if (type === "emoji") {
                    mention = {
                        type: "emoji",
                        animated: match[1] === "a",
                        name: match[2]!,
                        id: match[3]!,
                    };
                } else if (type === "timestamp") {
                    mention = { type: "timestamp", epochSeconds: parseInt(match[1]!) };
                } else {
                    throw new Error(`Unexpected match type: ${type}`);
                }

                // Create a new element
                const element = {
                    type: "element",
                } as Element;
                // Add the element to the list
                components.push(element);
                // Asynchronously populate the element
                promises.push(hydrateMention(element, mention));

                lastMatchEnd = match.index + match[0].length;
            }
            // Keep text after last match
            if (lastMatchEnd < origText.length) {
                components.push({
                    type: "text",
                    value: origText.slice(lastMatchEnd),
                } satisfies Text);
            }
            parent.children.splice(index, 1, ...components);
        });
        await Promise.all(promises);
    };
}

type Mention =
    | { type: "user" | "role" | "channel"; id: string }
    | { type: "emoji"; animated: boolean; name: string; id: string }
    | { type: "timestamp"; epochSeconds: number };

/**
 * Fetches the data needed and populates the given hast element with the
 * rendered mention.
 */
async function hydrateMention(element: Element, mention: Mention) {
    if (mention.type === "user") {
        const user = await getDiscordUser(mention.id);
        const name = user?.global_name ?? user?.username ?? "user";
        element.tagName = "span";
        element.properties = {
            className: ["mention", "mention-user"],
        };
        element.children = [{ type: "text", value: `@${name}` }];
    } else if (mention.type === "channel") {
        const channel = await getDiscordChannel(mention.id);
        const name = channel?.name ?? "channel";
        element.tagName = "span";
        element.properties = {
            className: ["mention", "mention-channel"],
        };
        element.children = [{ type: "text", value: `#${name}` }];
    } else if (mention.type === "role") {
        const role = await getRole(mention.id);
        const name = role?.name || "role";
        const color = role?.color ? `#${role.color.toString(16).padStart(6, "0")}` : null;
        const style =
            color && color !== "#000000" ? `color: ${color}; background: ${color}20;` : "";
        element.tagName = "span";
        element.properties = {
            className: ["mention", "mention-role"],
            style,
        };
        element.children = [{ type: "text", value: `@${name}` }];
    } else if (mention.type === "emoji") {
        const extension = mention.animated ? "gif" : "png";
        element.tagName = "img";
        element.properties = {
            src: `https://cdn.discordapp.com/emojis/${mention.id}.${extension}`,
            alt: `:${mention.name}:`,
            className: ["discord-emoji"],
        };
    } else if (mention.type === "timestamp") {
        const date = new Date(mention.epochSeconds * 1000);
        element.tagName = "time";
        element.children = [{ type: "text", value: date.toLocaleString() }];
    }
}

// Check with me (Kian) before updating these; I fixed some issues in the
// previous ones and want to make sure they don't get re-introduced.
const COMMIT_PATTERN =
    /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)\/commit\/(?<sha>[a-f0-9]+)$/i;
const DIFF_PATTERN =
    /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)\/compare\/(?<from>.+)(?<dots>\.\.\.?)(?<to>.+)$/i;
const ISSUE_PULL_PATTERN =
    /^https?:\/\/(?<domain>[^/]+)\/(?<user>[^/]+)\/(?<repo>[^/]+)\/(?:pull|issues)\/(?<num>\d+)$/i;
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
