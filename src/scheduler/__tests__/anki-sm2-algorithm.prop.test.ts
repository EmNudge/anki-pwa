import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fc from "fast-check";
import { AnkiSM2Algorithm } from "../anki-sm2-algorithm";
import type { AnkiSM2CardState, AnkiSM2ReviewLog, CardPhase } from "../anki-sm2-algorithm";
import type { Answer } from "../types";
import { NUM_RUNS } from "~/test/pbt";

// ── Custom arbitraries ──

const arbAnswer = fc.constantFrom<Answer>("again", "hard", "good", "easy");

const arbReviewCard: fc.Arbitrary<AnkiSM2CardState> = fc.record({
  phase: fc.constant("review" as CardPhase),
  step: fc.constant(0),
  ease: fc.double({ min: 1.3, max: 5.0, noNaN: true }),
  interval: fc.integer({ min: 1, max: 36500 }),
  due: fc.constant(Date.now()), // due right now (not early/late)
  lapses: fc.integer({ min: 0, max: 100 }),
  reps: fc.integer({ min: 1, max: 1000 }),
});

const arbLearningCard: fc.Arbitrary<AnkiSM2CardState> = fc.record({
  phase: fc.constantFrom("learning" as CardPhase, "relearning" as CardPhase),
  step: fc.integer({ min: 0, max: 1 }), // default steps [1, 10] has max index 1
  ease: fc.double({ min: 1.3, max: 5.0, noNaN: true }),
  interval: fc.double({ min: 0, max: 1, noNaN: true }),
  due: fc.constant(Date.now()),
  lapses: fc.integer({ min: 0, max: 100 }),
  reps: fc.integer({ min: 1, max: 1000 }),
});

const arbCardId = fc.integer({ min: 0, max: 100000 });

describe("SM2 Algorithm — property-based tests", () => {
  let algo: AnkiSM2Algorithm;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
    algo = new AnkiSM2Algorithm();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("interval ordering (review cards)", () => {
    it("hard <= good <= easy for any due review card", () => {
      fc.assert(
        fc.property(arbReviewCard, arbCardId, (card, cardId) => {
          // Ensure card is due now (not early)
          card.due = Date.now();

          const hard = algo.reviewCard(card, "hard", cardId).cardState as AnkiSM2CardState;
          const good = algo.reviewCard(card, "good", cardId).cardState as AnkiSM2CardState;
          const easy = algo.reviewCard(card, "easy", cardId).cardState as AnkiSM2CardState;

          expect(good.interval).toBeGreaterThanOrEqual(hard.interval);
          expect(easy.interval).toBeGreaterThanOrEqual(good.interval);
        }),
        { numRuns: NUM_RUNS ?? 500 },
      );
    });
  });

  describe("ease factor bounds", () => {
    it("ease never drops below 1.3 for any card and answer", () => {
      fc.assert(
        fc.property(arbReviewCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const result = algo.reviewCard(card, answer, cardId);
          const newState = result.cardState as AnkiSM2CardState;
          expect(newState.ease).toBeGreaterThanOrEqual(1.3);
        }),
        { numRuns: NUM_RUNS ?? 500 },
      );
    });

    it("ease direction: again/hard decrease, good preserves, easy increases", () => {
      fc.assert(
        fc.property(arbReviewCard, arbCardId, (card, cardId) => {
          card.due = Date.now();
          // Use ease well above floor so decreases are visible
          card.ease = Math.max(2.0, card.ease);

          const again = (algo.reviewCard(card, "again", cardId).cardState as AnkiSM2CardState).ease;
          const hard = (algo.reviewCard(card, "hard", cardId).cardState as AnkiSM2CardState).ease;
          const good = (algo.reviewCard(card, "good", cardId).cardState as AnkiSM2CardState).ease;
          const easy = (algo.reviewCard(card, "easy", cardId).cardState as AnkiSM2CardState).ease;

          expect(again).toBeLessThan(card.ease);
          expect(hard).toBeLessThan(card.ease);
          expect(good).toBeCloseTo(card.ease, 10);
          expect(easy).toBeGreaterThan(card.ease);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("reps always increment", () => {
    it("reps increases by 1 for any review card answer", () => {
      fc.assert(
        fc.property(arbReviewCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const newState = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          expect(newState.reps).toBe(card.reps + 1);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("reps increases by 1 for any learning card answer", () => {
      fc.assert(
        fc.property(arbLearningCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const newState = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          expect(newState.reps).toBe(card.reps + 1);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("lapses", () => {
    it("lapses increment only on 'again' from review phase", () => {
      fc.assert(
        fc.property(arbReviewCard, arbCardId, (card, cardId) => {
          card.due = Date.now();
          const again = algo.reviewCard(card, "again", cardId).cardState as AnkiSM2CardState;
          expect(again.lapses).toBe(card.lapses + 1);

          for (const answer of ["hard", "good", "easy"] as Answer[]) {
            const result = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
            expect(result.lapses).toBe(card.lapses);
          }
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("lapses stay unchanged for learning card answers", () => {
      fc.assert(
        fc.property(arbLearningCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const newState = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          expect(newState.lapses).toBe(card.lapses);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("phase transitions", () => {
    it("review cards transition to valid phases only", () => {
      fc.assert(
        fc.property(arbReviewCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const newState = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          // review → review (hard/good/easy) or review → relearning (again)
          if (answer === "again") {
            expect(["review", "relearning"]).toContain(newState.phase);
          } else {
            expect(newState.phase).toBe("review");
          }
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("learning cards transition to valid phases only", () => {
      fc.assert(
        fc.property(arbLearningCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const newState = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          // learning/relearning → learning/relearning/review
          expect(["learning", "relearning", "review"]).toContain(newState.phase);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("new cards transition to learning or review only", () => {
      const newCard = algo.createCard();
      fc.assert(
        fc.property(arbAnswer, (answer) => {
          const newState = algo.reviewCard(newCard, answer).cardState as AnkiSM2CardState;
          expect(["learning", "review"]).toContain(newState.phase);
        }),
      );
    });
  });

  describe("interval clamping", () => {
    it("interval never exceeds maximumInterval", () => {
      const maxInterval = 100;
      const capped = new AnkiSM2Algorithm({ maximumInterval: maxInterval });

      fc.assert(
        fc.property(arbReviewCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          card.interval = Math.min(card.interval, maxInterval); // start within bounds
          const newState = capped.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          expect(newState.interval).toBeLessThanOrEqual(maxInterval);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("interval is always >= 1 for review phase results", () => {
      fc.assert(
        fc.property(arbReviewCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const newState = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          if (newState.phase === "review") {
            expect(newState.interval).toBeGreaterThanOrEqual(1);
          }
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("fuzz determinism", () => {
    it("same card + same cardId produces identical results", () => {
      fc.assert(
        fc.property(arbReviewCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const result1 = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          const result2 = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          expect(result1.interval).toBe(result2.interval);
          expect(result1.ease).toBe(result2.ease);
          expect(result1.phase).toBe(result2.phase);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("due date", () => {
    it("due date is always in the future for review results", () => {
      fc.assert(
        fc.property(arbReviewCard, arbAnswer, arbCardId, (card, answer, cardId) => {
          card.due = Date.now();
          const newState = algo.reviewCard(card, answer, cardId).cardState as AnkiSM2CardState;
          expect(newState.due).toBeGreaterThanOrEqual(Date.now());
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("leech detection", () => {
    it("leech triggers at exact threshold boundary", () => {
      fc.assert(
        fc.property(fc.integer({ min: 2, max: 20 }), arbCardId, (threshold, cardId) => {
          const custom = new AnkiSM2Algorithm({ leechThreshold: threshold });
          const card: AnkiSM2CardState = {
            phase: "review",
            step: 0,
            ease: 2.5,
            interval: 10,
            due: Date.now(),
            lapses: threshold - 1,
            reps: 50,
          };
          const result = custom.reviewCard(card, "again", cardId);
          expect((result.reviewLog as AnkiSM2ReviewLog).leeched).toBe(true);
        }),
        { numRuns: NUM_RUNS ?? 50 },
      );
    });

    it("no leech below threshold", () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 3, max: 20 }),
          fc.integer({ min: 0, max: 100 }),
          arbCardId,
          (threshold, lapsesBelow, cardId) => {
            const lapses = lapsesBelow % (threshold - 1); // always below threshold-1
            const custom = new AnkiSM2Algorithm({ leechThreshold: threshold });
            const card: AnkiSM2CardState = {
              phase: "review",
              step: 0,
              ease: 2.5,
              interval: 10,
              due: Date.now(),
              lapses,
              reps: 50,
            };
            const result = custom.reviewCard(card, "again", cardId);
            // After answering 'again', lapses becomes lapses+1
            // Leech triggers when newLapses >= threshold AND (newLapses - threshold) % ceil(threshold/2) === 0
            const newLapses = lapses + 1;
            if (newLapses < threshold) {
              expect((result.reviewLog as AnkiSM2ReviewLog).leeched).toBe(false);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });

  describe("answer sequence invariants", () => {
    it("repeated 'good' on review cards keeps phase as review", () => {
      fc.assert(
        fc.property(
          arbReviewCard,
          fc.integer({ min: 2, max: 10 }),
          arbCardId,
          (initialCard, rounds, cardId) => {
            let card = { ...initialCard, due: Date.now() };
            for (let i = 0; i < rounds; i++) {
              const result = algo.reviewCard(card, "good", cardId);
              card = result.cardState as AnkiSM2CardState;
              expect(card.phase).toBe("review");
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });
});
