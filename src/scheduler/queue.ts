import type { CardReviewState, Answer, SchedulerSettings, DailyStats } from "./types";
import { reviewDB } from "./db";
import type { SchedulingAlgorithm } from "./algorithm";
import { FSRSAlgorithm } from "./fsrs-algorithm";
import { AnkiSM2Algorithm } from "./anki-sm2-algorithm";

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
   * Get today's date as YYYY-MM-DD
   */
  private getTodayString(): string {
    const today = new Date();
    return today.toISOString().split("T")[0]!;
  }

  /**
   * Initialize the queue by loading today's stats
   */
  async init(): Promise<void> {
    const stats = await reviewDB.getDailyStats(this.getTodayString());
    if (stats) {
      this.todayStats = stats;
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
   */
  async buildQueue(totalCards: number, templatesPerCard: number): Promise<ReviewCard[]> {
    // Get existing review states
    const existingStates = await reviewDB.getCardsForDeck(this.deckId);
    const stateMap = new Map<string, CardReviewState>(
      existingStates.map((state) => [state.cardId, state]),
    );

    const now = new Date();

    // Generate cards for all card/template combinations immutably
    return Array.from({ length: totalCards }, (_, cardIndex) =>
      Array.from({ length: templatesPerCard }, (_, templateIndex) => {
        const cardId = this.generateCardId(cardIndex, templateIndex);
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

    const newLeft = Math.max(0, this.settings.dailyNewLimit - this.todayStats.newCount);
    const reviewLeft = Math.max(0, this.settings.dailyReviewLimit - this.todayStats.reviewCount);

    const selectedNew = newCards.slice(0, newLeft);
    const selectedReviews = dueReviews.slice(0, reviewLeft);

    const includeAhead =
      this.settings.showAheadOfSchedule &&
      selectedReviews.length === 0 &&
      selectedNew.length === 0
        ? aheadCards
        : [];

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
