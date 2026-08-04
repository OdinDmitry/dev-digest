import { unzipSync } from 'fflate';
import type { SkillImportPreview, SkillImportSkipped, SkillType } from '@devdigest/shared';
import { SkillType as SkillTypeSchema } from '@devdigest/shared';
import { ValidationError } from '../../platform/errors.js';
import {
  CORE_FILENAME,
  EXECUTABLE_DIRS,
  EXECUTABLE_EXTS,
  IMPORTED_SKILL_SOURCE,
  MARKDOWN_EXTS,
  MAX_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_TOTAL_BYTES,
  TEXT_EXTS,
} from './constants.js';
import { firstLine, inferType, normalizeName } from './helpers.js';

/**
 * Skill import parsing — markdown file or zip archive → a preview the user
 * confirms before anything is written.
 *
 * Pure: no database, no filesystem, no network. `fflate` is an in-process codec
 * (like `zod`), not an external system, so it is imported directly rather than
 * hidden behind an `adapters/` port — there is no second implementation to swap
 * and nothing to mock.
 *
 * Security posture: the archive is untrusted input. Executable members are
 * matched on the central directory and refused BEFORE decompression, so their
 * bytes are never inflated, never parsed, and never stored — only their paths
 * are reported so the preview can show what was left out. Nothing is written to
 * disk at any point, so zip-slip is not reachable.
 */

export interface SkillUpload {
  /** Original filename — decides md-vs-zip and is the last-resort name source. */
  filename: string;
  bytes: Uint8Array;
}

/** Local PK\x03\x04 / empty-archive PK\x05\x06 signature. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06)
  );
}

function extensionOf(path: string): string {
  const base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot).toLowerCase();
}

function stemOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot === -1 ? base : base.slice(0, dot);
}

/** Why (if at all) we refuse to read an archive member, judged on its path alone. */
function skipReason(path: string): SkillImportSkipped['reason'] | undefined {
  const segments = path.split('/');
  if (segments.some((seg) => EXECUTABLE_DIRS.includes(seg.toLowerCase()))) return 'executable';
  if (EXECUTABLE_EXTS.includes(extensionOf(path))) return 'executable';
  if (!TEXT_EXTS.includes(extensionOf(path))) return 'unsupported';
  return undefined;
}

/** Members we drop without telling the user — archive noise, not content. */
function isNoise(path: string): boolean {
  if (path.endsWith('/')) return true; // directory entry
  if (path.startsWith('__MACOSX/') || path.includes('/__MACOSX/')) return true;
  const base = path.slice(path.lastIndexOf('/') + 1);
  return base.startsWith('.') || base.length === 0;
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  if (bytes.includes(0)) {
    throw new ValidationError(`"${path}" is not text (contains NUL bytes)`, { path });
  }
  const text = new TextDecoder('utf-8').decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // strip BOM
}

/**
 * Frontmatter is parsed as flat `key: value` lines only — deliberately NOT with
 * a YAML library. A real YAML parser is a second attack surface (anchors, tags,
 * aliases) on a file we have just declared untrusted, and skill frontmatter has
 * no need for nesting.
 */
interface Frontmatter {
  fields: Record<string, string>;
  rest: string;
}

function splitFrontmatter(text: string): Frontmatter {
  const normalized = text.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) return { fields: {}, rest: normalized };
  const end = normalized.indexOf('\n---', 3);
  if (end === -1) return { fields: {}, rest: normalized };

  const block = normalized.slice(4, end);
  const rest = normalized.slice(normalized.indexOf('\n', end + 1) + 1);
  const fields: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(line.trim());
    if (!match) continue;
    let value = match[2]!.trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    fields[match[1]!.toLowerCase()] = value;
  }
  return { fields, rest };
}

/** First paragraph that isn't a heading — the fallback skill description. */
function firstParagraph(text: string): string {
  for (const block of text.split(/\n\s*\n/)) {
    const line = firstLine(block);
    if (line.length > 0 && !line.startsWith('#')) return line;
  }
  return '';
}

/** First `# Heading` in the body, if any. */
function firstHeading(text: string): string {
  for (const line of text.split('\n')) {
    const match = /^#{1,6}\s+(.*)$/.exec(line.trim());
    if (match) return match[1]!.trim();
  }
  return '';
}

/** Build the preview from one markdown body + whatever context the archive gave. */
function toPreview(args: {
  markdown: string;
  fallbackName: string;
  entryPath: string | null;
  evidenceFiles: string[];
  skipped: SkillImportSkipped[];
}): SkillImportPreview {
  const { fields, rest } = splitFrontmatter(args.markdown);
  const body = rest.trim();
  if (body.length === 0) {
    throw new ValidationError('The uploaded skill has an empty body');
  }

  const name = normalizeName(fields.name || firstHeading(body) || args.fallbackName) || 'imported-skill';
  const description = fields.description || firstParagraph(body) || firstLine(body);

  const declared = SkillTypeSchema.safeParse(fields.type);
  const type: SkillType = declared.success ? declared.data : inferType(name, body);

  return {
    name,
    description,
    type,
    source: IMPORTED_SKILL_SOURCE,
    body,
    entry_path: args.entryPath,
    evidence_files: args.evidenceFiles,
    skipped: args.skipped,
  };
}

/**
 * Pick the archive member that supplies the body: a `SKILL.md` at the shallowest
 * depth, else the lexicographically first markdown file. Deterministic so the
 * same archive always previews identically.
 */
function pickCore(paths: string[]): string | undefined {
  const markdown = paths
    .filter((p) => MARKDOWN_EXTS.includes(extensionOf(p)))
    .sort((a, b) => a.localeCompare(b));
  if (markdown.length === 0) return undefined;

  const cores = markdown
    .filter((p) => p.slice(p.lastIndexOf('/') + 1).toLowerCase() === CORE_FILENAME)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  return cores[0] ?? markdown[0];
}

function parseArchive(upload: SkillUpload): SkillImportPreview {
  const skipped: SkillImportSkipped[] = [];
  let seen = 0;

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(upload.bytes, {
      // Runs against the central directory BEFORE inflation, which is exactly
      // where the executable decision belongs: returning false means those bytes
      // are never decompressed at all.
      filter: (file) => {
        if (isNoise(file.name)) return false;
        if (++seen > MAX_ENTRIES) return false;

        const reason = skipReason(file.name);
        if (reason) {
          skipped.push({ path: file.name, reason });
          return false;
        }
        if (file.originalSize > MAX_ENTRY_BYTES) {
          skipped.push({ path: file.name, reason: 'too_large' });
          return false;
        }
        return true;
      },
    });
  } catch (err) {
    throw new ValidationError(`Could not read the archive: ${(err as Error).message}`);
  }

  // The header size the filter trusted is attacker-controlled, so re-check the
  // bytes we actually got and keep a running total across members.
  const kept: Record<string, Uint8Array> = {};
  let total = 0;
  for (const [path, bytes] of Object.entries(entries)) {
    if (bytes.length > MAX_ENTRY_BYTES || total + bytes.length > MAX_TOTAL_BYTES) {
      skipped.push({ path, reason: 'too_large' });
      continue;
    }
    total += bytes.length;
    kept[path] = bytes;
  }

  const core = pickCore(Object.keys(kept));
  if (!core) {
    throw new ValidationError(
      'No markdown file found in the archive — a skill needs a SKILL.md or another .md file',
      { skipped },
    );
  }

  // "SKILL.md" is a container name, not a skill name — fall back to the archive's
  // own filename in that case, and to the member's filename otherwise.
  const coreBase = core.slice(core.lastIndexOf('/') + 1);
  const isGenericCore = coreBase.toLowerCase() === CORE_FILENAME;

  return toPreview({
    markdown: decodeUtf8(kept[core]!, core),
    fallbackName: stemOf(isGenericCore ? upload.filename : core),
    entryPath: core,
    // Paths only — the other markdown files are context for the user, not content
    // we silently fold into the prompt.
    evidenceFiles: Object.keys(kept)
      .filter((p) => p !== core && MARKDOWN_EXTS.includes(extensionOf(p)))
      .sort((a, b) => a.localeCompare(b)),
    skipped,
  });
}

/** Parse an uploaded skill (.md or .zip) into a preview. Persists nothing. */
export function parseSkillUpload(upload: SkillUpload): SkillImportPreview {
  if (upload.bytes.length === 0) {
    throw new ValidationError('The uploaded file is empty');
  }
  if (looksLikeZip(upload.bytes)) return parseArchive(upload);

  const ext = extensionOf(upload.filename);
  if (ext && !TEXT_EXTS.includes(ext)) {
    throw new ValidationError(
      `Unsupported file type "${ext}" — upload a .md file or a .zip archive`,
    );
  }

  return toPreview({
    markdown: decodeUtf8(upload.bytes, upload.filename),
    fallbackName: stemOf(upload.filename),
    entryPath: null,
    evidenceFiles: [],
    skipped: [],
  });
}
