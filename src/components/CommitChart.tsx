import { useState, useEffect } from "react";
import useSWR from "swr";
import { fetcher } from "../lib/fetcher";

interface StatsData {
    commitsByDay: Record<string, number>;
    event: {
        startDate: string;
        endDate: string;
    };
}

const HEATMAP_CHARS = [" ", "░", "▒", "▓", "█"];
const MOBILE_DAYS = 8;

function getDateRange(startDate: string, endDate: string): string[] {
    const dates: string[] = [];
    const current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
        dates.push(current.toISOString().split("T")[0]);
        current.setDate(current.getDate() + 1);
    }

    return dates;
}

function formatDateLabel(dateStr: string): string {
    const date = new Date(dateStr + "T12:00:00");
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const day = date.getDate();
    return `${month} ${day}`;
}

function verticalBarChart(commitsByDay: Record<string, number>, days: string[], globalMax: number): string[] {
    const values = days.map((day) => commitsByDay[day] || 0);
    const height = Math.ceil(globalMax / 4);
    const max = globalMax;
    const lines: string[] = [];
    const barWidth = 4;
    const step = max / height;

    for (let row = height; row >= 1; row--) {
        const threshold = row * step;
        const yLabel = Math.round(threshold).toString().padStart(4);

        const bars = values
            .map((v) => {
                if (v >= threshold) return ' <span class="green">██</span> ';
                if (v >= threshold - step / 2) return ' <span class="green">▄▄</span> ';
                return "    ";
            })
            .join("");

        lines.push(`${yLabel} │${bars}│`);
    }

    lines.push("     └" + "─".repeat(days.length * barWidth) + "┘");

    const labels = days
        .map((day) => {
            const d = new Date(day + "T12:00:00").getDate().toString();
            return d.padStart(Math.floor((barWidth + d.length) / 2)).padEnd(barWidth);
        })
        .join("");
    lines.push("      " + labels);

    return lines;
}

function heatmapRow(commitsByDay: Record<string, number>, days: string[]): string {
    const values = days.map((day) => commitsByDay[day] || 0);
    const max = Math.max(...values, 1);

    return values
        .map((count) => {
            const level = count === 0 ? 0 : Math.ceil((count / max) * 4);
            return HEATMAP_CHARS[level];
        })
        .join("");
}

export function CommitChart() {
    const [isMobile, setIsMobile] = useState(false);
    const [mobileOffset, setMobileOffset] = useState(0);

    useEffect(() => {
        const checkMobile = () => setIsMobile(window.innerWidth <= 600);
        checkMobile();
        window.addEventListener("resize", checkMobile);
        return () => window.removeEventListener("resize", checkMobile);
    }, []);

    const { data, error, mutate } = useSWR<StatsData>("/api/stats", fetcher, {
        refreshInterval: 60000,
    });

    if (error) {
        return (
            <section className="chart-section">
                <h2>COMMIT ACTIVITY</h2>
                <pre style={{ color: "var(--error, #ff6b6b)" }}>
                    ╳ Failed to load chart data.{" "}
                    <button
                        onClick={() => mutate()}
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
        const skeletonBars = Array(10)
            .fill(0)
            .map(() => {
                const yLabel = "░░░░";
                const bars = "░░░░".repeat(22);
                return `${yLabel} │${bars}│`;
            })
            .join("\n");
        const skeletonLabels = "     └" + "─".repeat(88) + "┘\n      " + "░░  ".repeat(22);

        return (
            <section className="chart-section">
                <h2>COMMIT ACTIVITY</h2>
                <pre className="bar-chart skeleton">{skeletonBars + "\n" + skeletonLabels}</pre>
                <div className="heatmap-container">
                    <pre className="heatmap skeleton">
                        <span className="date-label">░░░ ░░</span> [
                        <span className="heatmap-chars">{"░░".repeat(22)}</span>]{" "}
                        <span className="date-label">░░░ ░░</span>
                    </pre>
                    <p className="heatmap-legend">
                        <span className="unselectable">░▒▓█</span> = commit density
                    </p>
                </div>
            </section>
        );
    }

    const { commitsByDay, event } = data;
    const days = getDateRange(event.startDate, event.endDate);
    const rawMax = Math.max(...Object.values(commitsByDay), 1);
    const globalMax = Math.ceil(rawMax / 20) * 20;
    
    const maxOffset = Math.max(0, days.length - MOBILE_DAYS);
    const displayDays = isMobile ? days.slice(mobileOffset, mobileOffset + MOBILE_DAYS) : days;
    
    const chart = verticalBarChart(commitsByDay, displayDays, globalMax);
    const heatmap = heatmapRow(commitsByDay, isMobile ? displayDays : days);

    const startLabel = formatDateLabel(isMobile ? displayDays[0] : event.startDate);
    const endLabel = formatDateLabel(isMobile ? displayDays[displayDays.length - 1] : event.endDate);

    const canGoBack = mobileOffset > 0;
    const nextPageDays = days.slice(mobileOffset + MOBILE_DAYS, mobileOffset + MOBILE_DAYS * 2);
    const hasCommitsOnNextPage = nextPageDays.some(day => (commitsByDay[day] || 0) > 0);
    const canGoForward = mobileOffset < maxOffset && hasCommitsOnNextPage;

    const chartLines = isMobile ? chart.slice(0, -1) : chart;
    
    const buildMobileLabelsRow = () => {
        if (!isMobile) return null;
        const originalLabels = chart[chart.length - 1];
        const match = originalLabels.match(/^(\s*)(.*)$/);
        const padding = match ? match[1] + '  ' : '';
        const labels = match ? match[2] : originalLabels;
        
        return (
            <pre className="mobile-labels-row">
                {padding}
                <span 
                    className={`nav-text ${canGoBack ? '' : 'disabled'}`}
                    onClick={() => canGoBack && setMobileOffset(Math.max(0, mobileOffset - MOBILE_DAYS))}
                >{"<"}</span>
                {" "}{labels}{" "}
                <span 
                    className={`nav-text ${canGoForward ? '' : 'disabled'}`}
                    onClick={() => canGoForward && setMobileOffset(Math.min(maxOffset, mobileOffset + MOBILE_DAYS))}
                >{">"}</span>
            </pre>
        );
    };

    return (
        <section className="chart-section">
            <h2>COMMIT ACTIVITY</h2>
            <pre className="bar-chart" dangerouslySetInnerHTML={{ __html: chartLines.join("\n") }} />
            {buildMobileLabelsRow()}
            <div className="heatmap-container">
                <pre className="heatmap">
                    <span className="date-label">{startLabel}</span> [
                    <span className="heatmap-chars">{heatmap}</span>]{" "}
                    <span className="date-label">{endLabel}</span>
                </pre>
                <p className="heatmap-legend">
                    <span className="unselectable">░▒▓█</span> = commit density
                </p>
            </div>
        </section>
    );
}
