#!/usr/bin/env node

/**
 * Anki Media Extractor CLI Tool
 *
 * Extracts all media files from .apkg archives to a specified output directory
 */

import * as fs from 'fs';
import * as path from 'path';
import { BlobReader, ZipReader, BlobWriter } from '@zip-js/zip-js';
import { decompressZstd } from './utils/zstdNode.js';
import { parseMediaProto } from '../src/ankiParser/parseMediaProto.js';
import { mediaMappingSchema } from '../src/ankiParser/anki2/jsonParsers.js';

async function extractAnkiMedia(filePath: string, outputDir: string) {
  const fileName = path.basename(filePath);
  console.log('\n═══════════════════════════════════════════════════════');
  console.log('           ANKI MEDIA EXTRACTOR');
  console.log('═══════════════════════════════════════════════════════\n');
  console.log(`📁 Source: ${fileName}`);
  console.log(`📂 Output: ${outputDir}\n`);

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log(`✅ Created output directory: ${outputDir}\n`);
  }

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
  } catch (_e) {
    // Not compressed, try as plain text
    mediaBytes = mediaBuffer;
    mediaContent = new TextDecoder().decode(mediaBuffer);
  }

  // Parse media mapping
  let mediaMapping: Record<string, string>;
  try {
    // Try parsing as JSON first (older format)
    mediaMapping = mediaMappingSchema.parse(JSON.parse(mediaContent));
  } catch (_jsonError) {
    // If JSON parsing fails, try parsing as Protocol Buffer (newer .anki21b format)
    try {
      mediaMapping = parseMediaProto(mediaBytes);
    } catch (_protoError) {
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

  // Extract all media files
  let extracted = 0;
  let skipped = 0;
  const errors: string[] = [];

  console.log('📥 Extracting media files...\n');

  for (const [index, filename] of Object.entries(mediaMapping)) {
    // Find the corresponding numbered file in the archive
    const fileEntry = entries.find(e => e.filename === index);

    if (!fileEntry) {
      skipped++;
      errors.push(`   ✗ [${index}] ${filename} - not found in archive`);
      continue;
    }

    try {
      // Extract the file data
      const fileBlob = await fileEntry.getData?.(new BlobWriter());
      if (!fileBlob) {
        skipped++;
        errors.push(`   ✗ [${index}] ${filename} - failed to extract data`);
        continue;
      }

      let fileBuffer = Buffer.from(await fileBlob.arrayBuffer());

      // Check if file is Zstandard compressed and decompress if needed
      // Zstandard magic number is 0x28 0xB5 0x2F 0xFD
      const isZstdCompressed = fileBuffer.length >= 4 &&
        fileBuffer[0] === 0x28 &&
        fileBuffer[1] === 0xB5 &&
        fileBuffer[2] === 0x2F &&
        fileBuffer[3] === 0xFD;

      if (isZstdCompressed) {
        try {
          const decompressed = await decompressZstd(new Uint8Array(fileBuffer));
          fileBuffer = Buffer.from(decompressed);
        } catch (decompError) {
          skipped++;
          errors.push(`   ✗ [${index}] ${filename} - failed to decompress Zstandard: ${decompError instanceof Error ? decompError.message : String(decompError)}`);
          continue;
        }
      }

      // Sanitize filename to prevent directory traversal
      const sanitizedFilename = path.basename(filename);
      const outputPath = path.join(outputDir, sanitizedFilename);

      // Write the file
      fs.writeFileSync(outputPath, fileBuffer);
      extracted++;

      // Log progress for every 10 files or if less than 20 total
      if (extracted % 10 === 0 || mediaCount < 20) {
        console.log(`   ✓ [${index}] ${sanitizedFilename} (${fileBuffer.length} bytes)`);
      }
    } catch (error) {
      skipped++;
      errors.push(`   ✗ [${index}] ${filename} - ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════════');
  console.log('📊 EXTRACTION SUMMARY:');
  console.log('═══════════════════════════════════════════════════════');
  console.log(`   Total media files in mapping: ${mediaCount}`);
  console.log(`   Successfully extracted: ${extracted}`);
  console.log(`   Skipped/Failed: ${skipped}`);
  console.log(`   Output directory: ${path.resolve(outputDir)}`);

  if (errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    errors.slice(0, 10).forEach(err => console.log(err));
    if (errors.length > 10) {
      console.log(`   ... and ${errors.length - 10} more errors`);
    }
  }

  console.log('═══════════════════════════════════════════════════════\n');

  await zipReader.close();
}

// Main CLI execution
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npm run extract:media <file-path> [output-directory]');
    console.error('');
    console.error('Arguments:');
    console.error('  file-path          Path to the .apkg file');
    console.error('  output-directory   Directory to extract media to (default: ./media)');
    console.error('');
    console.error('Examples:');
    console.error('  npm run extract:media myDeck.apkg');
    console.error('  npm run extract:media myDeck.apkg ./extracted-media');
    process.exit(1);
  }

  const filePath = args[0];
  const outputDir = args[1] || './media';

  if (!fs.existsSync(filePath)) {
    console.error(`Error: File not found: ${filePath}`);
    process.exit(1);
  }

  try {
    await extractAnkiMedia(filePath, outputDir);
  } catch (error) {
    console.error('Fatal error:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

main();
