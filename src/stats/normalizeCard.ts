import type { CardReviewState } from "../scheduler/types";
import type { AnkiSM2CardState } from "../scheduler/anki-sm2-algorithm";
import type { Card } from "ts-fsrs";
import { State } from "ts-fsrs";
import type { NormalizedCardInfo, CardPhaseGroup } from "./types";

function getPhaseFromSM2(state: AnkiSM2CardState): CardPhaseGroup {
  if (state.phase === "new") return "new";
  if (state.phase === "learning" || state.phase === "relearning") return "learning";
  return state.interval < 21 ? "young" : "mature";
}

function getPhaseFromFSRS(card: Card): CardPhaseGroup {
  if (card.state === State.New) return "new";
  if (card.state === State.Learning || card.state === State.Relearning) return "learning";
  return card.scheduled_days < 21 ? "young" : "mature";
}

export function normalizeCard(card: CardReviewState): NormalizedCardInfo {
  if (card.algorithm === "sm2") {
    const sm2 = card.cardState as AnkiSM2CardState;
    return {
      cardId: card.cardId,
      deckId: card.deckId,
      algorithm: card.algorithm,
      phase: getPhaseFromSM2(sm2),
      interval: sm2.interval,
      easeFactor: sm2.ease,
      due: sm2.due,
      lapses: sm2.lapses,
      reps: sm2.reps,
      createdAt: card.createdAt,
    };
  }

  // FSRS
  const fsrs = card.cardState as Card;
  return {
    cardId: card.cardId,
    deckId: card.deckId,
    algorithm: card.algorithm,
    phase: getPhaseFromFSRS(fsrs),
    interval: fsrs.scheduled_days,
    // Map FSRS difficulty (1-10, lower=easier) to ease-like scale
    easeFactor: (11 - fsrs.difficulty) / 2.5,
    due: new Date(fsrs.due).getTime(),
    lapses: fsrs.lapses,
    reps: fsrs.reps,
    createdAt: card.createdAt,
  };
}
