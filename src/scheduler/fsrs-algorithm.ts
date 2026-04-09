import { FSRS, Rating, Card, createEmptyCard, FSRSParameters } from "ts-fsrs";
import type { Answer } from "./types";
import type { SchedulingAlgorithm, SchedulingResult, CardState } from "./algorithm";

/**
 * Maps our Answer type to FSRS Rating
 */
const ANSWER_TO_FSRS_RATING: Record<Answer, Rating> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

/**
 * FSRS algorithm adapter
 */
export class FSRSAlgorithm implements SchedulingAlgorithm {
  private fsrs: FSRS;

  constructor(params?: {
    weights?: number[];
    requestRetention?: number;
    maximumInterval?: number;
  }) {
    const fsrsParams: Partial<FSRSParameters> = {};

    if (params?.weights) {
      fsrsParams.w = params.weights;
    }
    if (params?.requestRetention !== undefined) {
      fsrsParams.request_retention = params.requestRetention;
    }
    if (params?.maximumInterval !== undefined) {
      fsrsParams.maximum_interval = params.maximumInterval;
    }

    this.fsrs = new FSRS(fsrsParams);
  }

  createCard(): Card {
    return createEmptyCard();
  }

  reviewCard(cardState: CardState, answer: Answer): SchedulingResult {
    const rating = ANSWER_TO_FSRS_RATING[answer];
    const card = cardState as Card;
    const now = new Date();

    const recordLog = this.fsrs.repeat(card, now);

    // Get the appropriate scheduling info based on rating
    const result =
      rating === Rating.Again
        ? recordLog[Rating.Again]
        : rating === Rating.Hard
          ? recordLog[Rating.Hard]
          : rating === Rating.Good
            ? recordLog[Rating.Good]
            : recordLog[Rating.Easy];

    return {
      cardState: result.card,
      reviewLog: result.log,
    };
  }

  getNextIntervals(cardState: CardState): Record<Answer, Date> {
    const card = cardState as Card;
    const now = new Date();

    const schedulingCards = this.fsrs.repeat(card, now);

    return {
      again: schedulingCards[Rating.Again].card.due,
      hard: schedulingCards[Rating.Hard].card.due,
      good: schedulingCards[Rating.Good].card.due,
      easy: schedulingCards[Rating.Easy].card.due,
    };
  }

  getDueDate(cardState: CardState): Date {
    const card = cardState as Card;
    return card.due;
  }

  getDisplayInfo(cardState: CardState): {
    stability?: number;
    difficulty?: number;
    repetitions?: number;
  } {
    const card = cardState as Card;
    return {
      stability: card.stability,
      difficulty: card.difficulty,
      repetitions: card.reps,
    };
  }
}
