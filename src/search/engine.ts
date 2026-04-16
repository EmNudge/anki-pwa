import { getFlags } from "../lib/flags";

// ── Search AST types ──

export type SearchLeaf =
  | { type: "text"; value: string }
  | { type: "deck"; value: string }
  | { type: "tag"; value: string }
  | { type: "is"; value: string }
  | { type: "flag"; value: number }
  | { type: "card"; value: string }
  | { type: "note"; value: string }
  | { type: "prop"; prop: string; op: ">" | "<" | ">=" | "<=" | "=" | "!="; value: number }
  | { type: "added"; days: number }
  | { type: "edited"; days: number }
  | { type: "rated"; days: number };

export type SearchExpr =
  | SearchLeaf
  | { type: "negate"; inner: SearchExpr }
  | { type: "and"; left: SearchExpr; right: SearchExpr }
  | { type: "or"; left: SearchExpr; right: SearchExpr };

export const IS_VALUES = ["new", "learn", "review", "due", "suspended", "buried"] as const;

export const QUALIFIERS = [
  "deck:", "tag:", "is:", "flag:", "card:", "note:",
  "prop:", "added:", "edited:", "rated:",
] as const;

// ── Searchable card interface ──

export interface SearchableCard {
  fields: Record<string, string>;
  deck: string;
  tags: string[];
  templateName: string;
  templateNames?: string;
  queueName: string;
  flags: number;
  rawEase: number | null;
  rawIvl: number;
  rawDue: number;
  rawDueType: string;
  cardCreatedMs: number;
  noteModSec: number;
  cardModSec: number;
  reps: number;
  lapses: number;
}

// ── Lexer ──

type LexToken =
  | { kind: "term"; value: SearchExpr }
  | { kind: "or" }
  | { kind: "lparen" }
  | { kind: "rparen" };

function getFlagValues() {
  return [
    { value: 0, label: "none" },
    ...getFlags().map((f) => ({ value: f.flag, label: f.label.toLowerCase() })),
  ];
}

function parseQualifiedTerm(word: string): SearchLeaf {
  const colonIdx = word.indexOf(":");
  if (colonIdx === -1) return { type: "text", value: word };

  const qualifier = word.slice(0, colonIdx).toLowerCase();
  const val = word.slice(colonIdx + 1);

  switch (qualifier) {
    case "deck":
      return { type: "deck", value: val };
    case "tag":
      return { type: "tag", value: val };
    case "is":
      return { type: "is", value: val.toLowerCase() };
    case "flag": {
      const parsed = parseInt(val, 10);
      if (!isNaN(parsed)) return { type: "flag", value: parsed };
      const m = getFlagValues().find((f) => f.label.toLowerCase() === val.toLowerCase());
      return { type: "flag", value: m?.value ?? 0 };
    }
    case "card":
      return { type: "card", value: val };
    case "note":
      return { type: "note", value: val };
    case "prop": {
      const opMatch = val.match(/^(ease|ivl|due|reps|lapses)(>=|<=|!=|>|<|=)(.+)$/);
      if (!opMatch) return { type: "text", value: word };
      const num = parseFloat(opMatch[3]!);
      if (isNaN(num)) return { type: "text", value: word };
      return {
        type: "prop",
        prop: opMatch[1]!,
        op: opMatch[2]! as SearchLeaf & { type: "prop" } extends { op: infer O } ? O : never,
        value: num,
      };
    }
    case "added":
      return { type: "added", days: parseInt(val, 10) || 1 };
    case "edited":
      return { type: "edited", days: parseInt(val, 10) || 1 };
    case "rated":
      return { type: "rated", days: parseInt(val, 10) || 1 };
    default:
      return { type: "text", value: word };
  }
}

function lex(query: string): LexToken[] {
  const tokens: LexToken[] = [];
  let i = 0;
  const len = query.length;

  while (i < len) {
    const ch = query[i]!;
    if (ch === " " || ch === "\t") {
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen" });
      i++;
      continue;
    }

    // Check for OR keyword
    if (
      (ch === "O" || ch === "o") &&
      i + 1 < len &&
      (query[i + 1] === "R" || query[i + 1] === "r") &&
      (i + 2 >= len || " ()\t".includes(query[i + 2]!))
    ) {
      tokens.push({ kind: "or" });
      i += 2;
      continue;
    }

    // Parse a term (possibly negated)
    const negate = ch === "-" && i + 1 < len && query[i + 1] !== " ";
    if (negate) i++;

    let leaf: SearchLeaf;
    if (i < len && query[i] === '"') {
      // Quoted string
      i++;
      const start = i;
      while (i < len && query[i] !== '"') i++;
      leaf = { type: "text", value: query.slice(start, i) };
      if (i < len) i++; // skip closing quote
    } else {
      // Unquoted word — but qualifier values may contain quoted portions (e.g. deck:"My Deck")
      const start = i;
      while (i < len && !" ()\t".includes(query[i]!)) {
        if (query[i] === '"') {
          // scan to closing quote
          i++;
          while (i < len && query[i] !== '"') i++;
          if (i < len) i++; // skip closing quote
        } else {
          i++;
        }
      }
      const word = query.slice(start, i);
      // Strip quotes from qualifier values: deck:"My Deck" → deck:My Deck
      const stripped = word.replace(/"/g, "");
      leaf = parseQualifiedTerm(stripped);
    }

    tokens.push({ kind: "term", value: negate ? { type: "negate", inner: leaf } : leaf });
  }

  return tokens;
}

// ── Recursive descent parser ──
// Grammar:
//   expr    = andExpr (OR andExpr)*
//   andExpr = unary unary*          (implicit AND)
//   unary   = LPAREN expr RPAREN | term

export function parseSearch(query: string): SearchExpr | null {
  const lexTokens = lex(query);
  if (lexTokens.length === 0) return null;

  let pos = 0;

  function peek(): LexToken | undefined {
    return lexTokens[pos];
  }
  function advance(): LexToken {
    return lexTokens[pos++]!;
  }

  function parseExpr(): SearchExpr {
    let left = parseAndExpr();
    while (peek()?.kind === "or") {
      advance();
      const right = parseAndExpr();
      left = { type: "or", left, right };
    }
    return left;
  }

  function parseAndExpr(): SearchExpr {
    let left = parseUnary();
    while (peek() && peek()!.kind !== "or" && peek()!.kind !== "rparen") {
      const right = parseUnary();
      left = { type: "and", left, right };
    }
    return left;
  }

  function parseUnary(): SearchExpr {
    const tok = peek();
    if (tok?.kind === "lparen") {
      advance();
      const expr = parseExpr();
      if (peek()?.kind === "rparen") advance();
      return expr;
    }
    if (tok?.kind === "term") {
      advance();
      return tok.value;
    }
    // Fallback for unexpected tokens
    advance();
    return { type: "text", value: "" };
  }

  return parseExpr();
}

// ── Matching ──

function compareNumeric(actual: number, op: string, target: number): boolean {
  switch (op) {
    case ">":
      return actual > target;
    case "<":
      return actual < target;
    case ">=":
      return actual >= target;
    case "<=":
      return actual <= target;
    case "=":
      return actual === target;
    case "!=":
      return actual !== target;
    default:
      return false;
  }
}

function getDueDaysFromNow(
  rawDue: number,
  rawDueType: string,
  collectionCreationTime: number,
): number | null {
  if (rawDueType === "position") return null;
  if (rawDueType === "timestamp") {
    return (rawDue - Date.now() / 1000) / 86400;
  }
  // dayOffset or dayLearningOffset: due is days since collection creation
  const todayDay = Math.floor((Date.now() / 1000 - collectionCreationTime) / 86400);
  return rawDue - todayDay;
}

function matchProp(
  card: SearchableCard,
  expr: SearchLeaf & { type: "prop" },
  collectionCreationTime: number,
): boolean {
  let actual: number | null;
  switch (expr.prop) {
    case "ease":
      actual = card.rawEase;
      break;
    case "ivl":
      actual = card.rawIvl;
      break;
    case "due":
      actual = getDueDaysFromNow(card.rawDue, card.rawDueType, collectionCreationTime);
      break;
    case "reps":
      actual = card.reps;
      break;
    case "lapses":
      actual = card.lapses;
      break;
    default:
      return false;
  }
  if (actual == null) return false;
  return compareNumeric(actual, expr.op, expr.value);
}

function matchDateRange(
  card: SearchableCard,
  field: "added" | "edited" | "rated",
  days: number,
): boolean {
  const cutoffMs = Date.now() - days * 86400_000;
  switch (field) {
    case "added":
      return card.cardCreatedMs > 0 && card.cardCreatedMs >= cutoffMs;
    case "edited":
      return card.noteModSec > 0 && card.noteModSec * 1000 >= cutoffMs;
    case "rated":
      return card.cardModSec > 0 && card.cardModSec * 1000 >= cutoffMs;
  }
}

export function matchExpr(
  card: SearchableCard,
  expr: SearchExpr,
  collectionCreationTime: number,
): boolean {
  switch (expr.type) {
    case "negate":
      return !matchExpr(card, expr.inner, collectionCreationTime);
    case "and":
      return (
        matchExpr(card, expr.left, collectionCreationTime) &&
        matchExpr(card, expr.right, collectionCreationTime)
      );
    case "or":
      return (
        matchExpr(card, expr.left, collectionCreationTime) ||
        matchExpr(card, expr.right, collectionCreationTime)
      );
    case "text": {
      const q = expr.value.toLowerCase();
      if (!q) return true;
      for (const v of Object.values(card.fields)) {
        if (v.toLowerCase().includes(q)) return true;
      }
      if (card.deck.toLowerCase().includes(q)) return true;
      if (card.tags.some((t) => t.toLowerCase().includes(q))) return true;
      if (card.templateName.toLowerCase().includes(q)) return true;
      if (card.templateNames && card.templateNames.toLowerCase().includes(q)) return true;
      return false;
    }
    case "deck": {
      const v = expr.value.toLowerCase();
      const deck = card.deck.toLowerCase();
      return deck === v || deck.startsWith(v + "::");
    }
    case "tag": {
      const v = expr.value.toLowerCase();
      return card.tags.some((t) => t.toLowerCase() === v || t.toLowerCase().startsWith(v + "::"));
    }
    case "is": {
      const q = card.queueName;
      switch (expr.value) {
        case "new":
          return q === "new";
        case "learn":
          return q === "learning" || q === "dayLearning";
        case "review":
          return q === "review";
        case "due":
          return q === "review" || q === "learning" || q === "dayLearning";
        case "suspended":
          return q === "suspended";
        case "buried":
          return q === "userBuried" || q === "schedulerBuried";
        default:
          return false;
      }
    }
    case "flag":
      return card.flags === expr.value;
    case "card":
    case "note": {
      const v = expr.value.toLowerCase();
      if (card.templateName.toLowerCase().includes(v)) return true;
      if (card.templateNames && card.templateNames.toLowerCase().includes(v)) return true;
      return false;
    }
    case "prop":
      return matchProp(card, expr, collectionCreationTime);
    case "added":
      return matchDateRange(card, "added", expr.days);
    case "edited":
      return matchDateRange(card, "edited", expr.days);
    case "rated":
      return matchDateRange(card, "rated", expr.days);
  }
}

// ── Helper to convert AnkiData card to SearchableCard ──

function stripHtml(val: string | null | undefined): string {
  if (!val) return "";
  return val.replace(/<[^>]*>/g, "");
}

export function ankiCardToSearchable(
  card: {
    values: Record<string, string | null>;
    tags: string[];
    templates: { name: string }[];
    deckName: string;
    guid: string;
    scheduling: {
      queueName: string;
      flags: number;
      easeFactor: number | null;
      ivl: number;
      due: number;
      dueType: string;
      reps: number;
      lapses: number;
    } | null;
    ankiCardId?: number;
    noteMod?: number;
    cardMod?: number;
  },
): SearchableCard {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(card.values)) {
    fields[k] = stripHtml(v);
  }
  const sched = card.scheduling;
  return {
    fields,
    deck: card.deckName,
    tags: card.tags,
    templateName: card.templates[0]?.name ?? "",
    queueName: sched?.queueName ?? "new",
    flags: sched?.flags ?? 0,
    rawEase: sched?.easeFactor ?? null,
    rawIvl: sched?.ivl ?? 0,
    rawDue: sched?.due ?? 0,
    rawDueType: sched?.dueType ?? "position",
    cardCreatedMs: card.ankiCardId ?? 0,
    noteModSec: card.noteMod ?? 0,
    cardModSec: card.cardMod ?? 0,
    reps: sched?.reps ?? 0,
    lapses: sched?.lapses ?? 0,
  };
}
