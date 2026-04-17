export const MS_PER_DAY = 86_400_000;

const ZSTD_MAGIC = [0x28, 0xb5, 0x2f, 0xfd] as const;

export function isZstdCompressed(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === ZSTD_MAGIC[0] &&
    bytes[1] === ZSTD_MAGIC[1] &&
    bytes[2] === ZSTD_MAGIC[2] &&
    bytes[3] === ZSTD_MAGIC[3]
  );
}

export const ANKI_DEFAULT_CSS = `.card {
  font-family: arial;
  font-size: 20px;
  text-align: center;
  color: black;
  background-color: white;
}`;

/** Compute Anki's sort field: strip HTML tags and trim (no sound removal). */
export function ankiSortField(html: string): string {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Compute Anki's field checksum (SHA-1 first 32 bits of the sort field). */
export function fieldChecksum(field: string): number {
  return stringHash(ankiSortField(field));
}

export function stringHash(input: string): number {
  // UTF-8 encode
  const encoder = new TextEncoder();
  const msg = encoder.encode(input);

  // Pre-processing: build padded buffer
  const bitLen = msg.length * 8;
  // message + 1 byte (0x80) + padding + 8 bytes length
  const totalBytes = msg.length + 1 + 8;
  const blocks = Math.ceil(totalBytes / 64);
  const buf = new Uint8Array(blocks * 64);
  buf.set(msg);
  buf[msg.length] = 0x80;
  // big-endian 64-bit bit-length at end (only lower 32 bits needed for reasonable inputs)
  const dv = new DataView(buf.buffer);
  dv.setUint32(buf.length - 4, bitLen, false);

  // Initial hash values
  let h0 = 0x67452301;
  let h1 = 0xefcdab89;
  let h2 = 0x98badcfe;
  let h3 = 0x10325476;
  let h4 = 0xc3d2e1f0;

  const w = new Int32Array(80);

  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = dv.getInt32(offset + i * 4, false);
    }
    for (let i = 16; i < 80; i++) {
      const x = w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!;
      w[i] = (x << 1) | (x >>> 31);
    }

    let a = h0,
      b = h1,
      c = h2,
      d = h3,
      e = h4;

    for (let i = 0; i < 80; i++) {
      let f: number, k: number;
      if (i < 20) {
        f = (b & c) | (~b & d);
        k = 0x5a827999;
      } else if (i < 40) {
        f = b ^ c ^ d;
        k = 0x6ed9eba1;
      } else if (i < 60) {
        f = (b & c) | (b & d) | (c & d);
        k = 0x8f1bbcdc;
      } else {
        f = b ^ c ^ d;
        k = 0xca62c1d6;
      }
      const temp = (((a << 5) | (a >>> 27)) + f + e + k + w[i]!) | 0;
      e = d;
      d = c;
      c = (b << 30) | (b >>> 2);
      b = a;
      a = temp;
    }

    h0 = (h0 + a) | 0;
    h1 = (h1 + b) | 0;
    h2 = (h2 + c) | 0;
    h3 = (h3 + d) | 0;
    h4 = (h4 + e) | 0;
  }

  return h0 >>> 0;
}
