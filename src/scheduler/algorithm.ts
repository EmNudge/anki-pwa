import type { Answer } from "./types";

/**
 * Result of reviewing a card with a scheduling algorithm
 */
export interface SchedulingResult {
  /**
   * Updated card state (serializable)
   */
  cardState: unknown;

  /**
   * Review log entry (serializable)
   */
  reviewLog: unknown;
}

/**
 * Abstract interface for scheduling algorithms
 */
export interface SchedulingAlgorithm {
  /**
   * Create a new card with initial state
   */
  createCard(): unknown;

  /**
   * Review a card and return the updated state
   * @param cardState Current card state (algorithm-specific)
   * @param answer User's answer
   * @returns Updated card state and review log
   */
  reviewCard(cardState: unknown, answer: Answer): SchedulingResult;

  /**
   * Get the next intervals for each answer type
   * @param cardState Current card state
   * @returns Map of answers to due dates
   */
  getNextIntervals(cardState: unknown): Record<Answer, Date>;

  /**
   * Get the due date from a card state
   * @param cardState Card state
   * @returns Due date
   */
  getDueDate(cardState: unknown): Date;

  /**
   * Get display info for the card (for UI visualization)
   * @param cardState Card state
   * @returns Display information
   */
  getDisplayInfo(cardState: unknown): {
    ease?: number;
    interval?: number;
    repetitions?: number;
    stability?: number;
    difficulty?: number;
    [key: string]: number | string | undefined;
  };

  /**
   * Whether the card is currently in a learning or relearning phase.
   * Learning cards need to be re-shown within the same session.
   */
  isInLearning?(cardState: unknown): boolean;
}
