import { Database } from "sql.js";
import { executeQueryAll } from "~/utils/sql";
import protobuf from "protobufjs";
import notesTypeProto from "./notestype.proto?raw";
import templatesProto from "./templates.proto?raw";
import fieldConfigProto from "./field.proto?raw";
import deckCommonProto from "./deck.proto?raw";
import deckConfigProto from "./deck_config.proto?raw";

// Cache parsed proto roots to avoid re-parsing on every call
const protoCache = new Map<string, protobuf.Root>();
function getProtoRoot(name: string, source: string): protobuf.Root {
  let root = protoCache.get(name);
  if (!root) {
    root = protobuf.parse(source).root;
    protoCache.set(name, root);
  }
  return root;
}

export function getNotesType(db: Database) {
  /**
   * Maps an id to a css block and a latex pre/post note
   */
  const notesTypes = (() => {
    const notesTypes = executeQueryAll<{
      id: number;
      name: string;
      config: Uint8Array;
    }>(db, "SELECT cast(id as text) as id, name, config FROM notetypes");

    return notesTypes.map((notesType) => ({
      id: String(notesType.id),
      name: notesType.name,
      ...parseNotesTypeConfigProto(notesType.config),
    }));
  })();

  return notesTypes;
}

type Anki21bNotesTypeConfig = {
  css: string;
  kind: number;
  latexPost: string;
  latexPre: string;
  latexSvg: boolean;
  originalId: number | null;
  originalStockKind: number;
  other: unknown[];
  reqs: { fieldOrds: number[]; kind: number }[];
  sortFieldIdx: number;
  targetDeckIdUnused: number;
};

function parseNotesTypeConfigProto(proto: Uint8Array): Anki21bNotesTypeConfig {
  const root = getProtoRoot("notestype", notesTypeProto);
  const NotesTypeConfig = root.lookupType("NotesTypeConfig");

  return NotesTypeConfig.toObject(NotesTypeConfig.decode(proto), {
    longs: String,
  }) as Anki21bNotesTypeConfig;
}

type Anki21bTemplate = {
  aFormat: string;
  id: number;
  qFormat: string;
  qFormatBrowser: string;
  aFormatBrowser: string;
  targetDeckId: number;
  browserFontName: string;
  browserFontSize: number;
};
export function parseTemplatesProto(proto: Uint8Array): Anki21bTemplate {
  const root = getProtoRoot("templates", templatesProto);
  const Template = root.lookupType("TemplateConfig");

  return Template.toObject(Template.decode(proto), {
    longs: String,
    defaults: true,
  }) as Anki21bTemplate;
}

type Anki21bFieldConfig = {
  sticky: boolean;
  rtl: boolean;
  fontName: string;
  fontSize: number;
  description: string;
  plainText: boolean;
  collapsed: boolean;
  excludeFromSearch: boolean;
  // used for merging notetypes on import (Anki 23.10)
  id?: number;
  // Can be used to uniquely identify required fields.
  tag?: number;
  preventDeletion: boolean;
  other: Uint8Array;
};
export function parseFieldConfigProto(proto: Uint8Array): Anki21bFieldConfig {
  const root = getProtoRoot("field", fieldConfigProto);
  const FieldConfig = root.lookupType("FieldConfig");

  // protobufjs decode returns IMessage which doesn't match our typed interface,
  // but the runtime shape is correct for these known proto definitions
  return FieldConfig.decode(proto) as unknown as Anki21bFieldConfig;
}

export type Anki21bDeckCommon = {
  studyCollapsed: boolean;
  browserCollapsed: boolean;
  lastDayStudied: number;
  newStudied: number;
  reviewStudied: number;
  millisecondsStudied: number;
  learningStudied: number;
  configId: number;
};

export function parseDeckCommonProto(proto: Uint8Array): Anki21bDeckCommon {
  const root = getProtoRoot("deck", deckCommonProto);
  const DeckCommon = root.lookupType("DeckCommon");

  return DeckCommon.toObject(DeckCommon.decode(proto), {
    longs: Number,
    defaults: true,
  }) as Anki21bDeckCommon;
}

export type Anki21bDeckConfig = {
  learnSteps: number[];
  relearnSteps: number[];
  fsrsParams4: number[];
  fsrsParams5: number[];
  easyDaysPercentages: number[];
  newPerDay: number;
  reviewsPerDay: number;
  newPerDayMinimum: number;
  initialEase: number;
  easyMultiplier: number;
  hardMultiplier: number;
  lapseMultiplier: number;
  intervalMultiplier: number;
  maximumReviewInterval: number;
  minimumLapseInterval: number;
  graduatingIntervalGood: number;
  graduatingIntervalEasy: number;
  newCardInsertOrder: number;
  newCardGatherPriority: number;
  newCardSortOrder: number;
  newMix: number;
  reviewOrder: number;
  interdayLearningMix: number;
  leechAction: number;
  leechThreshold: number;
  disableAutoplay: boolean;
  capAnswerTimeToSecs: number;
  showTimer: boolean;
  stopTimerOnAnswer: boolean;
  secondsToShowQuestion: number;
  secondsToShowAnswer: number;
  questionAction: number;
  answerAction: number;
  waitForAudio: boolean;
  skipQuestionWhenReplayingAnswer: boolean;
  buryNew: boolean;
  buryReviews: boolean;
  buryInterdayLearning: boolean;
  desiredRetention: number;
  ignoreRevlogsBeforeDate: string;
  historicalRetention: number;
  paramSearch: string;
};

export function parseDeckConfigProto(proto: Uint8Array): Anki21bDeckConfig {
  const root = getProtoRoot("deck_config", deckConfigProto);
  const ConfigInDeckConfig = root.lookupType("ConfigInDeckConfig");

  return ConfigInDeckConfig.toObject(ConfigInDeckConfig.decode(proto), {
    longs: Number,
    defaults: true,
  }) as Anki21bDeckConfig;
}
