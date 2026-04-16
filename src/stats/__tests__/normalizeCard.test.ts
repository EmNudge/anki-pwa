import { describe, it, expect } from "vitest";
import { normalizeCard } from "../normalizeCard";
import type { CardReviewState } from "../../scheduler/types";
import type { AnkiSM2CardState } from "../../scheduler/anki-sm2-algorithm";
import { State, type Card } from "ts-fsrs";

function makeSM2Card(overrides: Partial<AnkiSM2CardState> = {}): CardReviewState {
  const cardState: AnkiSM2CardState = {
    phase: "review",
    step: 0,
    ease: 2.5,
    interval: 10,
    due: Date.now(),
    lapses: 0,
    reps: 5,
    ...overrides,
  };
  return {
    cardId: "1",
    deckId: "deck1",
    algorithm: "sm2",
    cardState,
    createdAt: Date.now() - 86400000,
    lastReviewed: Date.now(),
  };
}

function makeFSRSCard(overrides: Partial<Card> = {}): CardReviewState {
  const cardState: Card = {
    due: new Date(),
    stability: 5,
    difficulty: 5,
    elapsed_days: 0,
    scheduled_days: 10,
    reps: 5,
    lapses: 0,
    learning_steps: 0,
    state: State.Review,
    last_review: new Date(),
    ...overrides,
  };
  return {
    cardId: "2",
    deckId: "deck1",
    algorithm: "fsrs",
    cardState,
    createdAt: Date.now() - 86400000,
    lastReviewed: Date.now(),
  };
}

describe("normalizeCard SM2", () => {
  it("classifies new cards", () => {
    const result = normalizeCard(makeSM2Card({ phase: "new" }));
    expect(result.phase).toBe("new");
  });

  it("classifies learning cards", () => {
    const result = normalizeCard(makeSM2Card({ phase: "learning" }));
    expect(result.phase).toBe("learning");
  });

  it("classifies relearning cards as learning", () => {
    const result = normalizeCard(makeSM2Card({ phase: "relearning" }));
    expect(result.phase).toBe("learning");
  });

  it("classifies short-interval review cards as young", () => {
    const result = normalizeCard(makeSM2Card({ phase: "review", interval: 10 }));
    expect(result.phase).toBe("young");
  });

  it("classifies long-interval review cards as mature", () => {
    const result = normalizeCard(makeSM2Card({ phase: "review", interval: 30 }));
    expect(result.phase).toBe("mature");
  });

  it("uses interval=21 as the young/mature boundary", () => {
    expect(normalizeCard(makeSM2Card({ phase: "review", interval: 20 })).phase).toBe("young");
    expect(normalizeCard(makeSM2Card({ phase: "review", interval: 21 })).phase).toBe("mature");
  });

  it("maps SM2 fields correctly", () => {
    const result = normalizeCard(makeSM2Card({ ease: 2.3, interval: 15, lapses: 2, reps: 10 }));
    expect(result.easeFactor).toBe(2.3);
    expect(result.interval).toBe(15);
    expect(result.lapses).toBe(2);
    expect(result.reps).toBe(10);
  });
});

describe("normalizeCard FSRS", () => {
  it("classifies new FSRS cards", () => {
    const result = normalizeCard(makeFSRSCard({ state: State.New }));
    expect(result.phase).toBe("new");
  });

  it("classifies learning FSRS cards", () => {
    const result = normalizeCard(makeFSRSCard({ state: State.Learning }));
    expect(result.phase).toBe("learning");
  });

  it("classifies relearning FSRS cards as learning", () => {
    const result = normalizeCard(makeFSRSCard({ state: State.Relearning }));
    expect(result.phase).toBe("learning");
  });

  it("classifies short-interval FSRS review cards as young", () => {
    const result = normalizeCard(makeFSRSCard({ state: State.Review, scheduled_days: 10 }));
    expect(result.phase).toBe("young");
  });

  it("classifies long-interval FSRS review cards as mature", () => {
    const result = normalizeCard(makeFSRSCard({ state: State.Review, scheduled_days: 30 }));
    expect(result.phase).toBe("mature");
  });

  it("maps FSRS difficulty to ease-like scale", () => {
    // difficulty=1 (easiest) → (11-1)/2.5 = 4.0
    const easy = normalizeCard(makeFSRSCard({ difficulty: 1 }));
    expect(easy.easeFactor).toBe(4.0);

    // difficulty=10 (hardest) → (11-10)/2.5 = 0.4
    const hard = normalizeCard(makeFSRSCard({ difficulty: 10 }));
    expect(hard.easeFactor).toBeCloseTo(0.4);
  });

  it("uses scheduled_days as interval", () => {
    const result = normalizeCard(makeFSRSCard({ scheduled_days: 42 }));
    expect(result.interval).toBe(42);
  });
});
