import type { StoredReviewLog, DailyStats, Answer } from "../scheduler/types";
import type {
  NormalizedCardInfo,
  BucketData,
  DayCount,
  AnswerButtonsData,
  CardCountsData,
  TrueRetentionData,
} from "./types";

const MS_PER_DAY = 86_400_000;

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
  const counts: CardCountsData = { new: 0, learning: 0, young: 0, mature: 0 };
  for (const card of cards) {
    counts[card.phase]++;
  }
  return counts;
}

export function computeIntervalDistribution(cards: NormalizedCardInfo[]): BucketData[] {
  // Only include cards with meaningful intervals (review/young/mature)
  const intervals = cards
    .filter((c) => c.phase !== "new" && c.phase !== "learning")
    .map((c) => c.interval);

  if (intervals.length === 0) return [];

  // Create logarithmic-ish buckets: 0-1d, 1-3d, 3-7d, 7-14d, 14-30d, 1-3mo, 3-6mo, 6-12mo, 1y+
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

  return buckets.map(([label, min, max]) => ({
    label,
    count: intervals.filter((i) => i >= min && i < max).length,
  }));
}

export function computeEaseDistribution(cards: NormalizedCardInfo[]): BucketData[] {
  const eases = cards.filter((c) => c.reps > 0).map((c) => Math.round(c.easeFactor * 100));

  if (eases.length === 0) return [];

  // Buckets from 130% to 350%+ in steps of 20
  const buckets: BucketData[] = [];
  for (let start = 130; start <= 340; start += 20) {
    const end = start + 20;
    buckets.push({
      label: `${start}%`,
      count: eases.filter((e) => e >= start && e < end).length,
    });
  }
  buckets.push({
    label: "350%+",
    count: eases.filter((e) => e >= 350).length,
  });
  return buckets;
}

export function computeFutureDue(cards: NormalizedCardInfo[], days: number = 30): DayCount[] {
  const now = Date.now();
  const result: DayCount[] = [];

  for (let i = 0; i < days; i++) {
    const dayStart = now + i * MS_PER_DAY;
    const dayEnd = dayStart + MS_PER_DAY;
    const date = formatDate(dayStart);
    const count = cards.filter((c) => c.due >= dayStart && c.due < dayEnd).length;
    result.push({ date, count });
  }

  return result;
}

export function computeAddedCards(
  cards: NormalizedCardInfo[],
  startMs: number,
  endMs: number,
): DayCount[] {
  const days = new Map<string, number>();

  // Initialize all days in range
  for (let ts = startMs; ts < endMs; ts += MS_PER_DAY) {
    days.set(formatDate(ts), 0);
  }

  for (const card of cards) {
    if (card.createdAt >= startMs && card.createdAt < endMs) {
      const date = formatDate(card.createdAt);
      days.set(date, (days.get(date) ?? 0) + 1);
    }
  }

  return Array.from(days.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

// --- Review-log-based stats ---

export function computeCalendarHeatmap(logs: StoredReviewLog[]): DayCount[] {
  const dayCounts = new Map<string, number>();
  for (const log of logs) {
    const date = formatDate(log.timestamp);
    dayCounts.set(date, (dayCounts.get(date) ?? 0) + 1);
  }

  return Array.from(dayCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));
}

export function computeReviewsByHour(logs: StoredReviewLog[]): BucketData[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const log of logs) {
    const h = new Date(log.timestamp).getHours();
    hours[h] = (hours[h] ?? 0) + 1;
  }
  return hours.map((count, hour) => ({
    label: `${hour}:00`,
    count,
  }));
}

export function computeAnswerButtons(logs: StoredReviewLog[]): AnswerButtonsData {
  const data: AnswerButtonsData = { again: 0, hard: 0, good: 0, easy: 0 };
  for (const log of logs) {
    const rating = normalizeRating(log.rating);
    data[rating]++;
  }
  return data;
}

export function computeTrueRetention(
  logs: StoredReviewLog[],
  cards: NormalizedCardInfo[],
): TrueRetentionData {
  // True retention: % of reviews on mature cards that were not "again"
  const matureCardIds = new Set(cards.filter((c) => c.phase === "mature").map((c) => c.cardId));

  let total = 0;
  let correct = 0;

  for (const log of logs) {
    if (!matureCardIds.has(log.cardId)) continue;
    total++;
    if (normalizeRating(log.rating) !== "again") {
      correct++;
    }
  }

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
