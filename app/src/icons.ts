// 16px line icons, inline so the app has no icon-font dependency. Corners are cut at 45°
// to match the app mark; `cut()` draws a rectangle with chamfered corners.
const cut = (x: number, y: number, w: number, h: number, c = 1) =>
  `<path d="M${x + c} ${y}h${w - 2 * c}l${c} ${c}v${h - 2 * c}l${-c} ${c}h${2 * c - w}l${-c} ${-c}v${2 * c - h}z"/>`;

const PATHS = {
  open: '<path d="M2 5.5 3.5 4h3L8 5.5h6v6.5l-1.5 1.5h-9L2 12z"/>',
  note: '<path d="M4.5 2.5h7L13 4v6.5l-3 3H4.5L3 12V4z"/><path d="M10 13.5v-3h3"/><path d="M5.5 6h5M5.5 8.5h3"/>',
  zone: '<path d="M2.5 5.5V4L4 2.5h1.5M10.5 2.5H12L13.5 4v1.5M13.5 10.5V12L12 13.5h-1.5M5.5 13.5H4L2.5 12v-1.5"/><path d="M7 2.5h2M7 13.5h2M2.5 7v2M13.5 7v2"/>',
  pin: '<path d="M8 2l1.8 3.7 4 .6-2.9 2.8.7 4L8 11.2 4.4 13.1l.7-4L2.2 6.3l4-.6z"/>',
  arrange: cut(2.5, 2.5, 5, 4) + cut(8.5, 2.5, 5, 4) + cut(2.5, 9.5, 3.5, 4) + cut(7, 9.5, 6.5, 4),
  fit: '<path d="M2.5 6V4L4 2.5h2M10 2.5h2L13.5 4v2M13.5 10v2L12 13.5h-2M6 13.5H4L2.5 12v-2"/>' + cut(5.5, 5.5, 5, 5),
  gray: '<circle cx="8" cy="8" r="5.5"/><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" stroke="none"/>',
  undo: '<path d="M5 4 2.5 6.5 5 9"/><path d="M2.5 6.5h8l2 2v3l-2 2H7"/>',
  redo: '<path d="M11 4l2.5 2.5L11 9"/><path d="M13.5 6.5h-8l-2 2v3l2 2H9"/>',
  flip: '<path d="M8 2v12" stroke-dasharray="1.5 1.5"/><path d="M6 4 2.5 12H6z"/><path d="M10 4l3.5 8H10z"/>',
  flipV: '<path d="M2 8h12" stroke-dasharray="1.5 1.5"/><path d="M4 6 12 2.5V6z"/><path d="M4 10l8 3.5V10z"/>',
  crop: '<path d="M4.5 1.5v10h10"/><path d="M1.5 4.5h10v10"/>',
  trash: '<path d="M3 4.5h10M6 4.5 7 3h2l1 1.5M4.5 4.5l.7 9h5.6l.7-9"/>',
  pushpin: '<path d="M10 2.2l3.8 3.8"/><path d="M11.9 4.1 8.6 7.4 5.6 7l-1.1 1.1 3.4 3.4L9 10.4l-.4-3"/><path d="M6.2 9.8 2.4 13.6"/>',
  gear: '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.3 1.3M11.2 11.2l1.3 1.3M3.5 12.5l1.3-1.3M11.2 4.8l1.3-1.3"/>',
  minimize: '<path d="M3.5 8.5h9"/>',
  maximize: '<rect x="3.5" y="3.5" width="9" height="9" rx=".5"/>',
  restore: '<rect x="3.5" y="5.5" width="7" height="7" rx=".5"/><path d="M5.5 5.5v-2h7v7h-2"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
} as const;

export type IconName = keyof typeof PATHS;

const parser = new DOMParser();

/** Builds an icon from the static path table above (never from user data). */
export function icon(name: IconName): SVGElement {
  const doc = parser.parseFromString(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`,
    'image/svg+xml',
  );
  return document.importNode(doc.documentElement, true) as unknown as SVGElement;
}
