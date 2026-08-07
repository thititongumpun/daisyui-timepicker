/**
 * <daisy-time-picker> — light-DOM custom element styled with daisyUI 5.
 *
 * All time arithmetic lives in ./time.js; this file is DOM plumbing only.
 *
 * Form association goes through ElementInternals only — no hidden <input> — and
 * every call into it is capability-guarded, because jsdom 29.1.1 ships an
 * ElementInternals missing form, setFormValue, setValidity, checkValidity,
 * reportValidity, willValidate, validity and validationMessage. Only `labels`
 * is actually there (and returns an empty NodeList).
 *
 * Keyboard: roving aria-activedescendant, not roving tabindex. DOM focus stays
 * on the listbox container, so repainting aria-selected can never clobber it.
 */

import {
  display,
  format,
  inRange,
  join12,
  maskTyped,
  onStep,
  parse,
  parseTyped,
  resolveHourCycle,
  split12,
  stepMinutes,
} from './time.js'

/** Stable across runs so test assertions can hard-code `dtp-1-h-9`. */
let uid = 0

const COL_CLASS = 'flex flex-col gap-0.5 overflow-y-auto max-h-56 min-w-0'
const OPT_CLASS = 'btn btn-ghost btn-sm justify-center'
const PERIODS: Array<[number, string]> = [
  [0, 'AM'],
  [1, 'PM'],
]

/** Every observed attribute has a matching prototype accessor of the same name. */
const ACCESSORS = [
  'value',
  'defaultValue',
  'hourCycle',
  'min',
  'max',
  'step',
  'disabled',
  'required',
  'name',
  'placeholder',
  'label',
] as const

type ColKey = 'h' | 'm' | 'p'

/**
 * jsdom 29.1.1 returns an object from attachInternals() on which form,
 * setFormValue, setValidity, checkValidity, reportValidity, willValidate,
 * validity and validationMessage are all *absent* — `labels` is the one member
 * it does implement. Every member optional + `?.` is what lets those calls
 * no-op there while a genuine failure in a real browser still throws instead of
 * being swallowed by a try/catch.
 */
type Internals = Partial<ElementInternals>

/**
 * Do not "simplify" this back to `extends HTMLElement`.
 *
 * An `extends` clause is evaluated when the module is *parsed*, long before any
 * `typeof customElements` guard further down can run. So `extends HTMLElement`
 * throws `ReferenceError: HTMLElement is not defined` on plain `import` in any
 * DOM-free environment — a Next.js server component, a Node script, SSG. This
 * indirection is what keeps the module importable there; the dummy base is
 * never constructed because the registration below is also skipped.
 *
 * The type annotation keeps the class's public shape (and `override focus`)
 * identical on both paths, so the type consumers import — and the
 * HTMLElementTagNameMap entry below — is exactly what it was.
 */
const Base: typeof HTMLElement =
  typeof HTMLElement !== 'undefined' ? HTMLElement : (class {} as unknown as typeof HTMLElement)

export class DaisyTimePicker extends Base {
  // Makes the host labelable and submittable, and must be true at definition
  // time for attachInternals() below to hand back form-associated internals.
  static formAssociated = true

  static get observedAttributes(): string[] {
    return ['value', 'hour-cycle', 'min', 'max', 'step', 'disabled', 'required', 'name', 'placeholder', 'label']
  }

  // ---- state -------------------------------------------------------------
  readonly #uid = `dtp-${++uid}`
  /** '' or 'HH:MM'. Never reflected — the attribute is the *default* value. */
  #value = ''
  #hourCycleAttr: string | null = null
  #hc: 12 | 24 = resolveHourCycle()
  #min: string | null = null
  #max: string | null = null
  #step = 60
  #stepM = 1
  #stepWarned = false
  #internals: Internals | null =
    typeof this.attachInternals === 'function' ? this.attachInternals() : null
  #disabled = false
  /** From formDisabledCallback (an ancestor <fieldset disabled>), not the attribute. */
  #formDisabled = false
  #required = false
  /** Set while #onFocusOut closes us, so hidePicker() does not yank focus back. */
  #noRefocus = false
  #name: string | null = null
  #placeholder: string | null = null
  #label: string | null = null

  /** Set while a setter writes its own attribute back, to break the loop. */
  #reflecting = false
  #built = false
  #open = false
  #valueAtOpen = ''

  // ---- cached nodes ------------------------------------------------------
  #root!: HTMLDivElement
  #trigger!: HTMLInputElement
  #panel!: HTMLDivElement
  #cols!: HTMLDivElement
  #opts: Record<ColKey, HTMLDivElement[]> = { h: [], m: [], p: [] }

  // ---- accessors ---------------------------------------------------------

  /** Current value. Does not reflect; see the class comment. */
  get value(): string {
    return this.#value
  }
  set value(v: string) {
    this.#setValue(v)
  }

  /** Mirrors the `value` *attribute* — the reset/default value. */
  get defaultValue(): string {
    return this.getAttribute('value') ?? ''
  }
  set defaultValue(v: string) {
    this.#reflect('value', v)
  }

  /** The literal attribute string: '12' | '24' | 'auto' | null. */
  get hourCycle(): string | null {
    return this.#hourCycleAttr
  }
  set hourCycle(v: string | null) {
    this.#reflect('hour-cycle', v)
  }

  /** What will actually be rendered, after resolving 'auto'/unset/garbage. */
  get resolvedHourCycle(): 12 | 24 {
    return this.#hc
  }

  get min(): string | null {
    return this.#min
  }
  set min(v: string | null) {
    this.#reflect('min', v)
  }

  get max(): string | null {
    return this.#max
  }
  set max(v: string | null) {
    this.#reflect('max', v)
  }

  /** Seconds, like native <input type="time">. Default 60. */
  get step(): number {
    return this.#step
  }
  set step(v: number | string | null) {
    this.#reflect('step', v === null ? null : String(v))
  }

  get disabled(): boolean {
    return this.#disabled
  }
  set disabled(v: boolean) {
    this.#reflectBool('disabled', v)
  }

  get required(): boolean {
    return this.#required
  }
  set required(v: boolean) {
    this.#reflectBool('required', v)
  }

  get name(): string | null {
    return this.#name
  }
  set name(v: string | null) {
    this.#reflect('name', v)
  }

  get placeholder(): string | null {
    return this.#placeholder
  }
  set placeholder(v: string | null) {
    this.#reflect('placeholder', v)
  }

  get label(): string | null {
    return this.#label
  }
  set label(v: string | null) {
    this.#reflect('label', v)
  }

  // ---- constraint validation ---------------------------------------------
  // Every member below is a capability check, never a try/catch: `?.()` no-ops
  // where jsdom left the method out, and still lets a real browser throw.

  get form(): HTMLFormElement | null {
    return this.#internals?.form ?? null
  }

  /** The live NodeList; `labels` is the one ElementInternals member jsdom 29.1.1
   * does implement, where it is a real but always-empty NodeList (jsdom has no
   * labelable custom elements). `[]` only if attachInternals() itself is absent. */
  get labels(): ArrayLike<Node> {
    return this.#internals?.labels ?? []
  }

  get willValidate(): boolean {
    return this.#internals?.willValidate ?? true
  }

  get validity(): ValidityState {
    return this.#internals?.validity ?? ({} as ValidityState)
  }

  get validationMessage(): string {
    return this.#internals?.validationMessage ?? ''
  }

  checkValidity(): boolean {
    return this.#internals?.checkValidity?.() ?? true
  }

  reportValidity(): boolean {
    return this.#internals?.reportValidity?.() ?? true
  }

  /** Only the flags that are actually true — `{}` means valid. */
  #validityFlags(): ValidityStateFlags {
    const f: ValidityStateFlags = {}
    const m = parse(this.#value)
    if (this.#required && m === null) f.valueMissing = true
    // The trigger holds text the parser cannot resolve into a time.
    if (this.#built && this.#trigger.value !== '' && parseTyped(this.#trigger.value, this.#hc) === null)
      f.badInput = true
    if (m === null) return f

    const lo = parse(this.#min)
    const hi = parse(this.#max)
    // The element never clamps — an out-of-range legacy value stays verbatim —
    // so these flags are the *only* signal the user gets that it is out of range.
    if (!inRange(m, lo, hi)) {
      if (lo !== null && hi !== null && lo > hi) {
        // Reversed range = overnight wrap. HTML's rule for a reversed range is
        // that a value outside it is simultaneously under- and overflowing
        // (it is both past max and short of min); native <input type="time">
        // does the same. Reporting only one of the two would name a bound the
        // value is not actually on the wrong side of.
        f.rangeUnderflow = true
        f.rangeOverflow = true
      } else if (lo !== null && m < lo) f.rangeUnderflow = true
      else f.rangeOverflow = true
    }
    // Same predicate the minute column is built from, so this is exactly
    // "the current value has no option to select in the minute list".
    if (!onStep(m % 60, this.#stepM, (lo ?? 0) % 60)) f.stepMismatch = true
    return f
  }

  #validityMessage(f: ValidityStateFlags): string {
    if (f.valueMissing) return 'Please fill out this field.'
    if (f.badInput) return 'Please enter a valid time.'
    if (f.rangeUnderflow) return `Time must be ${this.#min} or later.`
    if (f.rangeOverflow) return `Time must be ${this.#max} or earlier.`
    if (f.stepMismatch) return 'Please pick one of the offered times.'
    return ''
  }

  #syncForm(): void {
    const i = this.#internals
    i?.setFormValue?.(this.#value)
    if (typeof i?.setValidity !== 'function') return
    const flags = this.#validityFlags()
    i.setValidity(flags, this.#validityMessage(flags), this.#built ? this.#trigger : undefined)
  }

  // ---- form lifecycle ----------------------------------------------------

  /** Back to the `value` attribute, silently: a reset fires no input/change. */
  formResetCallback(): void {
    this.#setValue(this.defaultValue)
    this.#valueAtOpen = this.#value
  }

  /** An ancestor <fieldset disabled> / <form> — separate from the attribute. */
  formDisabledCallback(disabled: boolean): void {
    this.#formDisabled = disabled
    if (disabled) this.hidePicker()
    this.#render()
  }

  formStateRestoreCallback(state: string | File | FormData): void {
    this.value = String(state)
  }

  // ---- attribute plumbing ------------------------------------------------

  #reflect(name: string, v: string | null): void {
    this.#reflecting = true
    try {
      if (v === null) this.removeAttribute(name)
      else this.setAttribute(name, v)
    } finally {
      this.#reflecting = false
    }
    this.#adopt(name, v)
  }

  #reflectBool(name: string, v: boolean): void {
    this.#reflecting = true
    try {
      if (v) this.setAttribute(name, '')
      else this.removeAttribute(name)
    } finally {
      this.#reflecting = false
    }
    this.#adopt(name, v ? '' : null)
  }

  attributeChangedCallback(name: string, _old: string | null, next: string | null): void {
    if (this.#reflecting) return
    this.#adopt(name, next)
  }

  /** The single place an attribute string becomes internal state. */
  #adopt(name: string, next: string | null): void {
    switch (name) {
      case 'value':
        // The attribute is the default; adopting it into the live value keeps
        // markup-driven and framework-driven initialisation identical. Silent —
        // attribute writes never fire events.
        this.#setValue(next ?? '')
        return
      case 'hour-cycle': {
        this.#hourCycleAttr = next
        const hc = next === '12' ? 12 : next === '24' ? 24 : resolveHourCycle()
        if (hc === this.#hc) return
        this.#hc = hc
        this.#rebuild()
        return
      }
      case 'min':
        this.#min = next
        this.#rebuild()
        return
      case 'max':
        this.#max = next
        this.#rebuild()
        return
      case 'step': {
        this.#step = next === null ? 60 : Number(next)
        this.#stepM = stepMinutes(this.#step)
        // stepMinutes() legitimately returns 1 only for exactly 60s; anything
        // else reaching 1 was rejected input.
        if (this.#stepM === 1 && this.#step !== 60 && !this.#stepWarned) {
          this.#stepWarned = true
          console.warn(
            `<daisy-time-picker>: step="${next}" is not a whole number of minutes >= 60. ` +
              'step is in SECONDS (native <input type="time"> semantics); falling back to 60.',
          )
        }
        this.#rebuild()
        return
      }
      case 'disabled':
        this.#disabled = next !== null
        this.#render()
        return
      case 'required':
        this.#required = next !== null
        this.#syncForm()
        return
      case 'name':
        this.#name = next
        return
      case 'placeholder':
        this.#placeholder = next
        this.#render()
        return
      case 'label':
        this.#label = next
        this.#render()
        return
    }
  }

  // ---- lifecycle ---------------------------------------------------------

  connectedCallback(): void {
    // Property upgrade: a value assigned before the definition loaded became an
    // own property that permanently shadows the prototype accessor. Capture,
    // delete, reassign — the setter then runs for real.
    for (const k of ACCESSORS) {
      if (Object.prototype.hasOwnProperty.call(this, k)) {
        const v = (this as unknown as Record<string, unknown>)[k]
        delete (this as unknown as Record<string, unknown>)[k]
        ;(this as unknown as Record<string, unknown>)[k] = v
      }
    }

    // NOTE: this element mutates consumer-visible markup on the host. The
    // consumer stylesheet has a global `.fieldset > * { min-width: 0 }` and
    // daisyUI's grid needs the host to be a block, min-width:0 flex/grid item.
    this.classList.add('block', 'min-w-0')

    if (!this.#built) this.#build()
    this.#rebuildOptions()
    this.#linkLabels()
    this.#render()
  }

  /** Host focus() is a forward — the trigger is the only focusable entry point. */
  override focus(options?: FocusOptions): void {
    if (this.#built) this.#trigger.focus(options)
    else super.focus(options)
  }

  /**
   * `static formAssociated` already makes the host labelable in a real browser,
   * so <label for> and internals.labels work natively there. jsdom implements
   * neither, and the consumers' suite is @testing-library — which resolves a
   * label by walking to the element carrying aria-labelledby. So mirror the
   * label's id onto the internal input; that is the mechanism their
   * getByLabelText() actually hits. Minting an id on the consumer's <label>
   * when it has none is the price; aria-labelledby cannot reference a nameless
   * element.
   */
  #linkLabels(): void {
    if (!this.id) return
    const ids: string[] = []
    // Scan rather than build a `label[for="…"]` selector: ids are author data
    // and CSS.escape does not exist in jsdom.
    for (const l of document.querySelectorAll('label[for]')) {
      if ((l as HTMLLabelElement).htmlFor !== this.id) continue
      if (!l.id) l.id = `${this.#uid}-label-${ids.length}`
      ids.push(l.id)
    }
    if (ids.length) this.#trigger.setAttribute('aria-labelledby', ids.join(' '))
    else this.#trigger.removeAttribute('aria-labelledby')
  }

  disconnectedCallback(): void {
    document.removeEventListener('pointerdown', this.#onDocPointerDown, true)
    // Reset the open state too. connectedCallback never re-attaches the document
    // listener, so a node re-parented while open (any Preact/React keyed-list
    // reorder) would come back with dropdown-open asserted, showPicker() dead
    // (#open still true) and nothing left to close it. Not hidePicker(): that
    // refocuses the trigger and fires `change`, neither of which a disconnect is.
    if (!this.#open) return
    this.#open = false
    this.#root.classList.remove('dropdown-open')
    this.#root.classList.add('dropdown-close')
    this.#trigger.setAttribute('aria-expanded', 'false')
  }

  // ---- build (exactly once) ---------------------------------------------

  #build(): void {
    const u = this.#uid
    this.innerHTML =
      `<div class="dropdown dropdown-close block w-full" data-dtp-root>` +
      `<input data-dtp-trigger id="${u}-input" type="text" class="input w-full" ` +
      `role="combobox" aria-haspopup="listbox" aria-expanded="false" ` +
      `aria-controls="${u}-panel" inputmode="numeric" autocomplete="off">` +
      `<div id="${u}-panel" data-dtp-panel role="group" aria-label="Choose time" ` +
      `class="dropdown-content z-10 mt-1 p-2 bg-base-100 rounded-box shadow-lg">` +
      `<div class="flex gap-1" data-dtp-cols>` +
      `<div data-dtp-col="h" role="listbox" aria-label="Hour" tabindex="0" class="${COL_CLASS}"></div>` +
      `<div data-dtp-col="m" role="listbox" aria-label="Minute" tabindex="0" class="${COL_CLASS}"></div>` +
      `</div>` +
      `<div class="flex justify-between gap-2 mt-2">` +
      `<button type="button" data-dtp-now class="btn btn-ghost btn-sm">Now</button>` +
      `<button type="button" data-dtp-done class="btn btn-primary btn-sm">Done</button>` +
      `</div>` +
      `</div>` +
      `</div>`

    this.#root = this.querySelector('[data-dtp-root]') as HTMLDivElement
    this.#trigger = this.querySelector('[data-dtp-trigger]') as HTMLInputElement
    this.#panel = this.querySelector('[data-dtp-panel]') as HTMLDivElement
    this.#cols = this.querySelector('[data-dtp-cols]') as HTMLDivElement
    this.#built = true

    this.#trigger.addEventListener('input', this.#onType)
    this.#trigger.addEventListener('change', this.#swallow)
    this.#trigger.addEventListener('blur', this.#onTriggerBlur)
    this.#trigger.addEventListener('click', this.#onTriggerClick)
    this.#trigger.addEventListener('focus', this.#onTriggerFocus)
    this.addEventListener('keydown', this.#onKeyDown)
    this.#root.addEventListener('focusout', this.#onFocusOut)
    this.#panel.addEventListener('click', this.#onPanelClick)
  }

  #col(k: ColKey): HTMLDivElement | null {
    return this.#cols.querySelector(`[data-dtp-col="${k}"]`)
  }

  /** Option lists only — never called on a value change. */
  #rebuildOptions(): void {
    if (!this.#built) return

    // The AM/PM column exists only in 12h mode.
    let p = this.#col('p')
    if (this.#hc === 12 && !p) {
      p = document.createElement('div')
      p.dataset.dtpCol = 'p'
      p.setAttribute('role', 'listbox')
      p.setAttribute('aria-label', 'AM or PM')
      p.setAttribute('tabindex', '0')
      p.className = COL_CLASS
      this.#cols.appendChild(p)
    } else if (this.#hc === 24 && p) {
      p.remove()
      p = null
    }

    const base = parse(this.#min) ?? 0
    const hours: Array<[number, string]> =
      this.#hc === 12
        ? Array.from({ length: 12 }, (_, i): [number, string] => [i + 1, String(i + 1)])
        : Array.from({ length: 24 }, (_, i): [number, string] => [i, format(i * 60).slice(0, 2)])

    // ponytail: the minute grid is anchored at `base % 60`, so it is the same
    // list for every hour. Ceiling: a step that does not divide 60 (e.g. 2700s)
    // drifts relative to native, which walks one grid across the whole day.
    // Upgrade path: make the minute column value-dependent — but that costs the
    // "never rebuild on value change" guarantee the a11y ids rely on.
    const minutes: Array<[number, string]> = []
    for (let m = 0; m < 60; m++) {
      if (onStep(m, this.#stepM, base % 60)) minutes.push([m, format(m).slice(3)])
    }

    this.#opts = {
      h: this.#fill(this.#col('h')!, 'h', hours),
      m: this.#fill(this.#col('m')!, 'm', minutes),
      p: p ? this.#fill(p, 'p', PERIODS) : [],
    }
  }

  #fill(list: HTMLDivElement, key: ColKey, items: Array<[number, string]>): HTMLDivElement[] {
    const nodes = items.map(([n, text]) => {
      const el = document.createElement('div')
      el.setAttribute('role', 'option')
      el.id = `${this.#uid}-${key}-${n}`
      el.className = OPT_CLASS
      el.dataset.n = String(n)
      el.textContent = text
      return el
    })
    list.replaceChildren(...nodes)
    return nodes
  }

  /** Full rebuild + repaint, skipped while the user is inside an open panel. */
  #rebuild(): void {
    if (!this.#built) return
    if (this.#open && this.contains(document.activeElement)) return
    this.#rebuildOptions()
    this.#render()
  }

  // ---- render (patch only) ----------------------------------------------

  #render(): void {
    if (!this.#built) return
    this.#syncTrigger()
    this.#syncOptions()
    // Single funnel: every value/attribute change repaints, so every value
    // change re-publishes the form value and the validity flags.
    this.#syncForm()
  }

  #syncTrigger(): void {
    const m = parse(this.#value)
    this.#trigger.value = m === null ? '' : display(m, this.#hc)
    this.#trigger.disabled = this.#disabled || this.#formDisabled
    if (this.#placeholder === null) this.#trigger.removeAttribute('placeholder')
    else this.#trigger.placeholder = this.#placeholder
    if (this.#label === null) this.#trigger.removeAttribute('aria-label')
    else this.#trigger.setAttribute('aria-label', this.#label)
  }

  /** The working value: what a single-column click is a substitution *into*. */
  #work(): number {
    return parse(this.#value) ?? parse(this.#min) ?? 0
  }

  /** Candidate value if option `n` of column `key` were picked. */
  #candidate(key: ColKey, n: number): number {
    const w = this.#work()
    const { h12, mm, pm } = split12(w)
    if (key === 'h') return this.#hc === 12 ? join12(n, mm, pm) : n * 60 + mm
    if (key === 'm') return Math.floor(w / 60) * 60 + n
    return join12(h12, mm, n === 1)
  }

  /** Which option index of each column the current value highlights. */
  #selectedN(key: ColKey): number | null {
    const m = parse(this.#value)
    if (m === null) return null
    const { h12, mm, pm } = split12(m)
    if (key === 'h') return this.#hc === 12 ? h12 : Math.floor(m / 60)
    if (key === 'm') return mm
    return pm ? 1 : 0
  }

  #syncOptions(): void {
    const lo = parse(this.#min)
    const hi = parse(this.#max)
    for (const key of ['h', 'm', 'p'] as ColKey[]) {
      const sel = this.#selectedN(key)
      let active: HTMLDivElement | null = null
      for (const el of this.#opts[key]) {
        const n = Number(el.dataset.n)
        const selected = n === sel
        if (selected) active = el
        el.setAttribute('aria-selected', String(selected))
        el.classList.toggle('btn-active', selected)
        // One uniform predicate, no special case for the current value: an
        // out-of-range value stays verbatim and renders selected *and*
        // aria-disabled, which is the visible error surface. Never clamped.
        const bad = !inRange(this.#candidate(key, n), lo, hi)
        if (bad) el.setAttribute('aria-disabled', 'true')
        else el.removeAttribute('aria-disabled')
      }
      // Roving aria-activedescendant lives on the listbox, which is what holds
      // DOM focus — so repainting the options above can never clobber it.
      // Selection follows focus, so the active option *is* the selected one;
      // with no selection (empty or off-grid value) there is nothing to point at
      // until the first arrow key commits something.
      const list = this.#col(key)
      if (!list) continue
      if (active) list.setAttribute('aria-activedescendant', active.id)
      else list.removeAttribute('aria-activedescendant')
    }
  }

  // ---- value -------------------------------------------------------------

  /** Normalises through parse/format. Silent — never fires events. */
  #setValue(v: string): void {
    const m = parse(v)
    const next = m === null ? '' : format(m)
    if (next === this.#value) return
    this.#value = next
    this.#render()
  }

  /** Commit from a user gesture: normalise, repaint, fire `input`. */
  #commit(minutes: number): void {
    const next = format(minutes)
    if (next === this.#value) return
    this.#value = next
    this.#render()
    this.dispatchEvent(new Event('input', { bubbles: true }))
  }

  #maybeChange(): void {
    if (this.#value === this.#valueAtOpen) return
    this.#valueAtOpen = this.#value
    this.dispatchEvent(new Event('change', { bubbles: true }))
  }

  // ---- open / close ------------------------------------------------------

  showPicker(): void {
    if (!this.#built || this.#open || this.#disabled || this.#formDisabled) return
    this.#open = true
    // Exactly one of dropdown-open / dropdown-close, always. daisyUI's hide rule
    // also matches `:not(:focus-within)`, and the trigger lives *inside*
    // .dropdown — so returning focus to it would re-open the panel unless
    // dropdown-close is asserted explicitly.
    this.#root.classList.add('dropdown-open')
    this.#root.classList.remove('dropdown-close')
    this.#trigger.setAttribute('aria-expanded', 'true')
    this.#valueAtOpen = this.#value
    document.addEventListener('pointerdown', this.#onDocPointerDown, true)
    this.#scrollIntoView()
  }

  hidePicker(): void {
    if (!this.#built || !this.#open) return
    this.#open = false
    this.#root.classList.remove('dropdown-open')
    this.#root.classList.add('dropdown-close')
    this.#trigger.setAttribute('aria-expanded', 'false')
    document.removeEventListener('pointerdown', this.#onDocPointerDown, true)
    // Decide before focusing: focus() re-enters #onTriggerFocus, which resnapshots.
    const moved = this.#value !== this.#valueAtOpen
    // Tab-out is a legitimate commit path and this is not a focus trap, so when
    // focus has already left for a real next field we must not drag it back.
    if (!this.#noRefocus) this.#trigger.focus()
    this.#valueAtOpen = this.#value
    if (moved) this.dispatchEvent(new Event('change', { bubbles: true }))
  }

  /** Arithmetic, not scrollIntoView(): jsdom does not implement the latter. */
  #scrollIntoView(): void {
    for (const key of ['h', 'm', 'p'] as ColKey[]) {
      const list = this.#col(key)
      if (!list) continue
      const opt = this.#opts[key].find(o => o.getAttribute('aria-selected') === 'true')
      if (opt) list.scrollTop = opt.offsetTop - list.clientHeight / 2 + opt.offsetHeight / 2
    }
  }

  // ---- listeners ---------------------------------------------------------

  /** The inner input's native `change` must never reach the consumer. */
  #swallow = (e: Event): void => {
    e.stopPropagation()
  }

  #onDocPointerDown = (e: Event): void => {
    if (!this.contains(e.target as Node)) this.hidePicker()
  }

  #onFocusOut = (e: FocusEvent): void => {
    if (!this.#open) return
    const rt = e.relatedTarget as Node | null
    // relatedTarget === null (clicking bare document) is the pointerdown
    // handler's job; this branch covers Tab-out.
    if (!rt || this.contains(rt)) return
    this.#noRefocus = true
    try {
      this.hidePicker()
    } finally {
      this.#noRefocus = false
    }
  }

  #onTriggerClick = (): void => {
    this.showPicker()
  }

  /** Snapshot for `change` when the user types without ever opening the panel. */
  #onTriggerFocus = (): void => {
    if (!this.#open) this.#valueAtOpen = this.#value
  }

  #onType = (e: Event): void => {
    // The inner <input> fires its own bubbling input/change events whose
    // target.value is raw typed text. They must not escape the host: consumers
    // see exactly two events, both with e.target.value === "HH:MM".
    e.stopPropagation()
    const raw = this.#trigger.value
    // Parse the RAW text, before any rewrite: maskTyped strips letters, so
    // masking first made the whole 12h am/pm branch of parseTyped unreachable
    // from the DOM.
    const m = parseTyped(raw, this.#hc)
    // Same reason: while the text holds letters ("9p", "9:30 pm") the mask would
    // eat them keystroke by keystroke. Blur/Enter still normalises the display.
    if (!/[a-z]/i.test(raw)) this.#trigger.value = maskTyped(raw)
    let moved = false
    if (m !== null) {
      const next = format(m)
      if (next !== this.#value) {
        this.#value = next
        // Repaint the options only — rewriting trigger.value would fight the caret.
        this.#syncOptions()
        moved = true
      }
    }
    // Unconditional: badInput tracks the raw text, so half-typed garbage has to
    // reach setValidity even though the value did not move.
    this.#syncForm()
    if (moved) this.dispatchEvent(new Event('input', { bubbles: true }))
  }

  /** Normalise typed text, or revert the display rather than blanking it. */
  #normalizeTyped(): void {
    const m = parseTyped(this.#trigger.value, this.#hc)
    if (m !== null) this.#commit(m)
    this.#syncTrigger()
  }

  #onTriggerBlur = (): void => {
    this.#normalizeTyped()
    // While open, hidePicker() owns the `change`.
    if (!this.#open) this.#maybeChange()
  }

  // ---- keyboard ----------------------------------------------------------

  /** Index of the active (== selected, selection follows focus) option, or -1. */
  #activeIdx(key: ColKey): number {
    const sel = this.#selectedN(key)
    return sel === null ? -1 : this.#opts[key].findIndex(o => Number(o.dataset.n) === sel)
  }

  /**
   * `n` steps of `dir` from index `i`, skipping aria-disabled options and
   * stopping dead at the ends — no wrap. Seed `i` with -1 / opts.length to mean
   * "before the start" / "past the end", which is how Home/End and a move from
   * an unselected column are expressed.
   */
  #walk(key: ColKey, i: number, dir: 1 | -1, n: number): number {
    const opts = this.#opts[key]
    let cur = i
    for (let k = 0; k < n; k++) {
      let j = cur + dir
      while (j >= 0 && j < opts.length && opts[j].getAttribute('aria-disabled') === 'true') j += dir
      if (j < 0 || j >= opts.length) break
      cur = j
    }
    return cur
  }

  /** Left-to-right focus order of the listboxes that currently exist. */
  #colNodes(): HTMLDivElement[] {
    return (['h', 'm', 'p'] as ColKey[])
      .map(k => this.#col(k))
      .filter((c): c is HTMLDivElement => c !== null)
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      if (!this.#open) return
      e.preventDefault()
      this.#setValue(this.#valueAtOpen) // silent restore: no input, no change
      this.hidePicker()
      return
    }

    const t = e.target as HTMLElement

    if (t === this.#trigger) {
      // Alt+ArrowDown is the same e.key, so it needs no separate branch.
      if (e.key !== 'Enter' && e.key !== 'ArrowDown') return
      e.preventDefault()
      if (e.key === 'Enter') {
        this.#normalizeTyped()
        if (this.#open) {
          this.hidePicker()
          return
        }
        // Commit typed text before the snapshot showPicker() takes, or the
        // change would be swallowed when the panel closes again.
        this.#maybeChange()
      }
      this.showPicker()
      this.#col('h')?.focus()
      return
    }

    // Now / Done are real <button>s: leave Enter and Space to native activation.
    const key = t.dataset?.dtpCol as ColKey | undefined
    if (!key || this.#opts[key].length === 0) return
    const opts = this.#opts[key]

    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      this.hidePicker() // the value is already committed; this fires the change
      return
    }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      // DOM focus moves between columns; it never moves between options.
      const cols = this.#colNodes()
      cols[cols.indexOf(t as HTMLDivElement) + (e.key === 'ArrowRight' ? 1 : -1)]?.focus()
      return
    }

    const i = this.#activeIdx(key)
    let j: number
    switch (e.key) {
      // PageUp/PageDown are 10 *enabled* steps, which is also the clamp.
      case 'ArrowDown':
        j = this.#walk(key, i < 0 ? -1 : i, 1, 1)
        break
      case 'PageDown':
        j = this.#walk(key, i < 0 ? -1 : i, 1, 10)
        break
      case 'ArrowUp':
        j = this.#walk(key, i < 0 ? opts.length : i, -1, 1)
        break
      case 'PageUp':
        j = this.#walk(key, i < 0 ? opts.length : i, -1, 10)
        break
      case 'Home':
        j = this.#walk(key, -1, 1, 1)
        break
      case 'End':
        j = this.#walk(key, opts.length, -1, 1)
        break
      default:
        return
    }
    e.preventDefault()
    if (j < 0 || j >= opts.length || j === i) return
    // Selection follows focus: one commit, therefore exactly one `input`, and
    // the repaint moves aria-activedescendant with it.
    this.#commit(this.#candidate(key, Number(opts[j].dataset.n)))
    this.#scrollIntoView()
  }

  #onPanelClick = (e: Event): void => {
    const t = e.target as HTMLElement
    if (t.closest('[data-dtp-done]')) {
      this.hidePicker()
      return
    }
    if (t.closest('[data-dtp-now]')) {
      const now = new Date()
      this.#commit(now.getHours() * 60 + now.getMinutes())
      return
    }
    const opt = t.closest('[role="option"]') as HTMLElement | null
    if (!opt || opt.getAttribute('aria-disabled') === 'true') return
    const key = (opt.parentElement as HTMLElement | null)?.dataset.dtpCol as ColKey | undefined
    if (!key) return
    this.#commit(this.#candidate(key, Number(opt.dataset.n)))
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('daisy-time-picker'))
  customElements.define('daisy-time-picker', DaisyTimePicker)

declare global {
  interface HTMLElementTagNameMap {
    'daisy-time-picker': DaisyTimePicker
  }
}
