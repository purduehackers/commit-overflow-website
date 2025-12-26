import useSWR from "swr";
import { useState, useEffect } from "react";
import { fetcher } from "../lib/fetcher";

interface StatsData {
    event: {
        currentDay: number;
        totalDays: number;
        daysRemaining: number;
    };
}

function progressBar(
    current: number,
    total: number,
    width: number = 70,
): { filled: string; empty: string } {
    const filledCount = Math.round((current / total) * width);
    return {
        filled: "█".repeat(filledCount),
        empty: "░".repeat(width - filledCount),
    };
}

export function Progress() {
    const { data, error, mutate } = useSWR<StatsData>("/api/stats", fetcher, {
        refreshInterval: 60000,
    });

    const [barWidth, setBarWidth] = useState(70);

    useEffect(() => {
        const handleResize = () => {
            setBarWidth(window.innerWidth <= 600 ? 30 : 70);
        };

        handleResize();
        window.addEventListener("resize", handleResize);
        return () => window.removeEventListener("resize", handleResize);
    }, []);

    if (error) {
        return (
            <section className="progress-section" aria-labelledby="progress-heading-error">
                <div
                    className="section-header"
                    style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
                >
                    <h2 id="progress-heading-error" style={{ font: "inherit", margin: 0 }}>
                        EVENT PROGRESS
                    </h2>
                    <span className="muted" style={{ color: "var(--error, #ff6b6b)" }}>
                        ERROR
                    </span>
                </div>
                <pre
                    className="progress-bar"
                    style={{ color: "var(--error, #ff6b6b)" }}
                    role="alert"
                >
                    ╳ Failed to load progress data.{" "}
                    <button
                        onClick={() => mutate()}
                        aria-label="Retry loading progress data"
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

    if (!data) {
        return (
            <section
                className="progress-section"
                aria-labelledby="progress-heading-loading"
                aria-busy="true"
            >
                <div
                    className="section-header"
                    style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
                >
                    <h2 id="progress-heading-loading" style={{ font: "inherit", margin: 0 }}>
                        EVENT PROGRESS
                    </h2>
                    <span className="muted skeleton">░░ days left</span>
                </div>
                <pre
                    className="progress-bar skeleton"
                    style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
                >
                    <span className="unselectable">{"░".repeat(barWidth)}</span>
                    <span>Day ░ of 20</span>
                </pre>
            </section>
        );
    }

    const totalDays = 20;
    const eventStart = new Date("2025-12-23T06:00:00-05:00");
    const now = new Date();
    const msPerDay = 1000 * 60 * 60 * 24;
    const currentDay = Math.max(
        1,
        Math.min(totalDays, Math.floor((now.getTime() - eventStart.getTime()) / msPerDay) + 1),
    );
    const daysRemaining = Math.max(0, totalDays - currentDay);

    return (
        <section className="progress-section" aria-labelledby="progress-heading">
            <div
                className="section-header"
                style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
            >
                <h2 id="progress-heading" style={{ font: "inherit", margin: 0 }}>
                    EVENT PROGRESS
                </h2>
                <span className="muted">{daysRemaining} days left</span>
            </div>
            <pre
                className="progress-bar"
                style={{ display: "flex", justifyContent: "space-between", width: "100%" }}
            >
                {(() => {
                    const bar = progressBar(currentDay, totalDays, barWidth);
                    return (
                        <span className="unselectable">
                            {bar.filled}
                            {bar.empty}
                        </span>
                    );
                })()}
                <span className="selectable">
                    Day {currentDay} of {totalDays}
                </span>
            </pre>
        </section>
    );
}
