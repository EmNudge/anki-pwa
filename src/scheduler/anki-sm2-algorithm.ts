import type { Answer } from "./types";
import type { SchedulingAlgorithm, SchedulingResult } from "./algorithm";
import { DEFAULT_SM2_PARAMS, type SM2Params } from "./types";

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

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MIN_EASE = 1.3;

function resolveParams(partial?: Partial<SM2Params>): SM2Params {
  return { ...DEFAULT_SM2_PARAMS, ...partial };
}

function clampInterval(interval: number, params: SM2Params): number {
  return Math.max(1, Math.min(interval, params.maximumInterval));
}

function addFuzz(interval: number): number {
  if (interval < 2.5) return interval;
  const fuzzRange = interval < 7 ? 1 : interval < 30 ? Math.max(2, Math.round(interval * 0.15)) : Math.max(4, Math.round(interval * 0.05));
  const delta = Math.floor(Math.random() * (fuzzRange * 2 + 1)) - fuzzRange;
  return Math.max(2, interval + delta);
}

function daysLate(card: AnkiSM2CardState): number {
  const now = Date.now();
  return Math.max(0, (now - card.due) / MS_PER_DAY);
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

  switch (answer) {
    case "again": {
      ease = Math.max(MIN_EASE, ease - 0.2);
      const newIvl = Math.max(
        params.minLapseInterval,
        Math.round(interval * params.lapseNewInterval),
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
      return {
        phase: "relearning",
        step: 0,
        ease,
        interval: newIvl,
        due: now + steps[0]! * MS_PER_MINUTE,
        lapses: lapses + 1,
        reps,
      };
    }
    case "hard": {
      ease = Math.max(MIN_EASE, ease - 0.15);
      const rawIvl = (interval + late / 4) * params.hardMultiplier * params.intervalModifier;
      const newIvl = clampInterval(addFuzz(Math.max(interval + 1, Math.round(rawIvl))), params);
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
      const rawIvl = (interval + late / 2) * ease * params.intervalModifier;
      const newIvl = clampInterval(addFuzz(Math.max(interval + 1, Math.round(rawIvl))), params);
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
      const rawIvl =
        (interval + late) * ease * params.easyBonus * params.intervalModifier;
      const newIvl = clampInterval(addFuzz(Math.max(interval + 1, Math.round(rawIvl))), params);
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
      return {
        ...card,
        step: 0,
        due: now + (steps[0] ?? 1) * MS_PER_MINUTE,
        reps,
      };
    }
    case "hard": {
      let delayMs: number;
      if (steps.length === 1) {
        delayMs = Math.min(steps[0]! * 1.5, steps[0]! + MS_PER_DAY / MS_PER_MINUTE) * MS_PER_MINUTE;
      } else if (card.step === 0 && steps.length > 1) {
        delayMs = ((steps[0]! + steps[1]!) / 2) * MS_PER_MINUTE;
      } else {
        delayMs = steps[card.step]! * MS_PER_MINUTE;
      }
      return {
        ...card,
        due: now + delayMs,
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
      return {
        ...card,
        step: nextStep,
        due: now + steps[nextStep]! * MS_PER_MINUTE,
        reps,
      };
    }
    case "easy": {
      if (card.phase === "relearning") {
        const ivl = Math.max(params.minLapseInterval, card.interval) + 1;
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

    return {
      cardState: newState,
      reviewLog: {
        answer,
        previousPhase: card.phase,
        newPhase: newState.phase,
        ease: newState.ease,
        interval: newState.interval,
        lapses: newState.lapses,
        timestamp: Date.now(),
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
