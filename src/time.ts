/**
 * Pure time logic for <daisy-time-picker>. No DOM, no imports, zero dependencies.
 *
 * The unit throughout is minutes since midnight: an integer in 0..1439.
 * A Date is never constructed from a value string — only inside resolveHourCycle,
 * and there only from an explicit UTC timestamp.
 */

const VALUE_RE = /^(\d{1,2}):([0-5]\d)(?::[0-5]\d(?:\.\d+)?)?$/

const pad = (n: number): string => (n < 10 ? '0' : '') + n

/**
 * "HH:MM" | "HH:MM:SS" | "HH:MM:SS.sss" -> minutes since midnight.
 * Seconds and fractional seconds are accepted and discarded: Postgres/PostgREST
 * `time` columns come back as "09:00:00".
 */
export function parse(v: string | null | undefined): number | null {
  if (!v) return null
  const m = VALUE_RE.exec(v)
  if (!m) return null
  const h = Number(m[1])
  if (h > 23) return null
  return h * 60 + Number(m[2])
}

/** The only string ever written to `.value`. */
export function format(m: number): string {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

/** Human-facing text. Never written to `.value`. */
export function display(m: number, hc: 12 | 24): string {
  if (hc === 24) return format(m)
  const { h12, mm, pm } = split12(m)
  // ponytail: AM/PM hardcoded ASCII with a plain space. Ceiling: no localized day
  // periods (ja "午後", en-GB "a.m.", the NBSP separator ICU emits in many locales)
  // and no locale digit shaping. Deliberate — it keeps consumer assertions stable
  // regardless of the machine's ICU data. Upgrade path (v2): render via
  // Intl.DateTimeFormat(locales, { hour, minute }).formatToParts() and stitch the
  // dayPeriod/literal parts, gated behind an explicit opt-in prop.
  return `${h12}:${pad(mm)} ${pm ? 'PM' : 'AM'}`
}

export function split12(m: number): { h12: number; mm: number; pm: boolean } {
  const h = Math.floor(m / 60)
  return { h12: h % 12 || 12, mm: m % 60, pm: h >= 12 }
}

/** h12 % 12 is what makes 12 AM -> 00:mm and 12 PM -> 12:mm come out right. */
export function join12(h12: number, mm: number, pm: boolean): number {
  return ((h12 % 12) + (pm ? 12 : 0)) * 60 + mm
}

/**
 * Digit auto-colon while typing.
 *
 * DELIBERATE DIVERGENCE from the consumer's formatTimeInput, which this was
 * originally specified to match byte-for-byte: that helper is 24h-only and
 * derives the colon position from the digit count alone, so it turns a typed
 * "9:30" into "93:0" and deletes the letters of "9pm". A time picker that
 * silently discards "9:30" is broken whatever it was copied from, so:
 *   - an explicitly typed ":" is honoured as the separator instead of being
 *     stripped and re-derived ("9:30" stays "9:30", which parse() accepts);
 *   - letters are still dropped here, but #onType skips the mask entirely when
 *     the raw text contains any, so 12h "9pm" survives to parseTyped.
 * Pure-digit input ("0900" -> "09:00", "09", "9", "090012") is unchanged.
 */
export function maskTyped(raw: string): string {
  const i = raw.indexOf(':')
  if (i >= 0) {
    const h = raw.slice(0, i).replace(/\D/g, '').slice(0, 2)
    return `${h}:${raw.slice(i + 1).replace(/\D/g, '').slice(0, 2)}`
  }
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (digits.length <= 2) return digits
  return `${digits.slice(0, 2)}:${digits.slice(2)}`
}

const TYPED_12_RE = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])\.?m?\.?$/i

/** Free text from the input -> minutes, or null if it isn't a time yet. */
export function parseTyped(raw: string, hc: 12 | 24): number | null {
  if (hc === 12) {
    const m = TYPED_12_RE.exec(raw.trim())
    if (m) {
      const h12 = Number(m[1])
      if (h12 >= 1 && h12 <= 12) {
        return join12(h12, m[2] ? Number(m[2]) : 0, m[3].toLowerCase() === 'p')
      }
    }
    // fall through: "13:45" typed into a 12h field is still unambiguous
  }
  return parse(maskTyped(raw))
}

/** `step` is in seconds — native <input type="time"> semantics. */
export function stepMinutes(sec: number): number {
  if (!Number.isFinite(sec) || sec < 60 || sec % 60 !== 0) return 1
  return sec / 60
}

/** True when `m` sits on the step grid anchored at `base`. */
export function onStep(m: number, stepM: number, base: number): boolean {
  // Positive modulo: a value below `base` would otherwise give a negative
  // remainder and silently report on-grid times as off-grid.
  return (((m - base) % stepM) + stepM) % stepM === 0
}

/** `null` bound = unbounded. `lo > hi` is the HTML spec's overnight wrap. */
export function inRange(m: number, lo: number | null, hi: number | null): boolean {
  if (lo === null) return hi === null || m <= hi
  if (hi === null) return m >= lo
  return lo <= hi ? m >= lo && m <= hi : m >= lo || m <= hi
}

/** Does this locale render clock times with a day period? */
export function resolveHourCycle(locales?: string | string[]): 12 | 24 {
  try {
    // Not resolvedOptions().hourCycle: with no `hour` option requested most engines
    // return undefined, and JSC (WebKitGTK — Tauri's Linux webview — and WKWebView)
    // shipped it late and inconsistently.
    // timeZone: 'UTC' is mandatory; without it the probe renders in the ambient
    // timezone and the whole suite becomes TZ-dependent.
    const parts = new Intl.DateTimeFormat(locales, { hour: 'numeric', timeZone: 'UTC' })
      .formatToParts(new Date(Date.UTC(2000, 0, 1, 13, 0, 0)))
    // Presence of a dayPeriod part only — never its text, never the digits. That is
    // what makes non-Latin numerals (ar-EG, hi-IN, th-TH) and the h11/h12/h23/h24
    // distinction irrelevant: a regex for "13" fails on those, and an ASCII "PM"
    // check fails on ko-KR, which renders "오후 1시".
    return parts.some(p => p.type === 'dayPeriod') ? 12 : 24
  } catch {
    // Intl absent, formatToParts absent, or locale data throws.
    return 24
  }
}
