import { describe, expect, it } from 'vitest';
import { sniffImage } from '../src';

const bytes = (...parts: (string | number[])[]) =>
  Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));

describe('sniffImage', () => {
  it('recognizes supported formats by magic bytes', () => {
    expect(sniffImage(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpeg');
    expect(sniffImage(bytes('GIF89a'))).toBe('gif');
    expect(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))).toBe('webp');
  });

  it('rejects everything else no matter what it is named', () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)">'))).toBeNull();
    expect(sniffImage(bytes('<!doctype html><script>'))).toBeNull();
    expect(sniffImage(bytes('II*', [0]))).toBeNull(); // TIFF
    expect(sniffImage(bytes('MZ', [0x90, 0]))).toBeNull(); // Windows executable
    expect(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});
