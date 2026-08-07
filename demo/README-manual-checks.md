# Manual checks (browser only)

`jsdom` has no cascade, no layout, and an incomplete `ElementInternals` (no
`setFormValue`, no `labels`, no `scrollIntoView`). The test suite proves the
logic against that stand-in; the items below only exist, or only mean
anything, in a real browser. Run through them by hand before publishing.

## Running the demo

```bash
npx @tailwindcss/cli@4 -i demo/app.css -o demo/out.css   # build demo/out.css first
npx vite demo
```

(Any static file server that serves `demo/` at its root works too, e.g.
`npx serve demo`.)

## Checklist

1. **Real `FormData` carries each picker's value under its `name`.**
   Pick a time in picker 1, open devtools console, and check the readout
   `<pre>` at the bottom of the page — it prints `new FormData(form)` on every
   `change`. Confirm `time24` (or whichever picker you touched) shows up with
   the `HH:MM` you picked.
   *Expected:* the entry is present and matches the picker's displayed value.
   jsdom's `ElementInternals` is missing `setFormValue` entirely, so this can
   only be proven in a real browser.

2. **Native submit is blocked while the required picker is empty.**
   Leave picker 4 (required) empty and click **Submit**.
   *Expected:* the browser shows its native "please fill out this field"
   validation bubble anchored on picker 4's trigger, and the `submit` handler
   never runs (the readout does not update). Fill picker 4 and submit again —
   this time it should go through and the readout updates.

3. **Clicking the `<label>` focuses the picker.**
   Click directly on the "Meeting time (24h)" label text above picker 1
   (not the input itself).
   *Expected:* picker 1's trigger receives focus (focus ring appears).
   Form-associated custom elements are labelable, but jsdom does not
   implement label-click activation, so this only works in a real browser.

4. **The panel's closed-state class actually hides it.**
   Open picker 1, then click elsewhere on the page to close it. Inspect the
   panel wrapper in devtools while closed.
   *Expected:* the closed-state utility class is present and computed
   `display` is `none`. The test suite only asserts which class is on the
   element — jsdom has no cascade or layout, so it can never confirm the class
   actually hides anything.

5. **The selected option is scroll-centered when the panel opens.**
   Pick an hour near the bottom of the list (e.g. late evening in the 24h
   picker), close the panel, then reopen it.
   *Expected:* the hour column scrolls so the selected hour sits roughly in
   the middle of the visible list, not pinned to the top or bottom. The
   element computes `scrollTop` arithmetically rather than calling
   `scrollIntoView`, which jsdom does not implement.

6. **Open → close → open reopens correctly.**
   Open picker 2, close it (click elsewhere), then immediately click the
   trigger again.
   *Expected:* it reopens on the very next click. daisyUI's default dropdown
   relies on `:focus-within`, which has a known bug where a dropdown that was
   just closed via blur cannot be reopened by a single click — the
   consumer app works around this today with a `useState`-driven open flag in
   its existing Cally `DatePicker.tsx`. This element manages its open state
   explicitly instead, and this check is what proves it doesn't inherit the
   same bug.

7. **Two consumer-side global CSS rules — eyeball them.**
   - `.btn:active:not(:disabled) { scale: .975 }` — click and hold the "Now"
     or "Done" button inside an open picker; it should shrink very slightly.
   - `.fieldset > * { min-width: 0 }` — shrink the browser window narrow;
     the pickers inside their `fieldset` wrappers should compress instead of
     overflowing or forcing horizontal scroll.
   These rules are not part of this package, but they are what a real
   consumer page layers on top of it, so check the pickers still look right
   underneath them.

8. **Keyboard walk.**
   `Tab` to a picker's trigger → `ArrowDown` to open the panel (focus moves
   into the hour column) → `ArrowUp`/`ArrowDown` to move within a column →
   `ArrowRight`/`ArrowLeft` to move between columns → `Escape` to cancel
   (reverts to the value the panel had when it opened, panel closes, no
   `change` fires) → reopen and `Enter` on a highlighted option to commit and
   close.
   *Expected:* every step moves the highlighted option and, for
   Escape/Enter, closes the panel with the value you'd expect (reverted or
   committed). None of this depends on anything jsdom can't do — it's here
   because it's fastest to confirm by hand alongside the checks above.
