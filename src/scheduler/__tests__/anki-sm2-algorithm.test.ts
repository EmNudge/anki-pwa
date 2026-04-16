import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AnkiSM2Algorithm } from "../anki-sm2-algorithm";
import type { AnkiSM2CardState, AnkiSM2ReviewLog } from "../anki-sm2-algorithm";
import { DEFAULT_SM2_PARAMS } from "../types";
import { MS_PER_DAY } from "~/utils/constants";

describe("AnkiSM2Algorithm", () => {
  let algo: AnkiSM2Algorithm;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    algo = new AnkiSM2Algorithm();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("createCard", () => {
    it("creates a new card with default state", () => {
      const card = algo.createCard();
      expect(card.phase).toBe("new");
      expect(card.step).toBe(0);
      expect(card.ease).toBe(DEFAULT_SM2_PARAMS.startingEase);
      expect(card.interval).toBe(0);
      expect(card.lapses).toBe(0);
      expect(card.reps).toBe(0);
    });
  });

  describe("new card review", () => {
    it("moves to learning phase on 'again'", () => {
      const card = algo.createCard();
      const result = algo.reviewCard(card, "again");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("learning");
      expect(newState.step).toBe(0);
      expect(newState.reps).toBe(1);
    });

    it("moves to learning phase on 'good'", () => {
      const card = algo.createCard();
      const result = algo.reviewCard(card, "good");
      const newState = result.cardState as AnkiSM2CardState;
      // Good advances to next step (step 1 of [1, 10])
      expect(newState.phase).toBe("learning");
      expect(newState.step).toBe(1);
    });

    it("graduates immediately on 'easy'", () => {
      const card = algo.createCard();
      const result = algo.reviewCard(card, "easy");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("review");
      expect(newState.interval).toBe(DEFAULT_SM2_PARAMS.easyInterval);
    });

    it("graduates immediately when no learning steps", () => {
      const noSteps = new AnkiSM2Algorithm({ learningSteps: [] });
      const card = noSteps.createCard();
      const result = noSteps.reviewCard(card, "good");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("review");
      expect(newState.interval).toBe(DEFAULT_SM2_PARAMS.graduatingInterval);
    });
  });

  describe("learning card review", () => {
    it("graduates on 'good' after final step", () => {
      const card: AnkiSM2CardState = {
        phase: "learning",
        step: 1, // last step of default [1, 10]
        ease: 2.5,
        interval: 10 / (24 * 60), // 10 min in days
        due: Date.now(),
        lapses: 0,
        reps: 1,
      };
      const result = algo.reviewCard(card, "good");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("review");
      expect(newState.interval).toBe(DEFAULT_SM2_PARAMS.graduatingInterval);
    });

    it("resets to step 0 on 'again'", () => {
      const card: AnkiSM2CardState = {
        phase: "learning",
        step: 1,
        ease: 2.5,
        interval: 10 / (24 * 60),
        due: Date.now(),
        lapses: 0,
        reps: 1,
      };
      const result = algo.reviewCard(card, "again");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("learning");
      expect(newState.step).toBe(0);
    });

    it("graduates on 'easy' from learning", () => {
      const card: AnkiSM2CardState = {
        phase: "learning",
        step: 0,
        ease: 2.5,
        interval: 0,
        due: Date.now(),
        lapses: 0,
        reps: 1,
      };
      const result = algo.reviewCard(card, "easy");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("review");
    });
  });

  describe("review card answers", () => {
    function makeReviewCard(overrides: Partial<AnkiSM2CardState> = {}): AnkiSM2CardState {
      return {
        phase: "review",
        step: 0,
        ease: 2.5,
        interval: 10,
        due: Date.now(), // due now
        lapses: 0,
        reps: 5,
        ...overrides,
      };
    }

    it("decreases ease on 'again'", () => {
      const card = makeReviewCard();
      const result = algo.reviewCard(card, "again");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.ease).toBe(2.3);
      expect(newState.lapses).toBe(1);
    });

    it("enters relearning on 'again' with relearning steps", () => {
      const card = makeReviewCard();
      const result = algo.reviewCard(card, "again");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("relearning");
    });

    it("decreases ease on 'hard'", () => {
      const card = makeReviewCard();
      const result = algo.reviewCard(card, "hard");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.ease).toBe(2.35);
      expect(newState.phase).toBe("review");
    });

    it("keeps ease on 'good'", () => {
      const card = makeReviewCard();
      const result = algo.reviewCard(card, "good");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.ease).toBe(2.5);
    });

    it("increases ease on 'easy'", () => {
      const card = makeReviewCard();
      const result = algo.reviewCard(card, "easy");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.ease).toBe(2.65);
    });

    it("enforces minimum ease of 1.3", () => {
      const card = makeReviewCard({ ease: 1.3 });
      const result = algo.reviewCard(card, "again");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.ease).toBe(1.3);
    });

    it("enforces good > hard interval ordering", () => {
      const card = makeReviewCard({ interval: 10, ease: 2.5 });
      const hard = algo.reviewCard(card, "hard").cardState as AnkiSM2CardState;
      const good = algo.reviewCard(card, "good").cardState as AnkiSM2CardState;
      expect(good.interval).toBeGreaterThanOrEqual(hard.interval);
    });

    it("enforces easy > good interval ordering", () => {
      const card = makeReviewCard({ interval: 10, ease: 2.5 });
      const good = algo.reviewCard(card, "good").cardState as AnkiSM2CardState;
      const easy = algo.reviewCard(card, "easy").cardState as AnkiSM2CardState;
      expect(easy.interval).toBeGreaterThanOrEqual(good.interval);
    });

    it("clamps interval to maximumInterval", () => {
      const shortMax = new AnkiSM2Algorithm({ maximumInterval: 30 });
      const card = makeReviewCard({ interval: 25, ease: 2.5 });
      const result = shortMax.reviewCard(card, "easy");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.interval).toBeLessThanOrEqual(30);
    });
  });

  describe("relearning", () => {
    it("graduates from relearning on 'good' after final step", () => {
      const card: AnkiSM2CardState = {
        phase: "relearning",
        step: 0, // only step in default [10]
        ease: 2.3,
        interval: 5, // saved review interval
        due: Date.now(),
        lapses: 1,
        reps: 6,
      };
      const result = algo.reviewCard(card, "good");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("review");
      // Should use the saved interval, clamped to minLapseInterval
      expect(newState.interval).toBeGreaterThanOrEqual(DEFAULT_SM2_PARAMS.minLapseInterval);
    });

    it("graduates from relearning on 'easy' without interval +1", () => {
      const card: AnkiSM2CardState = {
        phase: "relearning",
        step: 0,
        ease: 2.3,
        interval: 5,
        due: Date.now(),
        lapses: 1,
        reps: 6,
      };
      const result = algo.reviewCard(card, "easy");
      const newState = result.cardState as AnkiSM2CardState;
      expect(newState.phase).toBe("review");
    });
  });

  describe("leech detection", () => {
    it("marks card as leeched at leech threshold", () => {
      const card: AnkiSM2CardState = {
        phase: "review",
        step: 0,
        ease: 2.5,
        interval: 10,
        due: Date.now(),
        lapses: 7, // one below default threshold of 8
        reps: 20,
      };
      const result = algo.reviewCard(card, "again");
      expect((result.reviewLog as AnkiSM2ReviewLog).leeched).toBe(true);
    });

    it("does not mark as leeched below threshold", () => {
      const card: AnkiSM2CardState = {
        phase: "review",
        step: 0,
        ease: 2.5,
        interval: 10,
        due: Date.now(),
        lapses: 5,
        reps: 15,
      };
      const result = algo.reviewCard(card, "again");
      expect((result.reviewLog as AnkiSM2ReviewLog).leeched).toBe(false);
    });
  });

  describe("getNextIntervals", () => {
    it("returns dates for all four answers", () => {
      const card = algo.createCard();
      const intervals = algo.getNextIntervals(card);
      expect(intervals.again).toBeInstanceOf(Date);
      expect(intervals.hard).toBeInstanceOf(Date);
      expect(intervals.good).toBeInstanceOf(Date);
      expect(intervals.easy).toBeInstanceOf(Date);
    });
  });

  describe("getDueDate", () => {
    it("returns the due date from card state", () => {
      const card: AnkiSM2CardState = {
        phase: "review",
        step: 0,
        ease: 2.5,
        interval: 10,
        due: Date.now() + MS_PER_DAY,
        lapses: 0,
        reps: 5,
      };
      const due = algo.getDueDate(card);
      expect(due.getTime()).toBe(card.due);
    });
  });

  describe("getDisplayInfo", () => {
    it("returns card state details", () => {
      const card: AnkiSM2CardState = {
        phase: "review",
        step: 0,
        ease: 2.5,
        interval: 10,
        due: Date.now(),
        lapses: 2,
        reps: 15,
      };
      const info = algo.getDisplayInfo(card);
      expect(info.ease).toBe(2.5);
      expect(info.interval).toBe(10);
      expect(info.repetitions).toBe(15);
      expect(info.state).toBe("review");
      expect(info.lapses).toBe(2);
    });
  });

  describe("isInLearning", () => {
    it("returns true for learning phase", () => {
      expect(algo.isInLearning({ phase: "learning" } as AnkiSM2CardState)).toBe(true);
    });

    it("returns true for relearning phase", () => {
      expect(algo.isInLearning({ phase: "relearning" } as AnkiSM2CardState)).toBe(true);
    });

    it("returns false for review phase", () => {
      expect(algo.isInLearning({ phase: "review" } as AnkiSM2CardState)).toBe(false);
    });

    it("returns false for new phase", () => {
      expect(algo.isInLearning({ phase: "new" } as AnkiSM2CardState)).toBe(false);
    });
  });
});
