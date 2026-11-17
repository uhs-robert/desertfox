// A document and a window that record their listeners and let a test fire events, for code that watches input.

type Handler = (event: Event) => void;

export function fake_events() {
  const state = { hidden: false, keys: 0 };
  const table = { doc: new Map<string, Set<Handler>>(), win: new Map<string, Set<Handler>>() };
  const target = (side: "doc" | "win") => ({
    addEventListener: (type: string, handler: Handler) => void (table[side].get(type) ?? table[side].set(type, new Set()).get(type)!).add(handler),
    removeEventListener: (type: string, handler: Handler) => void table[side].get(type)?.delete(handler),
  });
  const fire = (side: "doc" | "win", type: string, props: object = {}, is_trusted = true) => {
    for (const handler of [...(table[side].get(type) ?? [])]) handler({ type, isTrusted: is_trusted, ...props } as Event);
  };
  return {
    doc: { ...target("doc"), get hidden() { return state.hidden; } } as unknown as Document,
    win: target("win") as unknown as Window,
    fire,
    // The content script's count of pressed keys, which a bound key raises although no listener of a bundle sees it.
    pressed_keys: () => state.keys,
    press: () => void state.keys++,
    hide: () => ((state.hidden = true), fire("doc", "visibilitychange")),
    show: () => ((state.hidden = false), fire("doc", "visibilitychange")),
    listeners: () => [...table.doc.values(), ...table.win.values()].reduce((sum, set) => sum + set.size, 0),
  };
}
