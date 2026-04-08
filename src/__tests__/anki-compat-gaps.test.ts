/**
 * Tests for data store, writing, and reading discrepancies between this PWA
 * and the official Anki desktop client (ankitects/anki).
 *
 * Every test in this file is EXPECTED TO FAIL against the current implementation,
 * documenting a gap that should be closed for full Anki compatibility.
 *
 * Reference: ../anki rslib/src (Rust backend)
 */
import { describe, it, expect } from "vitest";
import { AnkiSM2Algorithm } from "../scheduler/anki-sm2-algorithm";
import {
  encodeLeft,
  encodeFactor,
  phaseToRevlogType,
  serializeCardData,
} from "../lib/syncWrite";
import type { CardReviewState } from "../scheduler/types";

// ─────────────────────────────────────────────────────────────────────────────
// GAP 1: SM-2 review "good" does NOT include late days in interval calculation
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (review.rs:213-246):
//   good_interval = (current_interval + days_late/2) * ease_factor * interval_multiplier
//   The interval is constrained so that good > hard.
//
// PWA (anki-sm2-algorithm.ts:100-111):
//   good: (interval + late/2) * ease * intervalModifier
//   This is correct in formula BUT Anki also ensures good_interval > hard_interval.
//   The PWA skips the constraint, so good can equal or be less than hard after fuzz.
describe("GAP 1: SM-2 review good interval must be > hard interval", () => {
  it("good interval should always be strictly greater than hard interval", () => {
    const algo = new AnkiSM2Algorithm({
      learningSteps: [1, 10],
      relearningSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      startingEase: 2.5,
      easyBonus: 1.3,
      hardMultiplier: 1.2,
      intervalModifier: 1.0,
      lapseNewInterval: 0,
      minLapseInterval: 1,
      maximumInterval: 36500,
    });

    // Use a card with a small interval where hard * 1.2 ≈ good after fuzz
    const card = {
      phase: "review" as const,
      step: 0,
      ease: 1.3, // minimum ease
      interval: 2,
      due: Date.now() - 2 * 86400000, // exactly on time
      lapses: 0,
      reps: 5,
    };

    // Run many times to account for fuzz randomness
    let goodLessOrEqualHard = false;
    for (let i = 0; i < 100; i++) {
      const hardResult = algo.reviewCard(card, "hard");
      const goodResult = algo.reviewCard(card, "good");
      const hardState = hardResult.cardState as { interval: number };
      const goodState = goodResult.cardState as { interval: number };
      if (goodState.interval <= hardState.interval) {
        goodLessOrEqualHard = true;
        break;
      }
    }

    // In official Anki, good is ALWAYS > hard. PWA can violate this.
    // This test should fail because the PWA doesn't enforce the constraint.
    expect(goodLessOrEqualHard).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 2: SM-2 review "easy" does NOT include late days in interval calculation
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (review.rs:238-244):
//   easy_interval = (current_interval + days_late) * ease_factor * easy_multiplier * interval_multiplier
//   Constrained: easy > good
//
// PWA (anki-sm2-algorithm.ts:113-127):
//   easy: (interval + late) * ease * easyBonus * intervalModifier
//   No constraint that easy > good.
describe("GAP 2: SM-2 review easy interval must be > good interval", () => {
  it("easy interval should always be strictly greater than good interval", () => {
    const algo = new AnkiSM2Algorithm();

    const card = {
      phase: "review" as const,
      step: 0,
      ease: 1.3,
      interval: 1,
      due: Date.now(),
      lapses: 0,
      reps: 5,
    };

    let easyLessOrEqualGood = false;
    for (let i = 0; i < 100; i++) {
      const goodResult = algo.reviewCard(card, "good");
      const easyResult = algo.reviewCard(card, "easy");
      const goodState = goodResult.cardState as { interval: number };
      const easyState = easyResult.cardState as { interval: number };
      if (easyState.interval <= goodState.interval) {
        easyLessOrEqualGood = true;
        break;
      }
    }

    expect(easyLessOrEqualGood).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 3: SM-2 "hard" on review uses wrong late-days formula
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (review.rs:224):
//   hard_interval = current_interval * hard_multiplier * interval_multiplier
//   Note: late days are NOT included in the hard calculation.
//
// PWA (anki-sm2-algorithm.ts:87-88):
//   hard: (interval + late / 4) * hardMultiplier * intervalModifier
//   The PWA adds late/4 to interval for hard, which Anki does NOT do.
describe("GAP 3: SM-2 hard on review should NOT include late days", () => {
  it("hard interval should only use current_interval * hard_multiplier, no late bonus", () => {
    const algo = new AnkiSM2Algorithm({
      learningSteps: [1, 10],
      relearningSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      startingEase: 2.5,
      easyBonus: 1.3,
      hardMultiplier: 1.2,
      intervalModifier: 1.0,
      lapseNewInterval: 0,
      minLapseInterval: 1,
      maximumInterval: 36500,
    });

    // Card is 100 days overdue
    const card = {
      phase: "review" as const,
      step: 0,
      ease: 2.5,
      interval: 10,
      due: Date.now() - 100 * 86400000,
      lapses: 0,
      reps: 5,
    };

    const result = algo.reviewCard(card, "hard");
    const newState = result.cardState as { interval: number };

    // Official Anki: hard = 10 * 1.2 = 12 (no late days influence)
    // PWA: hard = (10 + 100/4) * 1.2 = 35 * 1.2 = 42
    // The PWA interval will be much larger due to the late/4 term
    // Official value (without fuzz) should be close to 12
    expect(newState.interval).toBeLessThanOrEqual(15);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 4: Revlog interval for learning cards should be negative (seconds)
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (interval_kind.rs:32-37):
//   Learning intervals are stored as negative seconds in revlog.ivl.
//   InDays(days) → days (positive)
//   InSecs(secs) → -secs (negative)
//
// PWA (syncWrite.ts:288):
//   ivl = Math.round(reviewLog?.interval ?? 0)
//   Always positive — learning cards store interval in days (fractional),
//   rounded to a positive integer, losing sub-day precision.
describe("GAP 4: Revlog ivl for learning/relearning should be negative seconds", () => {
  it("learning card revlog ivl should be negative (representing seconds)", () => {
    // A learning card with a 10-minute step should have ivl = -600
    // The PWA stores this as 0 (since 10 min / 1440 min per day rounds to 0)
    // Official Anki would store -600

    const algo = new AnkiSM2Algorithm();
    const newCard = algo.createCard();

    // Answer "good" to move to step 1 (10 min)
    const result = algo.reviewCard(newCard, "good");
    const log = result.reviewLog as { interval?: number };

    // The interval stored in reviewLog should represent 10 minutes
    // In Anki revlog format, this would be -600 (negative seconds)
    // PWA stores it as a fractional day (10/1440 ≈ 0.00694)
    // When written to revlog, Math.round(0.00694) = 0, losing all info

    // Check that the interval is expressed in a way that preserves sub-day info
    // Either as negative seconds or as a fractional value that can be converted
    const ivlForRevlog = Math.round(log?.interval ?? 0);
    // This will be 0 in PWA (losing information) but should be -600
    expect(ivlForRevlog).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 5: Revlog lastIvl should also be negative seconds for learning cards
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (revlog.rs:48-49):
//   interval: self.interval.as_revlog_interval()
//   last_interval: self.last_interval.as_revlog_interval()
//   Both use the same sign convention.
//
// PWA (syncWrite.ts:289):
//   lastIvl = Math.round(reviewLog?.previousInterval ?? 0)
//   Same issue: always positive, loses sub-day precision.
describe("GAP 5: Revlog lastIvl for learning should be negative seconds", () => {
  it("previous interval for a learning card should be negative seconds", () => {
    const algo = new AnkiSM2Algorithm();
    const newCard = algo.createCard();

    // Step through learning: "good" → step 0 to step 1
    const result1 = algo.reviewCard(newCard, "good");
    const state1 = result1.cardState;

    // Review again at step 1
    const result2 = algo.reviewCard(state1, "good");
    const log2 = result2.reviewLog as { previousInterval?: number };

    // previousInterval should represent 1 minute = -60 in Anki's format
    const lastIvlForRevlog = Math.round(log2?.previousInterval ?? 0);
    expect(lastIvlForRevlog).toBeLessThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 6: FSRS revlog factor uses wrong encoding
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (card/mod.rs:116-124, answering/revlog.rs:50):
//   FSRS difficulty is stored as: (difficulty_shifted * 1000).round()
//   difficulty_shifted = ((difficulty - 1.0) / 9.0) + 0.1
//   So for difficulty=5.0: ((5-1)/9)+0.1 = 0.544... → 544
//
// PWA (syncWrite.ts:119-128):
//   FSRS factor = Math.round(difficulty * 100) + 100
//   For difficulty=5.0: 500 + 100 = 600
//   This is a completely different encoding.
describe("GAP 6: FSRS revlog factor encoding diverges from Anki", () => {
  it("FSRS difficulty=5.0 should encode as ~544, not 600", () => {
    const difficulty = 5.0;
    // Official Anki: ((5.0 - 1.0) / 9.0 + 0.1) * 1000 = 544
    const officialFactor = Math.round(((difficulty - 1.0) / 9.0 + 0.1) * 1000);
    expect(officialFactor).toBe(544);

    const pwaFactor = encodeFactor(0, "fsrs", difficulty);
    expect(pwaFactor).toBe(officialFactor);
  });

  it("FSRS difficulty=1.0 should encode as 100, not 200", () => {
    const difficulty = 1.0;
    const officialFactor = Math.round(((difficulty - 1.0) / 9.0 + 0.1) * 1000);
    expect(officialFactor).toBe(100);

    const pwaFactor = encodeFactor(0, "fsrs", difficulty);
    expect(pwaFactor).toBe(officialFactor);
  });

  it("FSRS difficulty=3.0 should encode as ~322, not 400", () => {
    const difficulty = 3.0;
    // Official: ((3.0 - 1.0) / 9.0 + 0.1) * 1000 = (0.222 + 0.1) * 1000 = 322
    const officialFactor = Math.round(((difficulty - 1.0) / 9.0 + 0.1) * 1000);
    expect(officialFactor).toBe(322);

    const pwaFactor = encodeFactor(0, "fsrs", difficulty);
    // PWA: 3.0 * 100 + 100 = 400 (wrong)
    expect(pwaFactor).toBe(officialFactor);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 7: Card data JSON missing decay, lrt, pos fields
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (storage/card/data.rs):
//   CardData { pos, s, d, dr, decay, lrt, cd }
//   - pos: original new queue position
//   - decay: FSRS decay factor
//   - lrt: last review time (seconds since epoch)
//   - cd: custom data
//
// PWA (syncWrite.ts:216-231):
//   Only writes { s, d, dr } — missing decay, lrt, pos, and cd fields.
describe("GAP 7: Card data JSON missing decay, lrt, pos fields", () => {
  it("should serialize decay field in card data when present", () => {
    const card: CardReviewState = {
      cardId: "123",
      deckId: "deck1",
      algorithm: "fsrs",
      cardState: {
        stability: 45.2,
        difficulty: 5.0,
        desiredRetention: 0.9,
        decay: 0.5,
      },
      createdAt: Date.now(),
      lastReviewed: Date.now(),
    };

    const serialized = serializeCardData(card);
    const parsed = JSON.parse(serialized);

    expect(parsed).toHaveProperty("decay");
  });

  it("should serialize lrt (last review time) in card data", () => {
    const card: CardReviewState = {
      cardId: "123",
      deckId: "deck1",
      algorithm: "fsrs",
      cardState: {
        stability: 45.2,
        difficulty: 5.0,
        desiredRetention: 0.9,
      },
      createdAt: Date.now(),
      lastReviewed: 1700000000000,
    };

    const serialized = serializeCardData(card);
    const parsed = JSON.parse(serialized);

    expect(parsed).toHaveProperty("lrt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 8: Card data floats not rounded to Anki's precision
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (storage/card/data.rs:93-106):
//   stability → 4 decimal places
//   difficulty → 3 decimal places
//   desired_retention → 2 decimal places
//   decay → 3 decimal places
//
// PWA (syncWrite.ts:220-221): No rounding at all.
describe("GAP 8: Card data FSRS floats not rounded to Anki precision", () => {
  it("stability should be rounded to 4 decimal places", () => {
    const card: CardReviewState = {
      cardId: "123",
      deckId: "deck1",
      algorithm: "fsrs",
      cardState: {
        stability: 123.45678901,
        difficulty: 5.0,
      },
      createdAt: Date.now(),
      lastReviewed: null,
    };

    const serialized = serializeCardData(card);
    const parsed = JSON.parse(serialized);

    const rawParts = parsed.s.toString().split(".");
    const decimals = rawParts[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(4);
  });

  it("difficulty should be rounded to 3 decimal places", () => {
    const card: CardReviewState = {
      cardId: "123",
      deckId: "deck1",
      algorithm: "fsrs",
      cardState: {
        stability: 10.0,
        difficulty: 1.234567,
      },
      createdAt: Date.now(),
      lastReviewed: null,
    };

    const serialized = serializeCardData(card);
    const parsed = JSON.parse(serialized);

    const rawParts = parsed.d.toString().split(".");
    const decimals = rawParts[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(3);
  });

  it("desired_retention should be rounded to 2 decimal places", () => {
    const card: CardReviewState = {
      cardId: "123",
      deckId: "deck1",
      algorithm: "fsrs",
      cardState: {
        stability: 10.0,
        difficulty: 5.0,
        desiredRetention: 0.987654,
      },
      createdAt: Date.now(),
      lastReviewed: null,
    };

    const serialized = serializeCardData(card);
    const parsed = JSON.parse(serialized);

    const rawParts = parsed.dr.toString().split(".");
    const decimals = rawParts[1]?.length ?? 0;
    expect(decimals).toBeLessThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 9: Review "good" on learning does NOT track previousInterval in seconds
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (revlog.rs:29): last_interval = current.interval_kind()
//   For learning cards: interval_kind() returns InSecs(scheduled_secs)
//   This gets written as negative seconds: -secs
//
// PWA: reviewLog stores interval as fractional days. When written to revlog,
//   Math.round(fractionalDays) loses the previous interval entirely for sub-day steps.
describe("GAP 9: Review log should track previousInterval in seconds for learning", () => {
  it("interval in reviewLog should be negative seconds for learning cards", () => {
    const algo = new AnkiSM2Algorithm();
    const card = algo.createCard();

    // "good" → enters learning at step 1 (10 min)
    const result1 = algo.reviewCard(card, "good");
    const log1 = result1.reviewLog as { interval?: number };

    // The revlog interval for a learning card should be negative seconds
    // 10 min = 600 seconds → stored as -600 (with possible fuzz)
    expect(log1.interval).toBeLessThan(0);
    // Should be approximately -600 to -750 (with up to 25% fuzz)
    expect(log1.interval!).toBeLessThanOrEqual(-600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 10: SM-2 learning "hard" delay calculation diverges
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (states/steps.rs:55-66):
//   hard_delay for single step: min(step[0]*1.5, step[0]+1day)
//   If secs > 1 day: round to whole number of days (maybe_round_in_days).
//
// PWA (anki-sm2-algorithm.ts:152-159):
//   Applies the formula but does NOT round to whole days for delays > 1 day.
//   For a single 2-day step, Anki hard = min(2*1.5, 2+1) = 3 days (exactly)
//   For a single 1.5-day step (2160 min): hard = min(1.5*1.5, 1.5+1) = 2.25 days
//   Anki rounds 2.25 days → 2 days (whole). PWA keeps 2.25 as fractional.
describe("GAP 10: Learning hard delay not rounded to whole days when > 1 day", () => {
  it("hard delay > 1 day should be rounded to whole number of days", () => {
    // Use a single step of 2000 minutes (1.389 days)
    // For a single step, hard = min(step*1.5, step+1440) = min(3000, 3440) = 3000 min
    // 3000 min = 2.083 days. Anki rounds to 2 days (maybe_round_in_days).
    // PWA keeps 3000 min as-is (no day-rounding).
    const algo = new AnkiSM2Algorithm({
      learningSteps: [2000], // ~1.389 days (single step)
      relearningSteps: [10],
      graduatingInterval: 7,
      easyInterval: 10,
      startingEase: 2.5,
      easyBonus: 1.3,
      hardMultiplier: 1.2,
      intervalModifier: 1.0,
      lapseNewInterval: 0,
      minLapseInterval: 1,
      maximumInterval: 36500,
    });

    // Directly construct a learning card at step 0 (skip the new→learning transition)
    const learningState = {
      phase: "learning" as const,
      step: 0,
      ease: 2.5,
      interval: 0,
      due: Date.now() + 2000 * 60 * 1000,
      lapses: 0,
      reps: 1,
    };

    const hardResult = algo.reviewCard(learningState, "hard");
    const hardState = hardResult.cardState as { due: number };
    const delayMs = hardState.due - Date.now();

    // PWA: min(2000*1.5, 2000+1440) * 60000 = 3000 * 60000 ms = 2.083 days
    // Anki: round(2.083) = 2 days = 172800000 ms
    const delayDays = delayMs / 86400000;
    expect(Math.abs(delayDays - Math.round(delayDays))).toBeLessThan(0.01);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 11: Learning "hard" does NOT advance the step in Anki (stays at same step)
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (states/learning.rs:86-95):
//   answer_hard: keeps remaining_steps the same (..self)
//   The step index doesn't change on Hard — only the delay changes.
//
// PWA (anki-sm2-algorithm.ts:151-164):
//   Hard also doesn't advance step (uses ...card), which matches.
//   BUT: the `remaining_steps` model is inverted. Anki counts DOWN
//   (remaining_steps = total - completed), PWA counts UP (step index).
//   This means the `left` field encoding is subtly wrong.
describe("GAP 11: Learning steps use index (up) vs remaining (down) model", () => {
  it("Anki uses remaining_steps counting DOWN, PWA uses step index counting UP", () => {
    // Official Anki: remaining_steps starts at total_steps, goes down.
    //   For 3 steps: remaining starts at 3, after "good" → 2, then → 1, then graduate
    //   remaining_for_failed() = total (reset to start)
    //   remaining_for_good(remaining) = total - (get_index(remaining) + 1)
    //
    // PWA: step starts at 0, goes up.
    //   After "good": step 0 → 1, step 1 → 2, step 2 → graduate
    //
    // The encodeLeft function maps step → remaining:
    //   stepsRemaining = totalSteps - step
    // But Anki's get_index uses: total - (remaining % 1000)
    //   Then remaining_for_good = total - (idx + 1)
    //
    // These are equivalent for simple cases but diverge with stepsToday (midnight crossing).
    // When a card crosses midnight, stepsToday < stepsRemaining.
    // Anki encodes: left = stepsToday * 1000 + stepsRemaining
    // The get_index function: idx = total - (remaining % 1000) = total - stepsRemaining
    // The card's step in PWA terms = total - stepsRemaining

    // Let's test: card at step 1 of 3, crosses midnight, stepsToday = 1
    const totalSteps = 3;
    const step = 1; // PWA step index
    // stepsRemaining = totalSteps - step = 2
    const stepsToday = 1; // Only 1 step left today

    const left = encodeLeft({ phase: "learning", step }, totalSteps, stepsToday);
    // Correct: 1 * 1000 + 2 = 1002
    expect(left).toBe(1002);

    // Now when Anki reads this back:
    // get_index(1002) = total - (1002 % 1000) = 3 - 2 = 1
    // This means step index 1, which matches. So far OK.

    // BUT: Anki's hard_delay_secs(1002) calls get_index(1002) → idx=1
    //   secs_at_index(1) → step[1]
    //   Since idx != 0, just returns step[1] delay.
    // PWA's hard: step[card.step] = step[1], same.
    //
    // The REAL divergence is when stepsToday doesn't match stepsRemaining
    // and the card is saved then loaded. The PWA has no concept of stepsToday
    // in its CardReviewState — it only has `step`.
    // When loading from SQLite, the PWA must correctly parse `left` back to a step index.

    // Verify roundtrip: can the PWA reconstruct step from left?
    // The PWA should parse left field and derive step = totalSteps - (left % 1000)
    const parsedStepsRemaining = left % 1000;
    const parsedStep = totalSteps - parsedStepsRemaining;
    expect(parsedStep).toBe(step);

    // But the stepsToday (left / 1000) is lost in the PWA model.
    // This is a data model gap — CardReviewState has no stepsToday field.
    // When the card crosses midnight and is synced back, stepsToday should be updated.
    // The PWA always uses stepsRemaining as stepsToday in encodeLeft (line 97).
    // This is only correct if the card hasn't crossed midnight.

    // Without explicit stepsToday, it defaults to stepsRemaining.
    // This is correct when the card hasn't crossed midnight.
    const leftWithoutExplicitToday = encodeLeft({ phase: "learning", step }, totalSteps);
    expect(leftWithoutExplicitToday).toBe(2002); // 2*1000 + 2

    // To get stepsToday=1 (midnight crossing), the caller must pass it explicitly.
    const leftWithExplicitToday = encodeLeft({ phase: "learning", step }, totalSteps, stepsToday);
    expect(leftWithExplicitToday).toBe(1002);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 12: Revlog type for "new" cards answered should be Learning (0)
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki: when a new card is answered, it transitions to learning state.
//   The revlog_kind comes from the CURRENT state (before transition):
//   New → Learning transition uses LearnState.revlog_kind() → Learning (0)
//
// PWA (syncWrite.ts:301): uses the card's CURRENT phase from cardState,
//   but cardState might already be the post-review state, not pre-review.
describe("GAP 12: Revlog type should reflect the state BEFORE the review", () => {
  it("new → learning transition should use revlog type Learning (0), not default Review (1)", () => {
    // When a new card is reviewed, the phase transitions to "learning".
    // The PWA uses the post-review phase for revlog type.
    // If the reviewLog doesn't include the previous phase, it falls through to
    // the cardState's phase (which is already "learning" after the review).
    // This is correct for "learning" → type 0.
    // BUT: if we look at the default fallback (line 110):
    //   default: return 1  ← this means "new" phase maps to Review (1)!
    expect(phaseToRevlogType("new")).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 13: Review card "again" with lapseNewInterval=0 should use lapse multiplier
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (review.rs:75-92):
//   failing_review_interval uses: max(1, scheduled_days * lapse_multiplier)
//   Then fuzz is applied, and the result is clamped to [minimum_lapse_interval, max].
//
// PWA (anki-sm2-algorithm.ts:60-63):
//   newIvl = max(minLapseInterval, round(interval * lapseNewInterval))
//   When lapseNewInterval=0: newIvl = max(1, round(interval * 0)) = max(1, 0) = 1
//   Anki's lapse_multiplier default is also 0, but the formula differs because
//   Anki uses scheduled_days (not the stored interval property directly).
// Official Anki (review.rs:84-91): applies review_fuzz to the lapse interval.
// PWA (anki-sm2-algorithm.ts:60-63): no fuzz on lapse interval.
describe("GAP 13: Lapse interval should have fuzz applied (like Anki)", () => {
  it("lapse interval with nonzero multiplier should have fuzz applied", () => {
    const algo = new AnkiSM2Algorithm({
      learningSteps: [1, 10],
      relearningSteps: [], // no relearning steps → go straight to review
      graduatingInterval: 1,
      easyInterval: 4,
      startingEase: 2.5,
      easyBonus: 1.3,
      hardMultiplier: 1.2,
      intervalModifier: 1.0,
      lapseNewInterval: 0.5, // 50% of previous interval
      minLapseInterval: 1,
      maximumInterval: 36500,
    });

    const card = {
      phase: "review" as const,
      step: 0,
      ease: 2.5,
      interval: 30,
      due: Date.now(),
      lapses: 0,
      reps: 10,
    };

    // Official Anki: lapse interval = max(1, 30 * 0.5) = 15, then fuzz applied
    // With deterministic fuzz, different reps values produce different results
    const results = new Set<number>();
    for (let reps = 1; reps < 50; reps++) {
      const cardWithReps = { ...card, reps };
      const result = algo.reviewCard(cardWithReps, "again");
      const newState = result.cardState as { interval: number };
      results.add(newState.interval);
    }

    // If fuzz is applied, different seeds (reps) should produce variation around 15.
    expect(results.size).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 14: SM-2 "easy" on relearning should add +1 day to interval
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (states/relearning.rs): For Easy on relearning, the card
//   goes directly to review with the FSRS/SM-2 computed interval.
//   The interval is the review state's scheduled_days (not +1).
//
// PWA (anki-sm2-algorithm.ts:190-200):
//   Easy on relearning: interval = max(minLapseInterval, card.interval) + 1
//   The +1 is not in official Anki. Anki graduates from relearning with the
//   computed interval unchanged (the ease bonus is already baked into the interval
//   during the review → relearn transition).
describe("GAP 14: Easy on relearning should NOT add +1 to interval", () => {
  it("easy on relearning should use the existing interval without +1 bonus", () => {
    const algo = new AnkiSM2Algorithm({
      learningSteps: [1, 10],
      relearningSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      startingEase: 2.5,
      easyBonus: 1.3,
      hardMultiplier: 1.2,
      intervalModifier: 1.0,
      lapseNewInterval: 0,
      minLapseInterval: 1,
      maximumInterval: 36500,
    });

    // Simulate a relearning card with interval 10
    const card = {
      phase: "relearning" as const,
      step: 0,
      ease: 2.5,
      interval: 10,
      due: Date.now() + 10 * 60000,
      lapses: 1,
      reps: 10,
    };

    const result = algo.reviewCard(card, "easy");
    const newState = result.cardState as { interval: number; phase: string };

    // PWA: max(1, 10) + 1 = 11
    // Official Anki: the relearning easy just graduates to review with
    // the review state's scheduled_days (computed earlier, no +1)
    expect(newState.interval).toBe(10); // Should be 10, not 11
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 15: Review "again" ease clamp should happen AFTER decrement
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (review.rs:101):
//   ease_factor: (self.ease_factor + EASE_FACTOR_AGAIN_DELTA).max(MINIMUM_EASE_FACTOR)
//   = max(1.3, ease - 0.2)
//
// PWA (anki-sm2-algorithm.ts:59):
//   ease = Math.max(MIN_EASE, ease - 0.2)
//   This is actually the same. OK, this one is correct.
//
// But: Anki's "good" on review does NOT change ease at all.
// PWA (anki-sm2-algorithm.ts:100): good answer doesn't change ease. Correct.
//
// Real gap: Anki applies intervalModifier ONLY to the fuzzed interval, not before.
// PWA applies it before fuzz in the raw calculation.
describe("GAP 15: intervalModifier should be applied before fuzz, not as part of raw calc", () => {
  it("interval multiplier order of operations matches Anki", () => {
    // Official Anki (review.rs:302-313):
    //   constrain_passing_interval: interval = interval * interval_multiplier (if not FSRS)
    //   Then applies fuzz, then clamps to [minimum, maximum]
    //
    // PWA (anki-sm2-algorithm.ts:101):
    //   rawIvl = (interval + late / 2) * ease * intervalModifier
    //   newIvl = clamp(addFuzz(max(interval + 1, round(rawIvl))))
    //
    // In Anki, the multiplication is: (interval + late/2) * ease, THEN * interval_multiplier.
    // In PWA, it's the same: (interval + late/2) * ease * intervalModifier
    // But Anki applies interval_multiplier inside constrain_passing_interval,
    // meaning fuzz is applied AFTER the multiplier.
    // In PWA, fuzz is also applied after: addFuzz(round(rawIvl))
    // This is actually the same order. OK.

    // The REAL difference: Anki's fuzz uses review-specific fuzz that considers
    // the fuzz_factor (deterministic based on card ID + reps). PWA uses Math.random().
    // This means PWA's fuzz is non-deterministic and can't be reproduced.
    const algo = new AnkiSM2Algorithm();

    const card = {
      phase: "review" as const,
      step: 0,
      ease: 2.5,
      interval: 10,
      due: Date.now(),
      lapses: 0,
      reps: 5,
    };

    // Call reviewCard twice with same state — should get same result in Anki (deterministic)
    // but different in PWA (Math.random)
    const result1 = algo.reviewCard(card, "good");
    algo.reviewCard(card, "good"); // second call to verify determinism
    const ivl1 = (result1.cardState as { interval: number }).interval;

    // In official Anki with same seed, these would be identical.
    // This test will sometimes pass by coincidence, so we run many times.
    let allSame = true;
    for (let i = 0; i < 50; i++) {
      const r = algo.reviewCard(card, "good");
      const ivl = (r.cardState as { interval: number }).interval;
      if (ivl !== ivl1) {
        allSame = false;
        break;
      }
    }

    // PWA uses Math.random() so results vary — Anki uses deterministic fuzz
    expect(allSame).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 16: Sync write-back stores learning ivl as positive days, not negative seconds
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (interval_kind.rs:32-37):
//   Learning intervals in the cards table: InSecs → stored in DB via
//   the card's interval field as a positive number of days.
//   But revlog uses negative seconds for sub-day intervals.
//
// In the cards.ivl column, Anki stores days (always non-negative).
// But syncWrite.ts:185 rounds the PWA's fractional day interval:
//   ivl = Math.max(0, Math.round(state.interval))
// For a learning card with interval=0.00694 (10 min), this becomes 0.
// Anki stores the card.interval as 0 for learning cards, which is correct.
// But the card.due for queue=1 (learn) should be a unix timestamp in seconds.
//
// The real issue: when a learning card has interval >= 1 day but < 1.5 days,
// Math.round can round down to 0, losing the interval.
describe("GAP 16: Revlog interval for sub-day learning uses negative seconds", () => {
  it("learning card revlog interval should encode sub-day values as negative seconds", () => {
    const algo = new AnkiSM2Algorithm();
    const card = algo.createCard();

    // "again" → stays at step 0 (1 min)
    const result = algo.reviewCard(card, "again");
    const log = result.reviewLog as { interval?: number };

    // 1 min = 60 seconds → revlog interval should be -60 (with possible fuzz)
    // Anki convention: negative = seconds for sub-day intervals
    expect(log.interval).toBeLessThan(0);
    expect(log.interval!).toBeLessThanOrEqual(-60);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 17: SM-2 learning fuzz — Anki adds up to 25% / max 5 min fuzz
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (answering/learning.rs:82-95):
//   fuzzed_next_learning_timestamp adds fuzz:
//     upper = secs + min(secs * 0.25, 300) // 25% max 5 minutes
//     actual = random(secs..upper)
//
// PWA: Learning timestamps use exact step times with no fuzz.
//   due = now + steps[n] * MS_PER_MINUTE (exact, no fuzz)
describe("GAP 17: Learning card due times should include fuzz", () => {
  it("learning step due time should include up to 25% fuzz (max 5 min)", () => {
    const algo = new AnkiSM2Algorithm();
    const card = algo.createCard();

    // Review "good" to enter learning at step 1 (10 minutes)
    const result = algo.reviewCard(card, "good");
    const state = result.cardState as { due: number; phase: string };

    expect(state.phase).toBe("learning");

    // The due time should be now + 10min + fuzz
    // Fuzz for 600 seconds: min(600*0.25, 300) = 150 seconds
    // So due should be between now+600s and now+750s
    // Fuzz range: [600s, 750s) — some should exceed base 600s

    // PWA always sets exact due = now + steps[n] * MS_PER_MINUTE
    // So state.due should be approximately now + 600000 (no fuzz)
    // If fuzz were applied, some runs should give due > expectedMin

    let anyFuzzed = false;
    for (let i = 0; i < 50; i++) {
      const r = algo.reviewCard(card, "good");
      const s = r.cardState as { due: number };
      // Allow 1 second tolerance for test execution time
      if (s.due > Date.now() + 10 * 60000 + 1000) {
        anyFuzzed = true;
        break;
      }
    }

    // Anki would add fuzz, so some results should be above the base delay
    expect(anyFuzzed).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 18: SM-2 review fuzz should be deterministic (seeded), not random
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki: fuzz is deterministic, seeded from card ID + reps.
//   get_fuzz_seed_for_id_and_reps → StdRng::seed_from_u64 → deterministic range
//
// PWA (anki-sm2-algorithm.ts:37):
//   Math.floor(Math.random() * (fuzzRange * 2 + 1)) - fuzzRange
//   Completely non-deterministic.
describe("GAP 18: Review fuzz should be deterministic (seeded by card ID + reps)", () => {
  it("same card state should produce same fuzzed interval", () => {
    const algo = new AnkiSM2Algorithm();

    const card = {
      phase: "review" as const,
      step: 0,
      ease: 2.5,
      interval: 30,
      due: Date.now(),
      lapses: 0,
      reps: 10,
    };

    // In official Anki, reviewing the exact same card state always produces
    // the exact same interval (fuzz is deterministic).
    const results = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const r = algo.reviewCard(card, "good");
      results.add((r.cardState as { interval: number }).interval);
    }

    // If fuzz is deterministic, all results should be identical
    expect(results.size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 19: SM-2 minimum review fuzz range is wrong for small intervals
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki: Uses a different fuzz table (sub_day, 2-day, 3-6 day, 7-30, etc.)
//   The fuzz ranges are precisely defined.
//
// PWA (anki-sm2-algorithm.ts:35-38):
//   if interval < 2.5: no fuzz
//   if interval < 7: fuzzRange = 1
//   if interval < 30: fuzzRange = max(2, round(interval*0.15))
//   else: fuzzRange = max(4, round(interval*0.05))
//   These ranges don't match Anki's precise fuzz tables.
// Official Anki applies fuzz to intervals >= 2 days using a precise fuzz table.
// PWA (anki-sm2-algorithm.ts:34-38) doesn't fuzz intervals < 2.5 days.
// For interval = 2: Anki fuzzes to {2, 3}, PWA doesn't fuzz at all.
describe("GAP 19: Fuzz ranges don't match Anki's fuzz table", () => {
  it("addFuzz should fuzz interval of exactly 2 days (Anki does, PWA doesn't)", () => {
    // We test addFuzz directly by constructing a scenario where the
    // raw interval before fuzz is exactly 2.
    // Since addFuzz is not exported, we test through the algorithm.

    // Use a card where good produces exactly interval=2 before fuzz
    // good = max(interval+1, round((interval + late/2) * ease * modifier))
    // With interval=1, ease=1.3, late=0: round(1 * 1.3) = 1, max(2, 1) = 2
    // Then addFuzz(2): since 2 < 2.5, PWA returns 2 unchanged.
    const algo = new AnkiSM2Algorithm({
      learningSteps: [1, 10],
      relearningSteps: [10],
      graduatingInterval: 1,
      easyInterval: 4,
      startingEase: 1.3,
      easyBonus: 1.3,
      hardMultiplier: 1.2,
      intervalModifier: 1.0,
      lapseNewInterval: 0,
      minLapseInterval: 1,
      maximumInterval: 36500,
    });

    const card = {
      phase: "review" as const,
      step: 0,
      ease: 1.3,
      interval: 1,
      due: Date.now(), // exactly on time
      lapses: 0,
      reps: 5,
    };

    // With deterministic fuzz, different reps values should produce different results
    const results = new Set<number>();
    for (let reps = 1; reps < 50; reps++) {
      const cardWithReps = { ...card, reps };
      const r = algo.reviewCard(cardWithReps, "hard");
      results.add((r.cardState as { interval: number }).interval);
    }

    // Anki: interval 2 should get fuzz (varying between 2 and 3)
    // Different seeds should produce variation
    expect(results.size).toBeGreaterThan(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GAP 20: Early review (card answered before due date) not handled
// ─────────────────────────────────────────────────────────────────────────────
// Official Anki (review.rs:253-282): Special "early review" intervals.
//   When days_late < 0 (card reviewed before due), uses a different formula:
//   hard = max(elapsed * hard_factor, scheduled * half_factor)
//   good = max(elapsed * ease, scheduled)
//   easy = max(elapsed * ease, scheduled) * reduced_bonus
//   No fuzz applied.
//
// PWA: daysLate = Math.max(0, ...) — clamps to 0, completely ignoring early reviews.
//   This means early reviews are treated as on-time reviews (days_late=0).
describe("GAP 20: Early reviews (before due date) use wrong interval formula", () => {
  it("early review should use reduced interval formula, not on-time formula", () => {
    const algo = new AnkiSM2Algorithm();

    // Card due in 30 days, reviewed today (30 days early)
    const card = {
      phase: "review" as const,
      step: 0,
      ease: 2.5,
      interval: 30,
      due: Date.now() + 30 * 86400000, // Due in 30 days
      lapses: 0,
      reps: 10,
    };

    const result = algo.reviewCard(card, "good");
    const newState = result.cardState as { interval: number };

    // PWA: daysLate = max(0, (now - due) / day) = 0 (clamped)
    //   good = (30 + 0/2) * 2.5 * 1.0 = 75 (plus fuzz)
    //
    // Official Anki: days_late = elapsed - scheduled = 0 - 30 = -30
    //   Uses early review formula:
    //   good = max(elapsed * ease, scheduled) = max(0 * 2.5, 30) = 30
    //   No fuzz, no multiplier.
    //
    // The PWA gives ~75 days, Anki gives ~30 days for this early review.
    expect(newState.interval).toBeLessThanOrEqual(35);
  });
});
