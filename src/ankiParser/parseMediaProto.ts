/**
 * Parse media mapping from Protocol Buffer format (used in .anki21b files)
 *
 * Format structure (observed from hex dumps):
 * - Repeated messages with tag 0x0a (field 1, length-delimited)
 * - Each message contains:
 *   - filename (tag 0x0a, field 1, string)
 *   - index (tag 0x10, field 2, varint)
 *   - sha1_hash (tag 0x1a, field 3, bytes, 20 bytes)
 */

function readVarint(buffer: Uint8Array, offset: number): { value: number; newOffset: number } {
  let value = 0;
  let shift = 0;
  let newOffset = offset;

  while (newOffset < buffer.length) {
    const byte = buffer[newOffset++];
    if (byte === undefined) break;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      break;
    }
    shift += 7;
  }

  return { value, newOffset };
}

function readLengthDelimited(
  buffer: Uint8Array,
  offset: number,
): { data: Uint8Array; newOffset: number } {
  const { value: length, newOffset: afterLength } = readVarint(buffer, offset);
  const data = buffer.slice(afterLength, afterLength + length);
  return { data, newOffset: afterLength + length };
}

function skipUnknownField(buffer: Uint8Array, offset: number, wireType: number): number | null {
  if (wireType === 0) return readVarint(buffer, offset).newOffset;
  if (wireType === 2) return readLengthDelimited(buffer, offset).newOffset;
  return null;
}

export function parseMediaProto(buffer: Uint8Array): Record<string, string> {
  const result: Record<string, string> = {};
  let offset = 0;
  let entryIndex = 0;

  while (offset < buffer.length) {
    // Read the wire type and field number
    const tag = buffer[offset++];

    if (tag === undefined) break;

    const wireType = tag & 0x07;
    const fieldNumber = tag >> 3;

    // We expect repeated messages with field number 1 (media entries)
    if (fieldNumber === 1 && wireType === 2) {
      // Length-delimited (message)
      const { data: entryData, newOffset } = readLengthDelimited(buffer, offset);
      offset = newOffset;

      // Parse the entry message
      let entryOffset = 0;
      let filename = "";
      let mediaIndex = -1;

      while (entryOffset < entryData.length) {
        const entryTag = entryData[entryOffset++];

        if (entryTag === undefined) break;

        const entryWireType = entryTag & 0x07;
        const entryFieldNumber = entryTag >> 3;

        if (entryFieldNumber === 1 && entryWireType === 2) {
          // Filename (string, length-delimited)
          const { data: filenameData, newOffset: afterFilename } = readLengthDelimited(
            entryData,
            entryOffset,
          );
          filename = new TextDecoder().decode(filenameData);
          entryOffset = afterFilename;
        } else if (entryFieldNumber === 2 && entryWireType === 0) {
          // Index field — maps to the ZIP entry number
          const { value, newOffset: afterIndex } = readVarint(entryData, entryOffset);
          mediaIndex = value;
          entryOffset = afterIndex;
        } else if (entryFieldNumber === 3 && entryWireType === 2) {
          // SHA1 hash (bytes, length-delimited) - we can skip this
          const { newOffset: afterHash } = readLengthDelimited(entryData, entryOffset);
          entryOffset = afterHash;
        } else {
          const skipped = skipUnknownField(entryData, entryOffset, entryWireType);
          if (skipped === null) break;
          entryOffset = skipped;
        }
      }

      if (filename) {
        // Use the proto index field if present, otherwise fall back to sequential
        const key = mediaIndex >= 0 ? mediaIndex : entryIndex;
        result[key.toString()] = filename;
        entryIndex++;
      }
    } else {
      const skipped = skipUnknownField(buffer, offset, wireType);
      if (skipped === null) break;
      offset = skipped;
    }
  }

  return result;
}
