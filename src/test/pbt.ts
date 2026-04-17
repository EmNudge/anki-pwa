/**
 * Default number of PBT runs. Override via FAST_CHECK_NUM_RUNS env var.
 * Local dev: uses the per-test default (typically 100-500).
 * CI: set to 1000+ for deeper exploration.
 */
export const NUM_RUNS = process.env.FAST_CHECK_NUM_RUNS
  ? parseInt(process.env.FAST_CHECK_NUM_RUNS, 10)
  : undefined;
