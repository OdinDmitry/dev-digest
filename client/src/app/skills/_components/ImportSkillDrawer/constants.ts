/** Extensions sent as plain text; anything else goes base64 (i.e. archives). */
export const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".txt"] as const;

/** What the file picker offers. The server re-checks; this is only a filter. */
export const UPLOAD_ACCEPT = ".md,.markdown,.zip";

/**
 * Bytes per `String.fromCharCode` call when base64-encoding. Well under the
 * engine's argument-count limit, which a whole archive would exceed.
 */
export const BASE64_CHUNK_BYTES = 8 * 1024;
