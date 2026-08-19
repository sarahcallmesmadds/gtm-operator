'use strict'

/**
 * One answer to "are these two strings the same Notion page".
 *
 * IT LIVES ALONE BECAUSE TWO UNRELATED CALLERS NEED IT. `views.js` compares the
 * rows a view returned against the rows its rule selected, and `config.js`
 * compares a parent page a run was given against the parent page a run already
 * recorded. Those have nothing to do with each other, and the second used to
 * reach into the first to borrow this, which made the file that stores state
 * depend on the file that compiles views.
 *
 * A page url or id reduced to the bare id, or `null` when it is not a page
 * reference at all.
 *
 * **Returning null rather than the input is the point.** The first version
 * handed back anything it did not recognise, so a caller who recorded page
 * TITLES got their titles back unchanged on both sides, the two sides matched,
 * and the view was reported as proved without a single page identity being
 * looked at. That is the same false pass this function was written to remove,
 * one step further along. A value that is not a page reference is missing
 * evidence, and the caller is told so.
 *
 * Two shapes are accepted, both measured on 2026-08-18:
 *
 *   the SQL half   https://app.notion.com/<32 hex>
 *   the view half  https://app.notion.com/p/<32 hex>
 *
 * plus a bare or dashed id, and the slug form `Some-Page-Title-<32 hex>` that
 * Notion puts in a browser url. Dashes are only stripped from something already
 * shaped like a uuid, never from a slug, because a slug's own words can contain
 * hex letters and stripping first would let the 32-character window slide off
 * the id and into the title.
 */
const BARE_ID = /^[0-9a-f]{32}$/i
const DASHED_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SLUGGED_ID = /^(?:.*-)?([0-9a-f]{32})$/i

function pageIdentity (value) {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (!text) return null

  const withoutQuery = text.split(/[?#]/)[0].replace(/\/+$/, '')
  const last = withoutQuery.split('/').pop() || ''

  if (BARE_ID.test(last)) return last.toLowerCase()
  if (DASHED_ID.test(last)) return last.replace(/-/g, '').toLowerCase()
  const slugged = last.match(SLUGGED_ID)
  if (slugged) return slugged[1].toLowerCase()
  return null
}

module.exports = { pageIdentity }
