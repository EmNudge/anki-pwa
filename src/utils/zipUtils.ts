import type { Entry } from "@zip-js/zip-js";

/**
 * Type guard to check if a zip Entry has getData (i.e. is a file, not a directory).
 */
export function isFileEntry(entry: Entry): entry is Entry & { getData: NonNullable<Entry["getData"]> } {
  return !entry.directory && typeof entry.getData === "function";
}
