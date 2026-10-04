type Child = Node | string | null | undefined | false;

interface Props {
  class?: string;
  style?: string;
  text?: string;
  title?: string;
  data?: Record<string, string>;
  attrs?: Record<string, string>;
}

/** Tiny element builder. Text always goes through textContent, never parsed as HTML. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.style) el.style.cssText = props.style;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.title) el.title = props.title;
  if (props.data) for (const [k, v] of Object.entries(props.data)) el.dataset[k] = v;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  for (const c of children) if (c) el.append(c);
  return el;
}

export function kbd(keys: string): HTMLElement {
  return h('kbd', { text: keys });
}
