import { describe, expect, it } from 'vitest';
import { createBoard, normalizeBoard, parseBoard, serializeBoard, slugify, zoneOf } from '../src';

describe('parseBoard', () => {
  it('round-trips a board', () => {
    const b = createBoard();
    b.items.push({ id: 'note_1', kind: 'note', text: 'flat, no shadows', x: 1, y: 2, w: 3, h: 4, z: 1, addedBy: 'user', createdAt: 'x' });
    expect(parseBoard(serializeBoard(b))).toEqual(b);
  });

  it('drops broken entries and duplicate ids instead of failing', () => {
    const b = normalizeBoard({
      rev: 4,
      items: [
        { id: 'img_1', kind: 'image', asset: 'assets/a.png', x: 0, y: 0, w: 10, h: 10 },
        { id: 'img_1', kind: 'image', asset: 'assets/dupe.png' },
        { id: 'img_2', kind: 'image' }, // no asset
        { kind: 'note', text: 'no id' },
        'garbage',
      ],
      zones: [{ id: 'zone_1', name: 'Palette', color: 'neon' }],
    });
    expect(b.rev).toBe(4);
    expect(b.items.map((i) => i.id)).toEqual(['img_1']);
    expect(b.zones[0]!.color).toBe('stone');
  });

  it('tidies agent names and ignores them on user items', () => {
    const hostile = 'Cursor' + String.fromCharCode(0, 10) + '<script>';
    const b = normalizeBoard({
      items: [
        { id: 'img_user', kind: 'image', asset: 'assets/a.png', addedBy: 'user', agent: 'Spoofed' },
        { id: 'img_new', kind: 'image', asset: 'assets/b.png', addedBy: 'agent', agent: hostile },
        { id: 'img_long', kind: 'image', asset: 'assets/c.png', addedBy: 'agent', agent: 'x'.repeat(100) },
      ],
    });
    expect(b.items[0]).not.toHaveProperty('agent');
    expect(b.items[1]!.agent).toBe('Cursorscript');
    expect(b.items[2]!.agent).toHaveLength(32);
  });

  it('throws on invalid JSON so a corrupt file is never overwritten', () => {
    expect(() => parseBoard('{not json')).toThrow();
  });
});

describe('image crop and flips', () => {
  it('keeps a valid crop, clamps a broken one, drops a whole-image one', () => {
    const img = (crop: unknown) => ({ id: `img_${Math.random()}`, kind: 'image', asset: 'assets/a.png', crop, flipY: true });
    const b = normalizeBoard({ items: [img({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 }), img({ x: 0.9, y: -3, w: 4, h: 0 }), img({ x: 0, y: 0, w: 1, h: 1 }), img('nonsense')] });
    const crops = b.items.map((i) => (i.kind === 'image' ? i.crop : null));
    expect(crops[0]).toEqual({ x: 0.1, y: 0.2, w: 0.5, h: 0.5 });
    expect(crops[1]).toEqual({ x: 0.9, y: 0, w: expect.closeTo(0.1, 5), h: 0.01 });
    expect(crops[2]).toBeUndefined();
    expect(crops[3]).toBeUndefined();
    expect(b.items[0]).toMatchObject({ flipY: true });
  });
});

describe('notes', () => {
  it('keeps a note scale within bounds and drops the default', () => {
    const b = normalizeBoard({
      items: [
        { id: 'note_a', kind: 'note', text: 'a', scale: 0.38 },
        { id: 'note_b', kind: 'note', text: 'b', scale: 1 },
        { id: 'note_c', kind: 'note', text: 'c', scale: 9999 },
      ],
    });
    expect(b.items.map((i) => (i.kind === 'note' ? i.scale : null))).toEqual([0.38, undefined, 10]);
  });
});

describe('titles and slugs', () => {
  it('keeps a trimmed title and drops empty ones', () => {
    expect(normalizeBoard({ title: '  Neon alley  ' }).title).toBe('Neon alley');
    expect(normalizeBoard({ title: '   ' })).not.toHaveProperty('title');
  });

  it('slugifies titles into safe folder names', () => {
    expect(slugify('Moody Neon Alley!')).toBe('moody-neon-alley');
    expect(slugify('Café   Ü-Bahn')).toBe('cafe-u-bahn');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
    expect(slugify('***')).toBe('board');
    expect(slugify('x'.repeat(100))).toHaveLength(40);
  });
});

describe('zoneOf', () => {
  it('picks the innermost zone containing the item center', () => {
    const b = createBoard();
    b.zones.push({ id: 'outer', name: 'All', x: 0, y: 0, w: 1000, h: 1000, color: 'stone' });
    b.zones.push({ id: 'inner', name: 'Palette', x: 100, y: 100, w: 200, h: 200, color: 'amber' });
    expect(zoneOf(b, { x: 150, y: 150, w: 50, h: 50 })?.id).toBe('inner');
    expect(zoneOf(b, { x: 600, y: 600, w: 50, h: 50 })?.id).toBe('outer');
    expect(zoneOf(b, { x: 2000, y: 0, w: 10, h: 10 })).toBeUndefined();
  });
});
