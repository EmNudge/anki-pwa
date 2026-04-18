import { describe, it, expect } from "vitest";
import fc from "fast-check";
import {
  parseSearch,
  matchExpr,
  type SearchExpr,
  type SearchLeaf,
  type SearchableCard,
} from "../engine";
import { NUM_RUNS } from "~/test/pbt";

// ── Custom arbitraries ──

const arbSearchableCard: fc.Arbitrary<SearchableCard> = fc.record({
  fields: fc.dictionary(fc.stringMatching(/^[A-Za-z]{1,8}$/), fc.string({ maxLength: 50 }), {
    minKeys: 1,
    maxKeys: 3,
  }),
  deck: fc.stringMatching(/^[A-Za-z]{1,15}$/),
  tags: fc.array(fc.stringMatching(/^[a-z]{1,10}$/), { maxLength: 3 }),
  templateName: fc.stringMatching(/^[A-Za-z ]{1,15}$/),
  queueName: fc.constantFrom(
    "new",
    "learning",
    "dayLearning",
    "review",
    "suspended",
    "userBuried",
    "schedulerBuried",
  ),
  flags: fc.integer({ min: 0, max: 7 }),
  rawEase: fc.oneof(fc.constant(null), fc.double({ min: 1.3, max: 5.0, noNaN: true })),
  rawIvl: fc.integer({ min: 0, max: 36500 }),
  rawDue: fc.integer({ min: 0, max: 100000 }),
  rawDueType: fc.constantFrom("position", "timestamp", "dayOffset"),
  cardCreatedMs: fc.integer({ min: 0, max: 2000000000000 }),
  noteModSec: fc.integer({ min: 0, max: 2000000000 }),
  cardModSec: fc.integer({ min: 0, max: 2000000000 }),
  reps: fc.integer({ min: 0, max: 10000 }),
  lapses: fc.integer({ min: 0, max: 1000 }),
});

// Leaf expressions that don't depend on Date.now()
const arbSearchLeaf: fc.Arbitrary<SearchLeaf> = fc.oneof(
  fc.record({ type: fc.constant("text" as const), value: fc.stringMatching(/^[a-z]{0,10}$/) }),
  fc.record({ type: fc.constant("deck" as const), value: fc.stringMatching(/^[A-Za-z]{1,10}$/) }),
  fc.record({ type: fc.constant("tag" as const), value: fc.stringMatching(/^[a-z]{1,10}$/) }),
  fc.record({
    type: fc.constant("is" as const),
    value: fc.constantFrom("new", "learn", "review", "due", "suspended", "buried"),
  }),
  fc.record({ type: fc.constant("flag" as const), value: fc.integer({ min: 0, max: 7 }) }),
);

// Recursive SearchExpr (depth-limited)
const arbSearchExpr: fc.Arbitrary<SearchExpr> = fc.letrec<{ expr: SearchExpr }>((tie) => ({
  expr: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    arbSearchLeaf,
    fc.record({ type: fc.constant("negate" as const), inner: tie("expr") }),
    fc.record({
      type: fc.constant("and" as const),
      left: tie("expr"),
      right: tie("expr"),
    }),
    fc.record({
      type: fc.constant("or" as const),
      left: tie("expr"),
      right: tie("expr"),
    }),
  ),
})).expr;

const collectionCreationTime = 0;

describe("Search Engine — property-based tests", () => {
  describe("parseSearch robustness", () => {
    it("never throws on arbitrary strings", () => {
      fc.assert(
        fc.property(fc.string({ maxLength: 200 }), (query) => {
          // Should return SearchExpr | null, never throw
          const result = parseSearch(query);
          expect(result === null || typeof result === "object").toBe(true);
        }),
        { numRuns: NUM_RUNS ?? 500 },
      );
    });
  });

  describe("boolean algebra properties", () => {
    it("double negation: NOT(NOT(expr)) === expr", () => {
      fc.assert(
        fc.property(arbSearchableCard, arbSearchExpr, (card, expr) => {
          const direct = matchExpr(card, expr, collectionCreationTime);
          const doubleNeg = matchExpr(
            card,
            { type: "negate", inner: { type: "negate", inner: expr } },
            collectionCreationTime,
          );
          expect(doubleNeg).toBe(direct);
        }),
        { numRuns: NUM_RUNS ?? 300 },
      );
    });

    it("AND commutativity: (A AND B) === (B AND A)", () => {
      fc.assert(
        fc.property(arbSearchableCard, arbSearchExpr, arbSearchExpr, (card, a, b) => {
          const ab = matchExpr(card, { type: "and", left: a, right: b }, collectionCreationTime);
          const ba = matchExpr(card, { type: "and", left: b, right: a }, collectionCreationTime);
          expect(ab).toBe(ba);
        }),
        { numRuns: NUM_RUNS ?? 300 },
      );
    });

    it("OR commutativity: (A OR B) === (B OR A)", () => {
      fc.assert(
        fc.property(arbSearchableCard, arbSearchExpr, arbSearchExpr, (card, a, b) => {
          const ab = matchExpr(card, { type: "or", left: a, right: b }, collectionCreationTime);
          const ba = matchExpr(card, { type: "or", left: b, right: a }, collectionCreationTime);
          expect(ab).toBe(ba);
        }),
        { numRuns: NUM_RUNS ?? 300 },
      );
    });

    it("De Morgan: NOT(A AND B) === (NOT A) OR (NOT B)", () => {
      fc.assert(
        fc.property(arbSearchableCard, arbSearchExpr, arbSearchExpr, (card, a, b) => {
          const notAandB = matchExpr(
            card,
            { type: "negate", inner: { type: "and", left: a, right: b } },
            collectionCreationTime,
          );
          const notAorNotB = matchExpr(
            card,
            {
              type: "or",
              left: { type: "negate", inner: a },
              right: { type: "negate", inner: b },
            },
            collectionCreationTime,
          );
          expect(notAandB).toBe(notAorNotB);
        }),
        { numRuns: NUM_RUNS ?? 300 },
      );
    });

    it("De Morgan: NOT(A OR B) === (NOT A) AND (NOT B)", () => {
      fc.assert(
        fc.property(arbSearchableCard, arbSearchExpr, arbSearchExpr, (card, a, b) => {
          const notAorB = matchExpr(
            card,
            { type: "negate", inner: { type: "or", left: a, right: b } },
            collectionCreationTime,
          );
          const notAandNotB = matchExpr(
            card,
            {
              type: "and",
              left: { type: "negate", inner: a },
              right: { type: "negate", inner: b },
            },
            collectionCreationTime,
          );
          expect(notAorB).toBe(notAandNotB);
        }),
        { numRuns: NUM_RUNS ?? 300 },
      );
    });
  });

  describe("self-matching properties", () => {
    it("empty text matches all cards", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const expr: SearchExpr = { type: "text", value: "" };
          expect(matchExpr(card, expr, collectionCreationTime)).toBe(true);
        }),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("deck: self-match — card always matches its own deck", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const expr: SearchExpr = { type: "deck", value: card.deck };
          expect(matchExpr(card, expr, collectionCreationTime)).toBe(true);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("tag: self-match — card matches each of its own tags", () => {
      fc.assert(
        fc.property(
          arbSearchableCard.filter((c) => c.tags.length > 0),
          (card) => {
            for (const tag of card.tags) {
              const expr: SearchExpr = { type: "tag", value: tag };
              expect(matchExpr(card, expr, collectionCreationTime)).toBe(true);
            }
          },
        ),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("flag: self-match — card matches its own flag value", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const expr: SearchExpr = { type: "flag", value: card.flags };
          expect(matchExpr(card, expr, collectionCreationTime)).toBe(true);
        }),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("is: queue mapping — each card matches exactly one primary is: qualifier", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const queueToIs: Record<string, string> = {
            new: "new",
            learning: "learn",
            dayLearning: "learn",
            review: "review",
            suspended: "suspended",
            userBuried: "buried",
            schedulerBuried: "buried",
          };
          const expectedIs = queueToIs[card.queueName];
          if (expectedIs) {
            const expr: SearchExpr = { type: "is", value: expectedIs };
            expect(matchExpr(card, expr, collectionCreationTime)).toBe(true);
          }
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });

    it("is:due matches learn and review cards", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const isDue = matchExpr(card, { type: "is", value: "due" }, collectionCreationTime);
          const isLearn = matchExpr(card, { type: "is", value: "learn" }, collectionCreationTime);
          const isReview = matchExpr(card, { type: "is", value: "review" }, collectionCreationTime);
          expect(isDue).toBe(isLearn || isReview);
        }),
        { numRuns: NUM_RUNS ?? 200 },
      );
    });
  });

  describe("prop: numeric comparisons", () => {
    it("prop:reps>N is false when reps <= N", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const expr: SearchExpr = {
            type: "prop",
            prop: "reps",
            op: ">",
            value: card.reps,
          };
          // reps > reps is always false
          expect(matchExpr(card, expr, collectionCreationTime)).toBe(false);
        }),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("prop:reps>=N is true when reps === N", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const expr: SearchExpr = {
            type: "prop",
            prop: "reps",
            op: ">=",
            value: card.reps,
          };
          expect(matchExpr(card, expr, collectionCreationTime)).toBe(true);
        }),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });

    it("prop:lapses=N matches exactly", () => {
      fc.assert(
        fc.property(arbSearchableCard, (card) => {
          const expr: SearchExpr = {
            type: "prop",
            prop: "lapses",
            op: "=",
            value: card.lapses,
          };
          expect(matchExpr(card, expr, collectionCreationTime)).toBe(true);
        }),
        { numRuns: NUM_RUNS ?? 100 },
      );
    });
  });
});
