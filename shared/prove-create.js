'use strict'

/**
 * The one proof for a create: did the page just written come back as sent.
 *
 * THIS FILE IS THE SOURCE, vendored into plugins by `scripts/vendor.js`. It
 * requires its siblings (`page-id.js`, `notion-compare.js`) the way
 * `memo-write.js` does, so a plugin that vendors it vendors those with it.
 *
 * Written for `projects`, which proves four kinds of write (a project row, a
 * task, a memo, and a property update to an existing row) and would otherwise
 * have carried the fourth hand copy of this logic. For an update, `createdUrl`
 * is the page the update was sent to; the binding is the same either way. `memos`, `process` and `calendar` still carry their own inline
 * versions, written first and measured there. Retire each into this file the
 * next time its plugin is opened, the same standing note as the calendar copy
 * of `notion-compare`: two copies of a measured fact is how the measurement
 * gets lost.
 *
 * THE PROOF IS BOUND TO THE PAGE THAT WAS CREATED. Without the url, this
 * checks that SOME page has the right shape, and a page created malformed
 * passes as long as the one read back is fine.
 *
 * VALUES ARE COMPARED THROUGH THE TYPE, NOT AS STRINGS. A person comes back
 * prefixed, a list as a JSON array in a string, a date can carry a time.
 * Compared raw, a perfect write reads as a failed one, and a proof that fails
 * on a perfect write teaches the next person to ignore it.
 *
 * IT RETURNS RATHER THAN PRINTS, unlike the inline versions, so one function
 * serves commands that print different envelopes. The caller prints the result
 * and sets the exit code; `proved` is false both on a problem and when nothing
 * was compared, because a proof that compared nothing proved nothing.
 */

const path = require('path')

const { pageIdentity } = require(path.join(__dirname, 'page-id'))
const { compareProperty, cameBackEmpty } = require(path.join(__dirname, 'notion-compare'))

function proveCreate ({ what, createdUrl, readback, intended, headings, types }) {
  const problems = []
  const checked = []
  const unchecked = []

  const created = pageIdentity(createdUrl)
  if (!created) {
    throw new Error(
      `prove needs the url of the page the write went to, and got ${JSON.stringify(createdUrl)}. Without it this checks ` +
      `that some page has the right shape rather than that the ${what} just written does.`
    )
  }
  const got = pageIdentity(readback && (readback.url || (readback.page && readback.page.url)))
  if (!got) {
    problems.push({ what: 'the page that came back', why: 'It carries no usable url, so nothing can say it is the page that was just written to. Save the whole page, keeping its url.' })
  } else if (got !== created) {
    problems.push({
      what: 'the page that came back',
      why: `It is not the page this write went to. Sent to ${created}, read back ${got}. Nothing below was checked, because checking a different page reports a clean write on the wrong ${what}.`
    })
  }

  if (!problems.length && (!readback || !readback.properties || typeof readback.properties !== 'object' || Array.isArray(readback.properties))) {
    problems.push({ what: 'the read-back', why: 'There are no properties to check, so nothing about this write has been proved. Save the whole page, not a summary of it.' })
  }

  if (!problems.length) {
    for (const [name, sent] of Object.entries(intended)) {
      const back = readback.properties[name]
      if (back === undefined) {
        // A null sent on purpose, the empty half of a date pair, is allowed to
        // be absent: Notion leaves an empty property off a page.
        if (sent === null || cameBackEmpty(sent)) {
          checked.push({ what: name, type: 'empty, and absent from the page, which is how Notion returns an empty property' })
          continue
        }
        problems.push({ what: name, why: 'The property is not on the page that came back. Notion discarded it without reporting an error.' })
        continue
      }
      const type = types[name]
      if (!type) {
        unchecked.push({ what: name, why: 'Nothing here knows which type this column holds, so its value was not compared. It is on the page.' })
        continue
      }
      const verdict = compareProperty(type, sent, back)
      if (verdict.state === 'same') { checked.push({ what: name, type }); continue }
      if (verdict.state === 'unchecked') { unchecked.push({ what: name, why: verdict.why }); continue }
      problems.push({ what: name, why: `Sent ${JSON.stringify(verdict.sent)} and the page came back with ${JSON.stringify(verdict.back)}.` })
    }

    const backHeadings = (readback.headings || []).map(h => String(h).trim())
    for (const heading of headings) {
      if (backHeadings.includes(heading)) checked.push({ what: heading, type: 'heading' })
      else problems.push({ what: heading, why: 'The section heading is not on the page. Write it again rather than reporting success.' })
    }
    if (headings.length) {
      unchecked.push({
        what: 'the body text',
        why: 'Only the headings were compared. What is written under them was not read back, so a heading with nothing under it passes this check.'
      })
    }
  }

  const comparedNothing = checked.length === 0

  return {
    proved: problems.length === 0 && !comparedNothing,
    problems,
    checked,
    unchecked,
    note: problems.length
      ? `The ${what} did not land as sent. Do not report it as done.`
      : comparedNothing
        ? 'Nothing was compared, so nothing is proved.'
        : 'Everything sent came back matching. The list above says what was not looked at.'
  }
}

module.exports = { proveCreate }
