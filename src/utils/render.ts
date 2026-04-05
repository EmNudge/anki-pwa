import katex from "katex";

type Variables = { [key: string]: string | null };

// security risk - figure out how to do this safely
// maybe embed in an iframe?
export function getRenderedCardString({
  templateString,
  variables,
  mediaFiles,
  cardOrd = 0,
  isAnswer = false,
  frontTemplate,
  tags,
  deckName,
  cardName,
  latexPre,
  latexPost,
  noteTypeName,
  isCloze = false,
  latexSvg = false,
}: {
  templateString: string;
  variables: Variables;
  mediaFiles: Map<string, string>;
  cardOrd?: number;
  isAnswer?: boolean;
  frontTemplate?: string;
  tags?: string[];
  deckName?: string;
  cardName?: string;
  latexPre?: string;
  latexPost?: string;
  noteTypeName?: string;
  isCloze?: boolean;
  latexSvg?: boolean;
}) {
  let renderedString = templateString;

  // Handle FrontSide: if the template references {{FrontSide}} and it's not in variables,
  // render the front template and inject it
  let enrichedVariables = { ...variables };
  if (frontTemplate && renderedString.includes("{{FrontSide}}") && !enrichedVariables.FrontSide) {
    let frontSideHtml = getRenderedCardString({
      templateString: frontTemplate,
      variables,
      mediaFiles,
      cardOrd,
      tags,
      deckName,
      cardName,
      latexPre,
      latexPost,
      noteTypeName,
      isCloze,
      latexSvg,
    });
    // Strip audio references from FrontSide to prevent double playback
    frontSideHtml = stripAvTags(frontSideHtml);
    // Strip type: input fields from FrontSide on answer side
    if (isAnswer) {
      frontSideHtml = stripTypeInputs(frontSideHtml);
    }
    enrichedVariables = { ...enrichedVariables, FrontSide: frontSideHtml };
  }

  // Add special fields if not already present
  if (tags && !enrichedVariables.Tags) {
    enrichedVariables.Tags = tags.join(" ");
  }
  if (deckName) {
    if (!enrichedVariables.Deck) enrichedVariables.Deck = deckName;
    if (!enrichedVariables.Subdeck) {
      const parts = deckName.split("::");
      enrichedVariables.Subdeck = parts[parts.length - 1] ?? deckName;
    }
  }
  if (isCloze && !enrichedVariables.Card) {
    enrichedVariables.Card = `Cloze ${cardOrd + 1}`;
  } else if (cardName && !enrichedVariables.Card) {
    enrichedVariables.Card = cardName;
  }
  if (noteTypeName && !enrichedVariables.Type) {
    enrichedVariables.Type = noteTypeName;
  }

  // Detect cloze numbers present in variables for conditional sections
  const clozeNumbers = detectClozeNumbers(enrichedVariables);
  for (const cn of clozeNumbers) {
    if (!enrichedVariables[`c${cn}`]) {
      enrichedVariables[`c${cn}`] = "1"; // truthy marker
    }
  }

  renderedString = flattenOptionalSections(renderedString, enrichedVariables);

  renderedString = renderedString.replace(/\{\{(.*?)\}\}/g, (_match, p1: string) => {
    return processFieldReference(p1, enrichedVariables, cardOrd, isAnswer, isCloze);
  });

  renderedString = replaceTemplatingSyntax(renderedString);

  const katexMacros = latexPre ? parseLatexMacros(latexPre) : {};
  if (latexSvg) {
    renderedString = replaceLatexWithSvg(renderedString, mediaFiles);
  } else {
    renderedString = replaceLatex(renderedString, katexMacros);
  }

  renderedString = replaceMediaFiles(renderedString, mediaFiles);

  return renderedString;
}

/**
 * Detect all cloze numbers present in any variable value.
 */
function detectClozeNumbers(variables: Variables): number[] {
  const nums = new Set<number>();
  for (const value of Object.values(variables)) {
    if (!value) continue;
    const matches = value.matchAll(/\{\{c(\d+)::/g);
    for (const m of matches) {
      nums.add(parseInt(m[1]!));
    }
  }
  return [...nums];
}

/**
 * Strip [sound:...] tags and their rendered audio elements from HTML.
 * Used when injecting FrontSide into the answer template to prevent double playback.
 */
function stripAvTags(html: string): string {
  return html
    .replace(/\[sound:[^\]]+\]/g, "")
    .replace(/<div class='audio-container'[^>]*>[\s\S]*?<\/div>/g, "");
}

/**
 * Strip type: input fields from FrontSide HTML when injecting into answer side.
 */
function stripTypeInputs(html: string): string {
  return html.replace(/<input type="text" id="typeans"[^>]*>/g, "");
}

/**
 * Process a field reference that may include filters.
 * Format: {{filter1:filter2:FieldName}} — filters applied left-to-right.
 */
function processFieldReference(
  ref: string,
  variables: Variables,
  cardOrd: number,
  isAnswer: boolean,
  isCloze: boolean,
): string {
  // Handle TTS filter: {{tts LANG OPTIONS:FieldName}}
  // The tts prefix contains spaces, so we need special handling before splitting on ':'
  const ttsMatch = ref.match(/^tts\s+([^:]+):(.+)$/);
  if (ttsMatch) {
    const ttsOptions = ttsMatch[1]!;
    const fieldName = ttsMatch[2]!;
    const value = variables[fieldName] ?? "";
    return `<span class="tts-speak" data-tts-options="${ttsOptions}">${value}</span>`;
  }

  const parts = ref.split(":");

  if (parts.length === 1) {
    return variables[ref] ?? "";
  }

  // Last part is the field name, preceding parts are filters
  const fieldName = parts[parts.length - 1]!;
  const filters = parts.slice(0, -1);

  let value = variables[fieldName] ?? "";

  // Apply filters left-to-right (outermost first, per Anki source)
  for (let i = 0; i < filters.length; i++) {
    const filter = filters[i]!;
    value = applyFilter(filter, value, cardOrd, isAnswer, isCloze, fieldName);
  }

  return value;
}

function applyFilter(
  filter: string,
  value: string,
  cardOrd: number,
  isAnswer: boolean,
  isCloze: boolean,
  fieldName: string,
): string {
  switch (filter) {
    case "text":
      return value.replace(/<[^>]*>/g, "");
    case "cloze":
      if (!isCloze) return value;
      return processCloze(value, cardOrd, isAnswer);
    case "cloze-only":
      if (!isCloze) return value;
      return processClozeOnly(value, cardOrd);
    case "hint":
      return `<a class="hint" onclick="this.style.display='none';this.nextSibling.style.display='inline-block';">Show ${fieldName}</a><span style="display:none">${value}</span>`;
    case "type":
      if (isAnswer) {
        return `<span id="typeans">${value}</span>`;
      }
      return `<input type="text" id="typeans" placeholder="type answer">`;
    case "furigana":
      return applyFuriganaFilter(value);
    case "kanji":
      return applyKanjiFilter(value);
    case "kana":
      return applyKanaFilter(value);
    default:
      return value;
  }
}

/**
 * Furigana filter: convert " 漢字[かんじ]" patterns to <ruby> markup.
 * Uses Anki's space-delimited format for multi-character bases.
 */
function applyFuriganaFilter(text: string): string {
  // Match space-delimited ruby groups: " BASE[READING]"
  return text.replace(/ ?([^\s\[]+)\[([^\]]+)\]/g, (_match, base: string, reading: string) => {
    return `<ruby>${base}<rt>${reading}</rt></ruby>`;
  });
}

/**
 * Kanji filter: strip bracketed readings, keep base characters.
 */
function applyKanjiFilter(text: string): string {
  return text.replace(/ ?([^\s\[]+)\[([^\]]+)\]/g, (_match, base: string) => {
    return base;
  });
}

/**
 * Kana filter: replace base+reading pairs with just the reading.
 */
function applyKanaFilter(text: string): string {
  return text.replace(/ ?([^\s\[]+)\[([^\]]+)\]/g, (_match, _base: string, reading: string) => {
    return reading;
  });
}

/**
 * Process cloze deletions in text.
 * On the question side, the active cloze (matching cardOrd+1) is replaced with [...] or [hint].
 * On the answer side, the active cloze is revealed in a <span class="cloze">.
 * Non-active cloze markers are always unwrapped to show their content.
 */
function processCloze(text: string, cardOrd: number, isAnswer: boolean): string {
  const clozeNum = cardOrd + 1;

  return text.replace(
    /\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/gs,
    (_match, num: string, answer: string, hint?: string) => {
      if (parseInt(num) === clozeNum) {
        if (isAnswer) {
          return `<span class="cloze">${answer}</span>`;
        }
        return hint ? `[${hint}]` : "[...]";
      }
      return answer;
    },
  );
}

function processClozeOnly(text: string, cardOrd: number): string {
  const clozeNum = cardOrd + 1;
  const matches: string[] = [];

  text.replace(/\{\{c(\d+)::(.+?)(?:::(.+?))?\}\}/gs, (_match, num: string, answer: string) => {
    if (parseInt(num) === clozeNum) {
      matches.push(answer);
    }
    return "";
  });

  return matches.join(", ");
}

/**
 * source strings are replaced with blob URLs
 * Performs case-insensitive and NFC-normalized matching
 * Falls back to Anki's 120-byte filename truncation if no match
 */
function replaceMediaFiles(renderedString: string, mediaFiles: Map<string, string>) {
  // Build a normalized lookup map for case-insensitive + NFC matching
  const normalizedMap = new Map<string, string>();
  for (const [key, value] of mediaFiles) {
    normalizedMap.set(key.normalize("NFC").toLowerCase(), value);
  }

  return renderedString.replace(/="([^"](\\"|[^"])+)"/g, (match, filename) => {
    const normalized = (filename as string).normalize("NFC").toLowerCase();
    let url = normalizedMap.get(normalized);
    if (!url) {
      // Try Anki's 120-byte filename truncation
      const truncated = truncateFilename(normalized, 120);
      if (truncated !== normalized) {
        url = normalizedMap.get(truncated);
      }
    }
    return url ? `="${url}"` : match;
  });
}

/**
 * Truncate a filename to maxBytes, preserving the file extension.
 * Matches Anki's MAX_FILENAME_LENGTH = 120 bytes.
 */
function truncateFilename(filename: string, maxBytes: number): string {
  const encoder = new TextEncoder();
  if (encoder.encode(filename).length <= maxBytes) return filename;

  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1) {
    // No extension, just truncate
    const bytes = encoder.encode(filename);
    return new TextDecoder().decode(bytes.slice(0, maxBytes));
  }
  const ext = filename.slice(lastDot);
  const stem = filename.slice(0, lastDot);
  const extBytes = encoder.encode(ext);
  const maxStemBytes = maxBytes - extBytes.length;
  if (maxStemBytes <= 0) return filename;
  const stemBytes = encoder.encode(stem);
  const truncatedStem = new TextDecoder().decode(stemBytes.slice(0, maxStemBytes));
  return truncatedStem + ext;
}

/**
 * Parse \newcommand definitions from latexPre into KaTeX macro format.
 */
function parseLatexMacros(latexPre: string): Record<string, string> {
  const macros: Record<string, string> = {};
  // Match \newcommand{\name}{expansion} with balanced braces in expansion
  const re = /\\(?:newcommand|renewcommand|def)\*?\{?(\\[a-zA-Z]+)\}?/g;
  let match;
  while ((match = re.exec(latexPre)) !== null) {
    const name = match[1];
    if (!name) continue;
    // Extract the balanced-brace body after the command name,
    // skipping optional argument count like [1]
    let afterMatch = latexPre.slice(match.index + match[0].length).trimStart();
    // Skip optional argument count [N]
    const argCountMatch = afterMatch.match(/^\[(\d+)\]/);
    if (argCountMatch) {
      afterMatch = afterMatch.slice(argCountMatch[0].length);
    }
    const body = extractBracedBody(afterMatch);
    if (body !== null) {
      macros[name] = body;
    }
  }
  return macros;
}

function extractBracedBody(str: string): string | null {
  const trimmed = str.trimStart();
  if (!trimmed.startsWith("{")) return null;
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{") depth++;
    else if (trimmed[i] === "}") depth--;
    if (depth === 0) return trimmed.slice(1, i);
  }
  return null;
}

/**
 * Pre-expand zero-argument macros in a LaTeX string so KaTeX doesn't leave
 * raw macro names in annotations. Macros with arguments (containing #) are
 * left for KaTeX to handle via the macros option.
 */
function preExpandMacros(latex: string, macros: Record<string, string>): string {
  let result = latex;
  for (const [name, expansion] of Object.entries(macros)) {
    // Skip macros with arguments — KaTeX handles these natively
    if (expansion.includes("#")) continue;
    const escaped = name.replace(/\\/g, "\\\\");
    result = result.replace(new RegExp(escaped + "(?![a-zA-Z])", "g"), expansion);
  }
  return result;
}

function replaceLatex(renderedString: string, macros: Record<string, string> = {}) {
  const hasMacros = Object.keys(macros).length > 0;
  const katexOptions = (displayMode: boolean) => ({
    displayMode,
    ...(hasMacros ? { macros } : {}),
  });

  const cleanAndUnescapeLatex = (latex: string) => {
    // Strip HTML tags that Anki may have inserted
    let cleanLatex = latex.replace(/<[^>]+>/g, "");

    // Unescape HTML entities
    cleanLatex = cleanLatex
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ");

    // Trim whitespace
    return cleanLatex.trim();
  };

  const replaceDisplayMathBlock = (_match: string, latex: string) => {
    try {
      let cleanLatex = cleanAndUnescapeLatex(latex);

      // Skip empty blocks
      if (!cleanLatex) {
        return "";
      }

      if (hasMacros) cleanLatex = preExpandMacros(cleanLatex, macros);

      // Render as display mode LaTeX
      return katex.renderToString(cleanLatex, katexOptions(true));
    } catch (error) {
      console.error(new Error("could not parse latex for: " + latex, { cause: error }));
      // Return cleaned content without the tags
      return cleanAndUnescapeLatex(latex);
    }
  };

  const replaceInlineMathBlock = (_match: string, latex: string) => {
    try {
      let cleanLatex = cleanAndUnescapeLatex(latex);
      if (!cleanLatex) return "";
      if (hasMacros) cleanLatex = preExpandMacros(cleanLatex, macros);
      return katex.renderToString(cleanLatex, katexOptions(false));
    } catch (error) {
      console.error(new Error("could not parse latex for: " + latex, { cause: error }));
      return cleanAndUnescapeLatex(latex);
    }
  };

  const replaceLatexBlock = (_match: string, latex: string) => {
    try {
      let cleanLatex = cleanAndUnescapeLatex(latex);
      if (hasMacros) cleanLatex = preExpandMacros(cleanLatex, macros);

      // Check if this contains a LaTeX environment (like \begin{align})
      const envMatch = cleanLatex.match(/^(.*?\\end\{[^}]+\})(.*?)$/s);

      if (envMatch && envMatch[1] !== undefined) {
        // Split into environment part and remaining text
        const envPart = envMatch[1];
        const textPart = envMatch[2] || "";

        let result = "";

        // Render the environment as display mode LaTeX
        try {
          result += katex.renderToString(envPart.trim(), katexOptions(true));
        } catch (e) {
          result += envPart; // Keep original if parsing fails
        }

        // Process remaining text for inline math
        if (textPart.trim()) {
          result += textPart.replace(/\$(.+?)\$/g, (_, math) => {
            try {
              return katex.renderToString(math, katexOptions(false));
            } catch (e) {
              return `$${math}$`; // Return original if parsing fails
            }
          });
        }

        return result;
      } else if (cleanLatex.includes("$")) {
        // Text with inline $...$ expressions
        return cleanLatex.replace(/\$(.+?)\$/g, (_, math) => {
          try {
            return katex.renderToString(math, katexOptions(false));
          } catch (e) {
            return `$${math}$`; // Return original if parsing fails
          }
        });
      } else {
        // Bare LaTeX content (no environment, no inline $) — render directly
        try {
          return katex.renderToString(cleanLatex, katexOptions(false));
        } catch (e) {
          return cleanLatex;
        }
      }
    } catch (error) {
      console.error(new Error("could not parse latex for: " + latex, { cause: error }));
      // Return cleaned content without the tags
      return cleanAndUnescapeLatex(latex);
    }
  };

  return (
    renderedString
      // <anki-mathjax block="true">...</anki-mathjax> → display math
      .replace(/<anki-mathjax\s+block="true"\s*>([\s\S]+?)<\/anki-mathjax>/g, replaceDisplayMathBlock)
      // <anki-mathjax>...</anki-mathjax> → inline math
      .replace(/<anki-mathjax>([\s\S]+?)<\/anki-mathjax>/g, replaceInlineMathBlock)
      // [$$]...[/$$] is display math
      .replace(/\[\$\$\](.+?)\[\/\$\$\]/gs, replaceDisplayMathBlock)
      // [$]...[/$] is inline math
      .replace(/\[\$\](.+?)\[\/\$\]/gs, replaceInlineMathBlock)
      .replace(/\[latex\](.+?)\[\/latex\]/gs, replaceLatexBlock)
      // Standard LaTeX delimiters: \[...\] for display, \(...\) for inline
      .replace(/\\\[(.+?)\\\]/gs, replaceDisplayMathBlock)
      .replace(/\\\((.+?)\\\)/gs, replaceInlineMathBlock)
  );
}

/**
 * When latexSvg mode is enabled, replace LaTeX blocks with img tags
 * referencing pre-rendered SVG files from the media map.
 */
function replaceLatexWithSvg(renderedString: string, mediaFiles: Map<string, string>): string {
  // Collect all latex SVG/PNG files from media
  const svgEntries = [...mediaFiles.entries()].filter(([k]) => /^latex-.*\.(svg|png)$/i.test(k));

  let idx = 0;
  const replacer = () => {
    const entry = svgEntries[idx++];
    return entry ? `<img src="${entry[1]}">` : "";
  };

  return renderedString
    .replace(/\[\$\$\][\s\S]+?\[\/\$\$\]/g, replacer)
    .replace(/\[\$\][\s\S]+?\[\/\$\]/g, replacer)
    .replace(/\[latex\][\s\S]+?\[\/latex\]/g, replacer)
    .replace(/\\\[[\s\S]+?\\\]/g, replacer)
    .replace(/\\\([\s\S]+?\\\)/g, replacer);
}

const SOUND_ICON_SVG =
  '<svg style="height: 2rem; width: 2rem;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024"><path d="M625.9 115c-5.9 0-11.9 1.6-17.4 5.3L254 352H90c-8.8 0-16 7.2-16 16v288c0 8.8 7.2 16 16 16h164l354.5 231.7c5.5 3.6 11.6 5.3 17.4 5.3c16.7 0 32.1-13.3 32.1-32.1V147.1c0-18.8-15.4-32.1-32.1-32.1zM586 803L293.4 611.7l-18-11.7H146V424h129.4l17.9-11.7L586 221v582zm348-327H806c-8.8 0-16 7.2-16 16v40c0 8.8 7.2 16 16 16h128c8.8 0 16-7.2 16-16v-40c0-8.8-7.2-16-16-16zm-41.9 261.8l-110.3-63.7a15.9 15.9 0 0 0-21.7 5.9l-19.9 34.5c-4.4 7.6-1.8 17.4 5.8 21.8L856.3 800a15.9 15.9 0 0 0 21.7-5.9l19.9-34.5c4.4-7.6 1.7-17.4-5.8-21.8zM760 344a15.9 15.9 0 0 0 21.7 5.9L892 286.2c7.6-4.4 10.2-14.2 5.8-21.8L878 230a15.9 15.9 0 0 0-21.7-5.9L746 287.8a15.99 15.99 0 0 0-5.8 21.8L760 344z" fill="currentColor"></path></svg>';

function replaceTemplatingSyntax(renderedString: string) {
  return renderedString
    .replace(/\[sound:(.+?)\]/g, (_match, filename) => {
      return [
        `<div class='audio-container' data-autoplay>`,
        `<button data-autoplay>${SOUND_ICON_SVG}</button>`,
        `<audio src="${filename}"></audio>`,
        "</div>",
      ].join("");
    })
    .replace(
      / ?([\u3000-\u9fff\uf900-\ufaffぁ-んァ-ヶ\u4e00-\u9faf]+)\[([\u3000-\u9fff\uf900-\ufaffぁ-んァ-ヶa-zA-Z]+)\]/g,
      (_match, rubyBase, rubyText) => {
        return `<ruby>${rubyBase}<rt>${rubyText}</rt></ruby>`;
      },
    );
}

/**
 * Check if a field value is "not empty" per Anki's rules:
 * strip HTML tags and whitespace, then check if anything remains.
 */
function fieldIsNotEmpty(value: string | null | undefined): boolean {
  if (!value) return false;
  // Strip HTML tags, then check for non-whitespace content
  const stripped = value.replace(/<[^>]*>/g, "").trim();
  return stripped.length > 0;
}

/**
 * Optional/conditional sections:
 * - {{#section}}content{{/section}} — shown if field is non-empty
 * - {{^section}}content{{/section}} — shown if field is empty (inverse)
 */
function flattenOptionalSections(templateString: string, card: Variables) {
  let renderedString = templateString;

  // Process positive conditionals {{#field}}...{{/field}}
  const positiveSections = [
    ...new Set([...renderedString.matchAll(/\{\{#(.*?)\}\}/g)].map((match) => match[1])),
  ];

  for (const section of positiveSections) {
    if (!section) continue;
    const regex = new RegExp(
      `\\{\\{\\#${escapeRegex(section)}\\}\\}((?:.|\\n)+?)\\{\\{\\/${escapeRegex(section)}\\}\\}`,
      "g",
    );

    if (!fieldIsNotEmpty(card[section])) {
      renderedString = renderedString.replace(regex, "");
    } else {
      renderedString = renderedString.replace(regex, "$1");
    }
  }

  // Process inverse conditionals {{^field}}...{{/field}}
  const inverseSections = [
    ...new Set([...renderedString.matchAll(/\{\{\^(.*?)\}\}/g)].map((match) => match[1])),
  ];

  for (const section of inverseSections) {
    if (!section) continue;
    const regex = new RegExp(
      `\\{\\{\\^${escapeRegex(section)}\\}\\}((?:.|\\n)+?)\\{\\{\\/${escapeRegex(section)}\\}\\}`,
      "g",
    );

    if (fieldIsNotEmpty(card[section])) {
      // Field has a value — remove the inverse section
      renderedString = renderedString.replace(regex, "");
    } else {
      // Field is empty — keep the content, remove the guards
      renderedString = renderedString.replace(regex, "$1");
    }
  }

  return renderedString;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
