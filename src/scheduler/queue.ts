import type { CardReviewState, Answer, SchedulerSettings, DailyStats, DayOfWeek } from "./types";
import { reviewDB } from "./db";
import type { SchedulingAlgorithm } from "./algorithm";
import { FSRSAlgorithm } from "./fsrs-algorithm";
import { AnkiSM2Algorithm } from "./anki-sm2-algorithm";
import { QUEUE_SUSPENDED, QUEUE_SCHED_BURIED, QUEUE_USER_BURIED } from "../lib/syncWrite";

/**
 * Apply fuzz to a due date to spread reviews across days.
 * Shifts the due date by a random offset within +/- fuzzFactor * interval.
 */
function applyLoadBalancerFuzz(dueDate: Date, intervalDays: number, fuzzFactor: number): Date {
  if (intervalDays < 3 || fuzzFactor <= 0) return dueDate;
  const fuzzDays = Math.round(intervalDays * fuzzFactor);
  if (fuzzDays === 0) return dueDate;
  const offset = Math.floor(Math.random() * (fuzzDays * 2 + 1)) - fuzzDays;
  const fuzzed = new Date(dueDate.getTime() + offset * 24 * 60 * 60 * 1000);
  return fuzzed;
}

/**
 * Get the easy-days multiplier for a given date.
 * Returns 1.0 if no easy days config is set.
 */
function getEasyDayMultiplier(date: Date, easyDays: Record<DayOfWeek, number> | undefined): number {
  if (!easyDays) return 1;
  const day = date.getDay() as DayOfWeek;
  return easyDays[day] ?? 1;
}

/**
 * Represents a card ready for review, combining deck data with review state
 */
export interface ReviewCard {
  /**
   * Unique identifier
   */
  cardId: string;

  /**
   * Index in the original cards array
   */
  cardIndex: number;

  /**
   * Template index for this card
   */
  templateIndex: number;

  /**
   * Review state
   */
  reviewState: CardReviewState;

  /**
   * Whether this is a new card (never reviewed)
   */
  isNew: boolean;
}

/**
 * Manages the review queue and scheduling logic
 */
export class ReviewQueue {
  private deckId: string;
  private settings: SchedulerSettings;
  private todayStats: DailyStats;
  private algorithm: SchedulingAlgorithm;

  constructor(deckId: string, settings: SchedulerSettings) {
    this.deckId = deckId;
    this.settings = settings;
    this.todayStats = {
      date: this.getTodayString(),
      newCount: 0,
      reviewCount: 0,
      totalTimeMs: 0,
    };

    // Initialize the appropriate algorithm
    if (settings.algorithm === "fsrs") {
      this.algorithm = new FSRSAlgorithm(settings.fsrsParams);
    } else {
      this.algorithm = new AnkiSM2Algorithm(settings.sm2Params);
    }
  }

  /**
   * Get today's date as YYYY-MM-DD, adjusted for rollover hour.
   * If the current time is before the rollover hour, the previous
   * calendar day is considered "today".
   */
  private getTodayString(): string {
    const now = new Date();
    const rollover = this.settings.rolloverHour ?? 4;
    if (now.getHours() < rollover) {
      now.setDate(now.getDate() - 1);
    }
    return now.toISOString().split("T")[0]!;
  }

  /**
   * Initialize the queue by loading today's stats and unbury cards on day rollover
   */
  async init(): Promise<void> {
    const today = this.getTodayString();
    const stats = await reviewDB.getDailyStats(today);
    if (stats) {
      this.todayStats = stats;
    }

    // Unbury cards when a new day starts (matches Anki desktop behavior)
    await this.unburyCards();
  }

  /**
   * Clear userBuried status on all cards for this deck.
   * Called on queue init so buried cards from previous days are restored.
   */
  private async unburyCards(): Promise<void> {
    const cards = await reviewDB.getCardsForDeck(this.deckId);
    for (const card of cards) {
      if (card.queueOverride === QUEUE_USER_BURIED) {
        await reviewDB.patchCard(card.cardId, { queueOverride: undefined });
      }
    }
  }

  /**
   * Generate a unique card ID from card index and template index
   */
  private generateCardId(cardIndex: number, templateIndex: number): string {
    return `${this.deckId}:${cardIndex}:${templateIndex}`;
  }

  /**
   * Build the review queue from the deck's cards
   * @param totalCards Total number of cards in the deck
   * @param templatesPerCard Number of templates for each card (assumes all cards have same templates)
   * @param ankiCardIds Optional array of native Anki card IDs (from SQLite) — when provided, used as card IDs instead of positional indices
   */
  async buildQueue(
    totalCards: number,
    templatesPerCard: number,
    ankiCardIds?: number[],
  ): Promise<ReviewCard[]> {
    // Get existing review states
    const existingStates = await reviewDB.getCardsForDeck(this.deckId);
    const stateMap = new Map<string, CardReviewState>(
      existingStates.map((state) => [state.cardId, state]),
    );

    const now = new Date();

    // Generate cards for all card/template combinations immutably
    return Array.from({ length: totalCards }, (_, cardIndex) =>
      Array.from({ length: templatesPerCard }, (_, templateIndex) => {
        const cardId = ankiCardIds
          ? String(ankiCardIds[cardIndex])
          : this.generateCardId(cardIndex, templateIndex);
        const existing = stateMap.get(cardId);
        const isNew = !existing;
        const reviewState: CardReviewState = existing ?? {
          cardId,
          deckId: this.deckId,
          algorithm: this.settings.algorithm,
          cardState: this.algorithm.createCard(),
          createdAt: now.getTime(),
          lastReviewed: null,
        };

        return {
          cardId,
          cardIndex,
          templateIndex,
          reviewState,
          isNew,
        };
      }),
    ).flat();
  }

  /**
   * Filter and sort queue to get cards due for review.
   * Order matches Anki: learning cards first, then reviews, then new cards.
   */
  getDueCards(queue: ReviewCard[]): ReviewCard[] {
    const now = new Date();
    const nowMs = now.getTime();

    const learningCards: ReviewCard[] = [];
    const dueReviews: ReviewCard[] = [];
    const newCards: ReviewCard[] = [];
    const aheadCards: ReviewCard[] = [];
    const dueDateCache = new Map<string, number>();

    for (const card of queue) {
      try {
        // Skip suspended cards entirely
        if (card.reviewState.queueOverride === QUEUE_SUSPENDED) continue;
        // Skip buried cards (they'll be unburied on day rollover)
        if (
          card.reviewState.queueOverride === QUEUE_USER_BURIED ||
          card.reviewState.queueOverride === QUEUE_SCHED_BURIED
        )
          continue;

        const dueDate = this.algorithm.getDueDate(card.reviewState.cardState);
        const dueMs = dueDate.getTime();
        dueDateCache.set(card.cardId, dueMs);

        if (card.isNew) {
          newCards.push(card);
        } else if (this.algorithm.isInLearning?.(card.reviewState.cardState)) {
          // Learning/relearning cards — always include (shown when due)
          learningCards.push(card);
        } else if (dueMs <= nowMs) {
          dueReviews.push(card);
        } else {
          aheadCards.push(card);
        }
      } catch (error) {
        console.error("Error processing card in queue:", error, card);
      }
    }

    // Apply easy-days multiplier to daily limits
    const easyMultiplier = getEasyDayMultiplier(now, this.settings.easyDays);
    const adjustedNewLimit = Math.round(this.settings.dailyNewLimit * easyMultiplier);
    const adjustedReviewLimit = Math.round(this.settings.dailyReviewLimit * easyMultiplier);

    const newLeft = Math.max(0, adjustedNewLimit - this.todayStats.newCount);
    const reviewLeft = Math.max(0, adjustedReviewLimit - this.todayStats.reviewCount);

    const selectedNew = newCards.slice(0, newLeft);
    const selectedReviews = dueReviews.slice(0, reviewLeft);

    // Include ahead-of-schedule cards when the regular queue is empty
    const learnAheadMs = (this.settings.learnAheadMins ?? 20) * 60 * 1000;
    let includeAhead: ReviewCard[] = [];
    if (selectedReviews.length === 0 && selectedNew.length === 0 && learningCards.length === 0) {
      if (this.settings.showAheadOfSchedule) {
        includeAhead = aheadCards;
      } else if (learnAheadMs > 0) {
        includeAhead = aheadCards.filter(
          (c) => (dueDateCache.get(c.cardId) ?? Infinity) <= nowMs + learnAheadMs,
        );
      }
    }

    // Sort learning cards by due time (soonest first)
    learningCards.sort(
      (a, b) => (dueDateCache.get(a.cardId) ?? 0) - (dueDateCache.get(b.cardId) ?? 0),
    );

    // Sort reviews by due date
    selectedReviews.sort(
      (a, b) => (dueDateCache.get(a.cardId) ?? 0) - (dueDateCache.get(b.cardId) ?? 0),
    );

    // Anki order: learning first, then reviews, then new cards
    return [...learningCards, ...selectedReviews, ...includeAhead, ...selectedNew];
  }

  /**
   * Process a review answer and update the card state
   */
  async processReview(
    reviewCard: ReviewCard,
    answer: Answer,
    reviewTimeMs: number,
  ): Promise<CardReviewState> {
    try {
      // Review the card using the selected algorithm
      const result = this.algorithm.reviewCard(reviewCard.reviewState.cardState, answer);

      // Apply load balancer fuzz to spread due dates when enabled
      const lb = this.settings.loadBalancer;
      if (lb?.enabled && lb.fuzzFactor > 0) {
        const dueDate = this.algorithm.getDueDate(result.cardState);
        const intervalMs = dueDate.getTime() - Date.now();
        const intervalDays = intervalMs / (24 * 60 * 60 * 1000);
        if (intervalDays >= 3) {
          const fuzzed = applyLoadBalancerFuzz(dueDate, intervalDays, lb.fuzzFactor);
          // Patch the due date in the card state — both SM-2 and FSRS store `due`
          if ("due" in result.cardState) {
            (result.cardState as { due: number }).due = fuzzed.getTime();
          }
        }
      }

      // Update review state
      const updatedState: CardReviewState = {
        ...reviewCard.reviewState,
        cardState: result.cardState,
        lastReviewed: Date.now(),
      };

      // Save to database
      await reviewDB.saveCard(updatedState);

      // Save review log
      await reviewDB.saveReviewLog({
        cardId: reviewCard.cardId,
        timestamp: Date.now(),
        rating: answer, // Store the answer instead of rating
        reviewLog: result.reviewLog,
      });

      // Update daily stats
      if (reviewCard.isNew) {
        this.todayStats.newCount++;
      } else {
        this.todayStats.reviewCount++;
      }
      this.todayStats.totalTimeMs += reviewTimeMs;

      await reviewDB.saveDailyStats(this.todayStats);

      return updatedState;
    } catch (error) {
      console.error("Error processing review:", error, reviewCard);
      // Return current state on error
      return reviewCard.reviewState;
    }
  }

  /**
   * Check if a card is in a learning/relearning phase
   */
  isCardInLearning(reviewCard: ReviewCard): boolean {
    return this.algorithm.isInLearning?.(reviewCard.reviewState.cardState) ?? false;
  }

  /**
   * Get the next intervals for each answer type
   */
  getNextIntervals(reviewCard: ReviewCard): Record<Answer, string> {
    try {
      const nextIntervals = this.algorithm.getNextIntervals(reviewCard.reviewState.cardState);

      const intervals: Record<Answer, string> = {
        again: this.formatInterval(nextIntervals.again),
        hard: this.formatInterval(nextIntervals.hard),
        good: this.formatInterval(nextIntervals.good),
        easy: this.formatInterval(nextIntervals.easy),
      };

      return intervals;
    } catch (error) {
      console.error("Error calculating intervals:", error);
      return {
        again: "<1m",
        hard: "<6m",
        good: "<10m",
        easy: "<5d",
      };
    }
  }

  /**
   * Format a due date as a human-readable interval
   */
  private formatInterval(dueDate: Date): string {
    const now = new Date();
    const diffMs = dueDate.getTime() - now.getTime();
    const diffMinutes = Math.floor(diffMs / 1000 / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) {
      return "<1m";
    }
    if (diffMinutes < 60) {
      return `${diffMinutes}m`;
    }
    if (diffHours < 24) {
      return `${diffHours}h`;
    }
    if (diffDays < 30) {
      return `${diffDays}d`;
    }

    const diffMonths = Math.floor(diffDays / 30);
    return `${diffMonths}mo`;
  }

  /**
   * Get remaining daily limits
   */
  getRemainingLimits(): { newLeft: number; reviewsLeft: number } {
    return {
      newLeft: Math.max(0, this.settings.dailyNewLimit - this.todayStats.newCount),
      reviewsLeft: Math.max(0, this.settings.dailyReviewLimit - this.todayStats.reviewCount),
    };
  }

  /**
   * Get today's stats for the congrats screen
   */
  getTodayStats(): DailyStats {
    return { ...this.todayStats };
  }

  /**
   * Get the soonest due date across all non-due cards in the given queue.
   * Returns null if there are no upcoming cards.
   */
  getNextDueDate(queue: ReviewCard[]): Date | null {
    const nowMs = Date.now();
    let earliest: number | null = null;

    for (const card of queue) {
      if (card.reviewState.queueOverride === QUEUE_SUSPENDED) continue;
      if (
        card.reviewState.queueOverride === QUEUE_USER_BURIED ||
        card.reviewState.queueOverride === QUEUE_SCHED_BURIED
      )
        continue;
      if (card.isNew) continue;

      try {
        const dueMs = this.algorithm.getDueDate(card.reviewState.cardState).getTime();
        if (dueMs > nowMs && (earliest === null || dueMs < earliest)) {
          earliest = dueMs;
        }
      } catch {
        // skip
      }
    }

    return earliest !== null ? new Date(earliest) : null;
  }

  /**
   * Get display info for a card (for UI visualization)
   */
  getCardDisplayInfo(reviewCard: ReviewCard): {
    ease?: number;
    interval?: number;
    repetitions?: number;
    stability?: number;
    difficulty?: number;
    [key: string]: number | string | undefined;
  } {
    try {
      return this.algorithm.getDisplayInfo(reviewCard.reviewState.cardState);
    } catch (error) {
      console.error("Error getting display info:", error);
      return {};
    }
  }
}
