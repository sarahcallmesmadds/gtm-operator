'use strict'

/**
 * How alike two pieces of text are.
 *
 * SPLIT OUT SO TWO CALLERS CAN SHARE ONE MEASURE. `process.js` compares a
 * proposed artifact against the library, and `backfill.js` compares one asking
 * of a question against another. They are the same job, and a second copy of it
 * would drift the way `CLAUDE.md` says every copy drifts: two callers would be
 * calling the same number "similarity" and meaning different things by it.
 *
 * `process.js` still re-exports both, because its tests and its own commands
 * name them there.
 *
 * PURE. It compares strings.
 */

/** Words worth comparing: lowercased, punctuation dropped, stop words removed. */
const STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from', 'how', 'in',
  'is', 'it', 'of', 'on', 'or', 'our', 'the', 'to', 'we', 'what', 'when',
  'where', 'which', 'why', 'with'
])

function tokens (text) {
  if (typeof text !== 'string') return []
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word && !STOP_WORDS.has(word))
}

/**
 * How alike two artifacts are, between 0 and 1.
 *
 * Overlap over union across the name and the description together, which is the
 * "title and topic" the reference compared. It is a blunt measure and is meant
 * to be: it produces candidates for a person to look at, and `plugins/process/SKILLS.md`
 * says the duplicate check runs before structuring precisely so a near match
 * costs one question rather than a merged-away document.
 */
function similarity (left, right) {
  const a = new Set(tokens(left))
  const b = new Set(tokens(right))
  if (!a.size || !b.size) return 0

  let shared = 0
  for (const word of a) if (b.has(word)) shared++

  const union = a.size + b.size - shared
  return union ? shared / union : 0
}

module.exports = { STOP_WORDS, tokens, similarity }
