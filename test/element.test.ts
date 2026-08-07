/**
 * <daisy-time-picker> element suite. Pure time logic lives in ./time.test.ts —
 * nothing here re-tests parse/format/inRange/step arithmetic.
 *
 * DELIBERATELY NOT COVERED HERE — jsdom cannot express any of it. These are the
 * demo page's job; naming them keeps someone from assuming they are green:
 *   - real FormData round-trip and native submit blocking. jsdom's
 *     ElementInternals has no setFormValue/setValidity (see the capability probe
 *     in "form association"), so the value never reaches a FormData and an
 *     invalid element never blocks a submit here.
 *   - <label for> click activation on a form-associated custom element. jsdom
 *     implements neither labelable custom elements nor label click forwarding;
 *     we can only assert the aria-labelledby mirror the element installs.
 *   - `.dropdown-close` actually producing `display: none`. jsdom has no CSS
 *     cascade and no layout, and daisyUI's stylesheet is not loaded — we assert
 *     the class contract, never visibility.
 *   - scrollTop centering. offsetTop/offsetHeight/clientHeight are all 0 under
 *     jsdom, so #scrollIntoView()'s arithmetic is unobservable.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { DaisyTimePicker } from '../src/index.js'

// ---- helpers ---------------------------------------------------------------

type ColKey = 'h' | 'm' | 'p'

/** 24h by default: the locale-derived default would make assertions machine-dependent. */
function mk(attrs: Record<string, string> = {}, connect = true): DaisyTimePicker {
  const el = document.createElement('daisy-time-picker')
  el.setAttribute('hour-cycle', '24')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  if (connect) document.body.appendChild(el)
  return el
}

const root = (el: Element): HTMLDivElement => el.querySelector('[data-dtp-root]') as HTMLDivElement
const trig = (el: Element): HTMLInputElement => el.querySelector('[data-dtp-trigger]') as HTMLInputElement
const col = (el: Element, k: ColKey): HTMLDivElement | null =>
  el.querySelector(`[data-dtp-col="${k}"]`) as HTMLDivElement | null
const opts = (el: Element, k: ColKey): HTMLDivElement[] =>
  Array.from((col(el, k) as HTMLDivElement).querySelectorAll('[role="option"]'))
const texts = (el: Element, k: ColKey): string[] => opts(el, k).map(o => o.textContent ?? '')

const click = (t: Element): boolean => t.dispatchEvent(new MouseEvent('click', { bubbles: true }))
const kd = (t: EventTarget, key: string, init: KeyboardEventInit = {}): boolean =>
  t.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }))

/** Records host-level input/change as `type:targetValue`, so a leaked inner event is visible. */
function record(el: DaisyTimePicker): { log: string[]; raw: Event[] } {
  const log: string[] = []
  const raw: Event[] = []
  const on = (e: Event): void => {
    raw.push(e)
    log.push(`${e.type}:${(e.target as DaisyTimePicker).value}`)
  }
  el.addEventListener('input', on)
  el.addEventListener('change', on)
  return { log, raw }
}

/** One keystroke: what the browser does before firing the inner input event. */
function type(el: DaisyTimePicker, raw: string): void {
  const t = trig(el)
  t.value = raw
  t.dispatchEvent(new Event('input', { bubbles: true }))
}

const isOpen = (el: Element): boolean =>
  root(el).classList.contains('dropdown-open') && !root(el).classList.contains('dropdown-close')
const isClosed = (el: Element): boolean =>
  root(el).classList.contains('dropdown-close') && !root(el).classList.contains('dropdown-open')

afterEach(() => {
  document.body.innerHTML = ''
})

// ---- module / definition ---------------------------------------------------

describe('module', () => {
  it('exports the class and registers the tag', () => {
    expect(DaisyTimePicker).toBeTypeOf('function')
    expect(customElements.get('daisy-time-picker')).toBe(DaisyTimePicker)
    expect(DaisyTimePicker.formAssociated).toBe(true)
  })

  it('observes every attribute it has an accessor for', () => {
    expect(DaisyTimePicker.observedAttributes).toEqual([
      'value',
      'hour-cycle',
      'min',
      'max',
      'step',
      'disabled',
      'required',
      'name',
      'placeholder',
      'label',
    ])
    // Attribute name -> property name. hour-cycle is the only non-identity pair,
    // and `defaultValue` is the property view of the `value` attribute.
    for (const p of ['value', 'defaultValue', 'hourCycle', 'min', 'max', 'step', 'disabled', 'required', 'name', 'placeholder', 'label']) {
      const d = Object.getOwnPropertyDescriptor(DaisyTimePicker.prototype, p)
      expect(d?.get, `${p} getter`).toBeTypeOf('function')
      expect(d?.set, `${p} setter`).toBeTypeOf('function')
    }
  })

  it('is light DOM', () => {
    expect(mk().shadowRoot).toBe(null)
  })

  it('SSR guard: evaluating the module with no customElements does not throw', async () => {
    const saved = globalThis.customElements
    Object.defineProperty(globalThis, 'customElements', { value: undefined, configurable: true, writable: true })
    expect(typeof globalThis.customElements).toBe('undefined')
    vi.resetModules()
    await expect(import('../src/index.js')).resolves.toBeTruthy()
    Object.defineProperty(globalThis, 'customElements', { value: saved, configurable: true, writable: true })

    // ...and re-evaluating while already defined must be a no-op, not NotSupportedError.
    vi.resetModules()
    await expect(import('../src/index.js')).resolves.toBeTruthy()
    // The statically imported class is still the registered one.
    expect(customElements.get('daisy-time-picker')).toBe(DaisyTimePicker)
    expect(mk()).toBeInstanceOf(DaisyTimePicker)
  })
})

// ---- property upgrade ------------------------------------------------------

describe('property upgrade', () => {
  it('hazard 1: property set after upgrade but before insertion survives', () => {
    const el = document.createElement('daisy-time-picker')
    el.setAttribute('hour-cycle', '24')
    el.value = '09:00:00'
    expect(el.value).toBe('09:00') // the setter ran: normalised immediately
    document.body.appendChild(el)
    expect(el.value).toBe('09:00')
    expect(trig(el).value).toBe('09:00')
  })

  it('hazard 2: own property set before upgrade shadows the accessor, and connect clears it', () => {
    // An inert document has no browsing context, so nothing is upgraded there —
    // exactly the state of an element parsed before the definition loads.
    const inert = document.implementation.createHTMLDocument('')
    const raw = inert.createElement('daisy-time-picker') as HTMLElement & { value: string }
    expect(raw).not.toBeInstanceOf(DaisyTimePicker)
    raw.value = '09:00:00'
    expect(Object.prototype.hasOwnProperty.call(raw, 'value')).toBe(true)

    const el = document.adoptNode(raw) as unknown as DaisyTimePicker
    document.body.appendChild(el)
    expect(el).toBeInstanceOf(DaisyTimePicker)
    expect(Object.prototype.hasOwnProperty.call(el, 'value')).toBe(false)
    expect(el.value).toBe('09:00')
  })

  it('upgrades every accessor, not just value', () => {
    const inert = document.implementation.createHTMLDocument('')
    // The tag map types this as DaisyTimePicker, but before upgrade it is a
    // plain HTMLElement — writing through an index signature is the honest shape.
    const raw = inert.createElement('daisy-time-picker') as unknown as HTMLElement & Record<string, unknown>
    raw.min = '09:00'
    raw.max = '17:00'
    raw.step = 900
    raw.hourCycle = '24'
    raw.required = true
    raw.name = 'start'
    raw.placeholder = 'hh:mm'
    raw.label = 'Start'
    const el = document.adoptNode(raw) as unknown as DaisyTimePicker
    document.body.appendChild(el)
    expect([el.min, el.max, el.step, el.hourCycle, el.required, el.name, el.placeholder, el.label]).toEqual([
      '09:00',
      '17:00',
      900,
      '24',
      true,
      'start',
      'hh:mm',
      'Start',
    ])
    expect(texts(el, 'm')).toEqual(['00', '15', '30', '45'])
  })
})

// ---- attribute / property model -------------------------------------------

describe('attribute and property model', () => {
  it('setAttribute reaches the property and setting the property reflects back', () => {
    const el = mk()
    el.setAttribute('min', '09:00')
    expect(el.min).toBe('09:00')
    el.min = '09:30'
    expect(el.getAttribute('min')).toBe('09:30')
    el.min = null
    expect(el.hasAttribute('min')).toBe(false)
    expect(el.min).toBe(null)
  })

  it('a property write reflects with exactly one attribute mutation (no reflection loop)', () => {
    // Counting attributeChangedCallback would not work: a custom element
    // definition captures its lifecycle callbacks at define() time, so a
    // prototype spy installed later is never called. Count the mutations
    // instead — a ping-pong between setter and callback would show up as more
    // than one write per assignment (and, unguarded, would not terminate).
    const el = mk()
    const mo = new MutationObserver(() => {})
    mo.observe(el, { attributes: true })
    const writes = (): string[] => mo.takeRecords().map(r => r.attributeName ?? '')

    el.min = '09:30'
    expect(writes()).toEqual(['min'])
    el.setAttribute('min', '10:00')
    expect(writes()).toEqual(['min'])
    el.min = null
    expect(writes()).toEqual(['min'])
    el.disabled = true
    expect(writes()).toEqual(['disabled'])
    el.value = '11:00' // does not reflect at all
    expect(writes()).toEqual([])
    mo.disconnect()
    expect([el.min, el.disabled, el.value]).toEqual([null, true, '11:00'])
  })

  it('everything reflects except value', () => {
    const el = mk()
    el.max = '18:00'
    el.step = 900
    el.hourCycle = '12'
    el.disabled = true
    el.required = true
    el.name = 'start'
    el.placeholder = 'hh:mm'
    el.label = 'Start'
    expect({
      max: el.getAttribute('max'),
      step: el.getAttribute('step'),
      hourCycle: el.getAttribute('hour-cycle'),
      disabled: el.getAttribute('disabled'),
      required: el.getAttribute('required'),
      name: el.getAttribute('name'),
      placeholder: el.getAttribute('placeholder'),
      label: el.getAttribute('label'),
    }).toEqual({
      max: '18:00',
      step: '900',
      hourCycle: '12',
      disabled: '',
      required: '',
      name: 'start',
      placeholder: 'hh:mm',
      label: 'Start',
    })
    el.disabled = false
    expect(el.hasAttribute('disabled')).toBe(false)

    el.value = '10:00'
    expect(el.value).toBe('10:00')
    expect(el.getAttribute('value')).toBe(null) // the attribute is the *default*
  })

  it('defaultValue is the value attribute, and writing it seeds the live value', () => {
    const el = mk({ value: '07:15' })
    expect(el.defaultValue).toBe('07:15')
    expect(el.value).toBe('07:15')
    el.value = '11:45'
    expect(el.defaultValue).toBe('07:15') // untouched by a live write
    el.defaultValue = '06:00'
    expect(el.getAttribute('value')).toBe('06:00')
    expect(el.value).toBe('06:00')
  })

  it('step is seconds, defaults to 60, and null resets it', () => {
    const el = mk()
    expect(el.step).toBe(60)
    expect(opts(el, 'm')).toHaveLength(60)
    el.step = 900
    expect(el.step).toBe(900)
    el.step = null
    expect(el.step).toBe(60)
    expect(el.hasAttribute('step')).toBe(false)
  })

  it('an unparseable assignment stores the empty string', () => {
    const el = mk({ value: '09:00' })
    el.value = 'not a time'
    expect(el.value).toBe('')
    expect(trig(el).value).toBe('')
  })

  it('placeholder and label patch the internal input', () => {
    const el = mk()
    expect(trig(el).hasAttribute('placeholder')).toBe(false)
    el.placeholder = 'hh:mm'
    expect(trig(el).placeholder).toBe('hh:mm')
    el.placeholder = null
    expect(trig(el).hasAttribute('placeholder')).toBe(false)
    el.label = 'Start time'
    expect(trig(el).getAttribute('aria-label')).toBe('Start time')
    el.label = null
    expect(trig(el).hasAttribute('aria-label')).toBe(false)
  })

  it('disabled disables the trigger and blocks showPicker()', () => {
    const el = mk({ value: '09:00', disabled: '' })
    expect(el.disabled).toBe(true)
    expect(trig(el).disabled).toBe(true)
    el.showPicker()
    expect(isClosed(el)).toBe(true)
    el.disabled = false
    expect(trig(el).disabled).toBe(false)
    el.showPicker()
    expect(isOpen(el)).toBe(true)
  })

  it('HH:MM:SS end to end (the Postgres path)', () => {
    const el = mk()
    el.value = '09:00:00'
    expect(el.value).toBe('09:00')
    expect(trig(el).value).toBe('09:00')

    const attr = mk({ value: '09:00:00' })
    expect(attr.value).toBe('09:00')
    expect(attr.defaultValue).toBe('09:00:00') // the attribute is verbatim
    attr.value = '13:30:45.500'
    expect(attr.value).toBe('13:30')

    const restored = mk()
    restored.formStateRestoreCallback('09:00:00')
    expect(restored.value).toBe('09:00')
  })

  it('a programmatic value assignment fires zero events', () => {
    const el = mk({ value: '09:00' })
    const { log } = record(el)
    el.value = '10:00'
    el.value = '10:00' // idempotent
    el.setAttribute('value', '11:00')
    el.value = ''
    expect(log).toEqual([])
    expect(el.value).toBe('')
  })
})

// ---- hour cycle ------------------------------------------------------------

describe('hour cycle', () => {
  it('resolves auto/unset/garbage to 12 or 24 without throwing', () => {
    const el = document.createElement('daisy-time-picker')
    document.body.appendChild(el)
    expect([12, 24]).toContain(el.resolvedHourCycle)
    el.hourCycle = 'auto'
    expect([12, 24]).toContain(el.resolvedHourCycle)
    el.hourCycle = 'nonsense'
    expect([12, 24]).toContain(el.resolvedHourCycle)
    expect(el.hourCycle).toBe('nonsense') // the literal attribute, not the resolution
  })

  it('12h grows an AM/PM column, 24h removes it', () => {
    const el = mk()
    expect(el.resolvedHourCycle).toBe(24)
    expect(col(el, 'p')).toBe(null)
    expect(el.querySelectorAll('[data-dtp-col]')).toHaveLength(2)
    expect(texts(el, 'h')).toHaveLength(24)
    expect(texts(el, 'h')[0]).toBe('00')

    el.hourCycle = '12'
    expect(el.resolvedHourCycle).toBe(12)
    expect(el.querySelectorAll('[data-dtp-col]')).toHaveLength(3)
    expect(texts(el, 'p')).toEqual(['AM', 'PM'])
    expect(texts(el, 'h')).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])

    el.hourCycle = '24'
    expect(col(el, 'p')).toBe(null)
  })

  it('switching hour cycle preserves the value and changes only the display', () => {
    const el = mk()
    el.value = '13:45'
    expect(trig(el).value).toBe('13:45')
    el.hourCycle = '12'
    expect(el.value).toBe('13:45')
    expect(trig(el).value).toBe('1:45 PM')
    el.hourCycle = '24'
    expect(el.value).toBe('13:45')
    expect(trig(el).value).toBe('13:45')
  })

  it.each([
    ['00:00', '12:00 AM'],
    ['09:05', '9:05 AM'],
    ['12:00', '12:00 PM'],
    ['13:45', '1:45 PM'],
    ['23:59', '11:59 PM'],
  ])('%s round-trips under both hour cycles (12h display %s)', (v, shown) => {
    const h24 = mk()
    h24.value = v
    expect(h24.value).toBe(v)
    expect(trig(h24).value).toBe(v)

    const h12 = mk({ 'hour-cycle': '12' })
    h12.value = v
    expect(h12.value).toBe(v)
    expect(trig(h12).value).toBe(shown)
  })
})

// ---- min / max / step ------------------------------------------------------

describe('min, max and step', () => {
  it('step builds the minute grid anchored at min', () => {
    expect(texts(mk({ min: '09:00', step: '900' }), 'm')).toEqual(['00', '15', '30', '45'])
    expect(texts(mk({ min: '09:05', step: '900' }), 'm')).toEqual(['05', '20', '35', '50'])
    expect(texts(mk({ step: '1800' }), 'm')).toEqual(['00', '30'])
  })

  it('out-of-range options are aria-disabled and inert to clicks', () => {
    const el = mk({ min: '09:00', max: '18:00', value: '09:00' })
    const h08 = opts(el, 'h')[8]
    expect(h08.textContent).toBe('08')
    expect(h08.getAttribute('aria-disabled')).toBe('true')
    expect(opts(el, 'h')[9].hasAttribute('aria-disabled')).toBe(false)
    expect(opts(el, 'h')[19].getAttribute('aria-disabled')).toBe('true')

    const { log } = record(el)
    click(h08)
    expect(el.value).toBe('09:00')
    expect(log).toEqual([])
  })

  it('never clamps: an out-of-range value stays verbatim and renders selected AND disabled', () => {
    const el = mk({ min: '09:00', max: '18:00' })
    el.value = '08:30'
    expect(el.value).toBe('08:30')
    const h08 = opts(el, 'h')[8]
    expect(h08.getAttribute('aria-selected')).toBe('true')
    expect(h08.getAttribute('aria-disabled')).toBe('true')
  })

  it('a reversed range is the overnight wrap, not an empty range', () => {
    const el = mk({ min: '22:00', max: '06:00' })
    const disabled = opts(el, 'h')
      .filter(o => o.getAttribute('aria-disabled') === 'true')
      .map(o => Number(o.dataset.n))
    expect(disabled).toEqual([7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21])
    el.value = '23:30'
    expect(el.value).toBe('23:30')
    el.value = '03:00'
    expect(el.value).toBe('03:00')
  })

  it('an invalid step warns once per instance and falls back to 60s', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const el = mk()
    el.step = 45
    el.step = 17 // still invalid: must not warn twice
    el.min = '10:00' // a repaint must not warn again
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toMatch(/SECONDS/)
    expect(opts(el, 'm')).toHaveLength(60) // fell back to a 1-minute grid

    const other = mk()
    other.step = 45
    expect(warn).toHaveBeenCalledTimes(2) // the once-rule is per instance
    warn.mockRestore()
  })
})

// ---- build once, patch after ----------------------------------------------

describe('build once, patch after', () => {
  it('builds exactly one root and adds the host layout classes', () => {
    const el = mk({ value: '09:00' })
    expect(el.querySelectorAll('[data-dtp-root]')).toHaveLength(1)
    expect(el.classList.contains('block') && el.classList.contains('min-w-0')).toBe(true)
    document.body.appendChild(el) // reconnect: connectedCallback runs again
    expect(el.querySelectorAll('[data-dtp-root]')).toHaveLength(1)
    expect(el.value).toBe('09:00')
  })

  it('a value change patches the existing nodes and never replaces them', () => {
    const el = mk({ value: '09:00' })
    const t = trig(el)
    const before = opts(el, 'h')
    const opt10 = before[10]
    const attrsOf = (n: Element): Record<string, string> =>
      Object.fromEntries(Array.from(n.attributes).map(a => [a.name, a.value]))
    const beforeAttrs = attrsOf(opt10)

    el.value = '10:30'

    expect(opts(el, 'h')).toEqual(before) // same node identities, same order
    expect(trig(el)).toBe(t)
    const afterAttrs = attrsOf(opt10)
    const changed = Array.from(new Set([...Object.keys(beforeAttrs), ...Object.keys(afterAttrs)]))
      .filter(k => beforeAttrs[k] !== afterAttrs[k])
      .sort()
    expect(changed).toEqual(['aria-selected', 'class'])
    expect(afterAttrs.class.replace(beforeAttrs.class, '').trim()).toBe('btn-active')
    expect(t.value).toBe('10:30')
  })

  it('never rebuilds the option lists under a user who is inside an open panel', () => {
    const el = mk({ value: '09:00' })
    const before = opts(el, 'h')
    el.showPicker()
    ;(col(el, 'h') as HTMLDivElement).focus()

    el.min = '12:00'
    expect(opts(el, 'h')).toEqual(before) // same nodes: nothing was replaced
    expect(before[9].hasAttribute('aria-disabled')).toBe(false) // not even repainted
    expect(el.min).toBe('12:00') // the state did land, only the paint deferred

    el.hidePicker()
    el.min = '13:00'
    expect(opts(el, 'h')).not.toEqual(before) // rebuilt once the panel closed
    expect(opts(el, 'h')[9].getAttribute('aria-disabled')).toBe('true')
  })

  it('option ids are stable and share the instance prefix', () => {
    const el = mk()
    const prefix = trig(el).id.replace(/-input$/, '')
    expect(prefix).toMatch(/^dtp-\d+$/)
    expect((el.querySelector('[data-dtp-panel]') as HTMLElement).id).toBe(`${prefix}-panel`)
    expect(opts(el, 'h')[9].id).toBe(`${prefix}-h-9`)
    expect(opts(el, 'h')[9].textContent).toBe('09')
    const idsBefore = opts(el, 'h').map(o => o.id)
    el.value = '15:00'
    expect(opts(el, 'h').map(o => o.id)).toEqual(idsBefore)
  })
})

// ---- open / close ----------------------------------------------------------

describe('dropdown open and close', () => {
  it('asserts exactly one of dropdown-open / dropdown-close, always', () => {
    const el = mk({ value: '09:00' })
    expect(isClosed(el)).toBe(true)
    expect(trig(el).getAttribute('aria-expanded')).toBe('false')

    el.showPicker()
    expect(isOpen(el)).toBe(true)
    expect(trig(el).getAttribute('aria-expanded')).toBe('true')

    el.hidePicker()
    expect(isClosed(el)).toBe(true)
    expect(trig(el).getAttribute('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(trig(el))
  })

  it('open -> close -> open reopens', () => {
    // Regression: daisyUI hides on :not(:focus-within) and the trigger lives
    // inside .dropdown, so hidePicker() refocusing it must not leave the panel
    // in a state that refuses to reopen.
    const el = mk({ value: '09:00' })
    el.showPicker()
    el.hidePicker()
    el.showPicker()
    expect(isOpen(el)).toBe(true)
  })

  it('clicking the trigger opens it', () => {
    const el = mk({ value: '09:00' })
    click(trig(el))
    expect(isOpen(el)).toBe(true)
  })

  it('a pointerdown outside closes it, inside does not', () => {
    const el = mk({ value: '09:00' })
    el.showPicker()
    trig(el).dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(isOpen(el)).toBe(true)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(isClosed(el)).toBe(true)
  })

  it('disconnecting removes the document listener', () => {
    const el = mk({ value: '09:00' })
    el.showPicker()
    el.remove()
    expect(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))).not.toThrow()
  })

  it('disconnecting while open leaves it closed, and it reopens after reconnect', () => {
    // Regression: disconnect dropped the document listener but kept #open true
    // and dropdown-open on the root, so a re-parented node (any keyed-list
    // reorder) came back stuck open with showPicker() and outside-click dead.
    const el = mk({ value: '09:00' })
    el.showPicker()
    el.remove()
    expect(isClosed(el)).toBe(true)
    expect(trig(el).getAttribute('aria-expanded')).toBe('false')

    document.body.appendChild(el)
    expect(isClosed(el)).toBe(true)
    el.showPicker()
    expect(isOpen(el)).toBe(true)
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(isClosed(el)).toBe(true)
  })
})

// ---- events ----------------------------------------------------------------

describe('event matrix', () => {
  it('an option click fires exactly one bubbling, non-cancelable input carrying HH:MM', () => {
    const el = mk({ value: '09:00' })
    const { log, raw } = record(el)
    el.showPicker()
    click(opts(el, 'h')[11])
    expect(log).toEqual(['input:11:00'])
    expect(raw[0].bubbles).toBe(true)
    expect(raw[0].cancelable).toBe(false)
    expect(raw[0].target).toBe(el)
  })

  it('Done fires exactly one change; closing unchanged fires nothing', () => {
    // Regression: hidePicker() focuses the trigger, whose focus handler
    // re-snapshots value-at-open. If it snapshots before the comparison, the
    // change is swallowed forever.
    const el = mk({ value: '09:00' })
    el.showPicker()
    click(opts(el, 'h')[11])
    const { log } = record(el)
    click(el.querySelector('[data-dtp-done]') as HTMLElement)
    expect(log).toEqual(['change:11:00'])
    expect(isClosed(el)).toBe(true)

    log.length = 0
    el.showPicker()
    click(el.querySelector('[data-dtp-done]') as HTMLElement)
    expect(log).toEqual([])
  })

  it('an outside click commits: input then change', () => {
    const el = mk({ value: '09:00' })
    const { log } = record(el)
    el.showPicker()
    click(opts(el, 'h')[7])
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    expect(log).toEqual(['input:07:00', 'change:07:00'])
    expect(el.value).toBe('07:00')
  })

  it('Now commits the current wall-clock time', () => {
    const el = mk()
    const { log } = record(el)
    const stamp = (d: Date): string =>
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    el.showPicker()
    const before = stamp(new Date())
    click(el.querySelector('[data-dtp-now]') as HTMLElement)
    const after = stamp(new Date())
    expect([before, after]).toContain(el.value)
    expect(log).toEqual([`input:${el.value}`])
  })

  it('typing fires one input per keystroke that moves the value, carrying HH:MM', () => {
    // Regression: the inner <input>'s own bubbling input event must not escape
    // the host — a consumer reading e.target.value would otherwise see raw text.
    const el = mk()
    const { log, raw } = record(el)
    trig(el).focus()
    type(el, '0')
    type(el, '08')
    type(el, '081')
    expect(log).toEqual([]) // nothing parseable yet
    type(el, '0815')
    expect(log).toEqual(['input:08:15'])
    expect(raw).toHaveLength(1)
    expect(raw[0].target).toBe(el) // not the inner input
    expect(trig(el).value).toBe('08:15') // masked in place
    expect(el.value).toBe('08:15')
  })

  it('a typed colon survives the mask and parses', () => {
    // Regression: the mask used to strip the colon and re-insert it by digit
    // count, so "9:30" became "93:0" and the field blurred to empty.
    const el = mk()
    trig(el).focus()
    type(el, '9')
    expect(trig(el).value).toBe('9')
    type(el, '9:')
    expect(trig(el).value).toBe('9:')
    type(el, '9:3')
    expect(trig(el).value).toBe('9:3')
    type(el, '9:30')
    expect(el.value).toBe('09:30')
    trig(el).dispatchEvent(new FocusEvent('blur'))
    expect(trig(el).value).toBe('09:30')
  })

  it('digits still auto-colon progressively', () => {
    const el = mk()
    trig(el).focus()
    const seen: string[] = []
    for (const raw of ['0', '09', '093', '0930']) {
      type(el, raw)
      seen.push(trig(el).value)
    }
    expect(seen).toEqual(['0', '09', '09:3', '09:30'])
    expect(el.value).toBe('09:30')
  })

  it('12h: typed am/pm reaches the parser instead of being masked away', () => {
    // Regression: maskTyped ran before parseTyped and deleted the letters on
    // every keystroke, making the entire 12h text branch unreachable from the DOM.
    const el = mk({ 'hour-cycle': '12' })
    trig(el).focus()
    type(el, '9')
    type(el, '9p')
    expect(trig(el).value).toBe('9p') // letters left alone
    type(el, '9pm')
    expect(el.value).toBe('21:00')
    trig(el).dispatchEvent(new FocusEvent('blur'))
    expect(trig(el).value).toBe('9:00 PM')
  })

  it('12h: a full "9:30 pm" parses', () => {
    const el = mk({ 'hour-cycle': '12' })
    const { log } = record(el)
    trig(el).focus()
    type(el, '9:30 pm')
    expect(el.value).toBe('21:30')
    trig(el).dispatchEvent(new FocusEvent('blur'))
    expect(trig(el).value).toBe('9:30 PM')
    expect(log).toEqual(['input:21:30', 'change:21:30'])
  })

  it("the inner input's own change never leaks out", () => {
    const el = mk({ value: '09:00' })
    const { log } = record(el)
    trig(el).dispatchEvent(new Event('change', { bubbles: true }))
    expect(log).toEqual([])
  })

  it('blur after typing fires the change', () => {
    const el = mk()
    const { log } = record(el)
    trig(el).focus()
    type(el, '0815')
    trig(el).dispatchEvent(new FocusEvent('blur'))
    expect(log).toEqual(['input:08:15', 'change:08:15'])
  })

  it('unparseable typing reverts the display instead of blanking the value', () => {
    const el = mk({ value: '08:15' })
    trig(el).focus()
    const { log } = record(el)
    type(el, '99')
    trig(el).dispatchEvent(new FocusEvent('blur'))
    expect(trig(el).value).toBe('08:15')
    expect(el.value).toBe('08:15')
    expect(log).toEqual([])
  })

  it('Escape restores the value at open and fires zero change', () => {
    const el = mk({ value: '09:00' })
    const { log } = record(el)
    const h = col(el, 'h') as HTMLDivElement
    el.showPicker()
    h.focus()
    kd(h, 'ArrowDown')
    kd(h, 'ArrowDown')
    expect(el.value).toBe('11:00')
    log.length = 0
    kd(h, 'Escape')
    expect(el.value).toBe('09:00')
    expect(log).toEqual([]) // silent restore: no input, no change
    expect(isClosed(el)).toBe(true)
  })

  it('formResetCallback restores the default silently', () => {
    const el = mk({ value: '07:15' })
    el.value = '11:45'
    const { log } = record(el)
    el.formResetCallback()
    expect(el.value).toBe('07:15')
    expect(log).toEqual([])
  })
})

// ---- form association ------------------------------------------------------

describe('form association', () => {
  it('probe: jsdom 29 ElementInternals really is missing the members the guards protect', () => {
    // This is the premise of every `?.` in the source. If a future jsdom fills
    // these in, this assertion flips — which is the signal to revisit the
    // guards, not a flake. `labels` IS implemented (note the source comment
    // saying otherwise is stale); setFormValue/setValidity/form are not.
    class Probe extends HTMLElement {
      static formAssociated = true
    }
    if (!customElements.get('probe-el')) customElements.define('probe-el', Probe)
    const i = (document.createElement('probe-el') as Probe).attachInternals()
    expect({
      setFormValue: typeof i.setFormValue,
      setValidity: typeof i.setValidity,
      hasForm: 'form' in i,
      hasLabels: 'labels' in i,
      hasWillValidate: 'willValidate' in i,
      hasValidity: 'validity' in i,
    }).toEqual({
      setFormValue: 'undefined',
      setValidity: 'undefined',
      hasForm: false,
      hasLabels: true,
      hasWillValidate: false,
      hasValidity: false,
    })
  })

  it('the whole public surface falls back safely where jsdom left holes', () => {
    const el = mk()
    expect(el.checkValidity()).toBe(true)
    expect(el.reportValidity()).toBe(true)
    expect(el.validity).toEqual({})
    expect(el.validationMessage).toBe('')
    expect(el.form).toBe(null)
    expect(el.willValidate).toBe(true)
    expect(el.labels.length).toBe(0)
  })

  it('the full form lifecycle throws nothing', () => {
    const form = document.createElement('form')
    form.addEventListener('submit', e => e.preventDefault())
    document.body.appendChild(form)
    expect(() => {
      const el = document.createElement('daisy-time-picker')
      el.setAttribute('hour-cycle', '24')
      el.setAttribute('name', 'start')
      form.appendChild(el)
      el.required = true // required + empty -> valueMissing
      el.value = '09:30'
      el.value = ''
      el.value = '08:30'
      el.min = '09:00' // -> rangeUnderflow
      el.max = '18:00'
      el.step = 900 // -> stepMismatch too
      form.requestSubmit()
      el.defaultValue = '07:15'
      el.formResetCallback()
      el.formDisabledCallback(true)
      el.formDisabledCallback(false)
      el.formStateRestoreCallback('06:45')
      el.checkValidity()
      el.reportValidity()
      void el.validity
      void el.validationMessage
      void el.form
      void el.labels
      void el.willValidate
      form.reset()
    }).not.toThrow()
  })

  it('formDisabledCallback is independent of the attribute and survives a repaint', () => {
    const el = mk({ value: '09:00' })
    el.showPicker()
    el.formDisabledCallback(true)
    expect(trig(el).disabled).toBe(true)
    expect(el.disabled).toBe(false) // the attribute is untouched
    expect(isClosed(el)).toBe(true)
    el.value = '12:00'
    expect(trig(el).disabled).toBe(true)
    el.formDisabledCallback(false)
    expect(trig(el).disabled).toBe(false)
  })

  it('showPicker() is a no-op while form-disabled', () => {
    const el = mk({ value: '09:00' })
    el.formDisabledCallback(true)
    el.showPicker()
    expect(isClosed(el)).toBe(true)
    el.formDisabledCallback(false)
    el.showPicker()
    expect(isOpen(el)).toBe(true)
  })

  describe('with a stubbed ElementInternals', () => {
    type Spy = { fv: string[]; sv: Array<[ValidityStateFlags, string, unknown]> }
    /** Patch the prototype before construction: #internals is a field initializer. */
    function withStub(fn: (spy: Spy, mkStubbed: (attrs?: Record<string, string>) => DaisyTimePicker) => void): void {
      const spy: Spy = { fv: [], sv: [] }
      const stub = {
        setFormValue: (v: string) => void spy.fv.push(v),
        setValidity: (f: ValidityStateFlags, m?: string, a?: HTMLElement) => void spy.sv.push([{ ...f }, m ?? '', a]),
        form: 'FORM-SENTINEL',
        labels: ['L'],
        willValidate: false,
        validity: { valid: false },
        validationMessage: 'nope',
        checkValidity: () => false,
        reportValidity: () => false,
      }
      const proto = DaisyTimePicker.prototype as unknown as { attachInternals?: () => unknown }
      proto.attachInternals = () => stub
      try {
        fn(spy, attrs => mk(attrs))
      } finally {
        delete proto.attachInternals
      }
    }

    it('publishes the value through setFormValue', () => {
      withStub((spy, mkStubbed) => {
        const el = mkStubbed()
        spy.fv.length = 0
        el.value = '09:00'
        expect(spy.fv.at(-1)).toBe('09:00')
        el.value = ''
        expect(spy.fv.at(-1)).toBe('')
      })
    })

    it('publishes exactly the flags that are true, with a message and the trigger as anchor', () => {
      withStub((spy, mkStubbed) => {
        const el = mkStubbed({ value: '08:30', min: '09:00' })
        const [flags, message, anchor] = spy.sv.at(-1) as Spy['sv'][number]
        expect(flags).toEqual({ rangeUnderflow: true })
        expect(message.length).toBeGreaterThan(0) // browsers throw on a flagged-but-empty message
        expect(anchor).toBe(trig(el))
      })
    })

    const noop = (): void => {}
    it.each([
      [
        'valueMissing when required and empty',
        noop,
        (el: DaisyTimePicker) => (el.required = true),
        { valueMissing: true },
      ],
      [
        'becoming valid clears every flag at once',
        (el: DaisyTimePicker) => {
          el.min = '09:00'
          el.max = '18:00'
          el.step = 900
          el.value = '08:20' // underflow + stepMismatch
        },
        (el: DaisyTimePicker) => (el.value = '10:30'),
        {},
      ],
      [
        'rangeOverflow above max',
        (el: DaisyTimePicker) => (el.value = '10:30'),
        (el: DaisyTimePicker) => (el.max = '09:00'),
        { rangeOverflow: true },
      ],
      [
        'stepMismatch off the grid',
        (el: DaisyTimePicker) => (el.value = '10:30'),
        (el: DaisyTimePicker) => (el.step = 3600),
        { stepMismatch: true },
      ],
      [
        'a reversed range reports both underflow and overflow',
        (el: DaisyTimePicker) => (el.value = '10:30'),
        (el: DaisyTimePicker) => {
          el.min = '22:00'
          el.max = '06:00'
        },
        { rangeUnderflow: true, rangeOverflow: true },
      ],
    ])('%s', (_name, setup, mutate, expected) => {
      withStub((spy, mkStubbed) => {
        const el = mkStubbed()
        setup(el)
        spy.sv.length = 0
        mutate(el)
        expect(spy.sv.at(-1)?.[0]).toEqual(expected)
      })
    })

    it('badInput tracks the raw typed text even though the value did not move', () => {
      withStub((spy, mkStubbed) => {
        const el = mkStubbed()
        trig(el).focus()
        spy.sv.length = 0
        type(el, '99')
        expect(spy.sv.at(-1)?.[0]).toEqual({ badInput: true })
      })
    })

    it('proxies form, labels, willValidate, validity and validationMessage through', () => {
      withStub((_spy, mkStubbed) => {
        const el = mkStubbed()
        expect(el.form).toBe('FORM-SENTINEL' as unknown as HTMLFormElement)
        expect(el.labels[0]).toBe('L')
        expect(el.willValidate).toBe(false)
        expect(el.validity.valid).toBe(false)
        expect(el.validationMessage).toBe('nope')
        expect(el.checkValidity()).toBe(false)
        expect(el.reportValidity()).toBe(false)
      })
    })
  })
})

// ---- keyboard and a11y -----------------------------------------------------

describe('keyboard', () => {
  it('arrows move aria-activedescendant, commit, and never move DOM focus off the listbox', () => {
    const el = mk({ value: '09:00' })
    const h = col(el, 'h') as HTMLDivElement
    const { log } = record(el)
    el.showPicker()
    h.focus()
    expect(h.getAttribute('aria-activedescendant')).toBe(opts(el, 'h')[9].id)

    kd(h, 'ArrowDown')
    expect(el.value).toBe('10:00')
    expect(h.getAttribute('aria-activedescendant')).toBe(opts(el, 'h')[10].id)
    expect(log).toEqual(['input:10:00'])
    expect(document.activeElement).toBe(h)

    log.length = 0
    kd(h, 'ArrowUp')
    expect(el.value).toBe('09:00')
    expect(log).toEqual(['input:09:00'])
  })

  it('Home, End, PageUp and PageDown clamp without wrapping', () => {
    const el = mk({ value: '09:00' })
    const h = col(el, 'h') as HTMLDivElement
    const { log } = record(el)
    el.showPicker()
    h.focus()

    kd(h, 'Home')
    expect(el.value).toBe('00:00')
    log.length = 0
    kd(h, 'ArrowUp')
    expect([el.value, log]).toEqual(['00:00', []]) // no wrap, no event

    kd(h, 'End')
    expect(el.value).toBe('23:00')
    log.length = 0
    kd(h, 'ArrowDown')
    expect([el.value, log]).toEqual(['23:00', []])

    kd(h, 'Home')
    kd(h, 'PageDown')
    expect(el.value).toBe('10:00')
    kd(h, 'PageUp')
    expect(el.value).toBe('00:00')
    kd(h, 'PageUp')
    expect(el.value).toBe('00:00')
  })

  it('arrows skip aria-disabled options and stop at the last enabled one', () => {
    const el = mk({ value: '09:00', min: '09:00', max: '11:00' })
    const h = col(el, 'h') as HTMLDivElement
    const { log } = record(el)
    el.showPicker()
    h.focus()

    kd(h, 'ArrowUp')
    expect([el.value, log]).toEqual(['09:00', []]) // 08 is below min

    kd(h, 'End')
    expect(el.value).toBe('11:00') // last ENABLED, not 23
    log.length = 0
    kd(h, 'ArrowDown')
    expect([el.value, log]).toEqual(['11:00', []])

    kd(h, 'Home')
    expect(el.value).toBe('09:00') // first ENABLED, not 00
    kd(h, 'PageDown')
    expect(el.value).toBe('11:00')
  })

  it('left and right move DOM focus between columns only', () => {
    const el = mk({ value: '09:00', 'hour-cycle': '12' })
    const [h, m, p] = ['h', 'm', 'p'].map(k => col(el, k as ColKey) as HTMLDivElement)
    el.showPicker()
    h.focus()

    kd(h, 'ArrowLeft')
    expect(document.activeElement).toBe(h) // no-op at the first column
    kd(h, 'ArrowRight')
    expect(document.activeElement).toBe(m)
    const { log } = record(el)
    kd(m, 'ArrowDown')
    expect(el.value).toBe('09:01') // minutes only
    expect(log).toEqual(['input:09:01'])
    kd(m, 'ArrowRight')
    expect(document.activeElement).toBe(p)
    kd(p, 'ArrowDown')
    expect(el.value).toBe('21:01') // AM -> PM
    kd(p, 'ArrowRight')
    expect(document.activeElement).toBe(p) // no-op at the last column
    kd(p, 'ArrowLeft')
    expect(document.activeElement).toBe(m)
  })

  it('Enter and Space in a listbox close and commit', () => {
    for (const key of ['Enter', ' ']) {
      const el = mk({ value: '09:00' })
      const h = col(el, 'h') as HTMLDivElement
      el.showPicker()
      h.focus()
      kd(h, 'ArrowDown')
      const { log } = record(el)
      kd(h, key)
      expect(isClosed(el)).toBe(true)
      expect(el.value).toBe('10:00')
      expect(log).toEqual(['change:10:00'])
      el.remove()
    }
  })

  it('Enter, ArrowDown and Alt+ArrowDown on the trigger open and focus the hour column', () => {
    for (const [key, init] of [
      ['ArrowDown', {}],
      ['ArrowDown', { altKey: true }],
      ['Enter', {}],
    ] as Array<[string, KeyboardEventInit]>) {
      const el = mk({ value: '09:00' })
      const h = col(el, 'h') as HTMLDivElement
      trig(el).focus()
      expect(kd(trig(el), key, init)).toBe(false) // preventDefault-ed
      expect(isOpen(el)).toBe(true)
      expect(document.activeElement).toBe(h)
      el.remove()
    }
  })

  it('Enter on the trigger commits typed text before opening', () => {
    const el = mk()
    const { log } = record(el)
    trig(el).focus()
    type(el, '0815')
    kd(trig(el), 'Enter')
    expect(el.value).toBe('08:15')
    expect(log).toEqual(['input:08:15', 'change:08:15'])
    expect(isOpen(el)).toBe(true)
  })

  it('leaves Enter on the Now and Done buttons to native activation', () => {
    const el = mk({ value: '09:00' })
    el.showPicker()
    const now = el.querySelector('[data-dtp-now]') as HTMLElement
    now.focus()
    expect(kd(now, 'Enter')).toBe(true) // not preventDefault-ed by the host
    expect(isOpen(el)).toBe(true)
  })

  it('Escape on a closed picker is not swallowed', () => {
    const el = mk({ value: '09:00' })
    expect(kd(trig(el), 'Escape')).toBe(true)
  })

  it('tabbing out closes, commits, and does not yank focus back', () => {
    const next = document.createElement('input')
    document.body.appendChild(next)
    const el = mk({ value: '09:00' })
    const h = col(el, 'h') as HTMLDivElement
    const { log } = record(el)
    el.showPicker()
    h.focus()
    kd(h, 'ArrowDown')
    log.length = 0

    next.focus() // == Tab out of the panel

    expect(isClosed(el)).toBe(true)
    expect(log).toEqual(['change:10:00'])
    expect(document.activeElement).toBe(next) // no focus trap
  })
})

describe('accessibility wiring', () => {
  it('the trigger is a typable combobox wired to the panel', () => {
    const el = mk({ 'hour-cycle': '12' })
    const t = trig(el)
    expect(t.tagName).toBe('INPUT')
    expect(t.type).toBe('text')
    expect(t.getAttribute('inputmode')).toBe('numeric')
    expect(t.getAttribute('autocomplete')).toBe('off')
    expect(t.getAttribute('role')).toBe('combobox')
    expect(t.getAttribute('aria-haspopup')).toBe('listbox')
    expect(t.getAttribute('aria-controls')).toBe((el.querySelector('[data-dtp-panel]') as HTMLElement).id)
  })

  it('every listbox holds only role=option children, with no list markup', () => {
    const el = mk({ 'hour-cycle': '12' })
    const lists = Array.from(el.querySelectorAll('[role="listbox"]'))
    expect(lists.map(l => l.getAttribute('aria-label'))).toEqual(['Hour', 'Minute', 'AM or PM'])
    for (const l of lists) {
      expect(l.getAttribute('tabindex')).toBe('0')
      expect(l.children.length).toBeGreaterThan(0)
      expect(Array.from(l.children).every(c => c.getAttribute('role') === 'option')).toBe(true)
    }
    expect(el.querySelectorAll('ul,li,menu')).toHaveLength(0)
  })

  it('aria-activedescendant is absent with no value and appears on selection', () => {
    const el = mk()
    const h = col(el, 'h') as HTMLDivElement
    expect(h.hasAttribute('aria-activedescendant')).toBe(false)
    el.value = '09:00'
    expect(h.getAttribute('aria-activedescendant')).toBe(opts(el, 'h')[9].id)
    el.value = ''
    expect(h.hasAttribute('aria-activedescendant')).toBe(false)
  })

  it('host focus() forwards to the trigger', () => {
    const el = mk()
    el.focus()
    expect(document.activeElement).toBe(trig(el))
  })

  it('mirrors a <label for> onto the internal input via aria-labelledby', () => {
    // NOTE: @testing-library/dom is not installed here, so this asserts the
    // *mechanism* its getByLabelText() relies on (aria-labelledby resolving to
    // an element whose text is the label) rather than exercising the library.
    document.body.insertAdjacentHTML(
      'beforeend',
      '<label for="t1">Start</label><daisy-time-picker id="t1" hour-cycle="24"></daisy-time-picker>',
    )
    const el = document.getElementById('t1') as DaisyTimePicker
    const label = document.querySelector('label[for="t1"]') as HTMLLabelElement
    expect(label.id).not.toBe('') // an id was minted so it can be referenced
    const ids = (trig(el).getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean)
    expect(ids).toEqual([label.id])
    expect(ids.map(i => document.getElementById(i)?.textContent).join(' ')).toBe('Start')
  })

  it('leaves aria-labelledby off when nothing labels the host', () => {
    const el = mk()
    expect(trig(el).hasAttribute('aria-labelledby')).toBe(false)
    const other = mk({ id: 'unlabelled' })
    expect(trig(other).hasAttribute('aria-labelledby')).toBe(false)
  })
})
