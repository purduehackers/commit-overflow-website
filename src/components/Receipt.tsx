import { useState, useEffect, useCallback, useRef } from "react";

type ReceiptType = "summary" | "commits";

interface ReceiptProps {
    discordUserId: string;
}

const getTabFromUrl = (): ReceiptType => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get("tab");
    return tab === "commits" ? "commits" : "summary";
};

const updateTabParam = (tab: ReceiptType) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState({}, "", url.toString());
};

const SPINNER_FRAMES = ["|", "/", "-", "\\"];

function useSpinner(active: boolean): string {
    const [frame, setFrame] = useState(0);

    useEffect(() => {
        if (!active) return;
        const interval = setInterval(() => {
            setFrame((f) => (f + 1) % SPINNER_FRAMES.length);
        }, 100);
        return () => clearInterval(interval);
    }, [active]);

    return active ? SPINNER_FRAMES[frame] : "";
}

function addSpinnerToDay(receipt: string, day: string, spinner: string): string {
    const dayPattern = new RegExp(
        `(║ ${day} \\(\\d+ commits?\\))( +)(║)`,
    );
    return receipt.replace(dayPattern, (_match, prefix, spaces, suffix) => {
        const spinnerWithBrackets = `[${spinner}] `;
        const newSpaces = spaces.slice(0, -spinnerWithBrackets.length);
        if (newSpaces.length < 1) return _match;
        return `${prefix}${newSpaces}${spinnerWithBrackets}${suffix}`;
    });
}

export function Receipt({ discordUserId }: ReceiptProps) {
    const [receiptType, setReceiptType] = useState<ReceiptType>("summary");

    useEffect(() => {
        const urlTab = getTabFromUrl();
        if (urlTab !== receiptType) {
            setReceiptType(urlTab);
        }
    }, []);

    useEffect(() => {
        updateTabParam(receiptType);
    }, [receiptType]);

    const [receiptData, setReceiptData] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [streaming, setStreaming] = useState(false);
    const [downloading, setDownloading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadingDays, setLoadingDays] = useState<Set<string>>(new Set());
    const abortControllerRef = useRef<AbortController | null>(null);
    const baseReceiptRef = useRef<string>("");

    const spinner = useSpinner(loadingDays.size > 0);

    const fetchReceipt = useCallback(async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        setLoading(true);
        setStreaming(false);
        setError(null);
        setLoadingDays(new Set());

        if (receiptType === "commits") {
            abortControllerRef.current = new AbortController();
            try {
                const response = await fetch(
                    `/api/receipt/stream?userId=${discordUserId}`,
                    { signal: abortControllerRef.current.signal },
                );

                if (!response.ok) {
                    throw new Error("Failed to fetch receipt");
                }

                const reader = response.body?.getReader();
                if (!reader) throw new Error("No reader available");

                const decoder = new TextDecoder();
                let buffer = "";
                let currentReceipt = "";
                const summaries = new Map<number, { time: string; line: string }>();
                const activeDays = new Set<string>();

                setLoading(false);
                setStreaming(true);

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n\n");
                    buffer = lines.pop() || "";

                    for (const line of lines) {
                        if (!line.startsWith("data: ")) continue;
                        const data = JSON.parse(line.slice(6));

                        if (data.type === "init") {
                            currentReceipt = data.receipt;
                            baseReceiptRef.current = currentReceipt;
                            setReceiptData(currentReceipt);
                        } else if (data.type === "day_start") {
                            activeDays.add(data.day);
                            setLoadingDays(new Set(activeDays));
                        } else if (data.type === "day_done") {
                            activeDays.delete(data.day);
                            setLoadingDays(new Set(activeDays));
                        } else if (data.type === "summary") {
                            summaries.set(data.commitId, {
                                time: data.time,
                                line: data.line,
                            });
                            let updated = baseReceiptRef.current;
                            for (const [, { time, line: newLine }] of summaries) {
                                const placeholder = `  ${time} - ...`;
                                const paddedPlaceholder = placeholder.padEnd(48);
                                const paddedLine = newLine.slice(2, -2);
                                updated = updated.replace(
                                    `║ ${paddedPlaceholder} ║`,
                                    `║ ${paddedLine} ║`,
                                );
                            }
                            baseReceiptRef.current = updated;
                            setReceiptData(updated);
                        } else if (data.type === "done") {
                            setStreaming(false);
                            setLoadingDays(new Set());
                        }
                    }
                }
            } catch (err) {
                if (err instanceof Error && err.name === "AbortError") return;
                setError(err instanceof Error ? err.message : "Failed to load receipt");
                setLoading(false);
                setStreaming(false);
                setLoadingDays(new Set());
            }
        } else {
            try {
                const response = await fetch(
                    `/api/receipt?type=${receiptType}&userId=${discordUserId}`,
                );

                if (!response.ok) {
                    throw new Error("Failed to fetch receipt");
                }

                const data = await response.json();
                setReceiptData(data.receipt);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to load receipt");
            } finally {
                setLoading(false);
            }
        }
    }, [receiptType, discordUserId]);

    useEffect(() => {
        fetchReceipt();
        return () => {
            if (abortControllerRef.current) {
                abortControllerRef.current.abort();
            }
        };
    }, [fetchReceipt]);

    const displayReceipt = useCallback(() => {
        if (!receiptData) return null;
        let display = receiptData;
        for (const day of loadingDays) {
            display = addSpinnerToDay(display, day, spinner);
        }
        return display;
    }, [receiptData, loadingDays, spinner]);

    const downloadReceipt = async () => {
        setDownloading(true);

        try {
            const response = await fetch(
                `/api/receipt/download?type=${receiptType}&userId=${discordUserId}`
            );

            if (!response.ok) {
                throw new Error("Failed to generate image");
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `commit-overflow-${receiptType}-receipt.png`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error("Download failed:", err);
            alert("Failed to generate image. Please try again.");
        } finally {
            setDownloading(false);
        }
    };

    const renderSkeleton = () => (
        <pre className="receipt skeleton">
            {`╔══════════════════════════════════════════════════╗
║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║
╠══════════════════════════════════════════════════╣
║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║
╠──────────────────────────────────────────────────╣
║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║
║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║
║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║
║░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░║
╚══════════════════════════════════════════════════╝`}
        </pre>
    );

    return (
        <section className="receipt-section">
            <div className="receipt-intro">
                <h2>YOUR COMMIT OVERFLOW RECEIPT</h2>
                <p className="receipt-message">
                    Commit Overflow 2025 has ended — but the building never stops.
                </p>
                <p className="receipt-message">
                    Keep shipping in <a href="https://discord.com/channels/772576325897945119/1052236377338683514" target="_blank" rel="noopener noreferrer" className="mention mention-channel">#🏁checkpoints</a> and <a href="https://discord.com/channels/772576325897945119/904896819165814794" target="_blank" rel="noopener noreferrer" className="mention mention-channel">#🚢ship</a>!
                </p>
            </div>

            <div className="receipt-viewer">
                <div className="receipt-toggle">
                    <button
                        className={`sort-btn ${receiptType === "summary" ? "active" : ""}`}
                        onClick={() => setReceiptType("summary")}
                    >
                        [Summary]
                    </button>
                    <button
                        className={`sort-btn ${receiptType === "commits" ? "active" : ""}`}
                        onClick={() => setReceiptType("commits")}
                    >
                        [Full Log]
                    </button>
                </div>

            {loading ? (
                renderSkeleton()
            ) : error ? (
                <div className="receipt-error">
                    <pre style={{ color: "var(--error, #ff6b6b)" }}>
                        Error: {error}{" "}
                        <button
                            onClick={fetchReceipt}
                            style={{
                                background: "none",
                                border: "none",
                                color: "inherit",
                                fontFamily: "inherit",
                                fontSize: "inherit",
                                cursor: "pointer",
                                textDecoration: "underline",
                            }}
                        >
                            [retry]
                        </button>
                    </pre>
                </div>
            ) : (
                <pre className="receipt">{displayReceipt()}</pre>
            )}
            </div>

            <div className="download-container">
                <button
                    className="download-btn"
                    onClick={downloadReceipt}
                    disabled={downloading || loading || streaming || !!error}
                >
                    {downloading ? "[Generating...]" : streaming ? "[Loading summaries...]" : "[Download as Image]"}
                </button>
            </div>
        </section>
    );
}
