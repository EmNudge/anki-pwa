import type { AlgorithmType } from "../scheduler/types";

export type CardPhaseGroup = "new" | "learning" | "young" | "mature";

export type StatsPeriod = "1m" | "3m" | "1y" | "all";

export interface NormalizedCardInfo {
  cardId: string;
  deckId: string;
  algorithm: AlgorithmType;
  phase: CardPhaseGroup;
  /** Current interval in days */
  interval: number;
  /** Ease factor (SM-2) or mapped difficulty (FSRS) */
  easeFactor: number;
  /** Due timestamp in ms */
  due: number;
  lapses: number;
  reps: number;
  /** Timestamp when card was first created */
  createdAt: number;
}

export interface BucketData {
  label: string;
  count: number;
}

export interface DayCount {
  date: string;
  count: number;
}

export interface AnswerButtonsData {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

export interface CardCountsData {
  new: number;
  learning: number;
  young: number;
  mature: number;
}

export interface TrueRetentionData {
  retention: number;
  total: number;
  correct: number;
}
