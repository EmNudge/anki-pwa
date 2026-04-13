type Delimiter = "," | "\t" | ";" | "|";

const DELIMITER_MAP: Record<string, Delimiter> = {
  comma: ",",
  tab: "\t",
  semicolon: ";",
  pipe: "|",
};

export type DelimiterName = "comma" | "tab" | "semicolon" | "pipe" | "custom";

export function resolveDelimiter(name: DelimiterName, custom: string): string {
  if (name === "custom") return custom || ",";
  return DELIMITER_MAP[name] ?? ",";
}

/**
 * Parse a single CSV line respecting quoted fields.
 * Handles double-quote escaping per RFC 4180.
 */
function parseCsvLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  const len = line.length;
  let i = 0;

  while (i <= len) {
    if (i === len) {
      fields.push("");
      break;
    }

    if (line[i] === '"') {
      // Quoted field
      let value = "";
      i++; // skip opening quote
      while (i < len) {
        if (line[i] === '"') {
          if (i + 1 < len && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else {
            i++; // skip closing quote
            break;
          }
        } else {
          value += line[i];
          i++;
        }
      }
      fields.push(value);
      // skip delimiter after quoted field
      if (i < len && line[i] === delimiter) {
        i++;
      } else {
        break;
      }
    } else {
      // Unquoted field
      const nextDelim = line.indexOf(delimiter, i);
      if (nextDelim === -1) {
        fields.push(line.slice(i));
        break;
      }
      fields.push(line.slice(i, nextDelim));
      i = nextDelim + delimiter.length;
    }
  }

  return fields;
}

/**
 * Parse CSV text into a 2D array of strings.
 * Handles quoted fields with embedded newlines.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  // Normalize line endings
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Split respecting quoted fields that may contain newlines
  const rows: string[][] = [];
  const lines = normalized.split("\n");
  let currentLine = "";
  let inQuotes = false;

  for (const line of lines) {
    if (inQuotes) {
      currentLine += "\n" + line;
    } else {
      currentLine = line;
    }

    // Count unescaped quotes to determine if we're inside a quoted field
    let quoteCount = 0;
    for (const char of currentLine) {
      if (char === '"') quoteCount++;
    }
    inQuotes = quoteCount % 2 !== 0;

    if (!inQuotes) {
      const trimmed = currentLine.trim();
      if (trimmed.length > 0) {
        rows.push(parseCsvLine(currentLine, delimiter));
      }
      currentLine = "";
    }
  }

  // Handle trailing content
  if (currentLine.trim().length > 0) {
    rows.push(parseCsvLine(currentLine, delimiter));
  }

  return rows;
}

/**
 * Auto-detect the most likely delimiter by counting occurrences
 * in the first few lines and checking consistency.
 */
export function detectDelimiter(text: string): DelimiterName {
  const sampleLines = text
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 5);
  if (sampleLines.length === 0) return "comma";

  const candidates: Delimiter[] = ["\t", ",", ";", "|"];
  const reverseMap: Record<string, DelimiterName> = {
    "\t": "tab",
    ",": "comma",
    ";": "semicolon",
    "|": "pipe",
  };

  let bestDelimiter: Delimiter = ",";
  let bestScore = -1;

  for (const delim of candidates) {
    const counts = sampleLines.map((line) => parseCsvLine(line, delim).length);
    const consistent = counts.every((c) => c === counts[0]);
    const fieldCount = counts[0] ?? 1;

    // Score: consistency matters most, then field count
    const score = (consistent ? 1000 : 0) + fieldCount;
    if (score > bestScore && fieldCount > 1) {
      bestScore = score;
      bestDelimiter = delim;
    }
  }

  return reverseMap[bestDelimiter] ?? "comma";
}
