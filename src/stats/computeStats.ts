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

  const counts = new Array<number>(buckets.length).fill(0);
  let total = 0;

  for (const c of cards) {
    if (c.phase === "new" || c.phase === "learning") continue;
    total++;
    const iv = c.interval;
    for (let b = 0; b < buckets.length; b++) {
      if (iv >= buckets[b]![1] && iv < buckets[b]![2]) {
        counts[b]!++;
        break;
      }
    }
  }

  if (total === 0) return [];
  return buckets.map(([label], i) => ({ label, count: counts[i]! }));
}

export function computeEaseDistribution(cards: NormalizedCardInfo[]): BucketData[] {
  // Buckets from 130% to 350%+ in steps of 20 — single-pass counting
  const BUCKET_START = 130;
  const BUCKET_STEP = 20;
  const NUM_BUCKETS = 12; // 130-150, 150-170, ..., 330-350, 350+
  const counts = new Array<number>(NUM_BUCKETS).fill(0);
  let total = 0;

  for (const c of cards) {
    if (c.reps <= 0) continue;
    total++;
    const ease = Math.round(c.easeFactor * 100);
    const idx = Math.min(Math.floor((ease - BUCKET_START) / BUCKET_STEP), NUM_BUCKETS - 1);
    counts[Math.max(0, idx)]!++;
  }

  if (total === 0) return [];

  const buckets: BucketData[] = [];
  for (let i = 0; i < NUM_BUCKETS - 1; i++) {
    buckets.push({ label: `${BUCKET_START + i * BUCKET_STEP}%`, count: counts[i]! });
  }
  buckets.push({ label: "350%+", count: counts[NUM_BUCKETS - 1]! });
  return buckets;
}

export function computeFutureDue(cards: NormalizedCardInfo[], days: number = 30): DayCount[] {
  const now = Date.now();
  const endMs = now + days * MS_PER_DAY;

  // Single pass: bucket each card into its day
  const dayCounts = new Array<number>(days).fill(0);
  for (const c of cards) {
    if (c.due < now || c.due >= endMs) continue;
    const dayIndex = Math.floor((c.due - now) / MS_PER_DAY);
    if (dayIndex >= 0 && dayIndex < days) dayCounts[dayIndex]!++;
  }

  return dayCounts.map((count, i) => ({
    date: formatDate(now + i * MS_PER_DAY),
    count,
  }));
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
