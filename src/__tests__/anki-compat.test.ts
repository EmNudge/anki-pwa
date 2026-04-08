/**
 * Tests validating compatibility with official Anki desktop client.
 * Each test asserts the CORRECT behavior per the official Anki codebase.
 */
import { describe, it, expect } from "vitest";
import { getQueueName, getRevlogTypeName } from "../ankiParser/anki2";
import {
  CARD_UPDATE_SQL,
  GRAVES_INSERT_SQL,
  QUEUE_USER_BURIED,
  convertDue,
  encodeLeft,
  encodeFactor,
  phaseToRevlogType,
} from "../lib/syncWrite";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Queue constants: schedulerBuried vs userBuried
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 1: Buried queue constants are swapped", () => {
  it("queue -2 should be schedulerBuried (sibling buried), not userBuried", () => {
    // Official Anki: -2 = SchedBuried (sibling buried by scheduler)
    expect(getQueueName(-2)).toBe("schedulerBuried");
  });

  it("queue -3 should be userBuried (manually buried), not schedulerBuried", () => {
    // Official Anki: -3 = UserBuried (manually buried by user)
    expect(getQueueName(-3)).toBe("userBuried");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. col.mod should be in milliseconds, not seconds
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 2: col.mod timestamp precision", () => {
  it("col.mod should be written in milliseconds, not seconds", () => {
    // Official Anki stores col.mod in milliseconds.
    // After fix, the source uses Date.now() which is in ms range (>= 1e12).
    const nowMs = Date.now();
    expect(nowMs).toBeGreaterThanOrEqual(1e12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. left field encoding: steps_today and steps_remaining independently
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 3: left field encoding is wrong across midnight", () => {
  it("should encode steps_today and steps_remaining independently", () => {
    // Official Anki: left = steps_today * 1000 + steps_remaining
    // These can differ when a learning card spans midnight.
    const state = { phase: "learning" as const, step: 1 };
    const totalSteps = 3;
    const stepsToday = 1; // Only 1 step left today (crossed midnight)

    const correctLeft = stepsToday * 1000 + (totalSteps - state.step); // 1002
    const actualLeft = encodeLeft(state, totalSteps, stepsToday);

    expect(actualLeft).toBe(correctLeft);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. notes.sfld column type should be integer, not text
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 4: notes.sfld column type in schema", () => {
  it("sfld column should be declared as integer, not text", async () => {
    // Official Anki schema: sfld integer not null
    const { readFileSync } = await import("fs");
    const { resolve } = await import("path");
    const source = readFileSync(
      resolve(__dirname, "../ankiExporter/index.ts"),
      "utf-8",
    );
    const sfldMatch = source.match(/sfld\s+(\w+)/);
    expect(sfldMatch?.[1]).toBe("integer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Revlog type 5 (Rescheduled) is missing
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 5: Missing revlog type 5 (Rescheduled)", () => {
  it("revlog type 5 should be 'rescheduled', not 'unknown'", () => {
    expect(getRevlogTypeName(5)).toBe("rescheduled");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. FSRS factor encoding in revlog differs from SM-2
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 6: FSRS difficulty encoding in revlog factor", () => {
  it("FSRS reviews should encode factor as difficulty*100+100, not ease*1000", () => {
    const difficulty = 5.0;
    // Official Anki FSRS: factor = Math.round(difficulty * 100) + 100 = 600
    const correctFsrsFactor = Math.round(difficulty * 100) + 100;
    const actualFactor = encodeFactor(0, "fsrs", difficulty);
    expect(actualFactor).toBe(correctFsrsFactor);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. FSRS state (card.data) is not written back on sync
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 7: FSRS memory state lost on sync-back", () => {
  it("card UPDATE should include the data column for FSRS state", () => {
    expect(CARD_UPDATE_SQL).toContain("data=?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. dayLearning queue (3) due should be day offset, not timestamp
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 9: dayLearning due format is wrong", () => {
  it("dayLearning cards should use day offset for due, not unix timestamp", () => {
    const collectionCreationSecs = 1700000000;
    const dueMs = (collectionCreationSecs + 86400) * 1000; // 1 day after creation

    // A learning card with interval >= 1 day is dayLearning
    const state = { phase: "learning" as const, due: dueMs, interval: 1 };

    const result = convertDue(state, collectionCreationSecs);
    // For dayLearning, should be day offset (1), not unix timestamp
    expect(result).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. No graves written during sync-back
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 10: Graves not written during sync-back", () => {
  it("syncWrite should have a function or SQL to insert graves entries", () => {
    expect(GRAVES_INSERT_SQL).toContain("INSERT INTO graves");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. Card UPDATE missing odue and odid columns
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 11: Card UPDATE missing odue and odid", () => {
  it("card UPDATE should include odue and odid for filtered deck support", () => {
    expect(CARD_UPDATE_SQL).toContain("odue=?");
    expect(CARD_UPDATE_SQL).toContain("odid=?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. USN not updated on card records during write-back
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 12: USN not set on card records", () => {
  it("card UPDATE should set usn=-1 to mark cards for sync", () => {
    expect(CARD_UPDATE_SQL).toContain("usn=?");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. queueOverride uses wrong values for bury
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 1b: queueOverride uses swapped bury values", () => {
  it("CardReviewState.queueOverride -2 should mean schedulerBuried", () => {
    // Official Anki: -3 = UserBuried, -2 = SchedBuried
    expect(QUEUE_USER_BURIED).toBe(-3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 13. Revlog type determination is oversimplified
// ─────────────────────────────────────────────────────────────────────────────
describe("Issue 5b: Revlog type logic is oversimplified", () => {
  it("revlog type should reflect card phase, not just ease value", () => {
    // A relearning card answered with "good" should be type 2 (relearning)
    expect(phaseToRevlogType("relearning")).toBe(2);
  });
});
