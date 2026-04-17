# Anki File Identifier CLI

A command-line tool to identify and analyze Anki file formats by inspecting file signatures, SQLite schemas, and compression formats.

## Features

- **Magic Byte Detection**: Identifies file formats by analyzing hex signatures
  - ZIP archives (.apkg, .colpkg)
  - Raw SQLite databases (.anki2, .anki21)
  - Zstandard compressed databases (.anki21b)

- **Schema Analysis**: Determines Anki version by querying SQLite schema
  - Collection version (ver column)
  - Schema modification time (scm column)
  - Table structure analysis (notes, facts, graves, deck_config)
  - Identifies Anki eras (1.x, 2.0, 2.1 Legacy, 2.1 Modern, 2.1+ Current)

- **Archive Inspection**: Lists contents of .apkg/.colpkg files
- **Compression Handling**: Automatically decompresses Zstandard (.anki21b) files

## Usage

```bash
pnpm run identify <file-path>
```

### Examples

Identify a package file:
```bash
pnpm run identify myDeck.apkg
```

Analyze a raw collection database:
```bash
pnpm run identify collection.anki2
```

Check a compressed modern database:
```bash
pnpm run identify collection.anki21b
```

## Output Format

The tool provides a detailed report including:

- **File Information**: Name, size, container format, magic bytes
- **ZIP Contents**: List of files in .apkg/.colpkg archives (if applicable)
- **Anki Format Details**:
  - Era (Anki 1.x, 2.0/2.1 Legacy, 2.1 Modern, 2.1+ Current)
  - Collection version number
  - Detailed description of version features
- **Database Structure**:
  - Table presence indicators (notes, facts, graves, deck_config)
  - Column structure information (models column in col table)

### Sample Output

```
═══════════════════════════════════════════════════════
           ANKI FILE IDENTIFICATION REPORT
═══════════════════════════════════════════════════════

📁 File Name: myDeck.apkg
📊 File Size: 2456.32 KB
🔍 Container Format: ZIP archive (.apkg/.colpkg)
🔢 Magic Bytes: 50 4B 03 04 14 00 00 00 08 00 00 00

📦 ZIP Archive Contents:
   - collection.anki21 (524288 bytes)
   - media (245 bytes)
   - 0 (125836 bytes)
   - 1 (89234 bytes)

📚 Anki Format Details:
   Era: Anki 2.1 (Modern)
   Collection Version: 14
   Details: Collection version 14. Introduced V2/V3 schedulers. Still uses JSON blobs in col table.

🗂️  Database Structure:
   - notes table: ✓
   - facts table: ✗
   - graves table: ✓
   - deck_config table: ✗
   - models column in col: ✓

═══════════════════════════════════════════════════════
```

## Anki Version Reference

### Version Eras

| Era | File Extension | Collection Version | Key Features |
|-----|----------------|-------------------|--------------|
| Anki 1.x | .anki | N/A | facts-based structure, pre-2012, incompatible with modern clients |
| Anki 2.0 | .anki2 | 11 | notes/cards structure, V1 scheduler, JSON in col table |
| Anki 2.1 (Early) | .anki2 | 11 | V1 scheduler with improvements |
| Anki 2.1 (Late) | .anki21 | 14-16 | V2/V3 schedulers, zstd compression in packages |
| Anki 2.1+ (Current) | .anki21 | 18+ | Rust backend, FSRS scheduling, optimized schema |

### Magic Bytes Reference

| Format | Hex Signature | Description |
|--------|--------------|-------------|
| ZIP | `50 4B 03 04` | Standard PKZip header (.apkg, .colpkg) |
| SQLite 3 | `53 51 4C 69 74 65 20 66 6F 72 6D 61 74 20 33 00` | Raw database (.anki2, .anki21) |
| Zstandard | `28 B5 2F FD` | Compressed database (.anki21b) |

## Architecture

The CLI tool consists of three main modules:

### 1. Magic Byte Detection (`cli/utils/magicBytes.ts`)
- Identifies container formats by file signatures
- Provides hex dump functionality for debugging

### 2. SQLite Schema Analysis (`cli/utils/sqliteAnalysis.ts`)
- Queries SQLite schema to determine Anki version
- Analyzes table structure and column presence
- Maps version numbers to era descriptions

### 3. Main Identifier (`cli/identify.ts`)
- Orchestrates file reading and analysis
- Handles decompression (ZIP, Zstandard)
- Generates formatted reports

## Technical Details

### Dependencies

- **sql.js**: SQLite compiled to WebAssembly for database querying
- **@zip-js/zip-js**: ZIP archive extraction
- **@dweb-browser/zstd-wasm**: Zstandard decompression
- **tsx**: TypeScript execution in Node.js

### Node.js Compatibility

The CLI includes Node.js-specific adaptations:

- Custom WASM loader for sql.js (bypasses Vite bundler)
- File system-based WASM loading for zstd decompression
- Buffer handling for binary file formats

## Troubleshooting

### Common Issues

**Error: File not found**
- Verify the file path is correct
- Use absolute paths or paths relative to project root

**Error: Failed to extract collection database**
- File may be corrupted
- Verify it's a valid Anki package file

**Error: Unknown file format**
- File may not be an Anki format
- Check magic bytes in output for diagnosis

### Debug Mode

To see raw magic bytes and detailed error messages, check the console output. The tool displays the first 16 bytes of every file in hex format for debugging.

## Development

### Adding New Format Support

To support additional Anki formats:

1. Add magic byte signature to `cli/utils/magicBytes.ts`
2. Implement format-specific analysis in `cli/identify.ts`
3. Update schema detection in `cli/utils/sqliteAnalysis.ts` if needed

### Testing

Create test files in various formats and run:

```bash
pnpm run identify path/to/test/file.apkg
```

Compare output against known file specifications.
