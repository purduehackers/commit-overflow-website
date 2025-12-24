import { useState, useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "../lib/fetcher";

interface StatsData {
    stats: {
        totalCommits: number;
        activeHackers: number;
        messagesSent: number;
        commitsToday: number;
    };
    lastUpdated: string;
}

function formatElapsedTime(seconds: number): string {
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
}

export function Stats() {
    const { data, error, mutate } = useSWR<StatsData>("/api/stats", fetcher, {
        refreshInterval: 30000,
    });

    const [secondsElapsed, setSecondsElapsed] = useState(0);

    if (error) {
        return (
            <section className="stats-section" aria-labelledby="stats-heading-error">
                <div
                    className="section-header"
                    style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
                >
                    <h2 id="stats-heading-error" style={{ font: "inherit", margin: 0 }}>
                        STATS
                    </h2>
                    <span className="muted" style={{ color: "var(--error, #ff6b6b)" }}>
                        ERROR
                    </span>
                </div>
                <pre style={{ color: "var(--error, #ff6b6b)" }} role="alert">
                    ╳ Failed to load stats.{" "}
                    <button
                        onClick={() => mutate()}
                        aria-label="Retry loading stats"
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
            </section>
        );
    }

    useEffect(() => {
        if (data) {
            setSecondsElapsed(0);
        }
    }, [data]);

    useEffect(() => {
        const interval = setInterval(() => {
            setSecondsElapsed((prev) => prev + 1);
        }, 1000);

        return () => clearInterval(interval);
    }, []);

    if (!data) {
        return (
            <section
                className="stats-section"
                aria-labelledby="stats-heading-loading"
                aria-busy="true"
            >
                <div
                    className="section-header"
                    style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
                >
                    <h2 id="stats-heading-loading" style={{ font: "inherit", margin: 0 }}>
                        STATS
                    </h2>
                    <span className="muted">updated ░s ago</span>
                </div>
                <dl className="stats-tickers skeleton">
                    <div className="ticker">
                        <dt className="ticker-label">Commits Today</dt>
                        <dd className="ticker-value">░░</dd>
                    </div>
                    <div className="ticker">
                        <dt className="ticker-label">Total Commits</dt>
                        <dd className="ticker-value">░░</dd>
                    </div>
                    <div className="ticker">
                        <dt className="ticker-label">Festive Hackers</dt>
                        <dd className="ticker-value">░░</dd>
                    </div>
                    <div className="ticker">
                        <dt className="ticker-label">Messages Sent</dt>
                        <dd className="ticker-value">░░░</dd>
                    </div>
                </dl>
            </section>
        );
    }

    const { totalCommits, activeHackers, messagesSent, commitsToday } = data.stats;

    return (
        <section className="stats-section" aria-labelledby="stats-heading">
            <div
                className="section-header"
                style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
            >
                <h2 id="stats-heading" style={{ font: "inherit", margin: 0 }}>
                    STATS
                </h2>
                <span className="muted">updated {formatElapsedTime(secondsElapsed)}</span>
            </div>
            <dl className="stats-tickers">
                <div className="ticker">
                    <dt className="ticker-label">Commits Today</dt>
                    <dd className="ticker-value">{commitsToday}</dd>
                </div>
                <div className="ticker">
                    <dt className="ticker-label">Total Commits</dt>
                    <dd className="ticker-value">{totalCommits}</dd>
                </div>
                <div className="ticker">
                    <dt className="ticker-label">Festive Hackers</dt>
                    <dd className="ticker-value">{activeHackers}</dd>
                </div>
                <div className="ticker">
                    <dt className="ticker-label">Messages Sent</dt>
                    <dd className="ticker-value">{messagesSent}</dd>
                </div>
            </dl>
        </section>
    );
}
