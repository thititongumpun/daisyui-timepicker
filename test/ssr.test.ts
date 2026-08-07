// @vitest-environment node
/**
 * The module must be importable with no DOM globals at all — a Next.js server
 * component, a Node script, SSG. It once was not: `class X extends HTMLElement`
 * evaluates its extends clause at module *parse* time, so it threw
 * `ReferenceError: HTMLElement is not defined` on plain import, before the
 * `typeof customElements` registration guard could ever run.
 *
 * Every other test file runs under jsdom, where `HTMLElement` exists and this
 * failure is invisible — hence the docblock above, and hence the first test,
 * which asserts the environment really is DOM-free. Without it this file would
 * pass for the wrong reason the moment the docblock is dropped or vitest starts
 * leaking globals between environments.
 */
import { describe, it, expect } from 'vitest'

describe('SSR safety', () => {
  it('runs in a genuinely DOM-free environment', () => {
    expect(typeof HTMLElement).toBe('undefined')
    expect(typeof customElements).toBe('undefined')
    expect(typeof document).toBe('undefined')
    expect(typeof window).toBe('undefined')
  })

  it('imports without throwing and exports the class', async () => {
    const mod = await import('../src/index.js')
    expect(typeof mod.DaisyTimePicker).toBe('function')
  })

  it('does not register the element when customElements is absent', async () => {
    await import('../src/index.js')
    expect(typeof customElements).toBe('undefined')
  })
})
