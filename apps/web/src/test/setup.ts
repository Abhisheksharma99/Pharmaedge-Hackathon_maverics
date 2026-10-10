import '@testing-library/jest-dom/vitest'

// Hide/show choices (useCollapsed) and other per-browser settings must not leak from one test into the next.
afterEach(() => localStorage.clear())

// jsdom has no ResizeObserver; Radix poppers (tooltips, popovers) measure with it when they open.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// jsdom has no scrollIntoView; cmdk (⌘K palette) scrolls the highlighted row into view.
Element.prototype.scrollIntoView ??= function scrollIntoView() {}
