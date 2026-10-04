import { describe, expect, it } from 'vitest';
import { createBoard, mergeBoards, mergeById, mergeSnapshots, type ImageItem, type Snapshot } from '../src';

const img = (id: string, extra: Partial<ImageItem> = {}): ImageItem => ({
  id,
  kind: 'image',
  asset: `assets/${id}.png`,
  srcW: 100,
  srcH: 100,
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 0,
  addedBy: 'user',
  createdAt: '2026-01-01T00:00:00.000Z',
  ...extra,
});

const snap = (...items: ImageItem[]): Snapshot => ({ items, zones: [] });

describe('mergeById', () => {
  it('keeps additions from both sides', () => {
    const out = mergeById([], [img('a')], [img('b')]);
    expect(out.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('merges non-conflicting field edits', () => {
    const base = [img('a')];
    const ours = [img('a', { x: 50 })]; // user moved it
    const theirs = [img('a', { caption: 'red car' })]; // an agent captioned it
    expect(mergeById(base, ours, theirs)).toEqual([img('a', { x: 50, caption: 'red car' })]);
  });

  it('lets ours win when the same field changed on both sides', () => {
    const out = mergeById([img('a')], [img('a', { x: 1 })], [img('a', { x: 2 })]);
    expect(out[0]!.x).toBe(1);
  });

  it('deletion wins over a concurrent edit', () => {
    expect(mergeById([img('a')], [], [img('a', { caption: 'late caption' })])).toEqual([]);
    expect(mergeById([img('a')], [img('a', { x: 9 })], [])).toEqual([]);
  });

  it('removes a field that one side deleted', () => {
    const out = mergeById([img('a', { note: 'old' })], [img('a')], [img('a', { note: 'old' })]);
    expect(out[0]).not.toHaveProperty('note');
  });
});

describe('mergeBoards', () => {
  it('keeps a local rename while taking the newer items from disk', () => {
    const base = { ...createBoard(), title: 'Old' };
    const ours = { ...base, title: 'New name' };
    const theirs = { ...base, rev: 5, items: [img('from-agent')] };
    const merged = mergeBoards(base, ours, theirs);
    expect(merged).toMatchObject({ title: 'New name', rev: 5 });
    expect(merged.items.map((i) => i.id)).toEqual(['from-agent']);
  });
});

describe('undo via mergeSnapshots(after, before, current)', () => {
  it('undoing an add removes only that item, keeping things an agent added since', () => {
    const before = snap(img('a'));
    const after = snap(img('a'), img('b'));
    const current = snap(img('a'), img('b'), img('agent1', { addedBy: 'agent', agent: 'Cursor' }));
    const undone = mergeSnapshots(after, before, current);
    expect(undone.items.map((i) => i.id)).toEqual(['a', 'agent1']);
  });

  it('undoing a delete restores the item', () => {
    const before = snap(img('a'), img('b'));
    const after = snap(img('a'));
    const undone = mergeSnapshots(after, before, after);
    expect(undone.items.map((i) => i.id).sort()).toEqual(['a', 'b']);
  });

  it('undoing a move keeps a caption written afterwards', () => {
    const before = snap(img('a', { x: 0 }));
    const after = snap(img('a', { x: 300 }));
    const current = snap(img('a', { x: 300, caption: 'neon street' }));
    const undone = mergeSnapshots(after, before, current);
    expect(undone.items[0]).toMatchObject({ x: 0, caption: 'neon street' });
  });
});
