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
    req: z.array(z.tuple([z.number(), z.string(), z.array(z.number())])).optional(),
    mod: z.number().optional(),
    usn: z.number().optional(),
    sortf: z.number().optional(),
    did: z.number().nullable().optional(),
    vers: z.array(z.unknown()).optional(),
    tags: z.array(z.unknown()).optional(),
    flds: z.array(
      z.object({
        name: z.string(),
        ord: z.number().optional(),
        sticky: z.boolean().optional(),
        rtl: z.boolean().optional(),
        font: z.string().optional(),
        size: z.number().optional(),
        description: z.string().optional(),
        plainText: z.boolean().optional(),
        collapsed: z.boolean().optional(),
        excludeFromSearch: z.boolean().optional(),
        preventDeletion: z.boolean().optional(),
        id: z.number().nullable().optional(),
        tag: z.number().nullable().optional(),
      }),
    ),
    tmpls: z.array(
      z.object({
        name: z.string(),
        afmt: z.string(),
        qfmt: z.string(),
        ord: z.number(),
        id: z.number().nullable().optional(),
        bafmt: z.string().optional(),
        bqfmt: z.string().optional(),
        did: z.number().nullable().optional(),
        bfont: z.string().optional(),
        bsize: z.number().optional(),
      }),
    ),
  }),
);

export const deckSchema = z.record(
  z.object({
    id: z.number(),
    name: z.string().optional(),
    desc: z.string().optional(),
    mod: z.number().optional(),
    usn: z.number().optional(),
    lrnToday: z.tuple([z.number(), z.number()]).optional(),
    revToday: z.tuple([z.number(), z.number()]).optional(),
    newToday: z.tuple([z.number(), z.number()]).optional(),
    timeToday: z.tuple([z.number(), z.number()]).optional(),
    collapsed: z.boolean().optional(),
    browserCollapsed: z.boolean().optional(),
    conf: z.number().optional(),
    dyn: z.number().optional(), // 0=normal, 1=filtered
    extendNew: z.number().optional(),
    extendRev: z.number().optional(),
  }),
);

export const colConfSchema = z
  .object({
    activeDecks: z.array(z.number()).optional(),
    curDeck: z.number().optional(),
    newSpread: z.number().optional(),
    collapseTime: z.number().optional(),
    timeLim: z.number().optional(),
    estTimes: z.boolean().optional(),
    dueCounts: z.boolean().optional(),
    curModel: z.union([z.number(), z.string()]).optional(),
    nextPos: z.number().optional(),
    sortType: z.string().optional(),
    sortBackwards: z.boolean().optional(),
    addToCur: z.boolean().optional(),
    dayLearnFirst: z.boolean().optional(),
    schedVer: z.number().optional(),
  })
  .passthrough();

const dconfNewSchema = z
  .object({
    order: z.number().optional(),
    perDay: z.number().optional(),
    delays: z.array(z.number()).optional(),
    ints: z.tuple([z.number(), z.number(), z.number()]).optional(),
    initialFactor: z.number().optional(),
    bury: z.boolean().optional(),
    separate: z.boolean().optional(),
  })
  .passthrough();

const dconfRevSchema = z
  .object({
    perDay: z.number().optional(),
    ease4: z.number().optional(),
    fuzz: z.number().optional(),
    ivlFct: z.number().optional(),
    maxIvl: z.number().optional(),
    bury: z.boolean().optional(),
    hardFactor: z.number().optional(),
  })
  .passthrough();

const dconfLapseSchema = z
  .object({
    delays: z.array(z.number()).optional(),
    mult: z.number().optional(),
    minInt: z.number().optional(),
    leechFails: z.number().optional(),
    leechAction: z.number().optional(),
  })
  .passthrough();

export const dconfSchema = z.record(
  z
    .object({
      id: z.union([z.number(), z.string()]).optional(),
      name: z.string().optional(),
      new: dconfNewSchema.optional(),
      rev: dconfRevSchema.optional(),
      lapse: dconfLapseSchema.optional(),
      maxTaken: z.number().optional(),
      autoplay: z.boolean().optional(),
      timer: z.number().optional(),
      replayq: z.boolean().optional(),
      dyn: z.boolean().optional(),
      mod: z.number().optional(),
      usn: z.number().optional(),
    })
    .passthrough(),
);

export type DconfEntry = z.infer<typeof dconfSchema>[string];

export const fsrsJsonSchema = z.object({
  s: z.number(),
  d: z.number(),
  dr: z.number().optional(),
});

export const mediaMappingSchema = z.record(z.string());
