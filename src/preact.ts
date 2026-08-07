/**
 * JSX type augmentation so Preact consumers can write <daisy-time-picker>
 * directly, without an `h('daisy-time-picker', …)` escape hatch.
 *
 * Types only: this module has no runtime body. Preact's automatic JSX
 * runtime (`jsxImportSource: "preact"`) resolves its `JSX` namespace through
 * `preact/jsx-runtime`, which re-exports the same `JSX` namespace declared
 * here on the `preact` module, so augmenting `preact` is enough.
 *
 * Preact wires `onChange` to the native `change` event (unlike React, which
 * only fires it for real form controls), so both `onChange` and `onInput`
 * below are real, live handlers.
 */
import type { ClassAttributes, JSX } from 'preact'
import type { DaisyTimePicker } from './index.js'

interface DaisyTimePickerAttributes extends ClassAttributes<DaisyTimePicker> {
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
  class?: string
  id?: string
  onChange?: JSX.GenericEventHandler<DaisyTimePicker>
  onInput?: JSX.InputEventHandler<DaisyTimePicker>
}

declare module 'preact' {
  namespace JSX {
    interface IntrinsicElements {
      'daisy-time-picker': DaisyTimePickerAttributes
    }
  }
}

export {}
