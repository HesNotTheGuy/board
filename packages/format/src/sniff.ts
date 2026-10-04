export type SniffedFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp';

const startsWith = (b: Uint8Array, sig: readonly number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/**
 * Identifies an image by its magic bytes, ignoring file names and MIME types.
 * Anything else (SVG, TIFF, HTML, executables...) returns null and must never
 * be handed to an image decoder.
 */
export function sniffImage(bytes: Uint8Array): SniffedFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(bytes, ascii('BM')) && bytes.length > 26) return 'bmp';
  return null;
}
