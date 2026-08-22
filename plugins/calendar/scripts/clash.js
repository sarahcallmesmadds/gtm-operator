'use strict'

/**
 * The clash check and the duplicate check.
 *
 * Two different questions, both answered before anything is written, and both
 * specified in `SKILLS-calendar.md`. A clash is two different things colliding.
 * A duplicate is the same thing entered twice.
 *
 * WHY BOTH RUN BEFORE DRAFTING. A conflict discovered after the work is planned
 * is a conflict somebody argues with rather than fixes. The only moment either
 * can be prevented is while somebody is still choosing the date.
 *
 * THIS FILE IS PURE. It takes rows that were already fetched and returns a
 * judgment. It makes no Notion call, because a script in this design cannot: the
 * connected client is reachable by the model and not by node. `calendar.js`
 * builds the query, the skill sends it, and the rows come back here.
 *
 * WHAT THIS IS NOT. It is not a collision detector and the skill says so. It
 * compares `Segment` and `L2C Lifecycle`, which is all the schema has, and it
 * does not know who is on a list, so two emails to entirely different enterprise
 * lists look identical to it. Describing it as more than a coarse signal would
 * be worse than the fields being coarse, because somebody would trust it.
 */

/**
 * How far either side of the proposed date counts as "around the same time".
 *
 * SEVEN, and the number is here rather than in prose. The failure this check
 * exists to prevent is three emails to one list in a week, and the rule it was
 * originally given was date-range overlap. Two one-day emails on the Monday and
 * the Wednesday do not overlap, so the specified mechanism could not catch its
 * own motivating example. Found in review on 2026-08-19, before any of this was
 * built. See `SKILLS-calendar.md`, "The window is seven days either side".
 *
 * Seven either side rather than the calendar week, on Sarah's call: a Friday and
 * the following Monday are obviously the same problem, and a week that starts on
 * Monday says they are not.
 */
const WINDOW_DAYS = 7

const { pageIdentity } = require(require("path").join(__dirname, "vendor", "page-id"))
const { listProblem, listValues } = require(require("path").join(__dirname, "vendor", "calendar-schema"))

const DAY = 24 * 60 * 60 * 1000

/**
 * The two fields that say who something is aimed at.
 *
 * Both multi-select, and both external-facing. `Audience` is deliberately NOT
 * here: it records which internal teams need to know, which is a different
 * question, and including it would surface two rows as competing because the
 * same internal team was told about both.
 */
const TARGETING = ['Segment', 'L2C Lifecycle']

/**
 * A date as a day number, so comparisons never depend on a time or a zone.
 *
 * Notion dates arrive as `YYYY-MM-DD` or as a full timestamp. Only the calendar
 * day matters here: a clash check that treated 9am and 5pm on one day as
 * different moments would answer a question nobody asked.
 *
 * Parsed off the string rather than through `new Date()` on purpose. `new
 * Date('2026-08-19')` is midnight UTC, and in a negative-offset timezone that
 * is the previous day locally, which would shift every window by one day for
 * everybody west of Greenwich.
 */
function dayNumber (value) {
  if (typeof value !== 'string') return null
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  if (!match) return null
  const [, year, month, day] = match
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day))
  if (Number.isNaN(ms)) return null

  // AN IMPOSSIBLE DAY IS REFUSED, NOT ROLLED FORWARD. `Date.UTC(2026, 1, 31)`
  // is 2026-03-03, so `2026-02-31` used to become a real day three days later
  // and every window and clash was then computed against a date nobody wrote.
  // Round-tripping is the check: a day that does not survive the trip did not
  // exist.
  const back = new Date(ms)
  if (back.getUTCFullYear() !== Number(year) ||
      back.getUTCMonth() !== Number(month) - 1 ||
      back.getUTCDate() !== Number(day)) {
    return null
  }
  return Math.round(ms / DAY)
}

/**
 * A row's dates as a span of day numbers, or null when it has none.
 *
 * A row with a start and no end is a single day. A range is inclusive at both
 * ends, so a three-day conference occupies three days rather than two.
 */
function span (date) {
  if (!date) return null
  const start = dayNumber(date.start)
  if (start === null) return null
  const end = date.end ? dayNumber(date.end) : start

  // AN END THAT CANNOT BE READ IS NOT A ROW THAT ENDS ON ITS START DAY. This
  // returned `{start, end: start}`, so `{start: '2026-09-10', end: '2026-02-31'}`
  // became a one-day event and a three-week conference could be silently
  // shortened to its first day. Returning null sends the row to the `unknown`
  // bucket, where a date nobody can read belongs.
  if (end === null) return null
  // A range recorded backwards is somebody's typo, not a reason to return
  // nothing. Ordering it is the reading that loses no information.
  return start <= end ? { start, end } : { start: end, end: start }
}

/**
 * Is this row inside the window around the proposed dates?
 *
 * The window is the proposed span widened by WINDOW_DAYS at both ends, and a
 * candidate qualifies when ANY part of it falls inside. Overlap is the narrower
 * case within that, not the test itself.
 */
function inWindow (candidateSpan, proposedSpan, windowDays) {
  if (!candidateSpan || !proposedSpan) return false
  const from = proposedSpan.start - windowDays
  const to = proposedSpan.end + windowDays
  return candidateSpan.start <= to && candidateSpan.end >= from
}

/**
 * The multi-select values on a row, as a clean list of strings.
 *
 * A NON-EMPTY VALUE THAT IS NOT A LIST IS REFUSED, NOT READ AS NOTHING. This
 * returned `[]` for anything that was not an array, and the query returns a
 * multi-select as a JSON array inside a string, so a row still carrying the
 * query's shape read as targeting nobody.
 *
 * `normaliseRows` parses the candidate rows, and `judge` refuses ones that were
 * parsed twice. NOTHING CHECKED THE PROPOSED ROW, which goes to `clashes`
 * exactly as the caller built it. REPRODUCED THROUGH THE CLI AGAINST FIXTURES
 * on 2026-08-21, not against a workspace: a same-day, same-segment clash came
 * back with `overlapping: 0` and the proposed row in `unknown`, saying it had
 * not said who it was aimed at when it had.
 *
 * THE CURE IS NOW LIVE-PROVED, 2026-08-21. A real query returned
 * `Segment: '["Enterprise"]'`, `judge` normalised it and found a real same-day
 * clash against a proposed row: one overlap, nothing unknown, sharing
 * `Enterprise`. The refusal itself is still fixtures only, because a refusal
 * happens before any call and there is nothing to send. That is
 * the same silent false negative the JSON string caused on the candidate side,
 * arriving through the door nobody guarded. A loud refusal is the cure, because
 * the answer this produced was indistinguishable from a clean calendar.
 *
 * An absent value still means the row said nothing, which is a real answer and
 * is why the empty cases return `[]` rather than throwing.
 */
function targetingValues (row, field) {
  const raw = row && row[field]
  const wrong = listProblem(raw)
  if (!wrong) return listValues(raw)
  if (wrong.kind === 'not-a-list') {
    throw new Error(
      `${field} is ${JSON.stringify(wrong.value)}, which is not a list. A row reaching the clash check ` +
      'holds its multi-selects as arrays, such as ["Enterprise"]. The query returns them as a JSON array ' +
      'inside a string, so pass what the query returned through `normalise`, and build the proposed row ' +
      'with real arrays. Read as a single value it would have matched nothing and reported no clash.'
    )
  }
  throw new Error(
    `${field} is a list containing ${JSON.stringify(wrong.entry)}, which is not a value name. ` +
    'Every entry has to be a non-empty string. This used to be filtered away instead, and a row whose ' +
    'segments were all filtered away read as targeting nobody, so a real clash reported none.'
  )
}

/**
 * Has this row said anything at all about who it is aimed at?
 *
 * BLANK MEANS BOTH FIELDS EMPTY, not either of them. A row with a `Segment` and
 * no `L2C Lifecycle` has said something, and it is compared on what it said.
 * Read the other way, every row missing one of the two would land in the "nobody
 * said" pile, which is most rows, and a bucket holding everything says nothing.
 * `SKILLS-calendar.md` states this explicitly.
 */
function hasTargeting (row) {
  return TARGETING.some(field => targetingValues(row, field).length > 0)
}

/** The values the two rows share, per field. */
function sharedTargeting (a, b) {
  const shared = {}
  for (const field of TARGETING) {
    const left = new Set(targetingValues(a, field))
    const overlap = targetingValues(b, field).filter(v => left.has(v))
    if (overlap.length) shared[field] = overlap
  }
  return shared
}

/**
 * The clash check.
 *
 * Returns three lists, and they are three different statements:
 *
 *   overlapping  something shared. One shared segment is enough
 *   unknown      one side said nothing, so nobody knows. NOT "everybody"
 *   (dropped)    both said nothing. Two rows saying nothing is not evidence
 *
 * `proposed` is `{ date, Segment, L2C Lifecycle, id }`, `rows` are the
 * candidates already fetched from the window.
 */
/**
 * Is this candidate the same row as the one being judged?
 *
 * BY PAGE IDENTITY, NOT BY AN `id` FIELD. The queries select `url`, and this
 * used to compare `row.id`, which no query here ever asks for, so the guard
 * never fired on a real row and every date change reported a clash with the row
 * being changed. `identity` is put on by `normaliseRows`; `id` and `url` are
 * accepted too so a caller holding either shape still gets the comparison.
 */
function sameRow (proposed, candidate) {
  const left = proposed && (proposed.identity || pageIdentity(proposed.url) || proposed.id)
  const right = candidate && (candidate.identity || pageIdentity(candidate.url) || candidate.id)
  if (!left || !right) return false
  return String(left) === String(right)
}

function clashes (proposed, rows, options) {
  const windowDays = (options && Number.isInteger(options.windowDays)) ? options.windowDays : WINDOW_DAYS
  const proposedSpan = span(proposed && proposed.date)

  // An undated proposal has no window to measure from. Returning an empty list
  // would read as "nothing else is happening", which is a different and much
  // stronger claim than "there was nothing to check against".
  if (!proposedSpan) {
    return {
      checked: false,
      why: 'This row has no date yet, so there is no window to check. A date is not required until Confirmed, and the check runs as soon as there is one.',
      windowDays,
      overlapping: [],
      unknown: []
    }
  }

  const proposedHasTargeting = hasTargeting(proposed)
  const overlapping = []
  const unknown = []

  for (const row of rows || []) {
    // Never surface a row against itself. `update` re-runs this check on a moved
    // date, and the row being moved is in the window by definition.
    if (sameRow(proposed, row)) continue

    // A DATE THAT CANNOT BE READ IS REPORTED, NOT SKIPPED. `span` returns null
    // for a value it cannot parse, and `inWindow(null, ...)` is false, so a row
    // carrying an impossible date such as 2026-02-31 fell out here and appeared
    // in neither list while the check reported itself complete. That is the same
    // silent drop this file exists to refuse, and refusing the date without
    // reporting the row only moved it.
    const rowSpan = span(row.date)
    if (!rowSpan) {
      if (row.date !== null && row.date !== undefined) {
        unknown.push({
          row,
          why: 'this row has a date that cannot be read as a real day, so it cannot be placed in or out of the window'
        })
      }
      continue
    }
    if (!inWindow(rowSpan, proposedSpan, windowDays)) continue

    const rowHasTargeting = hasTargeting(row)

    // Both blank. Not surfaced, and this is the one case that is dropped
    // entirely rather than reported quietly.
    if (!proposedHasTargeting && !rowHasTargeting) continue

    if (!proposedHasTargeting || !rowHasTargeting) {
      unknown.push({
        row,
        why: proposedHasTargeting
          ? 'this row does not say who it is aimed at'
          : 'the new row does not say who it is aimed at yet'
      })
      continue
    }

    const shared = sharedTargeting(proposed, row)
    if (Object.keys(shared).length) overlapping.push({ row, shared })
  }

  return { checked: true, windowDays, overlapping, unknown }
}

/**
 * Normalise a name for comparison.
 *
 * Case, surrounding space and internal runs of space are not differences
 * anybody means. Punctuation is left alone: "Q3 Launch" and "Q3 Launch!" being
 * treated as one thing is a judgment, and this check surfaces rather than
 * judges.
 */
function normaliseName (value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Normalise a url so two spellings of one address compare equal.
 *
 * Trailing slashes, the scheme and a leading `www.` are not differences. Query
 * strings ARE kept: two Eventbrite links differing only by a tracking parameter
 * are usually the same event, but dropping the query would also merge two
 * genuinely different pages on sites that route by parameter, and merging two
 * real rows is the worse error.
 */
function normaliseLink (value) {
  if (typeof value !== 'string') return ''
  return value.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/**
 * The duplicate check.
 *
 * Two tests, per `SKILLS-calendar.md`:
 *
 *   the same Link .................. strongest signal there is, needs no judgment
 *   a matching Name on the same date  the realistic case
 *
 * DELIBERATELY NOT "a matching name on any date". A monthly newsletter is the
 * same name twelve times a year and every one is a real separate row. A name
 * rule with no date would flag all twelve and teach people to click through the
 * warning, which is worse than not having it.
 *
 * "The same date" means the spans touch at all, so a row inside a conference's
 * three days counts. Equality would miss a range that was extended by a day.
 */
function duplicates (proposed, rows) {
  const found = []
  const proposedLink = normaliseLink(proposed && proposed.Link)
  const proposedName = normaliseName(proposed && proposed.Name)
  const proposedSpan = span(proposed && proposed.date)

  for (const row of rows || []) {
    if (sameRow(proposed, row)) continue

    if (proposedLink && normaliseLink(row.Link) === proposedLink) {
      found.push({ row, because: 'link', detail: 'Both rows point at the same link.' })
      continue
    }

    if (!proposedName || normaliseName(row.Name) !== proposedName) continue

    // A name match with no date on either side is not enough on its own, and
    // saying nothing about it would hide the one case where a person would
    // obviously want to look. It is reported as the weaker thing it is.
    const rowSpan = span(row.date)
    if (!proposedSpan || !rowSpan) {
      found.push({
        row,
        because: 'name-undated',
        detail: 'The names match and one of the two has no date, so this may or may not be the same thing.'
      })
      continue
    }

    if (rowSpan.start <= proposedSpan.end && rowSpan.end >= proposedSpan.start) {
      found.push({ row, because: 'name-and-date', detail: 'The names match and the dates are the same.' })
    }
  }

  return found
}

module.exports = {
  WINDOW_DAYS,
  sameRow,
  TARGETING,
  clashes,
  duplicates,
  // Exported so the tests can reach the parts rather than only the whole.
  dayNumber,
  span,
  inWindow,
  hasTargeting,
  sharedTargeting,
  normaliseName,
  normaliseLink
}
