/**
 * Supported scheduling algorithms
 */
export type AlgorithmType = "sm2" | "fsrs";

/**
 * Answer types for review buttons
 */
export type Answer = "again" | "hard" | "good" | "easy";

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

  /**
   * Queue override: -3 = userBuried, -2 = schedulerBuried, -1 = suspended. undefined = normal scheduling.
   */
  queueOverride?: number;

  /**
   * Card flags (low 3 bits = flag 0–7, matching Anki desktop).
   */
  flags?: number;
}

/**
 * SM-2 specific parameters matching Anki's modified SM-2
 */
export interface SM2Params {
  /** Learning steps in minutes (default: [1, 10]) */
  learningSteps: number[];
  /** Relearning steps in minutes (default: [10]) */
  relearningSteps: number[];
  /** Interval in days when graduating via Good (default: 1) */
  graduatingInterval: number;
  /** Interval in days when graduating via Easy (default: 4) */
  easyInterval: number;
  /** Starting ease factor for new cards (default: 2.5) */
  startingEase: number;
  /** Multiplier for Easy button on review cards (default: 1.3) */
  easyBonus: number;
  /** Multiplier for Hard button on review cards (default: 1.2) */
  hardMultiplier: number;
  /** Global interval multiplier (default: 1.0) */
  intervalModifier: number;
  /** Interval multiplier after lapse, 0 = reset (default: 0) */
  lapseNewInterval: number;
  /** Minimum interval after lapse in days (default: 1) */
  minLapseInterval: number;
  /** Maximum review interval in days (default: 36500) */
  maximumInterval: number;
  /** Leech threshold — number of lapses to trigger leech (default: 8) */
  leechThreshold: number;
  /** Whether to bury new siblings after answering (default: true) */
  buryNew: boolean;
  /** Whether to bury review siblings after answering (default: true) */
  buryReviews: boolean;
}

export const DEFAULT_SM2_PARAMS: SM2Params = {
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
  leechThreshold: 8,
  buryNew: true,
  buryReviews: true,
};

/**
 * Settings for the scheduler
 */
export interface SchedulerSettings {
  /**
   * Whether the scheduler is enabled for this deck
   */
  enabled: boolean;

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
   * SM-2 specific parameters (only used if algorithm is 'sm2')
   */
  sm2Params?: Partial<SM2Params>;

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
  enabled: true,
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
