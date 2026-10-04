import type { Board, Item, Zone } from './types';

/**
 * Three-way merge used when two writers (the app and an agent) touch the board at
 * once, and to implement undo/redo without clobbering changes made in between.
 *
 * Per entity (by id):
 *   - added on either side: kept
 *   - deleted on either side: deleted (deletion wins over edits)
 *   - edited on both sides: merged field by field; if the same field changed on
 *     both sides, `ours` wins
 */
export function mergeById<T extends { id: string }>(base: readonly T[], ours: readonly T[], theirs: readonly T[]): T[] {
  const baseMap = new Map(base.map((e) => [e.id, e]));
  const oursMap = new Map(ours.map((e) => [e.id, e]));
  const theirsMap = new Map(theirs.map((e) => [e.id, e]));
  const out: T[] = [];

  const consider = (id: string) => {
    const b = baseMap.get(id);
    const o = oursMap.get(id);
    const t = theirsMap.get(id);
    if (b) {
      if (!o || !t) return; // deleted on at least one side
      out.push(mergeFields(b, o, t));
    } else if (o && t) {
      out.push(mergeFields({} as T, o, t));
    } else if (o || t) {
      out.push((o ?? t)!);
    }
  };

  const done = new Set<string>();
  for (const e of [...ours, ...theirs]) {
    if (done.has(e.id)) continue;
    done.add(e.id);
    consider(e.id);
  }
  return out;
}

function mergeFields<T extends object>(base: T, ours: T, theirs: T): T {
  const keys = new Set([...Object.keys(base), ...Object.keys(ours), ...Object.keys(theirs)]) as Set<keyof T>;
  const out = {} as T;
  for (const k of keys) {
    const b = base[k];
    const o = ours[k];
    const t = theirs[k];
    const v = same(o, b) ? t : o;
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface Snapshot {
  items: Item[];
  zones: Zone[];
}

export function mergeSnapshots(base: Snapshot, ours: Snapshot, theirs: Snapshot): Snapshot {
  return {
    items: mergeById(base.items, ours.items, theirs.items),
    zones: mergeById(base.zones, ours.zones, theirs.zones),
  };
}

/** Merge whole boards; revision metadata comes from `theirs` (the copy on disk). */
export function mergeBoards(base: Board, ours: Board, theirs: Board): Board {
  const merged: Board = { ...theirs, ...mergeSnapshots(base, ours, theirs) };
  const title = same(ours.title, base.title) ? theirs.title : ours.title;
  if (title === undefined) delete merged.title;
  else merged.title = title;
  return merged;
}

export function sameContent(a: Snapshot, b: Snapshot): boolean {
  return JSON.stringify(a.items) === JSON.stringify(b.items) && JSON.stringify(a.zones) === JSON.stringify(b.zones);
}
