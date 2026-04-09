import initWasm, { compress, decompress } from "@dweb-browser/zstd-wasm";
import zstd_wasm_url from "@dweb-browser/zstd-wasm/zstd_wasm_bg.wasm?url";

declare module "@dweb-browser/zstd-wasm" {
  export function compress(data: Uint8Array, level: number): Uint8Array;
  export function decompress(data: Uint8Array): Uint8Array;
  export default function initWasm(path: string): Promise<void>;
}

const wasmInit = initWasm(zstd_wasm_url);

export async function compressZstd(data: Uint8Array, level = 1): Promise<Uint8Array> {
  await wasmInit;
  return compress(data, level);
}

export async function decompressZstd(data: Uint8Array): Promise<Uint8Array> {
  await wasmInit;
  return decompress(data);
}
