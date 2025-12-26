import { useState } from "react";
import useSWR from "swr";
import { fetcher } from "../lib/fetcher";

interface LeaderboardEntry {
    rank: number;
    odId: string;
    username: string;
    avatarUrl: string;
    totalCommits: number;
    totalDays: number;
    currentStreak: number;
}

interface StatsData {
    leaderboard: LeaderboardEntry[];
}

type SortKey = "commits" | "days" | "streak";

export function Leaderboard() {
    const [sortBy, setSortBy] = useState<SortKey>("commits");
    const { data, error, mutate } = useSWR<StatsData>("/api/stats", fetcher, {
        refreshInterval: 30000,
    });

    if (error) {
        return (
            <section className="leaderboard-section w-full">
                <div className="leaderboard-header">
                    <h2>TOP HACKERS</h2>
                </div>
                <pre style={{ color: "var(--error, #ff6b6b)" }} role="alert">
                    ╳ Failed to load leaderboard.{" "}
                    <button
                        onClick={() => mutate()}
                        aria-label="Retry loading leaderboard"
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
        const skeletonRows = Array(10)
            .fill(0)
            .map((_, i) => (
                <tr key={i} className="skeleton">
                    <td>{(i + 1).toString().padStart(2)}</td>
                    <td className="hacker-cell">
                        <span className="avatar-placeholder"></span>░░░░░░░░░░░░
                    </td>
                    <td>░░</td>
                    <td>░░</td>
                    <td>░░</td>
                </tr>
            ));

        return (
            <section className="leaderboard-section w-full">
                <div className="leaderboard-header">
                    <h2>TOP HACKERS</h2>
                    <div className="sort-toggle">
                        <span className="sort-label">sort by:</span>
                        <button className="sort-btn active">[commits]</button>
                        <button className="sort-btn">[days]</button>
                        <button className="sort-btn">[streak]</button>
                    </div>
                </div>
                <table className="leaderboard-table w-full" aria-label="Leaderboard rankings">
                    <thead>
                        <tr>
                            <th scope="col">Rank</th>
                            <th scope="col">Hacker</th>
                            <th scope="col" className="sorted">
                                Commits
                            </th>
                            <th scope="col">Days</th>
                            <th scope="col">Streak</th>
                        </tr>
                    </thead>
                    <tbody>{skeletonRows}</tbody>
                </table>
            </section>
        );
    }

    const sortedLeaderboard = [...data.leaderboard].sort((a, b) => {
        switch (sortBy) {
            case "commits":
                return b.totalCommits - a.totalCommits;
            case "days":
                return b.totalDays - a.totalDays;
            case "streak":
                return b.currentStreak - a.currentStreak;
            default:
                return 0;
        }
    });

    return (
        <section className="leaderboard-section w-full" data-sort={sortBy}>
            <div className="leaderboard-header">
                <h2>TOP HACKERS</h2>
                <div className="sort-toggle" role="group" aria-label="Sort leaderboard by">
                    <span className="sort-label" id="sort-label">
                        sort by:
                    </span>
                    <button
                        className={`sort-btn ${sortBy === "commits" ? "active" : ""}`}
                        onClick={() => setSortBy("commits")}
                        aria-pressed={sortBy === "commits"}
                        aria-label="Sort by total commits"
                    >
                        [commits]
                    </button>
                    <button
                        className={`sort-btn ${sortBy === "days" ? "active" : ""}`}
                        onClick={() => setSortBy("days")}
                        aria-pressed={sortBy === "days"}
                        aria-label="Sort by total days"
                    >
                        [days]
                    </button>
                    <button
                        className={`sort-btn ${sortBy === "streak" ? "active" : ""}`}
                        onClick={() => setSortBy("streak")}
                        aria-pressed={sortBy === "streak"}
                        aria-label="Sort by current streak"
                    >
                        [streak]
                    </button>
                </div>
            </div>
            <table className="leaderboard-table w-full" aria-label="Leaderboard rankings">
                <thead>
                    <tr>
                        <th scope="col">Rank</th>
                        <th scope="col">Hacker</th>
                        <th
                            scope="col"
                            className={sortBy === "commits" ? "sorted" : ""}
                            aria-sort={sortBy === "commits" ? "descending" : "none"}
                        >
                            Commits
                        </th>
                        <th
                            scope="col"
                            className={sortBy === "days" ? "sorted" : ""}
                            aria-sort={sortBy === "days" ? "descending" : "none"}
                        >
                            Days
                        </th>
                        <th
                            scope="col"
                            className={sortBy === "streak" ? "sorted" : ""}
                            aria-sort={sortBy === "streak" ? "descending" : "none"}
                        >
                            Streak
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {sortedLeaderboard.map((entry, index) => (
                        <tr key={entry.odId}>
                            <td>{(index + 1).toString().padStart(2)}</td>
                            <td className="hacker-cell">
                                <img
                                    src={entry.avatarUrl}
                                    alt=""
                                    className="avatar"
                                    loading="lazy"
                                />
                                {entry.username}
                            </td>
                            <td>{entry.totalCommits}</td>
                            <td>{entry.totalDays}</td>
                            <td>
                                {entry.currentStreak}
                                {entry.currentStreak >= 3 && " 🔥"}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}
