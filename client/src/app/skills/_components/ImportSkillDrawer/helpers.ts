import { BASE64_CHUNK_BYTES, MARKDOWN_EXTENSIONS } from "./constants";

/** True when the picked file should be sent as text rather than base64. */
export function isMarkdownFile(filename: string): boolean {
  const lower = filename.toLowerCase();
  return MARKDOWN_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * Base64-encode an ArrayBuffer.
 *
 * Chunked deliberately: `String.fromCharCode(...bytes)` spreads every byte as
 * an argument, and a few hundred KB of zip blows the JS argument limit with a
 * `RangeError` — the naive one-liner works in tests and fails on real archives.
 */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode(...bytes.subarray(i, i + BASE64_CHUNK_BYTES));
  }
  return btoa(binary);
}

/** Read a picked file into the shape POST /skills/import/preview expects. */
export async function readUpload(
  file: File,
): Promise<{ filename: string; content?: string; content_base64?: string }> {
  if (isMarkdownFile(file.name)) {
    return { filename: file.name, content: await file.text() };
  }
  return { filename: file.name, content_base64: toBase64(await file.arrayBuffer()) };
}
