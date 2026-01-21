import { queryD1 } from "./d1";
import {
  calculateStreaks,
  getCommitDay,
  DEFAULT_TIMEZONE,
  DAY_RESET_HOUR,
} from "./dates";
import { getDiscordMessage } from "./discord";
import { summarizeCommitMessage } from "./groq";

export const RECEIPT_WIDTH = 52;

export const R = {
  TL: "╔",
  TR: "╗",
  BL: "╚",
  BR: "╝",
  H: "═",
  V: "║",
  TRt: "╠",
  TLt: "╣",
  LH: "─",
  LTR: "├",
  LTL: "┤",
} as const;

const pad = (
  text: string,
  width: number,
  align: "left" | "right" | "center" = "left",
): string => {
  const len = [...text].length;
  if (len >= width) return text.slice(0, width);
  const space = width - len;
  if (align === "right") return " ".repeat(space) + text;
  if (align === "center")
    return (
      " ".repeat(Math.floor(space / 2)) +
      text +
      " ".repeat(Math.ceil(space / 2))
    );
  return text + " ".repeat(space);
};

const receiptTop = (title: string): string => {
  const inner = RECEIPT_WIDTH - 2;
  return [
    `${R.TL}${R.H.repeat(inner)}${R.TR}`,
    `${R.V}${pad(title, inner, "center")}${R.V}`,
  ].join("\n");
};

const receiptHeader = (subtitle: string): string => {
  const inner = RECEIPT_WIDTH - 2;
  return [
    `${R.TRt}${R.H.repeat(inner)}${R.TLt}`,
    `${R.V}${pad(subtitle, inner, "center")}${R.V}`,
    `${R.TRt}${R.LH.repeat(inner)}${R.TLt}`,
  ].join("\n");
};

const receiptRow = (label: string, value: string, dotFill = true): string => {
  const inner = RECEIPT_WIDTH - 4;
  const labelLen = [...label].length;
  const valueLen = [...value].length;
  const gapLen = inner - labelLen - valueLen;

  let middle: string;
  if (dotFill && gapLen > 2) {
    middle = " " + ".".repeat(gapLen - 2) + " ";
  } else {
    middle = " ".repeat(Math.max(1, gapLen));
  }

  return `${R.V} ${label}${middle}${value} ${R.V}`;
};

const receiptLine = (
  text: string,
  align: "left" | "right" | "center" = "left",
): string => {
  const inner = RECEIPT_WIDTH - 4;
  return `${R.V} ${pad(text, inner, align)} ${R.V}`;
};

const receiptBottom = (message?: string): string => {
  const inner = RECEIPT_WIDTH - 2;
  const lines: string[] = [];
  if (message) {
    lines.push(`${R.TRt}${R.LH.repeat(inner)}${R.TLt}`);
    lines.push(`${R.V}${pad(message, inner, "center")}${R.V}`);
  }
  lines.push(`${R.BL}${R.H.repeat(inner)}${R.BR}`);
  return lines.join("\n");
};

const horizontalBar = (
  value: number,
  maxValue: number,
  maxWidth: number,
): string => {
  if (maxValue === 0) return "";
  const width = Math.round((value / maxValue) * maxWidth);
  return "█".repeat(Math.max(0, width));
};

const pluralize = (count: number, singular: string): string => {
  return count === 1 ? singular : `${singular}s`;
};

const formatTimestamp = (timezone: string): string => {
  const now = new Date();
  return now.toLocaleString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
};

interface CommitRow {
  id: number;
  user_id: string;
  message_id: string;
  committed_at: string;
  approved_at: string | null;
}

interface ProfileRow {
  user_id: string;
  timezone: string;
  thread_id: string;
}

interface UserRow {
  id: string;
  discord_username: string;
}

const getDistinctCommitDays = (
  commitTimestamps: string[],
  timezone: string,
): string[] => {
  const commitDaysSet = new Set<string>();
  for (const ts of commitTimestamps) {
    commitDaysSet.add(getCommitDay(ts, timezone));
  }
  return [...commitDaysSet].sort();
};

const getStreakDays = (commitDays: string[]): Set<string> => {
  const streakDays = new Set<string>();
  if (commitDays.length === 0) return streakDays;

  const sortedDays = [...commitDays].sort();

  const diffInDays = (dateStr1: string, dateStr2: string): number => {
    const d1 = new Date(dateStr1 + "T12:00:00");
    const d2 = new Date(dateStr2 + "T12:00:00");
    return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  };

  let bestStreakStart = 0;
  let bestStreakLength = 1;
  let currentStreakStart = 0;

  for (let i = 1; i <= sortedDays.length; i++) {
    const isEndOfStreak =
      i === sortedDays.length || diffInDays(sortedDays[i - 1], sortedDays[i]) !== 1;

    if (isEndOfStreak) {
      const streakLength = i - currentStreakStart;
      if (streakLength > bestStreakLength) {
        bestStreakStart = currentStreakStart;
        bestStreakLength = streakLength;
      }
      currentStreakStart = i;
    }
  }

  if (bestStreakLength >= 2) {
    for (let j = bestStreakStart; j < bestStreakStart + bestStreakLength; j++) {
      streakDays.add(sortedDays[j]);
    }
  }

  return streakDays;
};

export async function generateSummaryReceipt(
  discordUserId: string,
): Promise<string> {
  const [users, profiles, commits] = await Promise.all([
    queryD1<UserRow>("SELECT id, discord_username FROM users WHERE id = ?", [
      discordUserId,
    ]),
    queryD1<ProfileRow>(
      "SELECT user_id, timezone FROM commit_overflow_profiles WHERE user_id = ?",
      [discordUserId],
    ),
    queryD1<CommitRow>(
      "SELECT id, user_id, message_id, committed_at, approved_at FROM commits WHERE user_id = ? AND approved_at IS NOT NULL ORDER BY committed_at",
      [discordUserId],
    ),
  ]);

  const user = users[0];
  const profile = profiles[0];
  const timezone = profile?.timezone ?? DEFAULT_TIMEZONE;

  const output: string[] = [];

  output.push(receiptTop("COMMIT OVERFLOW 2025"));
  output.push(receiptLine("USER RECEIPT", "center"));
  output.push(receiptHeader("ACCOUNT INFO"));
  output.push(
    receiptRow("USER", user ? `@${user.discord_username}` : "Unknown"),
  );
  output.push(receiptRow("TIMEZONE", timezone));
  output.push(receiptRow("DAY RESETS", `${DAY_RESET_HOUR}:00 AM`));

  if (commits.length === 0) {
    output.push(receiptHeader("STATUS"));
    output.push(receiptLine("No commits found.", "center"));
    output.push(receiptLine("", "center"));
    output.push(receiptBottom("THANK YOU FOR PARTICIPATING!"));
    return output.join("\n");
  }

  const commitTimestamps = commits.map((c) => c.committed_at);
  const commitDays = getDistinctCommitDays(commitTimestamps, timezone);
  const { longestStreak } = calculateStreaks(commitTimestamps, timezone);

  output.push(receiptHeader("STATISTICS"));
  output.push(receiptRow("Total Commits", String(commits.length)));
  output.push(receiptRow("Unique Commit Days", String(commitDays.length)));
  output.push(
    receiptRow(
      "Best Streak",
      `${longestStreak} ${pluralize(longestStreak, "day")}`,
    ),
  );

  const commitsByDay = new Map<string, number>();
  for (const ts of commitTimestamps) {
    const day = getCommitDay(ts, timezone);
    commitsByDay.set(day, (commitsByDay.get(day) ?? 0) + 1);
  }

  const sortedDays = [...commitsByDay.entries()].sort((a, b) =>
    b[0].localeCompare(a[0]),
  );
  const maxCommitsInDay = Math.max(...sortedDays.map(([, c]) => c));
  const labelWidth = 9; // "MM-DD XX " prefix before bar
  const barMaxWidth = RECEIPT_WIDTH - 4 - labelWidth;

  output.push(receiptHeader("RECENT ACTIVITY"));
  for (const [day, count] of sortedDays.slice(0, 10)) {
    const bar = horizontalBar(count, maxCommitsInDay, barMaxWidth);
    const dayShort = day.slice(5);
    const countStr = String(count).padStart(2);
    const inner = RECEIPT_WIDTH - 4;
    const content = `${dayShort} ${countStr} ${bar}`;
    output.push(`${R.V} ${content.padEnd(inner)} ${R.V}`);
  }

  if (sortedDays.length > 10) {
    output.push(
      receiptLine(`... and ${sortedDays.length - 10} more days`, "center"),
    );
  }

  const commitsByHour = new Map<number, number>();
  for (const c of commits) {
    const date = new Date(c.committed_at);
    const hourStr = date.toLocaleString("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hour12: false,
    });
    const hour = parseInt(hourStr, 10);
    commitsByHour.set(hour, (commitsByHour.get(hour) ?? 0) + 1);
  }

  const peakHour = [...commitsByHour.entries()].sort((a, b) => b[1] - a[1])[0];

  output.push(receiptHeader("COMMIT DATA"));
  output.push(receiptRow("First Commit", commitDays[0]));
  output.push(receiptRow("Latest Commit", commitDays[commitDays.length - 1]));
  if (peakHour) {
    const hourLabel = `${peakHour[0].toString().padStart(2, "0")}:00`;
    output.push(
      receiptRow("Peak Hour", `${hourLabel} (${peakHour[1]} commits)`),
    );
  }

  const avgPerDay = (commits.length / commitDays.length).toFixed(1);
  output.push(receiptRow("Avg Commits/Day", avgPerDay));

  output.push(receiptHeader(""));
  output.push(receiptLine(`Generated: ${formatTimestamp(timezone)}`, "center"));
  output.push(receiptBottom("THANK YOU FOR COMMITTING!"));

  return output.join("\n");
}

export async function generateCommitsReceipt(
  discordUserId: string,
): Promise<string> {
  const [users, profiles, commits] = await Promise.all([
    queryD1<UserRow>("SELECT id, discord_username FROM users WHERE id = ?", [
      discordUserId,
    ]),
    queryD1<ProfileRow>(
      "SELECT user_id, timezone, thread_id FROM commit_overflow_profiles WHERE user_id = ?",
      [discordUserId],
    ),
    queryD1<CommitRow>(
      "SELECT id, user_id, message_id, committed_at, approved_at FROM commits WHERE user_id = ? AND approved_at IS NOT NULL ORDER BY committed_at DESC",
      [discordUserId],
    ),
  ]);

  const user = users[0];
  const profile = profiles[0];
  const timezone = profile?.timezone ?? DEFAULT_TIMEZONE;
  const threadId = profile?.thread_id ?? "";

  const output: string[] = [];

  output.push(receiptTop("COMMIT OVERFLOW 2025"));
  output.push(receiptLine("COMMIT LOG", "center"));
  output.push(receiptHeader("ACCOUNT INFO"));
  output.push(
    receiptRow("USER", user ? `@${user.discord_username}` : "Unknown"),
  );
  output.push(receiptRow("TOTAL COMMITS", String(commits.length)));

  if (commits.length === 0) {
    output.push(receiptHeader("LOG"));
    output.push(receiptLine("No commits found.", "center"));
    output.push(receiptBottom("THANK YOU FOR PARTICIPATING!"));
    return output.join("\n");
  }

  const commitsByDay = new Map<string, CommitRow[]>();
  for (const commit of commits) {
    const day = getCommitDay(commit.committed_at, timezone);
    const dayCommits = commitsByDay.get(day) ?? [];
    dayCommits.push(commit);
    commitsByDay.set(day, dayCommits);
  }

  const sortedDays = [...commitsByDay.keys()].sort((a, b) =>
    b.localeCompare(a),
  );

  const streakDays = getStreakDays(sortedDays);

  interface MessageData {
    content: string;
    attachments: { url: string; content_type?: string }[];
  }
  const messageDataMap = new Map<number, MessageData>();

  await Promise.all(
    commits.map(async (commit) => {
      if (!threadId) return;
      const message = await getDiscordMessage(threadId, commit.message_id);
      if (!message) return;

      const isForwarded = message.message_reference?.type === 1;
      const forwardedMessage = isForwarded
        ? message.message_snapshots?.[0]?.message
        : null;

      messageDataMap.set(commit.id, {
        content: forwardedMessage?.content || message.content || "",
        attachments: forwardedMessage?.attachments || message.attachments || [],
      });
    }),
  );

  const summaryPromises = commits.map(async (commit) => {
    const msgData = messageDataMap.get(commit.id);
    if (!msgData || (!msgData.content && msgData.attachments.length === 0)) {
      return { id: commit.id, summary: null };
    }

    const day = getCommitDay(commit.committed_at, timezone);
    const dayCommits = commitsByDay.get(day) ?? [];
    const contextMessages = dayCommits
      .filter((c) => c.id !== commit.id)
      .map((c) => messageDataMap.get(c.id))
      .filter((m): m is MessageData => !!m && (!!m.content || m.attachments.length > 0))
      .map((m) => {
        if (m.content) return m.content.slice(0, 100);
        return `[${m.attachments.length} attachment(s)]`;
      });

    const summary = await summarizeCommitMessage(
      msgData.content,
      msgData.attachments,
      contextMessages,
    );
    return { id: commit.id, summary };
  });
  const summaryResults = await Promise.all(summaryPromises);
  const summaryMap = new Map(summaryResults.map((m) => [m.id, m.summary]));

  output.push(receiptHeader("COMMIT LOG"));

  for (let dayIndex = 0; dayIndex < sortedDays.length; dayIndex++) {
    const day = sortedDays[dayIndex];
    if (dayIndex > 0) {
      output.push(receiptLine("", "left"));
    }
    const dayCommits = commitsByDay.get(day) ?? [];
    const isStreakDay = streakDays.has(day);
    const streakIndicator = isStreakDay ? " [*]" : "";
    output.push(
      receiptLine(
        `${day} (${dayCommits.length} ${pluralize(dayCommits.length, "commit")})${streakIndicator}`,
        "left",
      ),
    );

    for (const commit of dayCommits) {
      const time = new Date(commit.committed_at).toLocaleString("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const summary = summaryMap.get(commit.id);
      const summaryText = summary ? ` - ${summary}` : "";
      output.push(receiptLine(`  ${time}${summaryText}`, "left"));
    }
  }

  output.push(receiptHeader(""));
  output.push(receiptLine(`Generated: ${formatTimestamp(timezone)}`, "center"));
  output.push(receiptBottom("KEEP BUILDING!"));

  return output.join("\n");
}

export interface CommitSummaryUpdate {
  commitId: number;
  summary: string | null;
}

export interface StreamingReceiptData {
  baseReceipt: string;
  commits: Array<{ id: number; time: string; messageId: string; day: string }>;
  commitsByDay: Map<string, number[]>;
  threadId: string;
}

export async function getCommitsReceiptData(
  discordUserId: string,
): Promise<StreamingReceiptData> {
  const [users, profiles, commits] = await Promise.all([
    queryD1<UserRow>("SELECT id, discord_username FROM users WHERE id = ?", [
      discordUserId,
    ]),
    queryD1<ProfileRow>(
      "SELECT user_id, timezone, thread_id FROM commit_overflow_profiles WHERE user_id = ?",
      [discordUserId],
    ),
    queryD1<CommitRow>(
      "SELECT id, user_id, message_id, committed_at, approved_at FROM commits WHERE user_id = ? AND approved_at IS NOT NULL ORDER BY committed_at DESC",
      [discordUserId],
    ),
  ]);

  const user = users[0];
  const profile = profiles[0];
  const timezone = profile?.timezone ?? DEFAULT_TIMEZONE;
  const threadId = profile?.thread_id ?? "";

  const output: string[] = [];
  const commitData: Array<{ id: number; time: string; messageId: string; day: string }> = [];
  const commitIdsByDay = new Map<string, number[]>();

  output.push(receiptTop("COMMIT OVERFLOW 2025"));
  output.push(receiptLine("COMMIT LOG", "center"));
  output.push(receiptHeader("ACCOUNT INFO"));
  output.push(
    receiptRow("USER", user ? `@${user.discord_username}` : "Unknown"),
  );
  output.push(receiptRow("TOTAL COMMITS", String(commits.length)));

  if (commits.length === 0) {
    output.push(receiptHeader("LOG"));
    output.push(receiptLine("No commits found.", "center"));
    output.push(receiptBottom("THANK YOU FOR PARTICIPATING!"));
    return {
      baseReceipt: output.join("\n"),
      commits: [],
      commitsByDay: new Map(),
      threadId,
    };
  }

  const commitsByDay = new Map<string, CommitRow[]>();
  for (const commit of commits) {
    const day = getCommitDay(commit.committed_at, timezone);
    const dayCommits = commitsByDay.get(day) ?? [];
    dayCommits.push(commit);
    commitsByDay.set(day, dayCommits);

    const dayIds = commitIdsByDay.get(day) ?? [];
    dayIds.push(commit.id);
    commitIdsByDay.set(day, dayIds);
  }

  const sortedDays = [...commitsByDay.keys()].sort((a, b) =>
    b.localeCompare(a),
  );

  const streakDays = getStreakDays(sortedDays);

  output.push(receiptHeader("COMMIT LOG"));

  for (let dayIndex = 0; dayIndex < sortedDays.length; dayIndex++) {
    const day = sortedDays[dayIndex];
    if (dayIndex > 0) {
      output.push(receiptLine("", "left"));
    }
    const dayCommits = commitsByDay.get(day) ?? [];
    const isStreakDay = streakDays.has(day);
    const streakIndicator = isStreakDay ? " [*]" : "";
    output.push(
      receiptLine(
        `${day} (${dayCommits.length} ${pluralize(dayCommits.length, "commit")})${streakIndicator}`,
        "left",
      ),
    );

    for (const commit of dayCommits) {
      const time = new Date(commit.committed_at).toLocaleString("en-US", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      commitData.push({ id: commit.id, time, messageId: commit.message_id, day });
      output.push(receiptLine(`  ${time} - ...`, "left"));
    }
  }

  output.push(receiptHeader(""));
  output.push(receiptLine(`Generated: ${formatTimestamp(timezone)}`, "center"));
  output.push(receiptBottom("KEEP BUILDING!"));

  return {
    baseReceipt: output.join("\n"),
    commits: commitData,
    commitsByDay: commitIdsByDay,
    threadId,
  };
}

export function buildCommitLine(time: string, summary: string | null): string {
  const summaryText = summary ? ` - ${summary}` : "";
  return receiptLine(`  ${time}${summaryText}`, "left");
}
