import type { AnkiData } from "./ankiParser";
import { ANKI_DEFAULT_CSS } from "./utils/constants";

type SampleCard = {
  front: string;
  back: string;
  deckName: string;
};

type SampleDeck = {
  id: string;
  name: string;
  description: string;
  data: AnkiData;
};

const basicTemplate = {
  name: "Card 1",
  qfmt: "{{Front}}",
  afmt: '{{FrontSide}}<hr id="answer">{{Back}}',
};

const basicCss = ANKI_DEFAULT_CSS;

function createCard(card: SampleCard, index: number) {
  return {
    values: {
      Front: card.front,
      Back: card.back,
    },
    tags: [],
    templates: [basicTemplate],
    css: basicCss,
    deckName: card.deckName,
    guid: `${card.deckName}-${index}`,
    scheduling: null,
    noteType: 0,
    latexSvg: false,
    latexPre: "",
    latexPost: "",
    req: null,
    fieldDescriptions: {},
    noteData: null,
    csum: null,
    sfld: card.front,
  };
}

function createSampleDeck({
  id,
  name,
  description,
  decks,
  cards,
}: {
  id: string;
  name: string;
  description: string;
  decks: Record<string, { id: number; name: string }>;
  cards: SampleCard[];
}): SampleDeck {
  return {
    id,
    name,
    description,
    data: {
      files: new Map(),
      cards: cards.map(createCard),
      deckName: name,
      decks,
      notesTypes: [],
      collectionCreationTime: 0,
      deckConfigs: {},
      colConf: null,
    },
  };
}

export const sampleDecks: SampleDeck[] = [
  createSampleDeck({
    id: "sample:field-notes",
    name: "Field Notes",
    description: "Two mini subdecks with made-up birds and trees.",
    decks: {
      "101": { id: 101, name: "Field Notes::Birds" },
      "102": { id: 102, name: "Field Notes::Trees" },
    },
    cards: [
      {
        deckName: "Field Notes::Birds",
        front: "What color stripe identifies the Lantern Finch?",
        back: "A thin silver stripe over each eye.",
      },
      {
        deckName: "Field Notes::Birds",
        front: "Where do Dusk Swallows build nests?",
        back: "Under covered bridges near moving water.",
      },
      {
        deckName: "Field Notes::Birds",
        front: "What sound does a Bramble Lark make?",
        back: "Three quick clicks followed by a whistle.",
      },
      {
        deckName: "Field Notes::Trees",
        front: "How do you spot a Glassbark Maple?",
        back: "Its bark peels in translucent paper-thin sheets.",
      },
      {
        deckName: "Field Notes::Trees",
        front: "What grows on a Lantern Cedar in early spring?",
        back: "Small amber cones that glow after rain.",
      },
      {
        deckName: "Field Notes::Trees",
        front: "What scent does River Mint Oak release?",
        back: "A cool mint smell when the leaves are crushed.",
      },
    ],
  }),
  createSampleDeck({
    id: "sample:moon-motel",
    name: "Moon Motel Trivia",
    description: "A playful Q&A deck with fictional roadside-space facts.",
    decks: {
      "201": { id: 201, name: "Moon Motel Trivia" },
    },
    cards: [
      {
        deckName: "Moon Motel Trivia",
        front: "What is the Moon Motel's checkout time?",
        back: "11:11 AM local crater time.",
      },
      {
        deckName: "Moon Motel Trivia",
        front: "Which snack is complimentary in the lobby?",
        back: "Freeze-dried peach rings.",
      },
      {
        deckName: "Moon Motel Trivia",
        front: "What powers the neon vacancy sign?",
        back: "A solar panel shaped like a crescent moon.",
      },
      {
        deckName: "Moon Motel Trivia",
        front: "What is room 7 famous for?",
        back: "Its ceiling projector maps every visible constellation.",
      },
    ],
  }),
];

export const sampleDeckMap = new Map(sampleDecks.map((deck) => [deck.id, deck] as const));

/** All sample decks merged into a single AnkiData, used as the default collection when no sync is configured. */
export const mergedSampleDeckData = {
  files: new Map(),
  cards: sampleDecks.flatMap((d) => [...d.data.cards]),
  deckName: "Sample Decks",
  decks: Object.fromEntries(sampleDecks.flatMap((d) => Object.entries(d.data.decks))),
  notesTypes: [],
  collectionCreationTime: 0,
  deckConfigs: {},
  colConf: null,
} as AnkiData;
