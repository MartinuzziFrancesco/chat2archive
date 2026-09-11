import { unzipSync } from "fflate";

export const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 1000;

export function checkInputSize(size: number): void {
  if (size > MAX_INPUT_BYTES) throw new Error("Input exceeds the 20 MB import limit.");
}

/** Inspect all ZIP entries before allocating decompressed buffers. */
export function unzipBounded(bytes: Uint8Array): Record<string, Uint8Array> {
  checkInputSize(bytes.byteLength);
  let total = 0;
  let entries = 0;
  const names = new Set<string>();
  unzipSync(bytes, { filter: file => {
    const path = file.name;
    if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path) || path.split("/").includes("..") || path.includes("\0") || path.split("/").includes(".") || ["__proto__", "constructor", "prototype"].includes(path)) {
      throw new Error(`Unsafe ZIP path: ${path}`);
    }
    if (names.has(path)) throw new Error(`Duplicate ZIP path: ${path}`);
    names.add(path);
    if (!Number.isSafeInteger(file.originalSize) || file.originalSize < 0 ||
        !Number.isSafeInteger(file.size) || file.size < 0 ||
        (file.compression === 0 && file.size !== file.originalSize)) {
      throw new Error(`Invalid ZIP entry size: ${path}`);
    }
    total += file.originalSize;
    entries++;
    if (total > MAX_EXPANDED_BYTES || entries > MAX_ZIP_ENTRIES) {
      throw new Error("ZIP exceeds the 100 MB expanded-size or 1000-entry import limit.");
    }
    return false;
  } });
  return unzipSync(bytes);
}
