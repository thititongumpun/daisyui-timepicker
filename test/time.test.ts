import { describe, it, expect, vi } from 'vitest'
import {
  parse,
  format,
  display,
  split12,
  join12,
  maskTyped,
  parseTyped,
  stepMinutes,
  onStep,
  inRange,
  resolveHourCycle,
} from '../src/time.js'

describe('parse', () => {
  it.each([
    ['00:00', 0],
    ['9:05', 545],
    ['09:05', 545],
    ['23:59', 1439],
    ['09:00:00', 540],
    ['09:00:00.500', 540],
    ['09:00:59.123456', 540],
  ])('accepts %j -> %i', (input, expected) => {
    expect(parse(input)).toBe(expected)
  })

  it.each([
    ['24:00'],
    ['09:60'],
    ['9:5'],
    [''],
    ['  '],
    ['9'],
    ['09:'],
    [':05'],
    ['09:05:60'],
    ['09:05:'],
    ['9:05 AM'],
    ['0900'],
    ['09-05'],
    ['abc'],
    ['009:05'],
    ['09:05.5'],
  ])('rejects %j', input => {
    expect(parse(input)).toBeNull()
  })

  it('rejects null and undefined', () => {
    expect(parse(null)).toBeNull()
    expect(parse(undefined)).toBeNull()
  })
})

describe('format', () => {
  it.each([
    [0, '00:00'],
    [545, '09:05'],
    [720, '12:00'],
    [1439, '23:59'],
  ])('%i -> %j', (m, expected) => {
    expect(format(m)).toBe(expected)
  })

  it('round-trips through parse for all 1440 minutes', () => {
    for (let m = 0; m < 1440; m++) expect(parse(format(m))).toBe(m)
  })
})

describe('display', () => {
  it('24h is identical to format', () => {
    for (let m = 0; m < 1440; m++) expect(display(m, 24)).toBe(format(m))
  })

  it.each([
    [0, '12:00 AM'],
    [720, '12:00 PM'],
    [750, '12:30 PM'],
    [1439, '11:59 PM'],
    [545, '9:05 AM'],
    [1, '12:01 AM'],
    [780, '1:00 PM'],
  ])('12h: %i -> %j', (m, expected) => {
    expect(display(m, 12)).toBe(expected)
  })

  it('uses a plain ASCII space and ASCII AM/PM', () => {
    for (let m = 0; m < 1440; m++) expect(display(m, 12)).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/)
  })
})

describe('split12 / join12', () => {
  it('round-trips every minute of the day', () => {
    for (let m = 0; m < 1440; m++) {
      const { h12, mm, pm } = split12(m)
      expect(join12(h12, mm, pm)).toBe(m)
    }
  })

  it.each([
    [0, { h12: 12, mm: 0, pm: false }],
    [720, { h12: 12, mm: 0, pm: true }],
    [545, { h12: 9, mm: 5, pm: false }],
    [1439, { h12: 11, mm: 59, pm: true }],
  ])('split12(%i)', (m, expected) => {
    expect(split12(m)).toEqual(expected)
  })

  it('maps 12 AM -> 00:mm and 12 PM -> 12:mm', () => {
    expect(join12(12, 30, false)).toBe(30)
    expect(join12(12, 30, true)).toBe(750)
  })
})

describe('maskTyped', () => {
  // Pure-digit input still matches the consumer's formatTimeInput byte for byte.
  it.each([
    ['', ''],
    ['9', '9'],
    ['09', '09'],
    ['090', '09:0'],
    ['0900', '09:00'],
    ['090012', '09:00'],
    ['09:00', '09:00'],
    ['a9b0c0d0', '90:00'],
  ])('%j -> %j', (raw, expected) => {
    expect(maskTyped(raw)).toBe(expected)
  })

  // Deliberate divergence from formatTimeInput, which re-derives the colon from
  // the digit count and so mangles "9:30" into "93:0". See src/time.ts.
  it.each([
    ['9:', '9:'],
    ['9:3', '9:3'],
    ['9:30', '9:30'],
    ['9:5', '9:5'],
    ['09:30', '09:30'],
    ['9:305', '9:30'],
  ])('honours a typed colon: %j -> %j', (raw, expected) => {
    expect(maskTyped(raw)).toBe(expected)
  })
})

describe('parseTyped', () => {
  it.each([
    ['0900', 540],
    ['09:00', 540],
    ['9:30', 570], // a typed colon is honoured, not re-derived from digit count
    ['2359', 1439],
    ['9', null],
    ['', null],
    ['2500', null],
  ])('24h: %j -> %s', (raw, expected) => {
    expect(parseTyped(raw, 24)).toBe(expected)
  })

  it.each([
    ['9:00 pm', 1260],
    ['9:00 PM', 1260],
    ['9p', 1260],
    ['9 P.M.', 1260],
    ['9am', 540],
    ['12am', 0],
    ['12pm', 720],
    ['12:30pm', 750],
    ['9:05a', 545],
  ])('12h text: %j -> %i', (raw, expected) => {
    expect(parseTyped(raw, 12)).toBe(expected)
  })

  it.each([
    ['0900', 540],
    ['13:45', 825],
    ['2359', 1439],
  ])('12h falls back to the 24h path: %j -> %i', (raw, expected) => {
    expect(parseTyped(raw, 12)).toBe(expected)
  })

  it.each([['13pm'], ['0pm'], ['9:60pm'], ['xpm'], ['']])(
    '12h rejects %j',
    raw => {
      expect(parseTyped(raw, 12)).toBeNull()
    },
  )
})

describe('stepMinutes', () => {
  it.each([
    [60, 1],
    [900, 15],
    [1800, 30],
    [3600, 60],
    [30, 1],
    [90, 1],
    [0, 1],
    [-60, 1],
    [NaN, 1],
    [Infinity, 1],
  ])('%s -> %i', (sec, expected) => {
    expect(stepMinutes(sec)).toBe(expected)
  })
})

describe('onStep', () => {
  const base = 545 // min="09:05"
  const stepM = 15

  it('accepts values on the grid at or above base', () => {
    expect(onStep(545, stepM, base)).toBe(true)
    expect(onStep(560, stepM, base)).toBe(true)
    expect(onStep(575, stepM, base)).toBe(true)
  })

  it('rejects values off the grid', () => {
    expect(onStep(550, stepM, base)).toBe(false)
    expect(onStep(546, stepM, base)).toBe(false)
  })

  it('uses a positive modulo below base', () => {
    expect(onStep(530, stepM, base)).toBe(true) // 545 - 15
    expect(onStep(500, stepM, base)).toBe(true) // 545 - 45
    expect(onStep(535, stepM, base)).toBe(false)
    expect(onStep(0, stepM, base)).toBe(false) // -545 % 15 = -5 -> +15 -> 10
  })

  it('step of 1 puts everything on the grid', () => {
    for (let m = 0; m < 1440; m++) expect(onStep(m, 1, base)).toBe(true)
  })
})

describe('inRange', () => {
  it('treats null bounds as unbounded', () => {
    expect(inRange(720, null, null)).toBe(true)
    expect(inRange(720, null, 800)).toBe(true)
    expect(inRange(900, null, 800)).toBe(false)
    expect(inRange(900, 800, null)).toBe(true)
    expect(inRange(700, 800, null)).toBe(false)
  })

  it('is inclusive when lo <= hi', () => {
    expect(inRange(540, 540, 1020)).toBe(true)
    expect(inRange(1020, 540, 1020)).toBe(true)
    expect(inRange(539, 540, 1020)).toBe(false)
    expect(inRange(1021, 540, 1020)).toBe(false)
    expect(inRange(600, 600, 600)).toBe(true)
    expect(inRange(601, 600, 600)).toBe(false)
  })

  it('wraps overnight when lo > hi', () => {
    const lo = 1320 // 22:00
    const hi = 360 // 06:00
    expect(inRange(1380, lo, hi)).toBe(true) // 23:00
    expect(inRange(120, lo, hi)).toBe(true) // 02:00
    expect(inRange(1320, lo, hi)).toBe(true) // 22:00, inclusive
    expect(inRange(360, lo, hi)).toBe(true) // 06:00, inclusive
    expect(inRange(720, lo, hi)).toBe(false) // 12:00
    expect(inRange(361, lo, hi)).toBe(false)
    expect(inRange(1319, lo, hi)).toBe(false)
  })
})

describe('resolveHourCycle', () => {
  it.each([
    ['en-US', 12],
    ['en-GB', 24],
    ['ja-JP', 24],
    ['de-DE', 24],
    ['th-TH', 24],
    ['ko-KR', 12],
    ['ar-EG', 12],
  ])('%s -> %i', (locale, expected) => {
    expect(resolveHourCycle(locale)).toBe(expected)
  })

  it('accepts an array of locales', () => {
    expect(resolveHourCycle(['en-US'])).toBe(12)
    expect(resolveHourCycle(['de-DE'])).toBe(24)
  })

  it('returns 12 or 24 for the ambient locale', () => {
    expect([12, 24]).toContain(resolveHourCycle())
  })

  it('falls back to 24 when Intl throws', () => {
    vi.stubGlobal('Intl', {
      DateTimeFormat() {
        throw new Error()
      },
    })
    try {
      expect(resolveHourCycle()).toBe(24)
      expect(resolveHourCycle('en-US')).toBe(24)
    } finally {
      vi.unstubAllGlobals()
    }
    expect(resolveHourCycle('en-US')).toBe(12)
  })
})
