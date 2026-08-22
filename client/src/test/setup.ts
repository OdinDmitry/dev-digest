import "@testing-library/jest-dom/vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement scrollIntoView — stub it so components that call
// it (e.g. finding/run navigation targets) don't throw in tests. Tests that
// assert ON the call should still install their own vi.fn() spy per-case.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does not implement matchMedia — stub it so components that read
// `prefers-reduced-motion` (e.g. EvalsTab's progress indicator) don't throw.
// Reports "no preference" (matches: false) by default.
if (typeof window.matchMedia !== "function") {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}
