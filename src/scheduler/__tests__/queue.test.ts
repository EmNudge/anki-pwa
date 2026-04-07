import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { ReviewQueue, type ReviewCard } from "../queue";
import { DEFAULT_SCHEDULER_SETTINGS } from "../types";

function makeReviewCard(
  overrides: Partial<ReviewCard> & { cardId: string },
): ReviewCard {
  const now = Date.now();
  return {
    cardIndex: 0,
    templateIndex: 0,
    isNew: false,
    reviewState: {
      cardId: overrides.cardId,
      deckId: "deck-test",
      algorithm: "sm2",
      cardState: {
        phase: "review",
        step: 0,
        ease: 2.5,
        interval: 1,
        due: now - 1000, // due in the past
        lapses: 0,
        reps: 1,
      },
      createdAt: now,
      lastReviewed: now,
    },
    ...overrides,
  };
}

describe("ReviewQueue.getDueCards", () => {
  let queue: ReviewQueue;

  beforeEach(async () => {
    queue = new ReviewQueue("deck-test", DEFAULT_SCHEDULER_SETTINGS);
    await queue.init();
  });

  it("should include normal review cards", () => {
    const cards = [makeReviewCard({ cardId: "c1" })];
    const due = queue.getDueCards(cards);
    expect(due).toHaveLength(1);
    expect(due[0]!.cardId).toBe("c1");
  });

  it("should exclude suspended cards (queueOverride = -1)", () => {
    const card = makeReviewCard({ cardId: "c1" });
    card.reviewState.queueOverride = -1;

    const due = queue.getDueCards([card]);
    expect(due).toHaveLength(0);
  });

  it("should exclude buried cards (queueOverride = -2)", () => {
    const card = makeReviewCard({ cardId: "c1" });
    card.reviewState.queueOverride = -2;

    const due = queue.getDueCards([card]);
    expect(due).toHaveLength(0);
  });

  it("should include cards without queueOverride alongside filtered ones", () => {
    const normal = makeReviewCard({ cardId: "c1" });
    const buried = makeReviewCard({ cardId: "c2" });
    buried.reviewState.queueOverride = -2;
    const suspended = makeReviewCard({ cardId: "c3" });
    suspended.reviewState.queueOverride = -1;
    const alsoNormal = makeReviewCard({ cardId: "c4" });

    const due = queue.getDueCards([normal, buried, suspended, alsoNormal]);
    const ids = due.map((c) => c.cardId);
    expect(ids).toContain("c1");
    expect(ids).toContain("c4");
    expect(ids).not.toContain("c2");
    expect(ids).not.toContain("c3");
  });
});
