// Minimal dotenv-file editing for `pnpm keys:generate`: set keys in place,
// keep every other line (comments, ordering, untouched values) as it is.
// Values we write never contain spaces, quotes or `#`, so they are unquoted.

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

/** Value of a dotenv right-hand side: quoted values are unquoted, unquoted ones lose any ` # comment`. */
export function parseValue(raw: string): string {
  const v = raw.trim();
  const quote = v[0];
  if ((quote === '"' || quote === "'" || quote === "`") && v.length >= 2) {
    const end = v.indexOf(quote, 1);
    if (end > 0) return v.slice(1, end);
  }
  const hash = v.search(/\s#/);
  return (hash >= 0 ? v.slice(0, hash) : v.startsWith("#") ? "" : v).trim();
}

/** KEY → value for every assignment in the file (later lines win, like dotenv). */
export function parseEnvFile(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m) out.set(m[1], parseValue(m[2]));
  }
  return out;
}

export interface MergeResult {
  text: string;
  /** Keys written (new or replaced). */
  set: string[];
  /** Keys left alone because they already had a value (and `force` was off). */
  kept: string[];
}

/**
 * Sets `values` in a dotenv file. A key that already has a non-empty value is
 * kept unless `force`; an empty or missing key is filled. Replaced lines keep
 * their position (their inline comment is dropped); new keys are appended.
 */
export function mergeEnvFile(text: string, values: Record<string, string>, opts: { force?: boolean } = {}): MergeResult {
  const existing = parseEnvFile(text);
  const lines = text.length ? text.split(/\r?\n/) : [];
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  const set: string[] = [];
  const kept: string[] = [];
  const pending = new Map(Object.entries(values));

  for (const [key, value] of [...pending]) {
    const current = existing.get(key);
    if (current !== undefined && current !== "" && !opts.force) {
      kept.push(key);
      pending.delete(key);
      continue;
    }
    let replaced = false;
    for (let i = 0; i < lines.length; i++) {
      const m = LINE.exec(lines[i]);
      if (m && m[1] === key) {
        // Replace the first assignment and drop later duplicates.
        if (!replaced) {
          lines[i] = `${key}=${value}`;
          replaced = true;
        } else {
          lines.splice(i--, 1);
        }
      }
    }
    if (replaced) {
      set.push(key);
      pending.delete(key);
    }
  }
  if (pending.size) {
    if (lines.length && lines[lines.length - 1].trim() !== "") lines.push("");
    for (const [key, value] of pending) {
      lines.push(`${key}=${value}`);
      set.push(key);
    }
  }
  return { text: `${lines.join("\n")}\n`, set, kept };
}
