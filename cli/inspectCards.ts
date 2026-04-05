#!/usr/bin/env node

/**
 * Anki Card Inspector CLI Tool
 *
 * Inspects the actual card templates and field values to debug rendering issues
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import initSqlJs from 'sql.js';
import { BlobReader, ZipReader, BlobWriter } from '@zip-js/zip-js';
import { modelSchema } from '../src/ankiParser/anki2/jsonParsers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Simple SQL query helpers (inlined to avoid import issues)
function executeQuery<T>(db: any, query: string): T {
  const result = db.exec(query);
  if (result.length === 0 || result[0].values.length === 0) {
    throw new Error(`Query returned no results: ${query}`);
  }
  const columns = result[0].columns;
  const values = result[0].values[0];
  const row: any = {};
  columns.forEach((col: string, i: number) => {
    row[col] = values[i];
  });
  return row;
}

function executeQueryAll<T>(db: any, query: string): T[] {
  const result = db.exec(query);
  if (result.length === 0) {
    return [];
  }
  const columns = result[0].columns;
  const values = result[0].values;
  return values.map((row: any[]) => {
    const obj: any = {};
    columns.forEach((col: string, i: number) => {
      obj[col] = row[i];
    });
    return obj;
  });
}

async function inspectAnkiFile(filePath: string) {
  const fileName = path.basename(filePath);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('           ANKI CARD INSPECTOR');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log(`📁 File: ${fileName}\n`);

  // Read and extract file
  const buffer = fs.readFileSync(filePath);
  const uint8Array = new Uint8Array(buffer);
  const blob = new Blob([uint8Array]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();

  // Look for collection files
  const collectionEntry = entries.find(e =>
    e.filename === 'collection.anki21' ||
    e.filename === 'collection.anki2'
  );

  if (!collectionEntry || collectionEntry.directory) {
    console.error('No collection database found in ZIP archive');
    process.exit(1);
  }

  // Extract collection file
  const collectionBlob = await collectionEntry.getData?.(new BlobWriter());
  if (!collectionBlob) {
    console.error('Failed to extract collection database');
    process.exit(1);
  }

  const collectionBuffer = new Uint8Array(await collectionBlob.arrayBuffer());

  // Initialize SQL.js
  const SQL = await initSqlJs({
    locateFile: () => {
      return path.join(__dirname, '../node_modules/sql.js/dist/sql-wasm.wasm');
    }
  });

  const db = new SQL.Database(collectionBuffer);

  // Get models and decks from col table
  const colData = executeQuery<{
    conf: string;
    models: string;
    decks: string;
    dconf: string;
    tags: string;
  }>(db, "SELECT * from col");

  const models = modelSchema.parse(JSON.parse(colData.models));
  // Get notes
  const notes = executeQueryAll<{ id: number; modelId: string; tags: string; fields: string }>(
    db,
    "SELECT id, cast(mid as text) as modelId, tags, flds as fields FROM notes"
  );

  console.log(`📊 Total notes: ${notes.length}\n`);

  // Inspect first 5 notes
  const notesToInspect = Math.min(5, notes.length);
  console.log(`🔍 Inspecting first ${notesToInspect} notes:\n`);

  for (let i = 0; i < notesToInspect; i++) {
    const note = notes[i];
    const model = models[note.modelId];

    if (!model) {
      console.log(`\n─────── Note ${i + 1} ─────── (Model not found)`);
      continue;
    }

    const fieldNames = model.flds.map((fld: any) => fld.name);
    const fieldValues = note.fields.split('\x1F');

    console.log(`\n─────── Note ${i + 1} ───────`);
    console.log(`Model: ${model.name || 'Unknown'}`);

    console.log(`\n📝 Field Values:`);
    fieldNames.forEach((name: string, idx: number) => {
      const value = fieldValues[idx] || '(empty)';
      const displayValue = value.length > 100 ? value.substring(0, 100) + '...' : value;
      console.log(`  ${name}: ${displayValue}`);
    });

    console.log(`\n📋 Templates (${model.tmpls.length}):`);
    model.tmpls.forEach((template: any, idx: number) => {
      console.log(`\n  Template ${idx + 1}: "${template.name}"`);
      console.log(`  Front (qfmt):`);
      console.log(`    ${template.qfmt.replace(/\n/g, '\n    ')}`);
      console.log(`  Back (afmt):`);
      console.log(`    ${template.afmt.replace(/\n/g, '\n    ')}`);

      // Check if front and back are identical
      if (template.qfmt === template.afmt) {
        console.log(`  ⚠️  WARNING: qfmt and afmt are identical!`);
      }
    });
  }

  // Check all templates for issues
  console.log('\n\n📋 Template Analysis:');
  console.log('═══════════════════════════════════════════════════════\n');

  const allModels = Object.values(models);
  let identicalCount = 0;
  let missingFrontSideCount = 0;

  allModels.forEach((model: any) => {
    model.tmpls.forEach((template: any) => {
      if (template.qfmt === template.afmt) {
        identicalCount++;
        console.log(`⚠️  Model "${model.name || 'Unknown'}", Template "${template.name}": qfmt === afmt`);
      }

      // Check if back template uses FrontSide
      if (template.afmt && !template.afmt.includes('{{FrontSide}}') && !template.afmt.includes('{{frontside}}')) {
        missingFrontSideCount++;
        console.log(`ℹ️  Model "${model.name || 'Unknown'}", Template "${template.name}": Back does not use {{FrontSide}}`);
        console.log(`   Front: ${template.qfmt.substring(0, 60)}${template.qfmt.length > 60 ? '...' : ''}`);
        console.log(`   Back:  ${template.afmt.substring(0, 60)}${template.afmt.length > 60 ? '...' : ''}`);
      }
    });
  });

  console.log(`\n📊 Summary:`);
  console.log(`   Total models: ${allModels.length}`);
  console.log(`   Templates with identical qfmt/afmt: ${identicalCount}`);
  console.log(`   Templates without {{FrontSide}} in back: ${missingFrontSideCount}`);

  console.log('\n\n═══════════════════════════════════════════════════════\n');

  await zipReader.close();
  db.close();
}

// Main CLI execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run inspect <file-path>');
    console.error('');
    console.error('Example:');
    console.error('  npm run inspect myDeck.apkg');
    process.exit(1);
  }

  const filePath = args[0];

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    await inspectAnkiFile(filePath);
  } catch (error) {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
