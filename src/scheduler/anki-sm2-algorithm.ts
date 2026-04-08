import type { Answer } from "./types";
import type { SchedulingAlgorithm, SchedulingResult } from "./algorithm";
import { DEFAULT_SM2_PARAMS, type SM2Params } from "./types";
import { MS_PER_DAY } from "~/utils/constants";

type CardPhase = "new" | "learning" | "review" | "relearning";

interface AnkiSM2CardState {
  phase: CardPhase;
  /** Current learning/relearning step index */
  step: number;
  /** Ease factor (minimum 1.3, starts at startingEase) */
  ease: number;
  /** Interval in days (fractional for sub-day learning steps) */
  interval: number;
  /** Due timestamp in ms */
  due: number;
  /** Number of times the card lapsed */
  lapses: number;
  /** Total number of reviews */
  reps: number;
}

const MIN_EASE = 1.3;
const SECS_PER_DAY = 86400;

function resolveParams(partial?: Partial<SM2Params>): SM2Params {
  return { ...DEFAULT_SM2_PARAMS, ...partial };
}

function clampInterval(interval: number, params: SM2Params): number {
  return Math.max(1, Math.min(interval, params.maximumInterval));
}

/**
 * Deterministic PRNG (mulberry32). Returns a value in [0, 1).
 * Matches Anki's approach of seeding fuzz from card reps.
 */
function seededRandom(seed: number): number {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Apply deterministic fuzz to a review interval.
 * Matches Anki: fuzzes intervals >= 2 days with deterministic seeded RNG.
 * The result is clamped to [minimum, maximum].
 */
function addFuzz(interval: number, seed: number, minimum = 1, maximum = 36500): number {
  if (interval < 2) return Math.max(minimum, interval);
  const fuzzRange = interval < 7 ? 1 : interval < 30 ? Math.max(2, Math.round(interval * 0.15)) : Math.max(4, Math.round(interval * 0.05));
  const delta = Math.floor(seededRandom(seed) * (fuzzRange * 2 + 1)) - fuzzRange;
  return Math.min(maximum, Math.max(minimum, interval + delta));
}

/**
 * Add up to 25% fuzz to learning card delays (max 5 minutes / 300 seconds).
 * Matches Anki's fuzzed_next_learning_timestamp.
 */
function addLearningFuzz(secs: number, seed: number): number {
  const upper = Math.min(Math.floor(secs * 0.25), 300);
  if (upper < 1) return secs;
  return secs + Math.floor(seededRandom(seed) * upper);
}

/**
 * Compute days late (can be negative for early reviews).
 * Anki: days_late = elapsed_days - scheduled_days
 */
function daysLate(card: AnkiSM2CardState): number {
  const now = Date.now();
  return (now - card.due) / MS_PER_DAY;
}

/**
 * Encode interval for revlog using Anki's sign convention:
 * - Positive = days (review cards)
 * - Negative = seconds (learning/relearning cards with sub-day intervals)
 * Uses the due timestamp to compute the actual scheduled delay for learning cards.
 */
function encodeIntervalForRevlog(state: AnkiSM2CardState, now?: number): number {
  if (state.phase === "learning" || state.phase === "relearning" || state.phase === "new") {
    // For learning/relearning, compute delay from due timestamp
    const refTime = now ?? Date.now();
    const delaySecs = Math.round((state.due - refTime) / 1000);
    if (delaySecs > 0 && delaySecs < SECS_PER_DAY) {
      return -delaySecs; // negative seconds for sub-day
    }
    if (delaySecs >= SECS_PER_DAY) {
      return Math.round(delaySecs / SECS_PER_DAY); // positive days
    }
    // Fallback: use interval field
    const secs = Math.round(state.interval * SECS_PER_DAY);
    return secs > 0 ? -secs : 0;
  }
  return Math.round(state.interval);
}

function reviewCardForAnswer(
  card: AnkiSM2CardState,
  answer: Answer,
  params: SM2Params,
): AnkiSM2CardState {
  const now = Date.now();
  const late = daysLate(card);
  let { ease, interval } = card;
  const lapses = card.lapses;
  const reps = card.reps + 1;

  // Early review: card answered before due date (Anki review.rs:253-282)
  if (late < 0 && answer !== "again") {
    const elapsed = Math.max(0, interval + late); // days since last review
    return earlyReviewForAnswer(card, answer, elapsed, params, now, reps);
  }

  const daysLatePositive = Math.max(0, late);

  switch (answer) {
    case "again": {
      ease = Math.max(MIN_EASE, ease - 0.2);
      const rawLapseIvl = Math.max(1, Math.round(interval * params.lapseNewInterval));
      const newIvl = Math.max(
        params.minLapseInterval,
        addFuzz(rawLapseIvl, reps),
      );
      const steps = params.relearningSteps;
      if (steps.length === 0) {
        return {
          phase: "review",
          step: 0,
          ease,
          interval: clampInterval(newIvl, params),
          due: now + clampInterval(newIvl, params) * MS_PER_DAY,
          lapses: lapses + 1,
          reps,
        };
      }
      const delaySecs = (steps[0] ?? 1) * 60;
      const fuzzedSecs = addLearningFuzz(delaySecs, reps);
      return {
        phase: "relearning",
        step: 0,
        ease,
        interval: newIvl,
        due: now + fuzzedSecs * 1000,
        lapses: lapses + 1,
        reps,
      };
    }
    case "hard": {
      ease = Math.max(MIN_EASE, ease - 0.15);
      // Anki: hard = interval * hardMultiplier (no late days)
      const hardRawIvl = interval * params.hardMultiplier * params.intervalModifier;
      const hardMinimum = params.hardMultiplier > 1 ? interval + 1 : 1;
      const hardCandiate = Math.max(hardMinimum, Math.round(hardRawIvl));
      const newIvl = clampInterval(addFuzz(hardCandiate, reps, hardMinimum, params.maximumInterval), params);
      return {
        phase: "review",
        step: 0,
        ease,
        interval: newIvl,
        due: now + newIvl * MS_PER_DAY,
        lapses,
        reps,
      };
    }
    case "good": {
      // Compute hard interval to enforce good > hard
      const hardRawIvl = interval * params.hardMultiplier * params.intervalModifier;
      const hardMinimum = params.hardMultiplier > 1 ? interval + 1 : 1;
      const hardCandidate = Math.max(hardMinimum, Math.round(hardRawIvl));
      const hardIvl = clampInterval(addFuzz(hardCandidate, reps, hardMinimum, params.maximumInterval), params);

      const goodMinimum = params.hardMultiplier <= 1 ? interval + 1 : hardIvl + 1;
      const goodCandidate = Math.max(goodMinimum, Math.round((interval + daysLatePositive / 2) * ease * params.intervalModifier));
      const newIvl = clampInterval(addFuzz(goodCandidate, reps + 1, goodMinimum, params.maximumInterval), params);
      return {
        phase: "review",
        step: 0,
        ease,
        interval: newIvl,
        due: now + newIvl * MS_PER_DAY,
        lapses,
        reps,
      };
    }
    case "easy": {
      ease += 0.15;

      // Compute hard & good intervals to enforce easy > good > hard
      const hardRawIvl = interval * params.hardMultiplier * params.intervalModifier;
      const hardMinimum = params.hardMultiplier > 1 ? interval + 1 : 1;
      const hardCandidate = Math.max(hardMinimum, Math.round(hardRawIvl));
      const hardIvl = clampInterval(addFuzz(hardCandidate, reps, hardMinimum, params.maximumInterval), params);

      const goodMinimum = params.hardMultiplier <= 1 ? interval + 1 : hardIvl + 1;
      const goodCandidate = Math.max(goodMinimum, Math.round((interval + daysLatePositive / 2) * (ease - 0.15) * params.intervalModifier));
      const goodIvl = clampInterval(addFuzz(goodCandidate, reps + 1, goodMinimum, params.maximumInterval), params);

      const easyCandidate = Math.max(goodIvl + 1, Math.round((interval + daysLatePositive) * ease * params.easyBonus * params.intervalModifier));
      const newIvl = clampInterval(addFuzz(easyCandidate, reps + 2, goodIvl + 1, params.maximumInterval), params);
      return {
        phase: "review",
        step: 0,
        ease,
        interval: newIvl,
        due: now + newIvl * MS_PER_DAY,
        lapses,
        reps,
      };
    }
  }
}

/**
 * Handle early review (card answered before due date).
 * Matches Anki review.rs:253-282.
 * Uses reduced formulas with no fuzz.
 */
function earlyReviewForAnswer(
  card: AnkiSM2CardState,
  answer: Answer,
  elapsed: number,
  params: SM2Params,
  now: number,
  reps: number,
): AnkiSM2CardState {
  const { ease, interval, lapses } = card;

  switch (answer) {
    case "hard": {
      const newEase = Math.max(MIN_EASE, ease - 0.15);
      const factor = params.hardMultiplier;
      const halfUsual = factor / 2;
      const rawIvl = Math.max(elapsed * factor, interval * halfUsual);
      const newIvl = clampInterval(Math.max(1, Math.round(rawIvl * params.intervalModifier)), params);
      return {
        phase: "review",
        step: 0,
        ease: newEase,
        interval: newIvl,
        due: now + newIvl * MS_PER_DAY,
        lapses,
        reps,
      };
    }
    case "good": {
      const rawIvl = Math.max(elapsed * ease, interval);
      const newIvl = clampInterval(Math.max(1, Math.round(rawIvl * params.intervalModifier)), params);
      return {
        phase: "review",
        step: 0,
        ease,
        interval: newIvl,
        due: now + newIvl * MS_PER_DAY,
        lapses,
        reps,
      };
    }
    case "easy": {
      const newEase = ease + 0.15;
      const reducedBonus = params.easyBonus - (params.easyBonus - 1) / 2;
      const rawIvl = Math.max(elapsed * ease, interval) * reducedBonus;
      const newIvl = clampInterval(Math.max(1, Math.round(rawIvl * params.intervalModifier)), params);
      return {
        phase: "review",
        step: 0,
        ease: newEase,
        interval: newIvl,
        due: now + newIvl * MS_PER_DAY,
        lapses,
        reps,
      };
    }
    default:
      // "again" handled in the caller before earlyReview is called
      throw new Error("Unreachable");
  }
}

function learningCardForAnswer(
  card: AnkiSM2CardState,
  answer: Answer,
  steps: number[],
  graduatingInterval: number,
  easyInterval: number,
  params: SM2Params,
): AnkiSM2CardState {
  const now = Date.now();
  const reps = card.reps + 1;

  switch (answer) {
    case "again": {
      const delaySecs = (steps[0] ?? 1) * 60;
      const fuzzedSecs = addLearningFuzz(delaySecs, reps);
      return {
        ...card,
        step: 0,
        interval: fuzzedSecs / SECS_PER_DAY,
        due: now + fuzzedSecs * 1000,
        reps,
      };
    }
    case "hard": {
      let delaySecs: number;
      if (steps.length === 1) {
        const againSecs = steps[0]! * 60;
        // 50% more, but at most one day more
        delaySecs = Math.min(againSecs * 1.5, againSecs + SECS_PER_DAY);
      } else if (card.step === 0 && steps.length > 1) {
        // average of first (again) and second (good) steps
        delaySecs = ((steps[0]! + steps[1]!) / 2) * 60;
      } else {
        delaySecs = steps[card.step]! * 60;
      }
      // Anki: maybe_round_in_days — if > 1 day, round to whole days
      if (delaySecs > SECS_PER_DAY) {
        delaySecs = Math.round(delaySecs / SECS_PER_DAY) * SECS_PER_DAY;
      }
      return {
        ...card,
        interval: delaySecs / SECS_PER_DAY,
        due: now + delaySecs * 1000,
        reps,
      };
    }
    case "good": {
      const nextStep = card.step + 1;
      if (nextStep >= steps.length) {
        const ivl = card.phase === "relearning"
          ? Math.max(params.minLapseInterval, card.interval)
          : clampInterval(graduatingInterval, params);
        return {
          phase: "review",
          step: 0,
          ease: card.ease,
          interval: ivl,
          due: now + ivl * MS_PER_DAY,
          lapses: card.lapses,
          reps,
        };
      }
      const delaySecs = steps[nextStep]! * 60;
      const fuzzedSecs = addLearningFuzz(delaySecs, reps);
      return {
        ...card,
        step: nextStep,
        interval: fuzzedSecs / SECS_PER_DAY,
        due: now + fuzzedSecs * 1000,
        reps,
      };
    }
    case "easy": {
      if (card.phase === "relearning") {
        // Anki: graduate to review with existing interval, no +1
        const ivl = Math.max(params.minLapseInterval, card.interval);
        return {
          phase: "review",
          step: 0,
          ease: card.ease,
          interval: clampInterval(ivl, params),
          due: now + clampInterval(ivl, params) * MS_PER_DAY,
          lapses: card.lapses,
          reps,
        };
      }
      const ivl = clampInterval(easyInterval, params);
      return {
        phase: "review",
        step: 0,
        ease: card.ease,
        interval: ivl,
        due: now + ivl * MS_PER_DAY,
        lapses: card.lapses,
        reps,
      };
    }
  }
}

export class AnkiSM2Algorithm implements SchedulingAlgorithm {
  private params: SM2Params;

  constructor(partialParams?: Partial<SM2Params>) {
    this.params = resolveParams(partialParams);
  }

  createCard(): AnkiSM2CardState {
    return {
      phase: "new",
      step: 0,
      ease: this.params.startingEase,
      interval: 0,
      due: Date.now(),
      lapses: 0,
      reps: 0,
    };
  }

  reviewCard(cardState: unknown, answer: Answer): SchedulingResult {
    const card = cardState as AnkiSM2CardState;
    const params = this.params;
    let newState: AnkiSM2CardState;

    switch (card.phase) {
      case "new": {
        const steps = params.learningSteps;
        if (steps.length === 0) {
          // No learning steps: graduate immediately
          const ivl = answer === "easy"
            ? params.easyInterval
            : params.graduatingInterval;
          newState = {
            phase: "review",
            step: 0,
            ease: params.startingEase,
            interval: clampInterval(ivl, params),
            due: Date.now() + clampInterval(ivl, params) * MS_PER_DAY,
            lapses: 0,
            reps: 1,
          };
        } else {
          // Enter learning steps
          const initialCard: AnkiSM2CardState = {
            ...card,
            phase: "learning",
            ease: params.startingEase,
          };
          newState = learningCardForAnswer(
            initialCard,
            answer,
            steps,
            params.graduatingInterval,
            params.easyInterval,
            params,
          );
        }
        break;
      }
      case "learning":
        newState = learningCardForAnswer(
          card,
          answer,
          params.learningSteps,
          params.graduatingInterval,
          params.easyInterval,
          params,
        );
        break;
      case "relearning":
        newState = learningCardForAnswer(
          card,
          answer,
          params.relearningSteps,
          params.graduatingInterval,
          params.easyInterval,
          params,
        );
        break;
      case "review":
        newState = reviewCardForAnswer(card, answer, params);
        break;
    }

    const reviewNow = Date.now();
    return {
      cardState: newState,
      reviewLog: {
        answer,
        previousPhase: card.phase,
        newPhase: newState.phase,
        ease: newState.ease,
        interval: encodeIntervalForRevlog(newState, reviewNow),
        previousInterval: encodeIntervalForRevlog(card, reviewNow),
        lapses: newState.lapses,
        timestamp: reviewNow,
      },
    };
  }

  getNextIntervals(cardState: unknown): Record<Answer, Date> {
    const card = cardState as AnkiSM2CardState;
    const intervals: Record<Answer, Date> = {} as Record<Answer, Date>;

    for (const answer of ["again", "hard", "good", "easy"] as Answer[]) {
      const result = this.reviewCard(card, answer);
      const newCard = result.cardState as AnkiSM2CardState;
      intervals[answer] = new Date(newCard.due);
    }

    return intervals;
  }

  getDueDate(cardState: unknown): Date {
    const card = cardState as AnkiSM2CardState;
    return new Date(card.due);
  }

  getDisplayInfo(cardState: unknown): {
    ease?: number;
    interval?: number;
    repetitions?: number;
    state?: string;
    lapses?: number;
    [key: string]: number | string | undefined;
  } {
    const card = cardState as AnkiSM2CardState;
    return {
      ease: card.ease,
      interval: card.interval,
      repetitions: card.reps,
      state: card.phase,
      lapses: card.lapses,
    };
  }

  isInLearning(cardState: unknown): boolean {
    const card = cardState as AnkiSM2CardState;
    return card.phase === "learning" || card.phase === "relearning";
  }
}
