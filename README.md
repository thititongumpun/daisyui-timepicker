# daisyui-timepicker

A zero-dependency `<daisy-time-picker>` custom element, styled entirely with
daisyUI 5 / Tailwind classes. Supports 12-hour and 24-hour formats.

daisyUI ships a calendar (via Cally) but no time picker, and nothing on npm
fills the gap in a themeable way — `jb-time-picker` is a web component too,
but it renders its own design system inside shadow DOM, so it can't inherit
your daisyUI theme. This element uses **light DOM specifically so daisyUI
classes reach its internals** — no shadow root, no `::part()` workarounds.

Works in plain HTML, Preact, React (client), and Next.js. Built for a Tauri
desktop app, so it's tested against all three Tauri webviews: WebKitGTK
(Linux), WKWebView (macOS), WebView2 (Windows).

```bash
npm install daisyui-timepicker daisyui tailwindcss
```

`daisyui` and `tailwindcss` are peer dependencies — the element needs their
classes to render as anything but unstyled text. Which brings us to the one
thing that will silently break your build:

## ⚠️ Tailwind `@source` — required

Tailwind does not scan `node_modules`. Without this line the picker renders
as unstyled stacked text, with no error anywhere:

```css
@source "../node_modules/daisyui-timepicker/dist";
```

Path is relative to *your CSS file*. Tailwind v3: add the same path to your
`content` array instead.

## Plain HTML

```html
<script type="module" src="node_modules/daisyui-timepicker/dist/index.js"></script>

<label for="meeting-time" class="label">Meeting time</label>
<daisy-time-picker
  id="meeting-time"
  name="time"
  hour-cycle="24"
  min="09:00"
  max="18:00"
  step="900"
></daisy-time-picker>

<script type="module">
  const picker = document.getElementById('meeting-time')
  picker.addEventListener('change', e => console.log(e.target.value)) // "HH:MM"
</script>
```

## Preact

Preact wires `onChange` straight to the element's native `change` event — no
`ref` dance needed.

```jsx
import 'daisyui-timepicker'
import 'daisyui-timepicker/preact' // JSX types only, zero runtime bytes
import { useState } from 'preact/hooks'

function Meeting() {
  const [time, setTime] = useState('09:00')
  return (
    <daisy-time-picker
      value={time}
      hour-cycle="24"
      onChange={e => setTime(e.target.value)}
    />
  )
}
```

## React / Next.js

**React does not wire `onChange` to a custom element's `change` event.**
React 19 does set properties on custom elements directly (React 18
stringified everything, which broke web components generally), but its
`ChangeEventPlugin` only fires synthetic `onChange` for real
`<input>`/`<select>`/`<textarea>` elements — never for a custom element. For
that reason the React JSX types in this package **deliberately omit
`onChange` and `onInput`** rather than advertise a handler that silently
never fires. Use a `ref` instead:

```jsx
'use client'
import 'daisyui-timepicker'
import 'daisyui-timepicker/react' // JSX types only, zero runtime bytes
import { useEffect, useRef, useState } from 'react'

function Meeting() {
  const ref = useRef(null)
  const [time, setTime] = useState('09:00')

  useEffect(() => {
    const el = ref.current
    const h = e => setTime(e.target.value)
    el.addEventListener('change', h)
    return () => el.removeEventListener('change', h)
  }, [])

  return <daisy-time-picker ref={ref} value={time} hour-cycle="24" />
}
```

**Next.js:** element registration is guarded by
`typeof customElements !== 'undefined'`, so importing the package in a
server component is a no-op rather than a crash — but you still need
`'use client'` on the component that actually renders the tag, as above.

**React ≤18:** not supported. React 18 and earlier stringify all props to
attributes, so property-style usage (`value={time}`) won't take effect;
plain attributes still work, but you lose live updates without a manual
`ref.current.setAttribute(...)` escape hatch.

Both `daisyui-timepicker/preact` and `daisyui-timepicker/react` are
types-only subpaths — no runtime code, and neither imports the other, so a
Preact app never pulls in React's types (or vice versa). Import whichever
one matches your framework once, anywhere TypeScript picks it up (an entry
file or a `.d.ts`).

## Reference

### Attributes & properties

Every observed attribute has a matching property of the same name (camelCase
for the property). Attribute writes are one-way into the property; see the
`value` note below for the one exception.

| Attribute | Property | Type | Default | Notes |
|---|---|---|---|---|
| `value` | `value` | `string` | `''` | `"HH:MM"` (24h storage format regardless of `hour-cycle`). **Never reflected**: setting `.value` does *not* rewrite the `value` attribute. Setting the attribute *does* update the live value. |
| — | `defaultValue` | `string` | `''` | Get/set the `value` attribute directly. This is what a form `reset()` restores. |
| `hour-cycle` | `hourCycle` | `string \| null` | `null` | The literal attribute string. `"12"` and `"24"` are the only values that pin a format; anything else — `"auto"`, omitted, or garbage — auto-detects. See [hour-cycle](#hour-cycle). |
| — | `resolvedHourCycle` | `12 \| 24` | — | Read-only. What is actually rendered, after resolving `hour-cycle`. |
| `min` | `min` | `string \| null` | `null` | `"HH:MM"`. |
| `max` | `max` | `string \| null` | `null` | `"HH:MM"`. `min > max` means an overnight wrap. |
| `step` | `step` | `number` | `60` | **Seconds**, like native `<input type="time">`. See [min / max / step](#min--max--step). |
| `disabled` | `disabled` | `boolean` | `false` | |
| `required` | `required` | `boolean` | `false` | |
| `name` | `name` | `string \| null` | `null` | Form field name. |
| `placeholder` | `placeholder` | `string \| null` | `null` | Placeholder on the internal `<input>`. |
| `label` | `label` | `string \| null` | `null` | Sets `aria-label` on the internal `<input>`. |

Additional read-only properties (delegate to `ElementInternals`; see
[Forms](#forms) for what they return under jsdom):

| Property | Type |
|---|---|
| `form` | `HTMLFormElement \| null` |
| `labels` | `ArrayLike<Node>` |
| `willValidate` | `boolean` |
| `validity` | `ValidityState` |
| `validationMessage` | `string` |

### Methods

| Method | Returns | Notes |
|---|---|---|
| `checkValidity()` | `boolean` | |
| `reportValidity()` | `boolean` | |
| `showPicker()` | `void` | Opens the dropdown. No-op if disabled or already open. |
| `hidePicker()` | `void` | Closes the dropdown. Fires `change` if the value moved while open. |
| `focus(options?)` | `void` | Focuses the internal trigger `<input>`. |

### Events

| Event | Fired when | `e.target.value` |
|---|---|---|
| `input` | Every committed change while interacting: arrow-key navigation in the panel, clicking an option, clicking **Now**, or typing text that parses to a valid time. | `"HH:MM"` |
| `change` | The value differs from what it was when the field last gained focus / the panel last opened — fired on close (Done, Enter, outside click, blur, tab-out). | `"HH:MM"` |

Both are plain `Event` objects (`bubbles: true`), not `CustomEvent` — read the
value off `e.target.value`, not `e.detail`. The internal `<input>`'s own
native `input`/`change` events never escape the host; you only ever see the
two above.

You can also type directly into the field. Digits auto-insert a colon
(`0900` → `09:00`); a colon you type yourself is left where you put it, so
`9:30` works too. In 12h mode a trailing `am`/`pm` is accepted (`9pm`,
`9:30 a.m.`) — while the text contains letters the field is not rewritten, and
it normalises to the display form (`9:00 PM`) on blur. Unparsable text reverts
to the last valid value on blur rather than being kept.

## hour-cycle

`hour-cycle="auto"` (also the default when the attribute is absent) probes
`Intl.DateTimeFormat({ hour: 'numeric', timeZone: 'UTC' }).formatToParts()`
for the presence of a `dayPeriod` part. If one is present, the locale uses a
12-hour clock; if not, 24-hour.

This deliberately does **not** use `resolvedOptions().hourCycle`, which is
unreliable across engines — JSC (WebKitGTK and WKWebView, two of the three
Tauri webviews) shipped it late and inconsistently. If `Intl` is unavailable
or throws, it falls back to `24`.

The resolved result is exposed as the read-only `resolvedHourCycle` property
(`12 | 24`) so you can check what actually rendered.

**Set `hour-cycle` explicitly (`"12"` or `"24"`) in any app with a house
convention rather than relying on `"auto"`** — auto-detection is a
convenience for locale-agnostic tools, not a substitute for a product
decision.

AM/PM labels are hardcoded ASCII (`"AM"` / `"PM"`), not `Intl`-localized —
deliberately, to keep consumers' test assertions locale-stable. A Japanese
user in 12h mode sees `"9:00 PM"`, not `"午後9:00"`.

## min / max / step

`step` is in **seconds**, default `60` — matching native
`<input type="time">`. `step="900"` is 15 minutes. Values under `60` or not
a whole multiple of `60` fall back to 1-minute steps with a console warning.

`step` filters which minute options exist; it does **not** round the value.
Options anchor at `min` (or `:00` if `min` is unset), so `min="09:05"
step="900"` offers `:05`, `:20`, `:35`, `:50` — not `:00`, `:15`, `:30`,
`:45`.

**Out-of-range and off-step values are kept verbatim and never clamped.**
This is deliberate: a legacy `08:30` row loaded from a database must not
silently become `09:00` and get written back — that's data corruption with
no error surface. Instead, an invalid value is reported through
`setValidity()` (`rangeUnderflow`, `rangeOverflow`, or `stepMismatch`), and
the matching option in the panel renders `aria-selected="true"` *and*
`aria-disabled="true"` simultaneously — selected because it's the current
value, disabled because picking it again isn't a valid move.

`min > max` means an overnight wrap (e.g. a night-shift window), per the
HTML spec for `<input type="time">`. A value outside a reversed range counts
as both under- and overflowing.

## Forms

Form association goes through `ElementInternals` only (no hidden `<input>`).
Support floor: Chromium 77+, Firefox 98+, Safari 16.4+ — which covers all
three Tauri webviews.

Lifecycle callbacks, invoked by the browser, not called directly:

- `formResetCallback()` — resets to the `value` attribute (`defaultValue`), silently (no `input`/`change`).
- `formDisabledCallback(disabled)` — fires from an ancestor `<fieldset disabled>`, independent of the `disabled` attribute.
- `formStateRestoreCallback(state)` — browser bfcache/autofill restore.

Validity flags actually set (via `setValidity`): `valueMissing` (when
`required` and empty), `badInput` (unparsable typed text), `rangeUnderflow`,
`rangeOverflow`, `stepMismatch`.

**In jsdom these APIs are absent** — `setFormValue`, `setValidity`, and
`form` are all missing from jsdom 29's `ElementInternals`. The element
degrades silently through capability guards and never throws, so existing
tests are safe. Under jsdom: `checkValidity()` returns `true`, `validity`
returns `{}`, and `form` returns `null`.

## Accessibility

The element owns its subtree — **do not pass children.** Anything inside
`<daisy-time-picker>...</daisy-time-picker>` is discarded and replaced on
connect.

Keyboard focus stays on the listbox container at all times (roving
`aria-activedescendant`, not roving `tabindex`), so repainting
`aria-selected` on options can never steal focus mid-interaction.

| Key | Context | Action |
|---|---|---|
| `Enter` / `ArrowDown` (incl. `Alt+ArrowDown`) | trigger input | Opens the panel and focuses the hour column. `Enter` also commits typed text first, and closes the panel again if it was already open. |
| `Escape` | anywhere while open | Restores the value to what it was when the panel opened (silently) and closes. |
| `ArrowLeft` / `ArrowRight` | a column | Moves focus to the previous/next column (Hour / Minute / AM-PM). |
| `ArrowUp` / `ArrowDown` | a column | Moves and commits one enabled option. |
| `PageUp` / `PageDown` | a column | Moves and commits 10 enabled options. |
| `Home` / `End` | a column | Jumps to the first/last enabled option. |
| `Enter` / `Space` | a column | Closes the panel (the value is already committed). |

Disabled (out-of-range) options are skipped by all of the above — navigation
never lands on one. **Now** and **Done** are real `<button>` elements, so
their own `Enter`/`Space` activation is native, not custom-handled.

Three label-association mechanisms are supported simultaneously:

1. A native `<label for="picker-id">` — works out of the box in a real
   browser because `static formAssociated = true` makes the host labelable.
2. The same `<label for>` is also mirrored into `aria-labelledby` on the
   internal `<input>`, as a belt-and-suspenders mechanism for
   `@testing-library`/jsdom environments where native label association
   isn't implemented.
3. The `label` property/attribute sets `aria-label` on the internal
   `<input>` directly, for when you don't want a visible `<label>` element.

## Theming

The element emits only daisyUI/Tailwind utility classes — no custom CSS. For
a Tailwind v4 safelist (or if you're pruning aggressively), here's every
class it can produce:

```
block min-w-0 dropdown dropdown-close dropdown-open w-full input
dropdown-content z-10 mt-1 p-2 bg-base-100 rounded-box shadow-lg flex gap-1
flex-col gap-0.5 overflow-y-auto max-h-56 justify-between gap-2 mt-2 btn
btn-ghost btn-sm btn-primary justify-center btn-active
```

Note that the element adds `block min-w-0` to **the host element's own class
list** on connect — this is the element mutating your markup, not just its
internal DOM, so don't be surprised to find those two classes on
`<daisy-time-picker>` itself in devtools.

Because everything is a daisyUI class, the picker follows whatever
`data-theme` is active on an ancestor, same as any other daisyUI component.

## Browser support

Requires `ElementInternals` (form association) and custom elements v1:
Chromium 77+, Firefox 98+, Safari 16.4+. Verified against all three Tauri
webviews: WebKitGTK (Linux), WKWebView (macOS), WebView2 (Windows).
