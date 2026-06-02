/** format.ts — small display helpers for mono meta (timecodes, weights, indices). */

/** Seconds → `MM:SS.t` timecode for the mono readouts (DESIGN §3). */
export function timecode(seconds: number): string {
  const s = Math.max(0, seconds);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const tenths = Math.floor((s * 10) % 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
}

/** Bytes → human MB string, e.g. `3.10 MB`. */
export function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** A numeric MB value → `3.10 MB` (already-MB inputs from the API). */
export function mb(value: number): string {
  return `${value.toFixed(2)} MB`;
}

/** `frame_032` style index label from a 0-based frame number. */
export function frameLabel(index: number): string {
  return `frame_${String(index).padStart(3, '0')}`;
}

/**
 * Derive a kebab slug from a filename, matching the package id pattern
 * `^[a-z0-9-]{1,64}$` (API.md §7.3). Empty input yields a stable default.
 */
export function slugFromFilename(filename: string): string {
  const base = filename.replace(/\.[^.]+$/, '');
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'hero-loop';
}
