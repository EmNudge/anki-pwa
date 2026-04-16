import { describe, it, expect } from "vitest";
import { isZstdCompressed, stringHash } from "../constants";

describe("isZstdCompressed", () => {
  it("detects zstd magic bytes", () => {
    const bytes = new Uint8Array([0x28, 0xb5, 0x2f, 0xfd, 0x00, 0x01]);
    expect(isZstdCompressed(bytes)).toBe(true);
  });

  it("returns false for non-zstd data", () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]); // ZIP magic
    expect(isZstdCompressed(bytes)).toBe(false);
  });

  it("returns false for too-short data", () => {
    const bytes = new Uint8Array([0x28, 0xb5, 0x2f]);
    expect(isZstdCompressed(bytes)).toBe(false);
  });

  it("returns false for empty data", () => {
    expect(isZstdCompressed(new Uint8Array([]))).toBe(false);
  });
});

describe("stringHash", () => {
  it("returns a number for any string", () => {
    expect(typeof stringHash("hello")).toBe("number");
  });

  it("returns same hash for same input", () => {
    expect(stringHash("test")).toBe(stringHash("test"));
  });

  it("returns different hashes for different inputs", () => {
    expect(stringHash("abc")).not.toBe(stringHash("def"));
  });

  it("handles empty string", () => {
    expect(typeof stringHash("")).toBe("number");
  });

  it("handles unicode", () => {
    const hash = stringHash("日本語テスト");
    expect(typeof hash).toBe("number");
    expect(hash).toBeGreaterThanOrEqual(0);
  });

  it("returns unsigned 32-bit integer", () => {
    const hash = stringHash("some random string");
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThanOrEqual(0xffffffff);
  });
});
