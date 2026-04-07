import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ref, reactive } from "vue";
import type { SchedulerSettings } from "../types";
import { DEFAULT_SCHEDULER_SETTINGS } from "../types";

async function createReviewDB() {
  const { reviewDB } = await import("../db");
  await reviewDB.clearAll();
  return reviewDB;
}

describe("ReviewDB", () => {
  let db: Awaited<ReturnType<typeof createReviewDB>>;

  beforeEach(async () => {
    db = await createReviewDB();
  });

  describe("saveSettings / getSettings round-trip", () => {
    it("should save and retrieve plain settings", async () => {
      const settings: SchedulerSettings = {
        enabled: true,
        algorithm: "fsrs",
        dailyNewLimit: 30,
        dailyReviewLimit: 300,
        showAheadOfSchedule: false,
        fsrsParams: {
          requestRetention: 0.85,
          maximumInterval: 1000,
        },
      };

      await db.saveSettings("deck-1", settings);
      const result = await db.getSettings("deck-1");

      expect(result.algorithm).toBe("fsrs");
      expect(result.dailyNewLimit).toBe(30);
      expect(result.dailyReviewLimit).toBe(300);
      expect(result.fsrsParams?.requestRetention).toBe(0.85);
      expect(result.fsrsParams?.maximumInterval).toBe(1000);
    });

    it("should return defaults for unknown deck", async () => {
      const result = await db.getSettings("nonexistent");
      expect(result).toEqual(DEFAULT_SCHEDULER_SETTINGS);
    });

    it("should overwrite existing settings", async () => {
      await db.saveSettings("deck-1", { ...DEFAULT_SCHEDULER_SETTINGS, algorithm: "sm2" });
      await db.saveSettings("deck-1", { ...DEFAULT_SCHEDULER_SETTINGS, algorithm: "fsrs" });

      const result = await db.getSettings("deck-1");
      expect(result.algorithm).toBe("fsrs");
    });
  });

  describe("patchCard", () => {
    it("should partially update an existing card", async () => {
      await db.saveCard({
        cardId: "card-1",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: { phase: "new" },
        createdAt: Date.now(),
        lastReviewed: null,
      });

      const patched = await db.patchCard("card-1", { flags: 3 });
      expect(patched).not.toBeNull();
      expect(patched!.flags).toBe(3);
      expect(patched!.cardId).toBe("card-1");
      expect(patched!.algorithm).toBe("sm2");

      // Verify persistence
      const fetched = await db.getCard("card-1");
      expect(fetched!.flags).toBe(3);
    });

    it("should set queueOverride for bury/suspend", async () => {
      await db.saveCard({
        cardId: "card-2",
        deckId: "deck-1",
        algorithm: "sm2",
        cardState: { phase: "review" },
        createdAt: Date.now(),
        lastReviewed: Date.now(),
      });

      const buried = await db.patchCard("card-2", { queueOverride: -2 });
      expect(buried!.queueOverride).toBe(-2);

      const suspended = await db.patchCard("card-2", { queueOverride: -1 });
      expect(suspended!.queueOverride).toBe(-1);

      const restored = await db.patchCard("card-2", { queueOverride: undefined });
      expect(restored!.queueOverride).toBeUndefined();
    });

    it("should return null for nonexistent card", async () => {
      const result = await db.patchCard("nonexistent", { flags: 1 });
      expect(result).toBeNull();
    });
  });

  describe("Vue reactive proxy handling", () => {
    it("should fail to save a Vue ref value directly (demonstrates the bug)", async () => {
      const settingsRef = ref<SchedulerSettings>({
        enabled: true,
        algorithm: "fsrs",
        dailyNewLimit: 20,
        dailyReviewLimit: 200,
        showAheadOfSchedule: false,
        fsrsParams: { requestRetention: 0.9, maximumInterval: 36500 },
      });

      // Vue ref wraps the object in a reactive proxy.
      // IndexedDB's structured clone algorithm cannot clone proxies.
      await expect(db.saveSettings("deck-1", settingsRef.value)).rejects.toThrow();
    });

    it("should save a Vue ref value after JSON round-trip (the fix)", async () => {
      const settingsRef = ref<SchedulerSettings>({
        enabled: true,
        algorithm: "fsrs",
        dailyNewLimit: 30,
        dailyReviewLimit: 300,
        showAheadOfSchedule: false,
        fsrsParams: { requestRetention: 0.85, maximumInterval: 1000 },
      });

      const plain = JSON.parse(JSON.stringify(settingsRef.value)) as SchedulerSettings;
      await db.saveSettings("deck-1", plain);

      const result = await db.getSettings("deck-1");
      expect(result.algorithm).toBe("fsrs");
      expect(result.fsrsParams?.requestRetention).toBe(0.85);
    });

    it("should fail to save a Vue reactive object directly", async () => {
      const settings = reactive<SchedulerSettings>({
        enabled: true,
        algorithm: "fsrs",
        dailyNewLimit: 20,
        dailyReviewLimit: 200,
        showAheadOfSchedule: false,
      });

      await expect(db.saveSettings("deck-1", settings)).rejects.toThrow();
    });

    it("should save a ref that was mutated via spread (matches SchedulerSettings pattern)", async () => {
      // This mirrors the exact pattern in SchedulerSettings.vue:
      // settings.value = { ...settings.value, [key]: value }
      const settingsRef = ref<SchedulerSettings>({ ...DEFAULT_SCHEDULER_SETTINGS });

      // Simulate updateSetting('algorithm', 'fsrs')
      settingsRef.value = { ...settingsRef.value, algorithm: "fsrs" };

      // Simulate updateFsrsParam('requestRetention', 0.85)
      settingsRef.value = {
        ...settingsRef.value,
        fsrsParams: { ...settingsRef.value.fsrsParams, requestRetention: 0.85 },
      };

      // Without the fix: this throws DataCloneError
      await expect(db.saveSettings("deck-1", settingsRef.value)).rejects.toThrow();

      // With the fix: JSON round-trip strips proxies
      const plain = JSON.parse(JSON.stringify(settingsRef.value)) as SchedulerSettings;
      await db.saveSettings("deck-1", plain);

      const result = await db.getSettings("deck-1");
      expect(result.algorithm).toBe("fsrs");
      expect(result.fsrsParams?.requestRetention).toBe(0.85);
    });
  });
});
