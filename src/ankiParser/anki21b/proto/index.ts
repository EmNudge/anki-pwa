import { Database } from "sql.js";
import { executeQueryAll } from "~/utils/sql";
import protobuf from "protobufjs";
import notesTypeProto from "./notestype.proto?raw";
import templatesProto from "./templates.proto?raw";
import fieldConfigProto from "./field.proto?raw";

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
  const { root } = protobuf.parse(notesTypeProto);
  const NotesTypeConfig = root.lookupType("NotesTypeConfig");

  return NotesTypeConfig.toObject(NotesTypeConfig.decode(proto), {
    longs: String,
  }) as Anki21bNotesTypeConfig;
}

type Anki21bTemplate = {
  aFormat: string;
  id: number;
  qFormat: string;
};
export function parseTemplatesProto(proto: Uint8Array): Anki21bTemplate {
  const { root } = protobuf.parse(templatesProto);
  const Template = root.lookupType("TemplateConfig");

  return Template.toObject(Template.decode(proto), {
    longs: String,
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
  const { root } = protobuf.parse(fieldConfigProto);
  const FieldConfig = root.lookupType("FieldConfig");

  // protobufjs decode returns IMessage which doesn't match our typed interface,
  // but the runtime shape is correct for these known proto definitions
  return FieldConfig.decode(proto) as unknown as Anki21bFieldConfig;
}
