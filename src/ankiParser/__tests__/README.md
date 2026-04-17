# Anki Parser Test Suite

This directory contains comprehensive tests for the Anki parser, covering both Anki2 and Anki21b database formats.

## Test Structure

### Files

- **`testUtils.ts`** - Utility functions for creating mock SQLite databases and inserting test data
- **`anki2.test.ts`** - Tests for the Anki2 parser
- **`anki21b.test.ts`** - Tests for the Anki21b parser
- **`integration.test.ts`** - Integration tests covering complete workflows and edge cases
- **`realFile.test.ts`** - Tests parsing of real .apkg files
- **`example_music_intervals.apkg`** - Sample Anki deck file (Anki 2.1+ format, version 18)
- **`ap_gov_vocab_anki11.apkg`** - Sample Anki deck file (Legacy Anki 2.0/2.1 format, version 11)

## Running Tests

```bash
# Run tests in watch mode
pnpm test

# Run tests once
pnpm run test:run

# Run tests with UI
pnpm run test:ui
```

## Test Coverage

### Anki2 Parser Tests (9 tests)

Tests the legacy Anki2 format parser with:

- Example data parsing from pre-built databases
- Card value extraction and field mapping
- Tag parsing and splitting
- Template extraction
- Multiple models and templates
- Empty fields handling
- Special characters and HTML in fields

### Anki21b Parser Tests (10 tests)

Tests the newer Anki21b format parser with:

- Example data parsing with protobuf-encoded configurations
- Card and template parsing
- Note types with CSS and LaTeX configuration
- Multiple note types and templates
- Complex field configurations (RTL, font settings, etc.)
- Special characters and HTML support
- LaTeX configuration in note types

### Integration Tests (7 tests)

End-to-end tests covering:

- Complete language learning deck workflow
- Mixed decks with multiple card types
- Medical terminology deck with complex formatting
- Cloze deletion cards
- Missing field value handling
- RTL text field support
- Large decks with 100+ notes

### Real File Tests (18 tests)

Tests parsing of actual .apkg files with different format versions:

**example_music_intervals.apkg (Anki 2.1+, version 18):**

- Basic deck parsing and structure validation
- Card data extraction with correct field mapping
- Template parsing with required fields
- Field value type validation (string or null)
- Complete card iteration without errors
- Deck statistics logging (cards, fields, tags)
- Database type detection (Anki2/Anki21/Anki21b)
- Field structure consistency across cards

**ap_gov_vocab_anki11.apkg (Legacy Anki 2.0/2.1, version 11):**

- Legacy format parsing and compatibility
- Collection version 11 detection (V1 scheduler)
- Card data extraction from older format
- Template parsing with required fields
- Tag parsing from legacy format
- Deck statistics (242 cards with chapter tags)
- Field structure validation across all cards
- Legacy format compatibility with modern parser

## Parsing Real .apkg Files

The test suite can parse actual Anki deck files:

```typescript
import { parseAnkiFile } from "./realFile.test";

const result = await parseAnkiFile("/path/to/deck.apkg");

console.log(`Cards: ${result.cards.length}`);
console.log(`Database type: ${result.dbType}`);
console.log(`Fields:`, Object.keys(result.cards[0].values));
```

### Test Files

**example_music_intervals.apkg:**

- Anki 2.1+ format (collection version 18)
- 1 card with Front/Back fields
- Modern Anki2 format database
- No tags or media files
- Basic card template

**ap_gov_vocab_anki11.apkg:**

- Legacy Anki 2.0/2.1 format (collection version 11)
- 242 vocabulary cards with Front/Back fields
- Chapter-based tagging system (Ch.1 through Ch.16)
- V1 scheduler (legacy)
- Tests backward compatibility with older Anki exports

## Building Test Databases from Scratch

The test suite includes utilities to programmatically create Anki databases:

### Anki2 Database

```typescript
import { createAnki2Database, insertAnki2Data } from "./testUtils";

const db = await createAnki2Database();

const models = [
  {
    id: "1",
    css: ".card { font-family: arial; }",
    fields: [{ name: "Front" }, { name: "Back" }],
    templates: [
      {
        name: "Card 1",
        qfmt: "{{Front}}",
        afmt: "{{Back}}",
        ord: 0,
      },
    ],
  },
];

const notes = [
  {
    id: 1,
    modelId: "1",
    tags: ["tag1", "tag2"],
    fields: {
      Front: "Question",
      Back: "Answer",
    },
  },
];

insertAnki2Data(db, models, notes);
```

### Anki21b Database

```typescript
import { createAnki21bDatabase, insertAnki21bData } from "./testUtils";

const db = await createAnki21bDatabase();

const notetypes = [
  {
    id: "1",
    name: "Basic",
    config: {
      css: ".card { font-family: arial; }",
      latexPre: "\\documentclass{article}",
      latexPost: "\\end{document}",
      kind: 0,
    },
  },
];

const fields = [
  {
    ntid: "1",
    ord: 0,
    name: "Front",
    config: { fontName: "Arial", fontSize: 20 },
  },
];

const templates = [
  {
    ntid: "1",
    ord: 0,
    name: "Card",
    qFormat: "{{Front}}",
    aFormat: "{{Back}}",
  },
];

const notes = [
  {
    id: 1,
    mid: "1",
    tags: ["tag1"],
    fields: {
      Front: "Question",
      Back: "Answer",
    },
  },
];

insertAnki21bData(db, notetypes, fields, templates, notes);
```

## Key Testing Insights

### Field Separator

Both Anki2 and Anki21b use `\x1F` (ASCII Unit Separator) to separate:

- Field values in notes
- Tags

### Empty Fields

The parser returns `null` for empty field values, not empty strings.

### Template Structure

- Anki2: Templates are stored as JSON in the models table
- Anki21b: Templates are stored as protobuf-encoded data in a separate templates table

### Tags

Tags are stored as a delimited string and split by the parser into an array.
Note: Anki21b parser currently returns empty arrays for tags.

## Test Data Format

### Anki2 Models

Models in Anki2 define the structure of notes, including:

- CSS styling
- LaTeX preamble and postamble
- Field definitions
- Card templates with question/answer formats

### Anki21b Notetypes

Notetypes in Anki21b are more advanced:

- Protobuf-encoded configuration
- Separate field and template tables
- Support for additional metadata (RTL, font configuration, etc.)
- LaTeX SVG rendering support
- Cloze deletion support (kind = 1)
