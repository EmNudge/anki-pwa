import type { AnkiData } from "../ankiParser";

export type ExportFormat = "csv" | "json";
export type ExportScope = "deck" | "all";

interface ExportOptions {
  format: ExportFormat;
  scope: ExportScope;
  deckName?: string;
  includeScheduling: boolean;
  /** Which field keys to include in CSV. If empty, include all. */
  csvColumns?: string[];
  includeHtml: boolean;
}

type CardData = AnkiData["cards"][number];

function stripHtml(html: string | null | undefined): string {
  if (!html) return "";
  return html
    .replace(/\[sound:[^\]]+\]/g, "")
    .replace(/<[^>]*>/g, "")
    .trim();
}

function getCardsForExport(ankiData: AnkiData, options: ExportOptions): CardData[] {
  if (options.scope === "all" || !options.deckName) {
    return ankiData.cards;
  }
  const prefix = options.deckName + "::";
  return ankiData.cards.filter(
    (card) => card.deckName === options.deckName || card.deckName.startsWith(prefix),
  );
}

/** Collect all unique field names across a set of cards. */
function collectFieldNames(cards: CardData[]): string[] {
  const keys = new Set<string>();
  for (const card of cards) {
    for (const key of Object.keys(card.values)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
}

function buildCardRecord(card: CardData, options: ExportOptions): Record<string, unknown> {
  const fieldKeys = options.csvColumns?.length ? options.csvColumns : Object.keys(card.values);

  const record: Record<string, unknown> = {};

  record["deck"] = card.deckName;
  record["tags"] = card.tags.join(" ");
  record["guid"] = card.guid;

  for (const key of fieldKeys) {
    const raw = card.values[key] ?? "";
    record[key] = options.includeHtml ? raw : stripHtml(raw);
  }

  if (options.includeScheduling && card.scheduling) {
    const s = card.scheduling;
    record["scheduling_type"] = s.typeName;
    record["scheduling_queue"] = s.queueName;
    record["scheduling_due"] = s.due;
    record["scheduling_interval"] = s.ivl;
    record["scheduling_ease_factor"] = s.easeFactor;
    record["scheduling_reps"] = s.reps;
    record["scheduling_lapses"] = s.lapses;
  }

  return record;
}

function escapeCsvField(value: string): string {
  if (value.includes('"') || value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

function exportToCsv(ankiData: AnkiData, options: ExportOptions): string {
  const cards = getCardsForExport(ankiData, options);
  if (cards.length === 0) return "";

  const fieldNames = options.csvColumns?.length ? options.csvColumns : collectFieldNames(cards);

  const headers = ["deck", "tags", "guid", ...fieldNames];
  if (options.includeScheduling) {
    headers.push(
      "scheduling_type",
      "scheduling_queue",
      "scheduling_due",
      "scheduling_interval",
      "scheduling_ease_factor",
      "scheduling_reps",
      "scheduling_lapses",
    );
  }

  const rows: string[] = [headers.map(escapeCsvField).join(",")];

  for (const card of cards) {
    const record = buildCardRecord(card, { ...options, csvColumns: fieldNames });
    const row = headers.map((h) => {
      const val = record[h];
      return escapeCsvField(val == null ? "" : String(val));
    });
    rows.push(row.join(","));
  }

  return rows.join("\n");
}

function exportToJson(ankiData: AnkiData, options: ExportOptions): string {
  const cards = getCardsForExport(ankiData, options);
  const records = cards.map((card) => buildCardRecord(card, options));
  return JSON.stringify(records, null, 2);
}

export function exportCards(
  ankiData: AnkiData,
  options: ExportOptions,
): { content: string; mimeType: string; extension: string } {
  if (options.format === "csv") {
    return {
      content: exportToCsv(ankiData, options),
      mimeType: "text/csv;charset=utf-8",
      extension: "csv",
    };
  }
  return {
    content: exportToJson(ankiData, options),
    mimeType: "application/json;charset=utf-8",
    extension: "json",
  };
}
