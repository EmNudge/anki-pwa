import { describe, it, expect } from "vitest";
import { exportCards } from "../csvJsonExport";
import type { AnkiData } from "../../ankiParser";

function makeAnkiData(cards: AnkiData["cards"][number][] = []): AnkiData {
  return {
    deckName: "Test Deck",
    cards,
    decks: {},
    media: [],
    models: {},
    tags: [],
    dconf: {},
    schedulerVersion: 2,
  } as unknown as AnkiData;
}

function makeCard(overrides: Record<string, unknown> = {}): AnkiData["cards"][number] {
  return {
    deckName: "Test Deck",
    guid: "abc123",
    tags: ["tag1"],
    values: { Front: "Question", Back: "Answer" },
    templates: [{ name: "Card 1", front: "{{Front}}", back: "{{Back}}" }],
    noteId: 1,
    fieldNames: ["Front", "Back"],
    modelName: "Basic",
    ...overrides,
  } as unknown as AnkiData["cards"][number];
}

describe("exportCards CSV", () => {
  it("returns CSV with headers and data rows", () => {
    const data = makeAnkiData([makeCard()]);
    const result = exportCards(data, {
      format: "csv",
      scope: "all",
      includeScheduling: false,
      includeHtml: true,
    });
    expect(result.mimeType).toBe("text/csv;charset=utf-8");
    expect(result.extension).toBe("csv");
    const lines = result.content.split("\n");
    expect(lines.length).toBe(2); // header + 1 row
    expect(lines[0]).toContain("deck");
    expect(lines[0]).toContain("tags");
    expect(lines[0]).toContain("guid");
    expect(lines[0]).toContain("Front");
    expect(lines[0]).toContain("Back");
  });

  it("returns empty string for no cards", () => {
    const result = exportCards(makeAnkiData([]), {
      format: "csv",
      scope: "all",
      includeScheduling: false,
      includeHtml: true,
    });
    expect(result.content).toBe("");
  });

  it("escapes commas in CSV fields", () => {
    const card = makeCard({ values: { Front: "hello, world", Back: "ok" } });
    const result = exportCards(makeAnkiData([card]), {
      format: "csv",
      scope: "all",
      includeScheduling: false,
      includeHtml: true,
    });
    expect(result.content).toContain('"hello, world"');
  });

  it("escapes quotes in CSV fields", () => {
    const card = makeCard({ values: { Front: 'say "hi"', Back: "ok" } });
    const result = exportCards(makeAnkiData([card]), {
      format: "csv",
      scope: "all",
      includeScheduling: false,
      includeHtml: true,
    });
    expect(result.content).toContain('"say ""hi"""');
  });

  it("strips HTML when includeHtml is false", () => {
    const card = makeCard({ values: { Front: "<b>bold</b>", Back: "plain" } });
    const result = exportCards(makeAnkiData([card]), {
      format: "csv",
      scope: "all",
      includeScheduling: false,
      includeHtml: false,
    });
    expect(result.content).toContain("bold");
    expect(result.content).not.toContain("<b>");
  });

  it("strips sound tags when includeHtml is false", () => {
    const card = makeCard({ values: { Front: "[sound:audio.mp3] word", Back: "ok" } });
    const result = exportCards(makeAnkiData([card]), {
      format: "csv",
      scope: "all",
      includeScheduling: false,
      includeHtml: false,
    });
    expect(result.content).toContain("word");
    expect(result.content).not.toContain("[sound:");
  });

  it("includes scheduling columns when requested", () => {
    const card = makeCard({
      scheduling: {
        type: 2,
        queue: 2,
        due: 100,
        ivl: 10,
        easeFactor: 2500,
        reps: 5,
        lapses: 1,
        typeName: "review",
        queueName: "review",
      },
    } as Partial<AnkiData["cards"][number]>);
    const result = exportCards(makeAnkiData([card]), {
      format: "csv",
      scope: "all",
      includeScheduling: true,
      includeHtml: true,
    });
    expect(result.content).toContain("scheduling_type");
    expect(result.content).toContain("scheduling_interval");
  });

  it("filters by deck when scope is 'deck'", () => {
    const card1 = makeCard({ deckName: "Deck A", values: { Front: "Q1", Back: "A1" } });
    const card2 = makeCard({ deckName: "Deck B", values: { Front: "Q2", Back: "A2" } });
    const result = exportCards(makeAnkiData([card1, card2]), {
      format: "csv",
      scope: "deck",
      deckName: "Deck A",
      includeScheduling: false,
      includeHtml: true,
    });
    const lines = result.content.split("\n");
    expect(lines).toHaveLength(2); // header + 1 matching card
    expect(result.content).toContain("Q1");
    expect(result.content).not.toContain("Q2");
  });

  it("includes subdeck cards when filtering by parent deck", () => {
    const card1 = makeCard({ deckName: "Parent", values: { Front: "Q1", Back: "A1" } });
    const card2 = makeCard({ deckName: "Parent::Child", values: { Front: "Q2", Back: "A2" } });
    const result = exportCards(makeAnkiData([card1, card2]), {
      format: "csv",
      scope: "deck",
      deckName: "Parent",
      includeScheduling: false,
      includeHtml: true,
    });
    const lines = result.content.split("\n");
    expect(lines).toHaveLength(3); // header + 2 cards
  });

  it("respects csvColumns filter", () => {
    const card = makeCard({ values: { Front: "Q", Back: "A", Extra: "E" } });
    const result = exportCards(makeAnkiData([card]), {
      format: "csv",
      scope: "all",
      includeScheduling: false,
      includeHtml: true,
      csvColumns: ["Front"],
    });
    const header = result.content.split("\n")[0]!;
    expect(header).toContain("Front");
    expect(header).not.toContain("Back");
    expect(header).not.toContain("Extra");
  });
});

describe("exportCards JSON", () => {
  it("returns valid JSON", () => {
    const data = makeAnkiData([makeCard()]);
    const result = exportCards(data, {
      format: "json",
      scope: "all",
      includeScheduling: false,
      includeHtml: true,
    });
    expect(result.mimeType).toBe("application/json;charset=utf-8");
    expect(result.extension).toBe("json");
    const parsed = JSON.parse(result.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].Front).toBe("Question");
  });

  it("includes deck and tags in JSON output", () => {
    const card = makeCard({ deckName: "My Deck", tags: ["t1", "t2"] });
    const result = exportCards(makeAnkiData([card]), {
      format: "json",
      scope: "all",
      includeScheduling: false,
      includeHtml: true,
    });
    const parsed = JSON.parse(result.content);
    expect(parsed[0].deck).toBe("My Deck");
    expect(parsed[0].tags).toBe("t1 t2");
  });
});
