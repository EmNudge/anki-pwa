/**
 * Supported scheduling algorithms
 */
type AlgorithmType = "sm2" | "fsrs";

/**
 * Answer types for review buttons
 */
export type Answer = "again" | "hard" | "good" | "easy";

/**
 * Maps Answer to SM-2 rating (0-5 scale)
 * - Again: 0 (complete blackout)
 * - Hard: 3 (correct but with serious difficulty)
 * - Good: 4 (correct with hesitation)
 * - Easy: 5 (perfect response)
 */
export const ANSWER_TO_RATING: Record<Answer, number> = {
  again: 0,
  hard: 3,
  good: 4,
  easy: 5,
};

/**
 * Review state for a card, combining our card ID with scheduling data
 */
export interface CardReviewState {
  /**
   * Unique identifier for this card (combination of note ID + template index)
   */
  cardId: string;

  /**
   * ID of the deck this card belongs to
   */
  deckId: string;

  /**
   * Scheduling algorithm being used
   */
  algorithm: AlgorithmType;

  /**
   * Card state (serializable) - structure depends on algorithm
   * For SM-2: { due: Date, interval: number, easeFactor: number, repetitions: number }
   * For FSRS: { due: Date, stability: number, difficulty: number, ... }
   */
  cardState: unknown;

  /**
   * Timestamp when this card was first created/seen
   */
  createdAt: number;

  /**
   * Timestamp when this card was last reviewed
   */
  lastReviewed: number | null;
}

/**
 * Settings for the scheduler
 */
export interface SchedulerSettings {
  /**
   * Scheduling algorithm to use
   */
  algorithm: AlgorithmType;

  /**
   * Maximum number of new cards to show per day
   */
  dailyNewLimit: number;

  /**
   * Maximum number of review cards to show per day
   */
  dailyReviewLimit: number;

  /**
   * Show cards ahead of schedule if daily reviews are complete
   */
  showAheadOfSchedule: boolean;

  /**
   * FSRS-specific settings (only used if algorithm is 'fsrs')
   */
  fsrsParams?: {
    /**
     * FSRS weights/parameters (17 parameters)
     */
    weights?: number[];

    /**
     * Target retention rate (0-1)
     */
    requestRetention?: number;

    /**
     * Maximum interval in days
     */
    maximumInterval?: number;
  };
}

/**
 * Default scheduler settings
 */
export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  algorithm: "sm2",
  dailyNewLimit: 20,
  dailyReviewLimit: 200,
  showAheadOfSchedule: false,
};

/**
 * Daily review statistics
 */
export interface DailyStats {
  /**
   * Date in YYYY-MM-DD format
   */
  date: string;

  /**
   * Number of new cards reviewed
   */
  newCount: number;

  /**
   * Number of review cards completed
   */
  reviewCount: number;

  /**
   * Total review time in milliseconds
   */
  totalTimeMs: number;
}

/**
 * Stored review log entry
 */
export interface StoredReviewLog {
  cardId: string;
  timestamp: number;
  rating: Answer | number; // Can be Answer string or legacy number rating
  reviewLog: unknown; // Algorithm-specific review log data
}
