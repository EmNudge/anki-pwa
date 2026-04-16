import { describe, expect, it } from "vitest";
import {
  parseSearch,
  matchExpr,
  ankiCardToSearchable,
  type SearchableCard,
  type SearchExpr,
} from "../engine";

function makeCard(overrides: Partial<SearchableCard> = {}): SearchableCard {
  return {
    fields: { Front: "hello world", Back: "goodbye" },
    deck: "Default",
    tags: [],
    templateName: "Basic",
    queueName: "new",
    flags: 0,
    rawEase: null,
    rawIvl: 0,
    rawDue: 0,
    rawDueType: "position",
    cardCreatedMs: Date.now(),
    noteModSec: Math.floor(Date.now() / 1000),
    cardModSec: Math.floor(Date.now() / 1000),
    reps: 0,
    lapses: 0,
    ...overrides,
  };
}

const COLLECTION_CREATION = Math.floor(Date.now() / 1000) - 86400 * 30; // 30 days ago

describe("parseSearch", () => {
  it("returns null for empty query", () => {
    expect(parseSearch("")).toBeNull();
    expect(parseSearch("   ")).toBeNull();
  });

  it("parses a simple text term", () => {
    const expr = parseSearch("hello");
    expect(expr).toEqual({ type: "text", value: "hello" });
  });

  it("parses a quoted text term", () => {
    const expr = parseSearch('"hello world"');
    expect(expr).toEqual({ type: "text", value: "hello world" });
  });

  it("parses deck: qualifier", () => {
    const expr = parseSearch("deck:Biology");
    expect(expr).toEqual({ type: "deck", value: "Biology" });
  });

  it("parses tag: qualifier", () => {
    const expr = parseSearch("tag:vocab");
    expect(expr).toEqual({ type: "tag", value: "vocab" });
  });

  it("parses is: qualifier", () => {
    const expr = parseSearch("is:new");
    expect(expr).toEqual({ type: "is", value: "new" });
  });

  it("parses flag: qualifier with number", () => {
    const expr = parseSearch("flag:1");
    expect(expr).toEqual({ type: "flag", value: 1 });
  });

  it("parses prop: qualifier", () => {
    const expr = parseSearch("prop:ease>=2.5");
    expect(expr).toEqual({ type: "prop", prop: "ease", op: ">=", value: 2.5 });
  });

  it("parses added: qualifier", () => {
    const expr = parseSearch("added:7");
    expect(expr).toEqual({ type: "added", days: 7 });
  });

  it("parses negation", () => {
    const expr = parseSearch("-is:suspended");
    expect(expr).toEqual({
      type: "negate",
      inner: { type: "is", value: "suspended" },
    });
  });

  it("parses implicit AND", () => {
    const expr = parseSearch("is:new deck:Biology");
    expect(expr).toEqual({
      type: "and",
      left: { type: "is", value: "new" },
      right: { type: "deck", value: "Biology" },
    });
  });

  it("parses OR", () => {
    const expr = parseSearch("is:new OR is:due");
    expect(expr).toEqual({
      type: "or",
      left: { type: "is", value: "new" },
      right: { type: "is", value: "due" },
    });
  });

  it("parses parenthesized groups", () => {
    const expr = parseSearch("(is:new OR is:due) deck:Bio");
    expect(expr).not.toBeNull();
    expect(expr!.type).toBe("and");
  });

  it("parses deck with quoted value", () => {
    const expr = parseSearch('deck:"My Deck"');
    expect(expr).toEqual({ type: "deck", value: "My Deck" });
  });
});

describe("matchExpr", () => {
  describe("text matching", () => {
    it("matches text in fields", () => {
      const card = makeCard({ fields: { Front: "apple pie" } });
      const expr = parseSearch("apple")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });

    it("does not match absent text", () => {
      const card = makeCard({ fields: { Front: "apple pie" } });
      const expr = parseSearch("banana")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(false);
    });

    it("matches text in deck name", () => {
      const card = makeCard({ deck: "Biology::Cells" });
      const expr = parseSearch("biology")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });

    it("matches text in tags", () => {
      const card = makeCard({ tags: ["vocab", "chapter1"] });
      const expr = parseSearch("vocab")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });

    it("empty text matches everything", () => {
      const card = makeCard();
      const expr: SearchExpr = { type: "text", value: "" };
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });
  });

  describe("deck: matching", () => {
    it("matches exact deck name", () => {
      const card = makeCard({ deck: "Biology" });
      const expr = parseSearch("deck:Biology")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });

    it("matches child decks with prefix", () => {
      const card = makeCard({ deck: "Biology::Cells" });
      const expr = parseSearch("deck:Biology")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });

    it("does not match different deck", () => {
      const card = makeCard({ deck: "Chemistry" });
      const expr = parseSearch("deck:Biology")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(false);
    });

    it("case insensitive", () => {
      const card = makeCard({ deck: "biology" });
      const expr = parseSearch("deck:Biology")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });
  });

  describe("tag: matching", () => {
    it("matches exact tag", () => {
      const card = makeCard({ tags: ["vocab"] });
      const expr = parseSearch("tag:vocab")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });

    it("matches hierarchical tag", () => {
      const card = makeCard({ tags: ["vocab::chapter1"] });
      const expr = parseSearch("tag:vocab")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(true);
    });

    it("does not match unrelated tag", () => {
      const card = makeCard({ tags: ["grammar"] });
      const expr = parseSearch("tag:vocab")!;
      expect(matchExpr(card, expr, COLLECTION_CREATION)).toBe(false);
    });
  });

  describe("is: matching", () => {
    it("matches is:new", () => {
      const card = makeCard({ queueName: "new" });
      expect(matchExpr(card, parseSearch("is:new")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches is:learn for learning cards", () => {
      const card = makeCard({ queueName: "learning" });
      expect(matchExpr(card, parseSearch("is:learn")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches is:learn for dayLearning cards", () => {
      const card = makeCard({ queueName: "dayLearning" });
      expect(matchExpr(card, parseSearch("is:learn")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches is:review", () => {
      const card = makeCard({ queueName: "review" });
      expect(matchExpr(card, parseSearch("is:review")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches is:due for review cards", () => {
      const card = makeCard({ queueName: "review" });
      expect(matchExpr(card, parseSearch("is:due")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches is:suspended", () => {
      const card = makeCard({ queueName: "suspended" });
      expect(matchExpr(card, parseSearch("is:suspended")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches is:buried", () => {
      const card = makeCard({ queueName: "userBuried" });
      expect(matchExpr(card, parseSearch("is:buried")!, COLLECTION_CREATION)).toBe(true);
    });
  });

  describe("flag: matching", () => {
    it("matches flag number", () => {
      const card = makeCard({ flags: 1 });
      expect(matchExpr(card, parseSearch("flag:1")!, COLLECTION_CREATION)).toBe(true);
    });

    it("does not match different flag", () => {
      const card = makeCard({ flags: 2 });
      expect(matchExpr(card, parseSearch("flag:1")!, COLLECTION_CREATION)).toBe(false);
    });

    it("matches flag:0 for no flag", () => {
      const card = makeCard({ flags: 0 });
      expect(matchExpr(card, parseSearch("flag:0")!, COLLECTION_CREATION)).toBe(true);
    });
  });

  describe("prop: matching", () => {
    it("matches prop:ease>=2.5", () => {
      const card = makeCard({ rawEase: 2.5 });
      expect(matchExpr(card, parseSearch("prop:ease>=2.5")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches prop:ivl>10", () => {
      const card = makeCard({ rawIvl: 15 });
      expect(matchExpr(card, parseSearch("prop:ivl>10")!, COLLECTION_CREATION)).toBe(true);
    });

    it("does not match when prop is below threshold", () => {
      const card = makeCard({ rawIvl: 5 });
      expect(matchExpr(card, parseSearch("prop:ivl>10")!, COLLECTION_CREATION)).toBe(false);
    });

    it("matches prop:reps>0", () => {
      const card = makeCard({ reps: 5 });
      expect(matchExpr(card, parseSearch("prop:reps>0")!, COLLECTION_CREATION)).toBe(true);
    });

    it("matches prop:lapses>=3", () => {
      const card = makeCard({ lapses: 4 });
      expect(matchExpr(card, parseSearch("prop:lapses>=3")!, COLLECTION_CREATION)).toBe(true);
    });

    it("returns false when ease is null", () => {
      const card = makeCard({ rawEase: null });
      expect(matchExpr(card, parseSearch("prop:ease>0")!, COLLECTION_CREATION)).toBe(false);
    });
  });

  describe("added: matching", () => {
    it("matches cards added within N days", () => {
      const card = makeCard({ cardCreatedMs: Date.now() - 3 * 86400_000 });
      expect(matchExpr(card, parseSearch("added:7")!, COLLECTION_CREATION)).toBe(true);
    });

    it("does not match cards added before N days", () => {
      const card = makeCard({ cardCreatedMs: Date.now() - 10 * 86400_000 });
      expect(matchExpr(card, parseSearch("added:7")!, COLLECTION_CREATION)).toBe(false);
    });
  });

  describe("boolean logic", () => {
    it("negation inverts match", () => {
      const card = makeCard({ queueName: "new" });
      expect(matchExpr(card, parseSearch("-is:new")!, COLLECTION_CREATION)).toBe(false);
      expect(matchExpr(card, parseSearch("-is:review")!, COLLECTION_CREATION)).toBe(true);
    });

    it("AND requires both conditions", () => {
      const card = makeCard({ queueName: "new", deck: "Biology" });
      expect(matchExpr(card, parseSearch("is:new deck:Biology")!, COLLECTION_CREATION)).toBe(true);
      expect(matchExpr(card, parseSearch("is:new deck:Chemistry")!, COLLECTION_CREATION)).toBe(false);
    });

    it("OR requires either condition", () => {
      const card = makeCard({ queueName: "new" });
      expect(matchExpr(card, parseSearch("is:new OR is:review")!, COLLECTION_CREATION)).toBe(true);
      expect(matchExpr(card, parseSearch("is:review OR is:suspended")!, COLLECTION_CREATION)).toBe(false);
    });
  });
});

describe("ankiCardToSearchable", () => {
  it("converts an anki card to SearchableCard", () => {
    const card = {
      values: { Front: "<b>Hello</b>", Back: "World" },
      tags: ["vocab"],
      templates: [{ name: "Basic" }] as any,
      deckName: "Test",
      guid: "abc123",
      scheduling: {
        queueName: "review",
        flags: 1,
        easeFactor: 2.5,
        ivl: 10,
        due: 100,
        dueType: "dayOffset",
        reps: 5,
        lapses: 1,
      } as any,
      ankiCardId: 1234567890,
      noteMod: 1000000,
      cardMod: 1000001,
    };

    const searchable = ankiCardToSearchable(card);
    expect(searchable.fields.Front).toBe("Hello"); // HTML stripped
    expect(searchable.fields.Back).toBe("World");
    expect(searchable.deck).toBe("Test");
    expect(searchable.tags).toEqual(["vocab"]);
    expect(searchable.templateName).toBe("Basic");
    expect(searchable.queueName).toBe("review");
    expect(searchable.flags).toBe(1);
    expect(searchable.rawEase).toBe(2.5);
    expect(searchable.rawIvl).toBe(10);
    expect(searchable.reps).toBe(5);
    expect(searchable.lapses).toBe(1);
  });

  it("handles null scheduling", () => {
    const card = {
      values: { Front: "Test" },
      tags: [],
      templates: [{ name: "Basic" }] as any,
      deckName: "Default",
      guid: "xyz",
      scheduling: null,
    };

    const searchable = ankiCardToSearchable(card);
    expect(searchable.queueName).toBe("new");
    expect(searchable.flags).toBe(0);
    expect(searchable.rawEase).toBeNull();
    expect(searchable.rawIvl).toBe(0);
    expect(searchable.reps).toBe(0);
  });
});
