/**
 * Zstandard decompression for Node.js CLI context
 */

import initWasm, { decompress } from '@dweb-browser/zstd-wasm';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

declare module '@dweb-browser/zstd-wasm' {
  export function decompress(data: Uint8Array): Uint8Array;
  export default function initWasm(wasmBinary: BufferSource): Promise<void>;
}

let wasmInitialized = false;

export async function decompressZstd(data: Uint8Array): Promise<Uint8Array> {
  if (!wasmInitialized) {
    // In Node.js, we need to load the WASM file from node_modules
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const wasmPath = join(
      __dirname,
      '../../node_modules/@dweb-browser/zstd-wasm/zstd_wasm_bg.wasm'
    );

    const wasmBinary = new Uint8Array(readFileSync(wasmPath));
    await initWasm(wasmBinary);
    wasmInitialized = true;
  }

  return decompress(data);
}
