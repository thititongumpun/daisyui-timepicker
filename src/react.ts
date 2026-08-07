/**
 * JSX type augmentation so React consumers can write <daisy-time-picker>
 * directly, without an `h('daisy-time-picker', …)` escape hatch.
 *
 * Types only: this module has no runtime body.
 *
 * Augments `react/jsx-runtime`, not `react`: with `jsx: "react-jsx"` and no
 * `jsxImportSource`, React 19's automatic runtime resolves the live `JSX`
 * namespace through `react/jsx-runtime`. Verified empirically — augmenting
 * `react` directly compiles but the element type never resolves, which is
 * silently absent rather than an error, so this was checked rather than
 * assumed.
 *
 * `onChange` and `onInput` are deliberately omitted. React 19 sets
 * properties on custom elements (React 18 stringified everything), but its
 * ChangeEventPlugin still only fires synthetic `onChange` for real
 * <input>/<select>/<textarea> elements, never for a custom element — so an
 * `onChange` prop typed here would compile but silently never fire. That is
 * worse than not typing it at all. Use a `ref` and
 * `addEventListener('change', …)` instead; see the README for the pattern.
 */
import type * as React from 'react'
import type {} from 'react/jsx-runtime'
import type { DaisyTimePicker } from './index.js'

interface DaisyTimePickerAttributes {
  'hour-cycle'?: '12' | '24' | 'auto'
  value?: string
  min?: string
  max?: string
  name?: string
  placeholder?: string
  label?: string
  step?: string | number
  disabled?: boolean
  required?: boolean
  className?: string
  id?: string
  ref?: React.Ref<DaisyTimePicker>
}

declare module 'react/jsx-runtime' {
  namespace JSX {
    interface IntrinsicElements {
      'daisy-time-picker': DaisyTimePickerAttributes
    }
  }
}

export {}
