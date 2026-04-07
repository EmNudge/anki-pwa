import { mediaMappingSchema } from "./anki2/jsonParsers";
import { parseMediaProto } from "./parseMediaProto";
import { isZstdCompressed } from "~/utils/constants";

type ZstdDecompressor = (data: Uint8Array) => Promise<Uint8Array>;

type DecodedBytes = {
  bytes: Uint8Array;
  text: string;
};

async function decodeMaybeZstd(
  bytes: Uint8Array,
  decompressZstd: ZstdDecompressor,
): Promise<DecodedBytes> {
  try {
    const decompressedBytes = await decompressZstd(bytes);
    return {
      bytes: decompressedBytes,
      text: new TextDecoder().decode(decompressedBytes),
    };
  } catch {
    return {
      bytes,
      text: new TextDecoder().decode(bytes),
    };
  }
}

export async function parseMediaMapping(
  bytes: Uint8Array,
  decompressZstd: ZstdDecompressor,
): Promise<Record<string, string>> {
  const decodedMedia = await decodeMaybeZstd(bytes, decompressZstd);

  try {
    return mediaMappingSchema.parse(JSON.parse(decodedMedia.text));
  } catch {
    return parseMediaProto(decodedMedia.bytes);
  }
}

export async function decompressMediaFile(
  bytes: Uint8Array,
  decompressZstd: ZstdDecompressor,
): Promise<Uint8Array> {
  if (!isZstdCompressed(bytes)) {
    return bytes;
  }

  try {
    return await decompressZstd(bytes);
  } catch {
    return bytes;
  }
}
