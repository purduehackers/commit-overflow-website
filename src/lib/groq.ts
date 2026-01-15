import { GROQ_API_KEY } from "astro:env/server";
import { cacheGet, cacheSet, TTL } from "./redis";

const GROQ_API = "https://api.groq.com/openai/v1/chat/completions";
const MAX_CONCURRENT = 3;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const REQUEST_DELAY_MS = 500;

interface ChatCompletionResponse {
    choices: { message: { content: string } }[];
}

interface Attachment {
    url: string;
    content_type?: string;
}

let activeRequests = 0;
const queue: Array<{
    resolve: (value: void) => void;
}> = [];

async function acquireSlot(): Promise<void> {
    if (activeRequests < MAX_CONCURRENT) {
        activeRequests++;
        return;
    }
    return new Promise((resolve) => {
        queue.push({ resolve });
    });
}

function releaseSlot(): void {
    activeRequests--;
    const next = queue.shift();
    if (next) {
        activeRequests++;
        next.resolve();
    }
}

function hashPrompt(prompt: string): string {
    let hash = 0;
    for (let i = 0; i < prompt.length; i++) {
        const char = prompt.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
    }
    return hash.toString(36);
}

async function fetchWithRetry(
    prompt: string,
    retries = MAX_RETRIES,
): Promise<string | null> {
    for (let attempt = 0; attempt < retries; attempt++) {
        await new Promise((r) => setTimeout(r, REQUEST_DELAY_MS));

        try {
            const response = await fetch(GROQ_API, {
                method: "POST",
                headers: {
                    Authorization: `Bearer ${GROQ_API_KEY}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "meta-llama/llama-4-scout-17b-16e-instruct",
                    messages: [
                        {
                            role: "system",
                            content:
                                "Summarize the commit in exactly 3-5 words. These are daily progress updates that may include code, designs, food, activities, or anything else. Describe what the person did or shared. Never mention 'screenshot', 'image', or 'attachment' - just describe the content directly. Examples: 'Fixed login bug', 'Made homemade pasta', 'Designed new logo', 'Went hiking today'. Output only the summary, no quotes or punctuation.",
                        },
                        { role: "user", content: prompt },
                    ],
                    max_tokens: 20,
                    temperature: 0.3,
                }),
            });

            if (response.status === 429 || response.status >= 500) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            if (!response.ok) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            const data: ChatCompletionResponse = await response.json();
            const result = data.choices[0]?.message?.content?.trim();

            if (!result) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }

            return result;
        } catch {
            if (attempt < retries - 1) {
                const delay = BASE_DELAY_MS * Math.pow(2, attempt);
                await new Promise((r) => setTimeout(r, delay));
                continue;
            }
            return null;
        }
    }
    return null;
}

export async function summarizeCommitMessage(
    content: string,
    attachments: Attachment[] = [],
    dayContext: string[] = [],
): Promise<string | null> {
    const hasContent = content && content.trim().length > 0;
    const hasAttachments = attachments.length > 0;

    if (!hasContent && !hasAttachments) return null;

    let prompt = "";

    if (dayContext.length > 0) {
        prompt += `<context>\n${dayContext.map((c) => `- ${c}`).join("\n")}\n</context>\n\n`;
    }

    prompt += "<commit>\n";
    if (hasContent) {
        prompt += `<message>${content}</message>\n`;
    }
    if (hasAttachments) {
        const attachmentDescriptions = attachments.map((a) => {
            const type = a.content_type?.split("/")[0] ?? "file";
            return type;
        });
        prompt += `<attachments>${attachmentDescriptions.join(", ")}</attachments>\n`;
    }
    prompt += "</commit>";

    const cacheKey = `groq:summary:${hashPrompt(prompt)}`;
    const cached = await cacheGet<string>(cacheKey);
    if (cached) {
        await new Promise((r) => setTimeout(r, 50));
        return cached;
    }

    await acquireSlot();
    try {
        const result = await fetchWithRetry(prompt);
        if (result) {
            const lowercased = result.toLowerCase();
            await cacheSet(cacheKey, lowercased, TTL.COMMIT_SUMMARY);
            return lowercased;
        }
        return result;
    } finally {
        releaseSlot();
    }
}
