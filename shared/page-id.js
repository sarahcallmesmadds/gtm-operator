'use strict'

/**
 * One answer to "are these two strings the same Notion page".
 *
 * THIS FILE IS THE SOURCE, vendored into plugins by `scripts/vendor.js`.
 *
 * It is a copy of `plugins/setup/scripts/page-id.js`, which predates the
 * vendoring mechanism and still has its own copy. NOTHING HOLDS THE TWO
 * TOGETHER. No test compares them, so they can drift apart silently. This note
 * previously claimed `tests/config-contract.test.js` asserted they agree; that
 * test contains no page-id comparison and never did. When `setup` is next
 * touched, its copy should be replaced by a vendored one and this note
 * removed.
 *
 * The reasoning, the measured shapes and the returning-null rule are all in
 * setup's copy and are not restated here, because restating them is how the two
 * would start to disagree about why they exist.
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
