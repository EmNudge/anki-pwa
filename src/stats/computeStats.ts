import type { StoredReviewLog, DailyStats, Answer } from "../scheduler/types";
import type {
  NormalizedCardInfo,
  BucketData,
  DayCount,
  AnswerButtonsData,
  CardCountsData,
  TrueRetentionData,
} from "./types";
import { MS_PER_DAY } from "../utils/constants";
import { groupBy } from "../utils/groupBy";

function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeRating(rating: Answer | number): Answer {
  if (typeof rating === "string") return rating;
  const map: Record<number, Answer> = { 1: "again", 2: "hard", 3: "good", 4: "easy" };
  return map[rating] ?? "good";
}

// --- Card-based stats ---

export function computeCardCounts(cards: NormalizedCardInfo[]): CardCountsData {
  const grouped = groupBy(cards, (c) => c.phase);
  return {
    new: grouped.new?.length ?? 0,
    learning: grouped.learning?.length ?? 0,
    young: grouped.young?.length ?? 0,
    mature: grouped.mature?.length ?? 0,
  };
}

export function computeIntervalDistribution(cards: NormalizedCardInfo[]): BucketData[] {
  const buckets: [string, number, number][] = [
    ["< 1d", 0, 1],
    ["1-3d", 1, 3],
    ["3-7d", 3, 7],
    ["1-2w", 7, 14],
    ["2w-1mo", 14, 30],
    ["1-3mo", 30, 90],
    ["3-6mo", 90, 180],
    ["6-12mo", 180, 365],
    ["1y+", 365, Infinity],
  ];

  const reviewed = cards.filter((c) => c.phase !== "new" && c.phase !== "learning");
  if (reviewed.length === 0) return [];

  return buckets.map(([label, min, max]) => ({
    label,
    count: reviewed.filter((c) => c.interval >= min && c.interval < max).length,
  }));
}

export function computeEaseDistribution(cards: NormalizedCardInfo[]): BucketData[] {
  const BUCKET_START = 130;
  const BUCKET_STEP = 20;
  const NUM_BUCKETS = 12;

  const reviewed = cards.filter((c) => c.reps > 0);
  if (reviewed.length === 0) return [];

  const grouped = groupBy(reviewed, (c) => {
    const ease = Math.round(c.easeFactor * 100);
    return Math.max(0, Math.min(Math.floor((ease - BUCKET_START) / BUCKET_STEP), NUM_BUCKETS - 1));
  });

  return Array.from({ length: NUM_BUCKETS }, (_, i) => ({
    label: i < NUM_BUCKETS - 1 ? `${BUCKET_START + i * BUCKET_STEP}%` : "350%+",
    count: grouped[i]?.length ?? 0,
  }));
}

export function computeFutureDue(cards: NormalizedCardInfo[], days: number = 30): DayCount[] {
  const now = Date.now();
  const endMs = now + days * MS_PER_DAY;

  const dueCards = cards.filter((c) => c.due >= now && c.due < endMs);
  const grouped = groupBy(dueCards, (c) => Math.floor((c.due - now) / MS_PER_DAY));

  return Array.from({ length: days }, (_, i) => ({
    date: formatDate(now + i * MS_PER_DAY),
    count: grouped[i]?.length ?? 0,
  }));
}

export function computeAddedCards(
  cards: NormalizedCardInfo[],
  startMs: number,
  endMs: number,
): DayCount[] {
  const scaffoldDates = Array.from(
    { length: Math.ceil((endMs - startMs) / MS_PER_DAY) },
    (_, i) => formatDate(startMs + i * MS_PER_DAY),
  );

  const cardsInRange = cards.filter((c) => c.createdAt >= startMs && c.createdAt < endMs);
  const grouped = groupBy(cardsInRange, (c) => formatDate(c.createdAt));

  const allDates = [...new Set([...scaffoldDates, ...Object.keys(grouped)])];

  return allDates
    .sort((a, b) => a.localeCompare(b))
    .map((date) => ({ date, count: grouped[date]?.length ?? 0 }));
}

// --- Review-log-based stats ---

export function computeCalendarHeatmap(logs: StoredReviewLog[]): DayCount[] {
  const grouped = groupBy(logs, (log) => formatDate(log.timestamp));

  return Object.entries(grouped)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, entries]) => ({ date, count: entries!.length }));
}

export function computeReviewsByHour(logs: StoredReviewLog[]): BucketData[] {
  const grouped = groupBy(logs, (log) => new Date(log.timestamp).getHours());

  return Array.from({ length: 24 }, (_, hour) => ({
    label: `${hour}:00`,
    count: grouped[hour]?.length ?? 0,
  }));
}

export function computeAnswerButtons(logs: StoredReviewLog[]): AnswerButtonsData {
  const grouped = groupBy(logs, (log) => normalizeRating(log.rating));
  return {
    again: grouped.again?.length ?? 0,
    hard: grouped.hard?.length ?? 0,
    good: grouped.good?.length ?? 0,
    easy: grouped.easy?.length ?? 0,
  };
}

export function computeTrueRetention(
  logs: StoredReviewLog[],
  cards: NormalizedCardInfo[],
): TrueRetentionData {
  const matureCardIds = new Set(cards.filter((c) => c.phase === "mature").map((c) => c.cardId));
  const matureLogs = logs.filter((log) => matureCardIds.has(log.cardId));
  const correct = matureLogs.filter((log) => normalizeRating(log.rating) !== "again").length;
  const total = matureLogs.length;

  return {
    retention: total > 0 ? correct / total : 0,
    total,
    correct,
  };
}

export function computeStudyStreak(dailyStats: DailyStats[]): number {
  if (dailyStats.length === 0) return 0;

  const dates = new Set(
    dailyStats.filter((s) => s.newCount + s.reviewCount > 0).map((s) => s.date),
  );

  let streak = 0;
  const now = new Date();

  for (let i = 0; i < 365; i++) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = formatDate(d.getTime());
    if (dates.has(dateStr)) {
      streak++;
    } else if (i > 0) {
      // Allow today to be missing (not reviewed yet)
      break;
    }
  }

  return streak;
}
