import { GROQ_API_KEY, AI_GATEWAY_API_KEY } from "astro:env/server";
import { generateText } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { Result, TaggedError } from "better-result";
import { cacheGet, cacheSet, TTL } from "./redis";

const MAX_CONCURRENT = 3;
const BASE_DELAY_MS = 2000;
const REQUEST_DELAY_MS = 500;
const MAX_SUMMARY_LENGTH = 38;
const MAX_RETRIES = 5;

const groq = createGroq({
    apiKey: GROQ_API_KEY,
});

interface Attachment {
    url: string;
    content_type?: string;
}

interface SummaryInput {
    content: string;
    attachments: Attachment[];
    dayContext: string[];
}

class SummaryTooLongError extends TaggedError("SummaryTooLongError")<{
    summary: string;
    message: string;
}>() {
    constructor(summary: string) {
        super({ summary, message: `Summary exceeds ${MAX_SUMMARY_LENGTH} chars` });
    }
}

class EmptyResponseError extends TaggedError("EmptyResponseError")<{
    message: string;
}>() {}

class ApiError extends TaggedError("ApiError")<{
    status: number;
    message: string;
}>() {}

class NoInputError extends TaggedError("NoInputError")<{
    message: string;
}>() {}

let activeRequests = 0;
const queue: Array<{ resolve: () => void }> = [];

async function acquireSlot(): Promise<void> {
    if (activeRequests < MAX_CONCURRENT) {
        activeRequests++;
        return;
    }
    return new Promise((resolve) => queue.push({ resolve }));
}

function releaseSlot(): void {
    activeRequests--;
    const next = queue.shift();
    if (next) {
        activeRequests++;
        next.resolve();
    }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

const hash = (s: string): string => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
        h = (h << 5) - h + s.charCodeAt(i);
        h |= 0;
    }
    return h.toString(36);
};

const validateInput = (input: SummaryInput): Result<SummaryInput, NoInputError> => {
    const hasContent = input.content?.trim().length > 0;
    const hasAttachments = input.attachments.length > 0;
    if (!hasContent && !hasAttachments) {
        return Result.err(new NoInputError({ message: "No content or attachments" }));
    }
    return Result.ok(input);
};

const formatContext = (ctx: string[]): string =>
    ctx.length > 0 ? `<context>\n${ctx.map((c) => `- ${c}`).join("\n")}\n</context>\n\n` : "";

const formatMessage = (content: string): string =>
    content.trim() ? `<message>${content}</message>\n` : "";

const formatAttachments = (attachments: Attachment[]): string => {
    if (attachments.length === 0) return "";
    const types = attachments.map((a) => a.content_type?.split("/")[0] ?? "file");
    return `<attachments>${types.join(", ")}</attachments>\n`;
};

const buildPrompt = (input: SummaryInput): string =>
    formatContext(input.dayContext) +
    "<commit>\n" +
    formatMessage(input.content) +
    formatAttachments(input.attachments) +
    "</commit>";

const validateLength = (summary: string): Result<string, SummaryTooLongError> => {
    if (summary.length > MAX_SUMMARY_LENGTH) {
        return Result.err(new SummaryTooLongError(summary));
    }
    return Result.ok(summary);
};

const normalize = (s: string): string => s.toLowerCase();

const SYSTEM_PROMPT =
    "Summarize the commit in exactly 3-5 words. These are daily progress updates that may include code, designs, food, activities, or anything else. Describe what the person did or shared. Never mention 'screenshot', 'image', or 'attachment' - just describe the content directly. Examples: 'Fixed login bug', 'Made homemade pasta', 'Designed new logo', 'Went hiking today'. Output only the summary, no quotes or punctuation.";

const hasImageAttachment = (attachments: Attachment[]): boolean =>
    attachments.some((a) => a.content_type?.startsWith("image/"));

const fetchGroqCompletion = (prompt: string): Promise<Result<string, ApiError>> =>
    Result.tryPromise(
        async () => {
            await delay(REQUEST_DELAY_MS);

            const { text } = await generateText({
                model: groq("meta-llama/llama-4-scout-17b-16e-instruct"),
                system: SYSTEM_PROMPT,
                prompt,
                maxOutputTokens: 20,
                temperature: 0.3,
            });

            if (!text?.trim()) {
                throw new EmptyResponseError({ message: "Empty response from Groq" });
            }

            return text.trim();
        },
        { retry: { times: MAX_RETRIES, delayMs: BASE_DELAY_MS, backoff: "exponential" } },
    ).then((r) => r.mapError((e) => new ApiError({ status: 0, message: String(e) })));

const fetchVisionCompletion = (
    textContent: string,
    attachments: Attachment[],
    context: string[],
): Promise<Result<string, ApiError>> =>
    Result.tryPromise(
        async () => {
            await delay(REQUEST_DELAY_MS);

            const content: Array<
                | { type: "text"; text: string }
                | { type: "image"; image: string }
            > = [];

            const textPrompt = [
                context.length > 0 ? `Context from other commits today:\n${context.map((c) => `- ${c}`).join("\n")}\n` : "",
                textContent ? `Commit message: ${textContent}\n` : "",
                "Describe what this person did or shared based on the image(s) and message above.",
            ]
                .filter(Boolean)
                .join("\n");

            content.push({ type: "text", text: textPrompt });

            const imageAttachments = attachments
                .filter((a) => a.content_type?.startsWith("image/"))
                .slice(0, 4);

            for (const attachment of imageAttachments) {
                content.push({
                    type: "image",
                    image: attachment.url,
                });
            }

            const { text } = await generateText({
                model: "anthropic/claude-sonnet-4-20250514",
                system: SYSTEM_PROMPT,
                messages: [{ role: "user", content }],
                maxOutputTokens: 20,
                temperature: 0.3,
                headers: {
                    Authorization: `Bearer ${AI_GATEWAY_API_KEY}`,
                },
            });

            if (!text?.trim()) {
                throw new EmptyResponseError({ message: "Empty response from Claude" });
            }

            return text.trim();
        },
        { retry: { times: MAX_RETRIES, delayMs: BASE_DELAY_MS, backoff: "exponential" } },
    ).then((r) => r.mapError((e) => new ApiError({ status: 0, message: String(e) })));

const checkCache = async (key: string): Promise<Result<string, null>> => {
    const cached = await cacheGet<string>(key);
    if (cached && cached.length <= MAX_SUMMARY_LENGTH) {
        await delay(50);
        return Result.ok(cached);
    }
    return Result.err(null);
};

const generateSummaryWithGroq = (prompt: string) =>
    Result.gen(async function* () {
        const content = yield* Result.await(fetchGroqCompletion(prompt));
        const normalized = normalize(content);
        const validated = yield* validateLength(normalized);
        return Result.ok(validated);
    });

const generateSummaryWithVision = (
    textContent: string,
    attachments: Attachment[],
    context: string[],
) =>
    Result.gen(async function* () {
        const content = yield* Result.await(fetchVisionCompletion(textContent, attachments, context));
        const normalized = normalize(content);
        const validated = yield* validateLength(normalized);
        return Result.ok(validated);
    });

const summarizePipeline = (input: SummaryInput) =>
    Result.gen(async function* () {
        const validInput = yield* validateInput(input);
        const prompt = buildPrompt(validInput);
        const cacheKey = `groq:summary:${hash(prompt)}`;

        const cached = await checkCache(cacheKey);
        if (Result.isOk(cached)) {
            return Result.ok(cached.value);
        }

        await acquireSlot();
        try {
            const summary = hasImageAttachment(validInput.attachments)
                ? yield* Result.await(
                      generateSummaryWithVision(
                          validInput.content,
                          validInput.attachments,
                          validInput.dayContext,
                      ),
                  )
                : yield* Result.await(generateSummaryWithGroq(prompt));

            await cacheSet(cacheKey, summary, TTL.COMMIT_SUMMARY);
            return Result.ok(summary);
        } finally {
            releaseSlot();
        }
    });

export async function summarizeCommitMessage(
    content: string,
    attachments: Attachment[] = [],
    dayContext: string[] = [],
): Promise<string | null> {
    const result = await summarizePipeline({ content, attachments, dayContext });
    return Result.isOk(result) ? result.value : null;
}
