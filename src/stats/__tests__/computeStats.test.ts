import { describe, it, expect } from "vitest";
import {
  computeCardCounts,
  computeIntervalDistribution,
  computeEaseDistribution,
  computeAnswerButtons,
  computeReviewsByHour,
  computeCalendarHeatmap,
  computeTrueRetention,
  computeStudyStreak,
  computeAddedCards,
} from "../computeStats";
import type { NormalizedCardInfo } from "../types";
import type { StoredReviewLog, DailyStats } from "../../scheduler/types";

function makeCard(overrides: Partial<NormalizedCardInfo> = {}): NormalizedCardInfo {
  return {
    cardId: "1",
    deckId: "1",
    algorithm: "sm2",
    phase: "young",
    interval: 5,
    easeFactor: 2.5,
    due: Date.now(),
    lapses: 0,
    reps: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeLog(overrides: Partial<StoredReviewLog> = {}): StoredReviewLog {
  return {
    cardId: "1",
    timestamp: Date.now(),
    rating: "good",
    reviewLog: {} as StoredReviewLog["reviewLog"],
    ...overrides,
  };
}

describe("computeCardCounts", () => {
  it("counts cards by phase", () => {
    const cards = [
      makeCard({ phase: "new" }),
      makeCard({ phase: "new" }),
      makeCard({ phase: "learning" }),
      makeCard({ phase: "young" }),
      makeCard({ phase: "mature" }),
      makeCard({ phase: "mature" }),
    ];
    expect(computeCardCounts(cards)).toEqual({
      new: 2,
      learning: 1,
      young: 1,
      mature: 2,
    });
  });

  it("returns all zeros for empty array", () => {
    expect(computeCardCounts([])).toEqual({ new: 0, learning: 0, young: 0, mature: 0 });
  });
});

describe("computeIntervalDistribution", () => {
  it("returns empty for no cards", () => {
    expect(computeIntervalDistribution([])).toEqual([]);
  });

  it("excludes new and learning cards", () => {
    const cards = [makeCard({ phase: "new" }), makeCard({ phase: "learning" })];
    expect(computeIntervalDistribution(cards)).toEqual([]);
  });

  it("distributes intervals into buckets", () => {
    const cards = [
      makeCard({ phase: "young", interval: 0.5 }),
      makeCard({ phase: "young", interval: 2 }),
      makeCard({ phase: "young", interval: 5 }),
      makeCard({ phase: "mature", interval: 100 }),
      makeCard({ phase: "mature", interval: 400 }),
    ];
    const buckets = computeIntervalDistribution(cards);
    expect(buckets.length).toBe(9);

    // < 1d bucket
    expect(buckets[0]!.label).toBe("< 1d");
    expect(buckets[0]!.count).toBe(1);

    // 1-3d bucket
    expect(buckets[1]!.label).toBe("1-3d");
    expect(buckets[1]!.count).toBe(1);

    // 3-7d bucket
    expect(buckets[2]!.label).toBe("3-7d");
    expect(buckets[2]!.count).toBe(1);

    // 3-6mo bucket (90-180)
    expect(buckets[6]!.label).toBe("3-6mo");
    expect(buckets[6]!.count).toBe(1);

    // 1y+ bucket
    expect(buckets[8]!.label).toBe("1y+");
    expect(buckets[8]!.count).toBe(1);
  });
});

describe("computeEaseDistribution", () => {
  it("returns empty for no cards", () => {
    expect(computeEaseDistribution([])).toEqual([]);
  });

  it("excludes cards with 0 reps", () => {
    const cards = [makeCard({ reps: 0 })];
    expect(computeEaseDistribution(cards)).toEqual([]);
  });

  it("distributes ease factors into buckets", () => {
    const cards = [
      makeCard({ easeFactor: 2.5, reps: 5 }), // 250%
      makeCard({ easeFactor: 1.3, reps: 3 }), // 130%
    ];
    const buckets = computeEaseDistribution(cards);
    expect(buckets.length).toBeGreaterThan(0);
    // 250% falls in 250-270 bucket
    const bucket250 = buckets.find((b) => b.label === "250%");
    expect(bucket250!.count).toBe(1);
    // 130% falls in 130-150 bucket
    const bucket130 = buckets.find((b) => b.label === "130%");
    expect(bucket130!.count).toBe(1);
  });
});

describe("computeAnswerButtons", () => {
  it("counts each answer type", () => {
    const logs = [
      makeLog({ rating: "again" }),
      makeLog({ rating: "good" }),
      makeLog({ rating: "good" }),
      makeLog({ rating: "easy" }),
      makeLog({ rating: "hard" }),
    ];
    expect(computeAnswerButtons(logs)).toEqual({ again: 1, hard: 1, good: 2, easy: 1 });
  });

  it("normalizes numeric ratings", () => {
    const logs = [makeLog({ rating: 1 }), makeLog({ rating: 3 }), makeLog({ rating: 4 })];
    expect(computeAnswerButtons(logs)).toEqual({ again: 1, hard: 0, good: 1, easy: 1 });
  });

  it("returns all zeros for empty logs", () => {
    expect(computeAnswerButtons([])).toEqual({ again: 0, hard: 0, good: 0, easy: 0 });
  });
});

describe("computeReviewsByHour", () => {
  it("returns 24 buckets", () => {
    const buckets = computeReviewsByHour([]);
    expect(buckets).toHaveLength(24);
    expect(buckets[0]!.label).toBe("0:00");
    expect(buckets[23]!.label).toBe("23:00");
  });

  it("counts reviews in their hour bucket", () => {
    const noon = new Date();
    noon.setHours(12, 30, 0, 0);
    const logs = [makeLog({ timestamp: noon.getTime() }), makeLog({ timestamp: noon.getTime() })];
    const buckets = computeReviewsByHour(logs);
    expect(buckets[12]!.count).toBe(2);
  });
});

describe("computeCalendarHeatmap", () => {
  it("returns empty for no logs", () => {
    expect(computeCalendarHeatmap([])).toEqual([]);
  });

  it("groups reviews by date", () => {
    const day1 = new Date("2024-01-15T10:00:00").getTime();
    const day1b = new Date("2024-01-15T14:00:00").getTime();
    const day2 = new Date("2024-01-16T10:00:00").getTime();
    const logs = [
      makeLog({ timestamp: day1 }),
      makeLog({ timestamp: day1b }),
      makeLog({ timestamp: day2 }),
    ];
    const heatmap = computeCalendarHeatmap(logs);
    expect(heatmap).toHaveLength(2);
    expect(heatmap[0]!.count).toBe(2);
    expect(heatmap[1]!.count).toBe(1);
  });
});

describe("computeTrueRetention", () => {
  it("returns 0 retention for no mature cards", () => {
    const result = computeTrueRetention([makeLog()], [makeCard({ phase: "young" })]);
    expect(result).toEqual({ retention: 0, total: 0, correct: 0 });
  });

  it("calculates retention from mature card reviews", () => {
    const cards = [makeCard({ cardId: "1", phase: "mature" })];
    const logs = [
      makeLog({ cardId: "1", rating: "good" }),
      makeLog({ cardId: "1", rating: "easy" }),
      makeLog({ cardId: "1", rating: "again" }),
    ];
    const result = computeTrueRetention(logs, cards);
    expect(result.total).toBe(3);
    expect(result.correct).toBe(2);
    expect(result.retention).toBeCloseTo(2 / 3);
  });

  it("returns 0 for no reviews", () => {
    const result = computeTrueRetention([], [makeCard({ phase: "mature" })]);
    expect(result).toEqual({ retention: 0, total: 0, correct: 0 });
  });
});

describe("computeStudyStreak", () => {
  it("returns 0 for empty stats", () => {
    expect(computeStudyStreak([])).toBe(0);
  });

  it("counts consecutive days from today", () => {
    const today = new Date();
    const stats: DailyStats[] = [];
    for (let i = 0; i < 5; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      stats.push({ date, newCount: 1, reviewCount: 5, totalTimeMs: 60000 });
    }
    expect(computeStudyStreak(stats)).toBe(5);
  });

  it("allows today to be missing (not yet reviewed)", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const date = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;
    const stats: DailyStats[] = [{ date, newCount: 1, reviewCount: 5, totalTimeMs: 60000 }];
    expect(computeStudyStreak(stats)).toBe(1);
  });

  it("skips days with 0 reviews", () => {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const stats: DailyStats[] = [{ date, newCount: 0, reviewCount: 0, totalTimeMs: 0 }];
    expect(computeStudyStreak(stats)).toBe(0);
  });
});

describe("computeAddedCards", () => {
  it("returns empty for no cards in range", () => {
    const MS_PER_DAY = 86_400_000;
    const start = Date.now() - MS_PER_DAY;
    const end = Date.now();
    const result = computeAddedCards([], start, end);
    expect(result).toHaveLength(1);
    expect(result[0]!.count).toBe(0);
  });

  it("counts cards created within the range", () => {
    const MS_PER_DAY = 86_400_000;
    const now = Date.now();
    const start = now - 2 * MS_PER_DAY;
    const end = now;
    const cards = [
      makeCard({ createdAt: now - 1.5 * MS_PER_DAY }),
      makeCard({ createdAt: now - 0.5 * MS_PER_DAY }),
      makeCard({ createdAt: now - 0.2 * MS_PER_DAY }),
    ];
    const result = computeAddedCards(cards, start, end);
    const totalAdded = result.reduce((sum, d) => sum + d.count, 0);
    expect(totalAdded).toBe(3);
  });

  it("excludes cards outside the range", () => {
    const MS_PER_DAY = 86_400_000;
    const now = Date.now();
    const start = now - MS_PER_DAY;
    const end = now;
    const cards = [makeCard({ createdAt: now - 3 * MS_PER_DAY })];
    const result = computeAddedCards(cards, start, end);
    const totalAdded = result.reduce((sum, d) => sum + d.count, 0);
    expect(totalAdded).toBe(0);
  });
});
