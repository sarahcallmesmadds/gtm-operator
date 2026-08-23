// GENERATED FILE. DO NOT EDIT.
// Copied from shared/notion-compare.js by scripts/vendor.js.
// Edit the source and re-run that script. An edit here is reverted by the
// next run and reported as drift by tests/vendor-copies-current.test.js.
'use strict'

/**
 * Comparing a value that was sent to Notion with the value that came back.
 *
 * WHY THIS IS NOT A STRING COMPARISON. A property does not come back in the
 * shape it went out in, and the differences are measured rather than guessed:
 *
 *   - A person is written bare and read back prefixed. Measured 2026-08-20:
 *     `["00000000-..."]` goes in and `["user://00000000-..."]` comes back. The
 *     first live proof of a create reported the owner as not having landed, on
 *     a write that was perfect.
 *   - A list is written as an array and read back as a JSON array inside a
 *     string, and an absent one arrives as null, '' or '[]'. All of those mean
 *     the same list.
 *   - A date is written as a day and can come back carrying a time.
 *
 * Compared raw, every one of those reads as a failed write. A proof that fails
 * on a perfect write is worse than no proof, because the next person learns to
 * ignore it.
 *
 * A COMPARATOR RETURNING null MEANS "I COULD NOT RENDER THIS ONE-TO-ONE". The
 * caller reports that as unchecked rather than guessing at equality, which is
 * the false success this whole file exists to refuse.
 *
 * ONE COPY, EVENTUALLY. `plugins/calendar/scripts/calendar.js` still carries its
 * own inline version of this, written first and measured there. Retire that one
 * into this file the next time calendar is opened: two copies of a measured fact
 * is how the measurement gets lost.
 */

/**
 * A list of names from either side of the comparison.
 *
 * Written as an array, read back as a JSON array in a string, and absent as
 * null. All three mean a list, and one of them is measured.
 */
function listOfNames (value) {
  if (value === null || value === undefined || value === '' || value === '[]') return []
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    const text = value.trim()
    if (text.startsWith('[')) {
      try {
        const parsed = JSON.parse(text)
        if (Array.isArray(parsed)) return parsed
      } catch (error) {
        // Not a JSON array. Fall through and treat it as a single name, which
        // is what a bare string is.
      }
    }
    return [value]
  }
  return [value]
}

/**
 * A list rendered so two of them can be compared.
 *
 * ORDER IS NOT PART OF THE VALUE. Notion does not promise to return a
 * multi-select in the order it was sent, and treating a reorder as a failed
 * write is the same false failure as the person prefix.
 *
 * `null` where an entry is not a name, because rendering a nested object as
 * `[object Object]` would make two different values compare equal.
 */
function renderList (entries) {
  if (entries.some(entry => typeof entry !== 'string')) return null
  return entries.map(one => one.trim()).slice().sort().join(' ')
}

const stripPerson = one => (typeof one === 'string' ? one.replace(/^user:\/\//, '') : one)

const COMPARABLE = {
  title: value => (value === null || value === undefined ? '' : String(value)),
  rich_text: value => (value === null || value === undefined ? '' : String(value)),
  url: value => (value === null || value === undefined ? '' : String(value)),
  select: value => (value === null || value === undefined ? '' : String(value)),
  date: value => (value === null || value === undefined ? '' : String(value).slice(0, 10)),
  multi_select: value => renderList(listOfNames(value)),
  people: value => renderList(listOfNames(value).map(stripPerson))
}

/**
 * Compare one property, and say which of three things happened.
 *
 * `{ state: 'same' | 'different' | 'unchecked' }`, never a bare boolean: "could
 * not compare" is a third answer, and folding it into either of the other two is
 * how a proof reports something it never looked at.
 */
function compareProperty (type, sent, back) {
  const reader = COMPARABLE[type]
  if (!reader) {
    return {
      state: 'unchecked',
      why: `Nothing here knows how a ${type || 'property of unknown type'} reads back, so its value was not compared.`
    }
  }
  const a = reader(sent)
  const b = reader(back)
  if (a === null || b === null) {
    return {
      state: 'unchecked',
      why: 'One side holds a value that is not a name, so the two could not be compared without guessing.'
    }
  }
  if (a === b) return { state: 'same' }
  return { state: 'different', sent: a, back: b }
}

module.exports = { COMPARABLE, listOfNames, renderList, compareProperty }
