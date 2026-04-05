import { z } from "zod";

// The col table contains a JSON string for the conf, models, decks, and dconf fields

export const modelSchema = z.record(
  z.object({
    id: z.union([z.number(), z.string()]),
    css: z.string(),
    latexPre: z.string(),
    latexPost: z.string(),
    latexsvg: z.boolean().optional(),
    type: z.number().optional(), // 0=MODEL_STD, 1=MODEL_CLOZE
    req: z
      .array(z.tuple([z.number(), z.string(), z.array(z.number())]))
      .optional(),
    flds: z.array(
      z.object({
        name: z.string(),
      }),
    ),
    tmpls: z.array(
      z.object({
        name: z.string(),
        afmt: z.string(),
        qfmt: z.string(),
        ord: z.number(),
        id: z.number().nullable().optional(),
      }),
    ),
  }),
);

export const deckSchema = z.record(
  z.object({
    id: z.number(),
    name: z.string().optional(),
  }),
);

export const fsrsJsonSchema = z.object({
  s: z.number(),
  d: z.number(),
  dr: z.number().optional(),
});

export const mediaMappingSchema = z.record(z.string());

export const cachedFileEntrySchema = z.array(
  z.object({
    name: z.string(),
    size: z.number(),
    addedAt: z.number(),
  }),
);
