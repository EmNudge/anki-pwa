import katex from "katex";

type Variables = { [key: string]: string | null };

// security risk - figure out how to do this safely
// maybe embed in an iframe?
export function getRenderedCardString({
  templateString,
  variables,
  mediaFiles,
}: {
  templateString: string;
  variables: Variables;
  mediaFiles: Map<string, string>;
}) {
  let renderedString = templateString;

  renderedString = flattenOptionalSections(templateString, variables);

  renderedString = renderedString.replace(/\{\{(.*?)\}\}/g, (_match, p1) => {
    const field = variables[p1];
    return field ?? "";
  });

  renderedString = replaceTemplatingSyntax(renderedString);

  renderedString = replaceLatex(renderedString);

  renderedString = replaceMediaFiles(renderedString, mediaFiles);

  return renderedString;
}

/**
 * source strings are replaced with blob URLs
 */
function replaceMediaFiles(renderedString: string, mediaFiles: Map<string, string>) {
  return renderedString.replace(/="([^"](\\"|[^"])+)"/g, (match, filename) => {
    const url = mediaFiles.get(filename);
    return url ? `="${url}"` : match;
  });
}

function replaceLatex(renderedString: string) {
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
      const cleanLatex = cleanAndUnescapeLatex(latex);

      // Skip empty blocks
      if (!cleanLatex) {
        return "";
      }

      // Render as display mode LaTeX
      return katex.renderToString(cleanLatex, { displayMode: true });
    } catch (error) {
      console.error(new Error("could not parse latex for: " + latex, { cause: error }));
      // Return cleaned content without the tags
      return cleanAndUnescapeLatex(latex);
    }
  };

  const replaceLatexBlock = (_match: string, latex: string) => {
    try {
      const cleanLatex = cleanAndUnescapeLatex(latex);

      // Check if this contains a LaTeX environment (like \begin{align})
      const envMatch = cleanLatex.match(/^(.*?\\end\{[^}]+\})(.*?)$/s);

      if (envMatch && envMatch[1] !== undefined) {
        // Split into environment part and remaining text
        const envPart = envMatch[1];
        const textPart = envMatch[2] || "";

        let result = "";

        // Render the environment as display mode LaTeX
        try {
          result += katex.renderToString(envPart.trim(), { displayMode: true });
        } catch (e) {
          result += envPart; // Keep original if parsing fails
        }

        // Process remaining text for inline math
        if (textPart.trim()) {
          result += textPart.replace(/\$(.+?)\$/g, (_, math) => {
            try {
              return katex.renderToString(math, { displayMode: false });
            } catch (e) {
              return `$${math}$`; // Return original if parsing fails
            }
          });
        }

        return result;
      } else {
        // No LaTeX environment - this is text with potential inline $...$ expressions
        // Replace inline math expressions within the text
        return cleanLatex.replace(/\$(.+?)\$/g, (_, math) => {
          try {
            return katex.renderToString(math, { displayMode: false });
          } catch (e) {
            return `$${math}$`; // Return original if parsing fails
          }
        });
      }
    } catch (error) {
      console.error(new Error("could not parse latex for: " + latex, { cause: error }));
      // Return cleaned content without the tags
      return cleanAndUnescapeLatex(latex);
    }
  };

  return renderedString
    .replace(/\[\$\$?\](.+?)\[\/\$\$?\]/gs, replaceDisplayMathBlock)
    .replace(/\[latex\](.+?)\[\/latex\]/gs, replaceLatexBlock);
}

const SOUND_ICON_SVG =
  '<svg style="height: 2rem; width: 2rem;" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 1024 1024"><path d="M625.9 115c-5.9 0-11.9 1.6-17.4 5.3L254 352H90c-8.8 0-16 7.2-16 16v288c0 8.8 7.2 16 16 16h164l354.5 231.7c5.5 3.6 11.6 5.3 17.4 5.3c16.7 0 32.1-13.3 32.1-32.1V147.1c0-18.8-15.4-32.1-32.1-32.1zM586 803L293.4 611.7l-18-11.7H146V424h129.4l17.9-11.7L586 221v582zm348-327H806c-8.8 0-16 7.2-16 16v40c0 8.8 7.2 16 16 16h128c8.8 0 16-7.2 16-16v-40c0-8.8-7.2-16-16-16zm-41.9 261.8l-110.3-63.7a15.9 15.9 0 0 0-21.7 5.9l-19.9 34.5c-4.4 7.6-1.8 17.4 5.8 21.8L856.3 800a15.9 15.9 0 0 0 21.7-5.9l19.9-34.5c4.4-7.6 1.7-17.4-5.8-21.8zM760 344a15.9 15.9 0 0 0 21.7 5.9L892 286.2c7.6-4.4 10.2-14.2 5.8-21.8L878 230a15.9 15.9 0 0 0-21.7-5.9L746 287.8a15.99 15.99 0 0 0-5.8 21.8L760 344z" fill="currentColor"></path></svg>';

function replaceTemplatingSyntax(renderedString: string) {
  return renderedString
    .replace(/\[sound:(.+?)\]/g, (_match, filename) => {
      const randomUuid = crypto.randomUUID();
      return [
        `<div class='audio-container' data-autoplay>`,
        `<button onclick="document.getElementById('audio-${randomUuid}').play()" data-autoplay>${SOUND_ICON_SVG}</button>`,
        `<audio src="${filename}" id="audio-${randomUuid}"></audio>`,
        "</div>",
      ].join("");
    })
    .replace(/(\w+)\[(\w+)\]/g, (_match, rubyBase, rubyText) => {
      return `<ruby>${rubyBase}<rt>${rubyText}</rt></ruby>`;
    });
}

/**
 * Optional sections of the form {#section}content{{/section}} are flattened.
 * If card[section] is not present, the section is removed.
 * If it is present, the guards are removed and the content remains.
 */
function flattenOptionalSections(templateString: string, card: Variables) {
  let renderedString = templateString;

  const optionalSections = [
    ...new Set([...renderedString.matchAll(/\{\{#(.*?)\}\}/g)].map((match) => match[1])),
  ];

  if (optionalSections) {
    for (const section of optionalSections) {
      const regex = new RegExp(
        `\\{\\{\\#${section}\\}\\}((?:.|\n)+?)\\{\\{\\/${section}\\}\\}`,
        "g",
      );

      if (section && !card[section]) {
        renderedString = renderedString.replace(regex, "");
        continue;
      }

      renderedString = renderedString.replace(regex, "$1");
    }
  }

  return renderedString;
}
