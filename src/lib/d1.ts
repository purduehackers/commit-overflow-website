import { D1_ACCOUNT_ID, D1_API_TOKEN, D1_DATABASE_ID } from "astro:env/server";

const D1_API_URL = `https://api.cloudflare.com/client/v4/accounts/${D1_ACCOUNT_ID}/d1/database/${D1_DATABASE_ID}/query`;
const FETCH_TIMEOUT_MS = 10000;

interface D1Result<T> {
    success: boolean;
    errors: Array<{ message: string }>;
    result: Array<{
        results: T[];
        success: boolean;
    }>;
}

export async function queryD1<T = Record<string, unknown>>(
    sql: string,
    params: unknown[] = [],
): Promise<T[]> {
    const response = await fetch(D1_API_URL, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${D1_API_TOKEN}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ sql, params }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
        throw new Error(`D1 API error: ${response.status} ${response.statusText}`);
    }

    const data: D1Result<T> = await response.json();

    if (!data.success) {
        throw new Error(`D1 query failed: ${data.errors.map((e) => e.message).join(", ")}`);
    }

    return data.result[0]?.results ?? [];
}
