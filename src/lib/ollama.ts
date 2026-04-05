import { z } from "zod";

const OLLAMA_BASE_URL = "/ollama";
const DEFAULT_MODEL = "gemma3";

const ankiDeckSchema = z.object({
  deckName: z.string(),
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      tags: z.array(z.string()).optional(),
    }),
  ),
});

export type AnkiDeckSpec = z.infer<typeof ankiDeckSchema>;

async function ollamaGenerate(prompt: string, model: string = DEFAULT_MODEL): Promise<string> {
  const response = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: "json",
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama request failed: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  return data.response;
}

export async function checkOllamaAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getOllamaModels(): Promise<string[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
    if (!response.ok) return [];
    const data = await response.json();
    return (data.models ?? []).map((m: { name: string }) => m.name);
  } catch {
    return [];
  }
}

const SYSTEM_PROMPT = `You are an expert Anki flashcard creator. Given a document, create flashcards as JSON.

Rules:
- Each card has a "front" (question) and "back" (answer) — plain text only, no markup or template syntax
- Follow the minimum information principle: one atomic fact per card
- Write clear questions that make sense without the source document
- Keep answers concise and direct
- Prefer active recall questions over simple definitions
- Optionally group related cards with tags

Return ONLY valid JSON matching this exact schema, nothing else:
{
  "deckName": "descriptive name for the deck",
  "cards": [
    {
      "front": "the question text",
      "back": "the answer text",
      "tags": ["optional", "tags"]
    }
  ]
}

Examples of good cards:
  {"front": "What color stripe identifies the Lantern Finch?", "back": "A thin silver stripe over each eye."}
  {"front": "Where do Dusk Swallows build nests?", "back": "Under covered bridges near moving water."}
  {"front": "What powers the Moon Motel's neon vacancy sign?", "back": "A solar panel shaped like a crescent moon."}

Do NOT include any Anki template syntax like {{Front}}, {{Back}}, {{FrontSide}}, {{cloze:}}, or similar — just the actual content.`;

export async function generateAnkiDeck(
  document: string,
  instructions: string,
  model: string = DEFAULT_MODEL,
): Promise<AnkiDeckSpec> {
  let userPrompt = `Create Anki flashcards from the following document.\n\n`;
  if (instructions.trim()) {
    userPrompt += `Additional instructions: ${instructions.trim()}\n\n`;
  }
  userPrompt += `Document:\n"""\n${document}\n"""`;

  const fullPrompt = `${SYSTEM_PROMPT}\n\n${userPrompt}`;
  const rawResponse = await ollamaGenerate(fullPrompt, model);

  const parsed = JSON.parse(rawResponse);
  return ankiDeckSchema.parse(parsed);
}
