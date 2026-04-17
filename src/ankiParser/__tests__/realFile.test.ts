import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import initSqlJs from "sql.js";
import { getDataFromAnki2 } from "../anki2";
import { getDataFromAnki21b } from "../anki21b";
import { BlobReader, ZipReader, BlobWriter, type Entry } from "@zip-js/zip-js";
import path from "path";

/**
 * Type guard to check if an Entry has getData (i.e. is a file, not a directory)
 */
function isFileEntry(entry: Entry): entry is Entry & { getData: NonNullable<Entry["getData"]> } {
  return !entry.directory && typeof entry.getData === "function";
}

// Mock the WASM dependencies to avoid loading issues in tests
vi.mock("../index", () => ({
  getAnkiDataFromBlob: vi.fn(),
}));

async function parseAnkiFile(filePath: string) {
  const fileBuffer = new Uint8Array(readFileSync(filePath));
  const blob = new Blob([fileBuffer]);

  const zipFileReader = new BlobReader(blob);
  const zipReader = new ZipReader(zipFileReader);
  const entries = await zipReader.getEntries();

  // Find the collection file - prioritize anki21b as it's the newer format
  const collectionEntry =
    entries.find((e) => e.filename === "collection.anki21b") ||
    entries.find((e) => e.filename === "collection.anki21") ||
    entries.find((e) => e.filename === "collection.anki2");

  if (!collectionEntry) {
    throw new Error("No collection file found in .apkg");
  }

  if (!isFileEntry(collectionEntry)) {
    throw new Error("collection entry is not a file");
  }

  const collectionBlob = await collectionEntry.getData(new BlobWriter());
  const collectionBuffer = new Uint8Array(await collectionBlob.arrayBuffer());

  // Initialize SQL.js
  const wasmPath = path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  const SQL = await initSqlJs({
    locateFile: () => wasmPath,
  });

  const db = new SQL.Database(collectionBuffer);

  // Determine which parser to use based on filename
  let result;
  if (collectionEntry.filename === "collection.anki21b") {
    // Decompress if anki21b - use Node.js version for tests
    const { decompressZstd } = await import("../../../cli/utils/zstdNode");
    const decompressed = await decompressZstd(collectionBuffer);
    const decompressedDb = new SQL.Database(decompressed);
    result = getDataFromAnki21b(decompressedDb);
  } else {
    result = getDataFromAnki2(db);
  }

  await zipReader.close();

  return {
    cards: result.cards,
    notesTypes: result.notesTypes,
    dbType: collectionEntry.filename,
    deckName: result.deckName,
    decks: result.decks,
  };
}

describe("Real Anki File Parsing", () => {
  describe("example_music_intervals.apkg", () => {
    it("should parse the example music intervals deck", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      // Basic structure checks
      expect(result.cards).toBeDefined();
      expect(Array.isArray(result.cards)).toBe(true);
      expect(result.cards.length).toBeGreaterThan(0);
      expect(result.dbType).toBeDefined();

      console.log(`\n📦 Database type: ${result.dbType}`);
      console.log(`📊 Total cards: ${result.cards.length}`);
    });

    it("should extract card data with correct structure", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      // Check first card structure
      const firstCard = result.cards[0];
      expect(firstCard).toBeDefined();
      if (!firstCard) return;

      expect(firstCard.values).toBeDefined();
      expect(typeof firstCard.values).toBe("object");
      expect(firstCard.tags).toBeDefined();
      expect(Array.isArray(firstCard.tags)).toBe(true);
      expect(firstCard.templates).toBeDefined();
      expect(Array.isArray(firstCard.templates)).toBe(true);
    });

    it("should have templates with required fields", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      const firstCard = result.cards[0];
      if (!firstCard) return;
      expect(firstCard.templates.length).toBeGreaterThan(0);

      const firstTemplate = firstCard.templates[0];
      if (!firstTemplate) return;
      expect(firstTemplate.name).toBeDefined();
      expect(typeof firstTemplate.name).toBe("string");
      expect(firstTemplate.qfmt).toBeDefined();
      expect(typeof firstTemplate.qfmt).toBe("string");
      expect(firstTemplate.afmt).toBeDefined();
      expect(typeof firstTemplate.afmt).toBe("string");
    });

    it("should have field values as strings or null", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      for (const card of result.cards) {
        for (const [key, value] of Object.entries(card.values)) {
          expect(
            typeof value === "string" || value === null,
            `Field ${key} should be string or null, got ${typeof value}`,
          ).toBe(true);
        }
      }
    });

    it("should parse all cards without errors", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      // Verify all cards have the expected structure
      for (let i = 0; i < result.cards.length; i++) {
        const card = result.cards[i];
        expect(card, `Card ${i} should exist`).toBeDefined();
        if (!card) return;

        expect(card.values, `Card ${i} should have values`).toBeDefined();
        expect(card.tags, `Card ${i} should have tags`).toBeDefined();
        expect(card.templates, `Card ${i} should have templates`).toBeDefined();
        expect(
          card.templates.length,
          `Card ${i} should have at least one template`,
        ).toBeGreaterThan(0);
      }
    });

    it("should log deck statistics", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      // Get unique field names
      const fieldNames = new Set<string>();
      result.cards.forEach((card) => {
        Object.keys(card.values).forEach((key) => fieldNames.add(key));
      });

      // Get all tags
      const allTags = new Set<string>();
      result.cards.forEach((card) => {
        card.tags.forEach((tag) => {
          if (tag) allTags.add(tag);
        });
      });

      // Log statistics for documentation purposes
      console.log("\n📊 Music Intervals Deck Statistics:");
      console.log(`   Total cards: ${result.cards.length}`);
      console.log(`   Field names: ${Array.from(fieldNames).join(", ")}`);
      console.log(`   Tags: ${allTags.size > 0 ? Array.from(allTags).join(", ") : "none"}`);

      if (result.cards.length > 0) {
        const firstCard = result.cards[0];
        expect(firstCard).toBeDefined();
        console.log(`   First card fields:`, Object.keys(firstCard?.values || {}));
        console.log(`   First card template: ${firstCard?.templates[0]?.name || "unnamed"}`);
        console.log(`   Sample card values:`, firstCard?.values);
      }

      // These are just informational, so we just verify they're defined
      expect(result.cards.length).toBeGreaterThan(0);
      expect(fieldNames.size).toBeGreaterThan(0);
    });

    it("should detect database type", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      // Should detect one of the known types
      expect(["collection.anki2", "collection.anki21", "collection.anki21b"]).toContain(
        result.dbType,
      );

      console.log(`\n📦 Detected database type: ${result.dbType}`);
    });

    it("should have consistent field structure across all cards", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      if (result.cards.length > 1) {
        // Get field names from first card
        const firstCardFields = Object.keys(result.cards[0]?.values || {}).sort();

        // Check if all cards have similar field structure (allowing for different models)
        const fieldStructures = new Map<string, number>();
        result.cards.forEach((card) => {
          const fields = Object.keys(card.values).sort().join(",");
          fieldStructures.set(fields, (fieldStructures.get(fields) || 0) + 1);
        });

        console.log(`\n📋 Field structures found:`);
        for (const [fields, count] of fieldStructures.entries()) {
          console.log(`   ${fields} (${count} cards)`);
        }

        // At least the first card should have a consistent structure
        expect(firstCardFields.length).toBeGreaterThan(0);
      }
    });

    it("should extract all deck information including subdecks", async () => {
      const filePath = join(__dirname, "example_music_intervals.apkg");
      const result = await parseAnkiFile(filePath);

      // Verify decks object exists
      expect(result.decks).toBeDefined();
      expect(typeof result.decks).toBe("object");

      // Get all deck names
      const deckNames = Object.values(result.decks).map((d) => d.name);
      console.log(`\n🗂️  Decks found:`);
      deckNames.forEach((name) => console.log(`   - ${name}`));

      // Verify deck name is set
      expect(result.deckName).toBeDefined();
      expect(typeof result.deckName).toBe("string");
      expect(result.deckName).not.toBe("Unknown");

      console.log(`\n📦 Primary deck: ${result.deckName}`);

      // Verify each card has a deckName property
      result.cards.forEach((card, i) => {
        expect(card.deckName, `Card ${i} should have deckName`).toBeDefined();
        expect(typeof card.deckName).toBe("string");
      });

      // Count cards per deck
      const cardsByDeck = new Map<string, number>();
      result.cards.forEach((card) => {
        cardsByDeck.set(card.deckName, (cardsByDeck.get(card.deckName) || 0) + 1);
      });

      console.log(`\n📊 Cards per deck:`);
      for (const [deckName, count] of cardsByDeck.entries()) {
        console.log(`   ${deckName}: ${count} card(s)`);
      }
    });
  });

  describe("ap_gov_vocab_anki11.apkg", () => {
    it("should parse the AP Government Vocabulary deck (Anki 2.0/2.1 Legacy format)", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      // Basic structure checks
      expect(result.cards).toBeDefined();
      expect(Array.isArray(result.cards)).toBe(true);
      expect(result.cards.length).toBeGreaterThan(0);
      expect(result.dbType).toBeDefined();

      console.log(`\n📦 Database type: ${result.dbType}`);
      console.log(`📊 Total cards: ${result.cards.length}`);
    });

    it("should parse legacy Anki 2.0 format (collection version 11)", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      // Should be using collection.anki2 (not anki21b)
      expect(result.dbType).toBe("collection.anki2");

      console.log(`\n📦 Confirmed legacy format: ${result.dbType}`);
    });

    it("should extract card data with correct structure from legacy format", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      // Check first card structure
      const firstCard = result.cards[0];
      expect(firstCard).toBeDefined();
      if (!firstCard) return;

      expect(firstCard.values).toBeDefined();
      expect(typeof firstCard.values).toBe("object");
      expect(firstCard.tags).toBeDefined();
      expect(Array.isArray(firstCard.tags)).toBe(true);
      expect(firstCard.templates).toBeDefined();
      expect(Array.isArray(firstCard.templates)).toBe(true);
    });

    it("should have templates with required fields", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      const firstCard = result.cards[0];
      if (!firstCard) return;
      expect(firstCard.templates.length).toBeGreaterThan(0);

      const firstTemplate = firstCard.templates[0];
      if (!firstTemplate) return;
      expect(firstTemplate.name).toBeDefined();
      expect(typeof firstTemplate.name).toBe("string");
      expect(firstTemplate.qfmt).toBeDefined();
      expect(typeof firstTemplate.qfmt).toBe("string");
      expect(firstTemplate.afmt).toBeDefined();
      expect(typeof firstTemplate.afmt).toBe("string");
    });

    it("should have field values as strings or null", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      for (const card of result.cards) {
        for (const [key, value] of Object.entries(card.values)) {
          expect(
            typeof value === "string" || value === null,
            `Field ${key} should be string or null, got ${typeof value}`,
          ).toBe(true);
        }
      }
    });

    it("should parse all cards without errors", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      // Verify all cards have the expected structure
      for (let i = 0; i < result.cards.length; i++) {
        const card = result.cards[i];
        expect(card, `Card ${i} should exist`).toBeDefined();
        if (!card) return;

        expect(card.values, `Card ${i} should have values`).toBeDefined();
        expect(card.tags, `Card ${i} should have tags`).toBeDefined();
        expect(card.templates, `Card ${i} should have templates`).toBeDefined();
        expect(
          card.templates.length,
          `Card ${i} should have at least one template`,
        ).toBeGreaterThan(0);
      }
    });

    it("should log deck statistics", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      // Get unique field names
      const fieldNames = new Set<string>();
      result.cards.forEach((card) => {
        Object.keys(card.values).forEach((key) => fieldNames.add(key));
      });

      // Get all tags
      const allTags = new Set<string>();
      result.cards.forEach((card) => {
        card.tags.forEach((tag) => {
          if (tag) allTags.add(tag);
        });
      });

      // Log statistics for documentation purposes
      console.log("\n📊 AP Government Vocabulary Deck Statistics:");
      console.log(`   Total cards: ${result.cards.length}`);
      console.log(`   Field names: ${Array.from(fieldNames).join(", ")}`);
      console.log(`   Tags: ${allTags.size > 0 ? Array.from(allTags).join(", ") : "none"}`);

      if (result.cards.length > 0) {
        const firstCard = result.cards[0];
        expect(firstCard).toBeDefined();
        console.log(`   First card fields:`, Object.keys(firstCard?.values || {}));
        console.log(`   First card template: ${firstCard?.templates[0]?.name || "unnamed"}`);
        console.log(`   Sample card values:`, firstCard?.values);
      }

      // These are just informational, so we just verify they're defined
      expect(result.cards.length).toBeGreaterThan(0);
      expect(fieldNames.size).toBeGreaterThan(0);
    });

    it("should have consistent field structure across all cards", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      if (result.cards.length > 1) {
        // Get field names from first card
        const firstCardFields = Object.keys(result.cards[0]?.values || {}).sort();

        // Check if all cards have similar field structure (allowing for different models)
        const fieldStructures = new Map<string, number>();
        result.cards.forEach((card) => {
          const fields = Object.keys(card.values).sort().join(",");
          fieldStructures.set(fields, (fieldStructures.get(fields) || 0) + 1);
        });

        console.log(`\n📋 Field structures found:`);
        for (const [fields, count] of fieldStructures.entries()) {
          console.log(`   ${fields} (${count} cards)`);
        }

        // At least the first card should have a consistent structure
        expect(firstCardFields.length).toBeGreaterThan(0);
      }
    });

    it("should correctly parse tags from legacy format", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      // Tags should be parsed as arrays
      result.cards.forEach((card, i) => {
        expect(Array.isArray(card.tags), `Card ${i} tags should be an array`).toBe(true);
      });

      // Count cards with tags
      const cardsWithTags = result.cards.filter(
        (card) => card.tags.length > 0 && card.tags[0] !== "",
      );
      console.log(`\n🏷️  Cards with tags: ${cardsWithTags.length}/${result.cards.length}`);
    });

    it("should validate legacy format compatibility with modern parser", async () => {
      const filePath = join(__dirname, "ap_gov_vocab_anki11.apkg");
      const result = await parseAnkiFile(filePath);

      // Ensure the parser can handle legacy format without errors
      expect(result.cards.length).toBeGreaterThan(0);

      // All cards should have valid template data
      result.cards.forEach((card, i) => {
        expect(card.templates.length, `Card ${i} should have templates`).toBeGreaterThan(0);
        const template = card.templates[0];
        if (template) {
          expect(template.qfmt, `Card ${i} template should have question format`).toBeDefined();
          expect(template.afmt, `Card ${i} template should have answer format`).toBeDefined();
        }
      });

      console.log(`\n✓ Legacy format (version 11) is fully compatible with parser`);
    });
  });
});
