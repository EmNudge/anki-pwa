#!/usr/bin/env node

/**
 * Anki Media Inspector CLI Tool
 *
 * Inspects media files in .apkg archives to debug media detection issues
 */

import * as fs from 'fs';
import * as path from 'path';
import { BlobReader, ZipReader, BlobWriter } from '@zip-js/zip-js';
import { decompressZstd } from './utils/zstdNode.js';
import { parseMediaProto } from '../src/ankiParser/parseMediaProto.js';
import { mediaMappingSchema } from '../src/ankiParser/anki2/jsonParsers.js';

async function inspectAnkiMedia(filePath: string) {
  const fileName = path.basename(filePath);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('           ANKI MEDIA INSPECTOR');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log(`📁 File: ${fileName}\n`);

  // Read and extract file
  const buffer = fs.readFileSync(filePath);
  const uint8Array = new Uint8Array(buffer);
  const blob = new Blob([uint8Array]);
  const zipReader = new ZipReader(new BlobReader(blob));
  const entries = await zipReader.getEntries();

  console.log(`📦 Total entries in archive: ${entries.length}\n`);

  // Look for media file
  const mediaEntry = entries.find(e => e.filename === 'media');

  if (!mediaEntry) {
    console.log('⚠️  No "media" file found in archive');
    console.log('\n📋 Files in archive:');
    entries.forEach(e => {
      console.log(`   - ${e.filename} ${e.directory ? '(directory)' : `(${e.uncompressedSize} bytes)`}`);
    });
    console.log('\n');
    await zipReader.close();
    return;
  }

  // Extract and decompress media mapping
  const mediaBlob = await mediaEntry.getData?.(new BlobWriter());
  if (!mediaBlob) {
    console.error('❌ Failed to extract media file');
    process.exit(1);
  }

  const mediaBuffer = new Uint8Array(await mediaBlob.arrayBuffer());

  // Try to decompress if it's zstd compressed (newer Anki formats)
  let mediaContent: string;
  let mediaBytes: Uint8Array;
  try {
    const decompressed = await decompressZstd(mediaBuffer);
    mediaBytes = decompressed;
    mediaContent = new TextDecoder().decode(decompressed);
  } catch {
    // Not compressed, try as plain text
    mediaBytes = mediaBuffer;
    mediaContent = new TextDecoder().decode(mediaBuffer);
  }

  // Parse media mapping
  let mediaMapping: Record<string, string>;
  try {
    // Try parsing as JSON first (older format)
    mediaMapping = mediaMappingSchema.parse(JSON.parse(mediaContent));
  } catch {
    // If JSON parsing fails, try parsing as Protocol Buffer (newer .anki21b format)
    try {
      mediaMapping = parseMediaProto(mediaBytes);
    } catch {
      console.error('❌ Failed to parse media mapping as JSON or Protocol Buffer');
      console.log('First 100 bytes (hex):');
      console.log(Array.from(mediaBuffer.slice(0, 100))
        .map(b => b.toString(16).padStart(2, '0'))
        .join(' '));
      process.exit(1);
    }
  }

  const mediaCount = Object.keys(mediaMapping).length;
  console.log(`✅ Found media mapping with ${mediaCount} entries\n`);

  if (mediaCount === 0) {
    console.log('⚠️  Media mapping is empty - no media files referenced\n');
    await zipReader.close();
    return;
  }

  // Count numbered files in archive (actual media files)
  const numberedFiles = entries.filter(e => /^\d+$/.test(e.filename));
  console.log(`📊 Numbered media files in archive: ${numberedFiles.length}\n`);

  // Analyze media types
  const mediaTypes = new Map<string, number>();
  const mediaFiles: { index: string; filename: string }[] = [];

  for (const [index, filename] of Object.entries(mediaMapping)) {
    const ext = path.extname(filename).toLowerCase();
    mediaTypes.set(ext, (mediaTypes.get(ext) || 0) + 1);
    mediaFiles.push({ index, filename });
  }

  console.log('📸 Media types breakdown:');
  const sortedTypes = Array.from(mediaTypes.entries()).sort((a, b) => b[1] - a[1]);
  for (const [ext, count] of sortedTypes) {
    const percentage = ((count / mediaCount) * 100).toFixed(1);
    console.log(`   ${ext || '(no extension)'}: ${count} files (${percentage}%)`);
  }

  console.log('\n🔍 Sample media files (first 10):');
  mediaFiles.slice(0, 10).forEach(({ index, filename }) => {
    const hasFile = numberedFiles.some(e => e.filename === index);
    const status = hasFile ? '✓' : '✗';
    console.log(`   ${status} [${index}] ${filename}`);
  });

  // Check for missing files
  const missingFiles = mediaFiles.filter(({ index }) =>
    !numberedFiles.some(e => e.filename === index)
  );

  if (missingFiles.length > 0) {
    console.log(`\n⚠️  Warning: ${missingFiles.length} media files referenced but not found in archive`);
    console.log('   First 5 missing:');
    missingFiles.slice(0, 5).forEach(({ index, filename }) => {
      console.log(`   - [${index}] ${filename}`);
    });
  }

  // Check for unreferenced files
  const unreferencedFiles = numberedFiles.filter(e =>
    !mediaFiles.some(({ index }) => index === e.filename)
  );

  if (unreferencedFiles.length > 0) {
    console.log(`\n⚠️  Warning: ${unreferencedFiles.length} numbered files in archive not referenced in media mapping`);
    console.log('   First 5 unreferenced:');
    unreferencedFiles.slice(0, 5).forEach(e => {
      console.log(`   - ${e.filename} (${e.uncompressedSize} bytes)`);
    });
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 SUMMARY:');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Total media references: ${mediaCount}`);
  console.log(`   Actual media files: ${numberedFiles.length}`);
  console.log(`   Missing files: ${missingFiles.length}`);
  console.log(`   Unreferenced files: ${unreferencedFiles.length}`);
  console.log(`   Media types: ${mediaTypes.size}`);
  console.log('═══════════════════════════════════════════════════════\n');

  await zipReader.close();
}

// Main CLI execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run inspect:media <file-path>');
    console.error('');
    console.error('Example:');
    console.error('  npm run inspect:media myDeck.apkg');
    process.exit(1);
  }

  const filePath = args[0];

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    await inspectAnkiMedia(filePath);
  } catch (error) {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
