/**
 * Supported scheduling algorithms
 */
export type AlgorithmType = "sm2" | "fsrs";

/**
 * Answer types for review buttons
 */
export type Answer = "again" | "hard" | "good" | "easy";

import type { CardState, ReviewLogEntry } from "./algorithm";

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
   * For SM-2: AnkiSM2CardState
   * For FSRS: Card (from ts-fsrs)
   */
  cardState: CardState;

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
 * Day-of-week index: 0 = Sunday, 6 = Saturday (matches Date.getDay())
 */
export type DayOfWeek = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Auto-advance configuration for passive review
 */
export interface AutoAdvanceSettings {
  /** Seconds to wait before auto-flipping the card (0 = disabled) */
  autoFlipDelaySecs: number;
  /** Seconds to wait after flip before advancing to next card (0 = disabled) */
  autoAdvanceDelaySecs: number;
  /** Answer to auto-submit when auto-advancing (default: "good") */
  autoAdvanceAnswer: Answer;
}

/**
 * Easy days configuration — per-day-of-week review multiplier
 * 1.0 = normal, 0.5 = half reviews, 0 = no reviews
 */
export type EasyDaysConfig = Record<DayOfWeek, number>;

/**
 * Load balancer settings for spreading reviews across days
 */
export interface LoadBalancerSettings {
  /** Whether to enable load balancing (default: false) */
  enabled: boolean;
  /** Fuzz range as a fraction of the interval (0.05 = +/-5%). Default 0.05. */
  fuzzFactor: number;
}

/**
 * Named option preset that can be shared across decks
 */
export interface OptionPreset {
  /** Unique preset ID */
  id: string;
  /** User-facing name */
  name: string;
  /** The scheduler settings for this preset */
  settings: SchedulerSettings;
  /** Timestamp of last modification */
  modifiedAt: number;
}

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
   * Learn-ahead limit in minutes. Cards due within this window are
   * shown when the regular queue is empty. Default 20.
   */
  learnAheadMins: number;

  /**
   * Hour of the day (0-23) when "today" rolls over. Default 4 (4 AM).
   * Useful for night owls so late-night reviews count as the same day.
   */
  rolloverHour: number;

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

  /**
   * Auto-advance settings for passive review
   */
  autoAdvance?: AutoAdvanceSettings;

  /**
   * Easy days — per-day-of-week review multiplier (0 = skip, 1 = normal)
   */
  easyDays?: EasyDaysConfig;

  /**
   * Load balancer — spread reviews across days to avoid spikes
   */
  loadBalancer?: LoadBalancerSettings;

  /**
   * ID of the option preset this deck uses (undefined = deck-local settings)
   */
  presetId?: string;
}

export const DEFAULT_AUTO_ADVANCE: AutoAdvanceSettings = {
  autoFlipDelaySecs: 0,
  autoAdvanceDelaySecs: 0,
  autoAdvanceAnswer: "good",
};

export const DEFAULT_EASY_DAYS: EasyDaysConfig = {
  0: 1,
  1: 1,
  2: 1,
  3: 1,
  4: 1,
  5: 1,
  6: 1,
};

export const DEFAULT_LOAD_BALANCER: LoadBalancerSettings = {
  enabled: false,
  fuzzFactor: 0.05,
};

/**
 * Default scheduler settings
 */
export const DEFAULT_SCHEDULER_SETTINGS: SchedulerSettings = {
  enabled: true,
  algorithm: "sm2",
  dailyNewLimit: 20,
  dailyReviewLimit: 200,
  showAheadOfSchedule: false,
  learnAheadMins: 20,
  rolloverHour: 4,
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
  reviewLog: ReviewLogEntry; // Algorithm-specific review log data
}

/**
 * Sort order options for filtered decks
 */
export type FilteredDeckSortOrder =
  | "random"
  | "orderAdded"
  | "orderDue"
  | "intervalAsc"
  | "intervalDesc"
  | "easeAsc"
  | "easeDesc"
  | "lapsesDesc";

/**
 * Configuration for a filtered (custom study) deck
 */
export interface FilteredDeckConfig {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Search query string */
  query: string;
  /** Maximum cards to gather */
  limit: number;
  /** Sort order for gathered cards */
  sortOrder: FilteredDeckSortOrder;
  /** true = normal review (reschedule), false = cram mode */
  reschedule: boolean;
  /** Timestamp of creation */
  createdAt: number;
  /** Timestamp of last modification */
  modifiedAt: number;
}
