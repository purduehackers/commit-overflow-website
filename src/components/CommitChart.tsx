import { useState, useEffect } from "react";

const COMMITS_BY_DAY: Record<string, number> = {
    "2025-12-22": 24,
    "2025-12-23": 73,
    "2025-12-24": 58,
    "2025-12-25": 84,
    "2025-12-26": 63,
    "2025-12-27": 52,
    "2025-12-28": 53,
    "2025-12-29": 49,
    "2025-12-30": 43,
    "2025-12-31": 40,
    "2026-01-01": 51,
    "2026-01-02": 52,
    "2026-01-03": 44,
    "2026-01-04": 32,
    "2026-01-05": 51,
    "2026-01-06": 35,
    "2026-01-07": 55,
    "2026-01-08": 42,
    "2026-01-09": 32,
    "2026-01-10": 41,
    "2026-01-11": 34,
    "2026-01-12": 112,
};

const EVENT_START = "2025-12-22";
const EVENT_END = "2026-01-12";

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

function verticalBarChart(
    commitsByDay: Record<string, number>,
    days: string[],
    globalMax: number,
): string[] {
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

    const commitsByDay = COMMITS_BY_DAY;
    const days = getDateRange(EVENT_START, EVENT_END);
    const rawMax = Math.max(...Object.values(commitsByDay), 1);
    const globalMax = Math.ceil(rawMax / 20) * 20;

    const maxOffset = Math.max(0, days.length - MOBILE_DAYS);
    const displayDays = isMobile ? days.slice(mobileOffset, mobileOffset + MOBILE_DAYS) : days;

    const chart = verticalBarChart(commitsByDay, displayDays, globalMax);
    const heatmap = heatmapRow(commitsByDay, isMobile ? displayDays : days);

    const startLabel = formatDateLabel(isMobile ? displayDays[0] : EVENT_START);
    const endLabel = formatDateLabel(
        isMobile ? displayDays[displayDays.length - 1] : EVENT_END,
    );

    const canGoBack = mobileOffset > 0;
    const nextPageDays = days.slice(mobileOffset + MOBILE_DAYS, mobileOffset + MOBILE_DAYS * 2);
    const hasCommitsOnNextPage = nextPageDays.some((day) => (commitsByDay[day] || 0) > 0);
    const canGoForward = mobileOffset < maxOffset && hasCommitsOnNextPage;

    const chartLines = isMobile ? chart.slice(0, -1) : chart;

    const buildMobileLabelsRow = () => {
        if (!isMobile) return null;
        const originalLabels = chart[chart.length - 1];
        const match = originalLabels.match(/^(\s*)(.*)$/);
        const padding = match ? match[1] + "  " : "";
        const labels = match ? match[2] : originalLabels;

        return (
            <pre className="mobile-labels-row">
                {padding}
                <span
                    className={`nav-text ${canGoBack ? "" : "disabled"}`}
                    onClick={() =>
                        canGoBack && setMobileOffset(Math.max(0, mobileOffset - MOBILE_DAYS))
                    }
                >
                    {"<"}
                </span>{" "}
                {labels}{" "}
                <span
                    className={`nav-text ${canGoForward ? "" : "disabled"}`}
                    onClick={() =>
                        canGoForward &&
                        setMobileOffset(Math.min(maxOffset, mobileOffset + MOBILE_DAYS))
                    }
                >
                    {">"}
                </span>
            </pre>
        );
    };

    return (
        <section className="chart-section">
            <h2>COMMIT ACTIVITY</h2>
            <pre
                className="bar-chart"
                dangerouslySetInnerHTML={{ __html: chartLines.join("\n") }}
            />
            {buildMobileLabelsRow()}
        </section>
    );
}
