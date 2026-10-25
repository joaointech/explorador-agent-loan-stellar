// Attributes card draws to notes for the registry. `CardDraw` events carry the
// agent and `from_credit` but not the line, so this replays the contract's
// allocation rule (spec §5.4: lines open at the time, earliest escritura day
// first, each up to its credit limit). Caps use principal only (interest
// would shrink them slightly), so splits across two lines are approximate;
// callers prefer exact on-chain figures where they exist.

export interface Position {
  ledger: number;
  eventIdx: number;
}

export interface LineWindow {
  noteId: number;
  escrituraDay: number;
  creditLimit: bigint;
  opened: Position;
  closed: Position | null;
}

export interface DrawEvent {
  at: Position;
  fromCredit: bigint;
}

const before = (a: Position, b: Position) => a.ledger < b.ledger || (a.ledger === b.ledger && a.eventIdx < b.eventIdx);

/** Lines open when the draw happened (opened before it; not yet closed). Same-ledger close counts as still open. */
function openAt(lines: LineWindow[], at: Position): LineWindow[] {
  return lines.filter((l) => !before(at, l.opened) && (l.closed === null || l.closed.ledger >= at.ledger));
}

/** For each draw (same order as `draws`), the stroops attributed to each note id. */
export function attributeDraws(lines: LineWindow[], draws: DrawEvent[]): Map<number, bigint>[] {
  const used = new Map<number, bigint>();
  return draws.map((draw) => {
    const out = new Map<number, bigint>();
    if (draw.fromCredit <= 0n) return out;
    const candidates = openAt(lines, draw.at).sort((a, b) => a.escrituraDay - b.escrituraDay || a.noteId - b.noteId);
    let remaining = draw.fromCredit;
    for (const line of candidates) {
      const room = line.creditLimit - (used.get(line.noteId) ?? 0n);
      const take = room > 0n ? (remaining < room ? remaining : room) : 0n;
      if (take > 0n) {
        out.set(line.noteId, (out.get(line.noteId) ?? 0n) + take);
        used.set(line.noteId, (used.get(line.noteId) ?? 0n) + take);
        remaining -= take;
      }
      if (remaining === 0n) break;
    }
    if (remaining > 0n && candidates.length > 0) {
      const last = candidates[candidates.length - 1].noteId;
      out.set(last, (out.get(last) ?? 0n) + remaining);
      used.set(last, (used.get(last) ?? 0n) + remaining);
    }
    return out;
  });
}
