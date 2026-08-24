'use strict'

/**
 * Filling the library from material that already exists.
 *
 * PURE, like `artifact.js`. It reads nothing and sends nothing. It decides what
 * a reader is allowed to be pointed at, judges what came back into candidates a
 * person can scan, and turns an approved candidate into a draft. The skill does
 * the reading and the writing.
 *
 * THE APPROVAL GATE IS THE WHOLE DESIGN, and everything permissive here rests
 * on it. `SKILLS-process.md` argues that all three discovery modes are
 * shippable precisely because a candidate that turns out to be junk costs one
 * "no": a weak detector produces noise rather than damage. So the judgments
 * below are allowed to be roughly right, and the things that are NOT allowed to
 * be roughly right are the two that survive a "no": what the plugin was
 * permitted to read, and what it writes onto a page.
 *
 * WHICH IS WHY SCOPE REFUSES RATHER THAN NARROWS. A scope this file quietly
 * trims reads less than the person asked for and says it read what they asked
 * for. There is no approval gate in front of a read: by the time a candidate
 * list exists, the reading already happened.
 */

const path = require('path')

const artifact = require(path.join(__dirname, 'artifact'))
const { similarity } = require(path.join(__dirname, 'similar'))
const { cameBackEmpty } = require(path.join(__dirname, 'vendor', 'notion-compare'))
const schema = require(path.join(__dirname, 'vendor', 'process-schema'))

/**
 * The sources a scope may name. Anything else is refused rather than ignored.
 *
 * `documents` is a body of writing somebody already keeps: a Drive folder, an
 * older Notion database, a Confluence space. The other three are conversations,
 * and they are the ones that carry a date range.
 */
const SOURCES = ['documents', 'slack', 'email', 'recordings']

/**
 * The sources that are conversations rather than documents.
 *
 * EVERY ONE OF THESE CARRIES A DATE RANGE AND THERE IS NO WAY TO OPT OUT.
 * `SKILLS-process.md`: "There is no unbounded read." A document store is a
 * place somebody chose to put things and its size is knowable before you start.
 * A conversation source is a firehose, and "all of Slack" is not a scope, it is
 * the absence of one.
 */
const CONVERSATION_SOURCES = ['slack', 'email', 'recordings']

/** The three ways of looking through conversations. Any combination, or none. */
const WAYS = ['topics', 'repeats', 'sweep']

/**
 * How many times a question has to be asked before it counts as repeated.
 *
 * Three, from `SKILLS-process.md`, on the reasoning that anything asked that
 * often should have been written down. Twice is a coincidence.
 */
const REPEAT_MIN = 3

/**
 * The similarity above which two askings are treated as the same question.
 *
 * NOTHING HAS MEASURED THIS, and `SKILLS-process.md` says so in as many words:
 * whether "how do we do refunds" and "what is the refund process" count as the
 * same question needs tuning against real workspaces, which do not exist yet.
 * It is acceptable here and only here, because the output is a candidate list
 * rather than a document. It is reported alongside every result for the same
 * reason `process.js` reports its duplicate threshold: so nobody reads a score
 * as calibrated.
 */
const REPEAT_SIMILARITY = 0.5
const REPEAT_SIMILARITY_IS_MEASURED = false

/**
 * The fields `fill` will put into a blank, hoisted out of the function.
 *
 * EXPORTED SO THE RAW-KEY GUARD CAN BE BUILT FROM IT. `process.js` has to refuse
 * a row keyed by the workspace's own property names, and to do that it needs to
 * know which logical names this function is going to look for. Built from a
 * separate list over there, the guard covered `UPDATABLE_FIELDS`, which holds
 * `Owner` and none of the other three fields a backfill refuses, so a candidate
 * carrying the workspace's name for `Verified date` passed the guard, became
 * invisible here, and was ignored rather than refused.
 */
const FILLABLE = ['Description', 'Domain', 'Review cadence', ...schema.MULTI_SELECT_FIELDS]

/**
 * Every field a backfill refuses to be handed, person and verification alike.
 *
 * ONE LIST BECAUSE TWO CALLERS KEPT DISAGREEING WITH IT. `artifact.js` refuses
 * both groups on the row itself. `draft` and `fill` each refused only the person
 * half and then dropped the other two on the floor: `draft` copies a whitelist
 * that does not include them, `fill` never looks at them, so a caller supplying
 * `Verified date` got `ok: true` and a field that had quietly disappeared. The
 * low-level refusal was unreachable through both of the paths anyone uses.
 *
 * `Verified by` is in both groups, so the reason given depends on which group
 * the field belongs to rather than on which loop reached it.
 */
const REFUSED_ON_A_BACKFILL = [
  ...schema.PERSON_FIELDS,
  ...schema.VERIFICATION_FIELDS.filter(field => !schema.PERSON_FIELDS.includes(field))
]

/** Why a backfill will not take this field, in the words of the rule it breaks. */
function whyRefused (field) {
  return schema.PERSON_FIELDS.includes(field)
    ? `${field} is a person field, and backfill never fills one. A machine pulled this in, so guessing at who owns or verified it is worse than an empty field. Notify the real person, and set it with \`update\` once they have read it.`
    : `${field} is one of the three verification fields, and nobody has read this artifact. Empty is the honest value, and it is what makes the never-verified audit signal mean something: an artifact stamped by the import that created it is indistinguishable from one a person actually checked.`
}

/**
 * A YYYY-MM-DD day, or null. Refusals are collected by the caller, never thrown.
 *
 * THE ROLL-OVER IS THE REASON FOR THE LAST LINE. `Date.parse` accepts
 * `2026-02-30` and hands back the 2nd of March, so a range ending on a day that
 * does not exist silently reads two days past where it was set. On this side of
 * the plugin that is the direction that matters: it reads more than was asked
 * for, in the one place where nothing downstream can catch it, because there is
 * no approval gate in front of a read.
 */
function day (value) {
  if (typeof value !== 'string') return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(parsed)) return null
  // Written back out and compared. A day that rolled over comes back as a
  // different one, which is the only way to tell 2026-02-30 from 2026-03-02
  // once the string has been parsed.
  if (new Date(parsed).toISOString().slice(0, 10) !== value) return null
  return value
}

/** A trimmed string, or null where there is nothing there. */
function text (value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** A non-empty list of non-empty strings, or null. */
function nameList (value) {
  if (!Array.isArray(value)) return null
  const names = value.map(one => text(one)).filter(Boolean)
  return names.length ? names : null
}

/**
 * The entries in a list that are not names, as `[index, value]`.
 *
 * DROPPING ONE IS NARROWING, AND NARROWING IS THE THING THIS FILE REFUSES.
 * `nameList` and every `.filter(Boolean)` beside it quietly discard whatever is
 * not a usable string, so `["#gtm", 42]` became a plan covering one channel and
 * reported `ok: true`. The run then reads less material than was asked about and
 * says it read what was asked about, which is the exact failure `plan` exists to
 * prevent, arriving through the helper rather than through the scope.
 */
function notNames (value) {
  if (!Array.isArray(value)) return []
  return value
    .map((one, index) => [index, one])
    .filter(([, one]) => text(one) === null)
}

/**
 * The read plan, or every reason this scope is not one.
 *
 * Returns `{ ok, reading, notReading, ways, refusals }`. `ok` is false when
 * anything was refused, and the caller sends nothing.
 *
 * THE DEFAULTS LEAN CLOSED AND `notReading` IS HOW A PERSON SEES THAT. A plugin
 * that quietly did not look at direct messages, and a plugin that looked at all
 * of them, produce the same candidate list when the direct messages happened to
 * hold nothing. Saying what was left out is the only way the difference is
 * visible from the outside.
 */
function plan (request) {
  const refusals = []
  const add = (field, kind, message) => refusals.push({ field, kind, message })
  const req = request || {}

  // ------------------------------------------------------------------- sources

  let asked = []
  if (req.sources === undefined || req.sources === null) {
    add('sources', 'missing', `No source was named. Backfill reads what it is pointed at and nothing else, so with no source there is nothing to point it at. One or more of: ${SOURCES.join(', ')}.`)
  } else if (!Array.isArray(req.sources)) {
    add('sources', 'not-a-list', `\`sources\` is ${JSON.stringify(req.sources)}. It is a list, because a backfill run reads any combination of ${SOURCES.join(', ')}.`)
  } else {
    for (const [index, one] of notNames(req.sources)) {
      add('sources', 'not-a-name', `\`sources[${index}]\` is ${JSON.stringify(one)}, which is not a source name. It is refused rather than dropped: a list quietly shortened reads less material than was asked about and reports that it read what was asked about.`)
    }
    asked = req.sources.map(one => text(one)).filter(Boolean)
    if (!asked.length && !notNames(req.sources).length) {
      add('sources', 'missing', 'The source list is empty, so there is nothing to read.')
    }
    for (const one of asked) {
      if (!SOURCES.includes(one)) {
        add('sources', 'unknown-source', `"${one}" is not a source this plugin knows how to read. One or more of: ${SOURCES.join(', ')}. It is refused rather than skipped, because a run that silently drops a source reports on less material than the person asked about and does not say so.`)
      }
    }
  }

  const named = source => asked.includes(source)
  const reading = {}
  const notReading = []

  // ------------------------------------------------------------- the date range
  //
  // ASKED OF EVERY CONVERSATION SOURCE SEPARATELY. A single range at the top
  // would read as covering whichever sources happened to be named, and the
  // range that is right for a mailbox is rarely the one that is right for a
  // year of meeting recordings.

  const range = (source, holder) => {
    const from = day(holder.from)
    const to = day(holder.to)

    // TWO DIFFERENT FAULTS, AND ONE WORDING FOR BOTH IS ITS OWN BUG. An absent
    // date is an unbounded read. A date like `2026-02-30` is a read whose end
    // rolled forward into March, which is a bounded read of the wrong window.
    // Telling somebody their date is missing when it is sitting right there
    // sends them looking in the wrong place.
    const end = (which, value, parsed) => {
      if (parsed) return
      if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
        add(source, 'range-not-a-day', `${source} is scoped \`${which}\` ${value}, which is written as a date and is not one. A day past the end of its month rolls forward and reads a window nobody set; a month past 12 does not resolve at all. Both are refused rather than guessed at, because which of the two this is changes what would have been read.`)
        return
      }
      add(source, 'range-open', `${source} has no usable \`${which}\` date, so this is an unbounded read. There is no unbounded read: a conversation source is a firehose and "everything" is the absence of a scope rather than a wide one. Use YYYY-MM-DD.`)
    }
    end('from', holder.from, from)
    end('to', holder.to, to)
    if (from && to && from > to) {
      add(source, 'range-backwards', `${source} is scoped from ${from} to ${to}, which is backwards. Read as it is written it covers nothing, and a run that reads nothing looks exactly like a workspace with nothing in it.`)
      return null
    }
    return from && to ? { from, to } : null
  }

  // ----------------------------------------------------------------- documents

  if (named('documents')) {
    const holder = req.documents || {}
    const where = text(holder.where)
    if (!where) {
      add('documents', 'unlocated', `The document source does not say where it is${holder.where === undefined || holder.where === null ? '' : `: \`where\` is ${JSON.stringify(holder.where)}, which names nowhere`}. Name the Drive folder, the Notion database or the space, because "the documents" is not somewhere this can be pointed at.`)
    } else {
      reading.documents = { where }
    }
  } else {
    notReading.push('Documents. No document store was named, so no existing knowledge base is being sorted.')
  }

  // --------------------------------------------------------------------- slack

  if (named('slack')) {
    const holder = req.slack || {}
    const window = range('slack', holder)

    let channels = null
    if (holder.channels === 'all') {
      channels = 'all'
    } else if (Array.isArray(holder.channels)) {
      for (const [index, one] of notNames(holder.channels)) {
        add('slack', 'channel-not-a-name', `\`slack.channels[${index}]\` is ${JSON.stringify(one)}, which is not a channel name. Dropping it would read fewer channels than were asked for without saying so.`)
      }
      channels = nameList(holder.channels)
      if (!channels && !notNames(holder.channels).length) {
        add('slack', 'channels-empty', 'The Slack channel list is empty. Either name the channels to read, or say "all" deliberately. An empty list reads as nothing and is more likely to be a mistake than a request.')
      }
    } else {
      add('slack', 'channels-unset', 'Slack was named with no channels. Either "all" or a list of the ones to read. Both are offered on purpose, because a small workspace may want everything and a large one certainly does not, but neither is assumed.')
    }

    /*
     * DIRECT MESSAGES ARE NAMED ONE BY ONE OR NOT READ.
     *
     * `SKILLS-process.md`: never, unless the user names specific ones. Not "all
     * DMs" as an option, not a checkbox to include them. This is the one place
     * in the plugin where a wide read is refused outright rather than offered
     * with a warning, because a public channel is a place people chose to speak
     * in front of the workspace and a direct message is not.
     */
    let dms = []
    if (holder.dms !== undefined && holder.dms !== null) {
      if (holder.dms === 'all' || holder.dms === true) {
        add('slack', 'dms-all', 'Direct messages cannot be read as a group. There is no "all DMs" option and this is not an oversight: a public channel is somewhere people chose to speak in front of the workspace and a direct message is not. Name the specific conversations, or leave them out.')
      } else if (!Array.isArray(holder.dms)) {
        add('slack', 'dms-not-a-list', `\`dms\` is ${JSON.stringify(holder.dms)}. It is a list of specific conversations, named one by one.`)
      } else {
        for (const [index, one] of notNames(holder.dms)) {
          add('slack', 'dm-not-a-name', `\`slack.dms[${index}]\` is ${JSON.stringify(one)}, which does not name a conversation. Direct messages are named one by one, so an entry that names nothing is refused rather than skipped.`)
        }
        dms = nameList(holder.dms) || []
      }
    }

    if (channels && window) {
      reading.slack = { channels, dms, ...window }
    }
    if (!dms.length) {
      notReading.push('Slack direct messages. None were named, and they are never read as a group.')
    }
  } else {
    notReading.push('Slack. It was not named, so no channels and no direct messages are being read.')
  }

  // --------------------------------------------------------------------- email

  if (named('email')) {
    const holder = req.email || {}
    const window = range('email', holder)
    const mailbox = text(holder.mailbox)

    /*
     * ABSENT AND MALFORMED ARE NOT THE SAME ANSWER, AND THIS IS THE ONE FIELD
     * WHERE THAT DECIDES A READ.
     *
     * `mailbox` is the only scope value whose absence means read anyway, with
     * "own" as the default. Everywhere else an unreadable value refuses and
     * nothing is read, so conflating the two costs a refusal. Here it bought
     * one: `text()` returns null for a number, an object, a list or a boolean,
     * so `mailbox: ["boss@corp.com", "legal@corp.com"]`, which is the shape a
     * model produces when it thinks it can name more than one, fell through to
     * the default and came back `ok: true` reading the user's own mailbox. A
     * scope somebody set was silently replaced by a different one.
     *
     * There is no approval gate in front of a read. By the time a person sees
     * the candidates, the reading has happened.
     */
    const askedFor = holder.mailbox !== undefined && holder.mailbox !== null

    if (askedFor && !mailbox) {
      add('email', 'mailbox-not-a-name', `\`mailbox\` is ${JSON.stringify(holder.mailbox)}, which does not name a mailbox. It is refused rather than read as "own": a value somebody set being replaced by a default is a scope nobody agreed to, and the reading has already happened by the time anybody sees the result. Set it to "own" or leave it out.`)
    } else if (mailbox && mailbox !== 'own') {
      add('email', 'mailbox-not-own', `The mailbox is "${mailbox}". Backfill reads the user's own mailbox and no other: reading somebody else's mail is not something an approval gate on the output makes acceptable, because the reading has already happened by then. Set \`mailbox\` to "own" or leave it out.`)
    } else if (window) {
      reading.email = { mailbox: 'own', ...window }
    }
  } else {
    notReading.push('Email. It was not named, so no mailbox is being read.')
  }

  // ---------------------------------------------------------------- recordings

  if (named('recordings')) {
    const holder = req.recordings || {}
    const window = range('recordings', holder)
    const recorder = text(holder.recorder)

    if (!recorder) {
      add('recordings', 'recorder-unnamed', `Call recordings were named with no recorder${holder.recorder === undefined || holder.recorder === null ? '' : `: \`recorder\` is ${JSON.stringify(holder.recorder)}, which names none`}. The plugin reads transcripts from whatever recorder the environment exposes rather than integrating with one by name, so it has to be told which one is connected. Setup asks and does not assume.`)
    } else if (window) {
      reading.recordings = { recorder, ...window }
    }
  } else {
    notReading.push('Call recordings. No recorder was named, so no transcripts are being read. This is where process decisions most often get made and least often get written down, so it is worth knowing it is off.')
  }

  // ---------------------------------------------------------------------- ways

  const conversational = CONVERSATION_SOURCES.some(one => named(one))
  let ways = []
  if (req.ways === undefined || req.ways === null) {
    ways = []
  } else if (!Array.isArray(req.ways)) {
    add('ways', 'not-a-list', `\`ways\` is ${JSON.stringify(req.ways)}. It is a list, because any combination of ${WAYS.join(', ')} can run, and which ones is chosen per run rather than at install time.`)
  } else {
    for (const [index, one] of notNames(req.ways)) {
      add('ways', 'not-a-name', `\`ways[${index}]\` is ${JSON.stringify(one)}, which is not a way of looking. One or more of: ${WAYS.join(', ')}.`)
    }
    ways = req.ways.map(one => text(one)).filter(Boolean)
    for (const one of ways) {
      if (!WAYS.includes(one)) {
        add('ways', 'unknown-way', `"${one}" is not a way of looking through conversations. Any combination of: ${WAYS.join(', ')}.`)
      }
    }
  }

  // THE SHAPE GUARD EVERY OTHER LIST HAS. `sources`, `channels`, `dms` and
  // `ways` each refuse a value that is not a list. `topics` did not, so a bare
  // string fell through to the "no topics were named" refusal and reported a
  // missing list to somebody looking straight at one. The `notNames` fix reached
  // five lists and this guard reached four, which is the same fault in the same
  // function twice.
  if (req.topics !== undefined && req.topics !== null && !Array.isArray(req.topics)) {
    add('topics', 'not-a-list', `\`topics\` is ${JSON.stringify(req.topics)}. It is a list of topics, because looking by topic means naming each one. A bare string is refused rather than read as one topic: nothing here can tell "refunds and routing" from two topics somebody meant to separate.`)
  }
  for (const [index, one] of notNames(req.topics)) {
    add('topics', 'not-a-name', `\`topics[${index}]\` is ${JSON.stringify(one)}, which is not a topic. Looking by topic finds exactly what was asked for, so a topic that reaches nothing is refused rather than dropped from the list.`)
  }
  const topics = nameList(req.topics)
  const topicsMalformed = (req.topics !== undefined && req.topics !== null && !Array.isArray(req.topics)) ||
    notNames(req.topics).length > 0
  if (ways.includes('topics') && !topics && !topicsMalformed) {
    add('topics', 'missing', 'Looking by topic means naming the topics. Without them there is nothing to look for, and this mode is the one that finds exactly what was asked for rather than guessing.')
  }
  if (topics && !ways.includes('topics')) {
    add('ways', 'topics-unused', 'Topics were given and `ways` does not include "topics", so they would be read and never used. It is refused rather than added, because choosing how to look is the person\'s call and quietly turning a mode on is how a run reads more than was agreed.')
  }

  if (conversational && !ways.length && !refusals.some(one => one.field === 'ways')) {
    add('ways', 'missing', `A conversation source was named and no way of looking through it was. One or more of: ${WAYS.join(', ')}.`)
  }
  if (!conversational && ways.length) {
    add('ways', 'nothing-to-look-through', `\`ways\` names ${ways.join(', ')} and no conversation source was given, so there is nothing to look through. These three read conversations; a document store is sorted rather than searched.`)
  }

  for (const one of WAYS) {
    if (!ways.includes(one)) notReading.push(`The "${one}" way of looking was not chosen.`)
  }

  /*
   * A REFUSED PLAN CARRIES NO PLAN.
   *
   * Each refusal above kept the source it named out of `reading`, and that was
   * not enough. Refusing `dms: "all"` left `reading.slack` standing with an
   * empty `dms`, so the same output said `ok: false`, said "NOTHING IS READ",
   * and handed back a narrowed plan that runs. A caller reading `reading`
   * without checking `ok` first would have read the channels and skipped the
   * direct messages, which is the narrowing this whole function refuses to do,
   * arriving as the shape of the answer rather than as a decision in it.
   *
   * Emptying it here rather than at each refusal is deliberate: per-refusal
   * removal is a rule every future source has to remember, and the one that
   * forgets is the one that ships.
   */
  const ok = refusals.length === 0

  /*
   * AND `notReading` IS THE FOURTH FIELD OF A THREE-FIELD RULE.
   *
   * The emptying above named `reading`, `ways` and `topics` and left this
   * standing, so a refused plan came back reading nothing and still listing
   * which sources it was leaving out. That list is written to be shown to a
   * person before a run starts, and a run that lists its exclusions is a run
   * that is reading the rest. On a refusal the honest answer is not the
   * complement of an empty plan, it is that there is no plan.
   *
   * Said rather than emptied, because this is the field a person is told to
   * read and handing them an empty list says nothing at all.
   */
  return {
    ok,
    reading: ok ? reading : {},
    notReading: ok
      ? notReading
      : ['Nothing. The scope was refused, so no source and no way of looking is being read at all. What each refusal ' +
         'says has to be answered before there is a plan to show.'],
    ways: ok ? ways : [],
    topics: ok && topics ? topics : [],
    refusals
  }
}

/**
 * Questions asked three or more times, clustered.
 *
 * Takes `[{ question, where, when }]` and gives back the clusters that reached
 * the threshold, each one carrying every asking behind it. `where` is required
 * on every asking and there is no default: this is the one mode that reads
 * things people said rather than things they wrote down for the record, and a
 * candidate nobody can trace back is a candidate nobody can check.
 *
 * IMPRECISE ON PURPOSE, AND ONLY HERE. Whether two wordings are the same
 * question needs tuning against real workspaces. The output is a list somebody
 * scans, so a cluster that is wrong costs one "no".
 */
function repeats (askings, { threshold = REPEAT_SIMILARITY, min = REPEAT_MIN } = {}) {
  const refusals = []
  const add = (field, kind, message) => refusals.push({ field, kind, message })

  if (!Array.isArray(askings)) {
    return {
      ok: false,
      clusters: [],
      below: [],
      refusals: [{ field: 'askings', kind: 'not-a-list', message: `The askings are ${JSON.stringify(askings)}. This takes a list of \`{ question, where, when }\`, one per time the question was asked.` }]
    }
  }

  const usable = []
  askings.forEach((one, index) => {
    const question = text(one && one.question)
    const where = text(one && one.where)
    if (!question) {
      add(`askings[${index}]`, 'question-missing', 'An asking with no question text cannot be compared with anything.')
      return
    }
    if (!where) {
      add(`askings[${index}]`, 'provenance-missing', `"${question}" does not say where it was asked. Every candidate says where it came from, down to the channel, the thread or the meeting and date. Nothing is absorbed anonymously, and this mode is the one where that matters most.`)
      return
    }
    usable.push({ question, where, when: text(one && one.when) })
  })

  if (refusals.length) return { ok: false, clusters: [], below: [], refusals }

  /*
   * GREEDY, AND COMPARED AGAINST THE FIRST ASKING IN THE CLUSTER.
   *
   * Comparing against every member and taking the best would chain: A is near
   * B, B is near C, and C joins a cluster it has nothing to do with A about.
   * The first asking is the cluster's subject, which is also what gets shown to
   * the person, so the thing they judge is the thing that decided membership.
   */
  const clusters = []
  for (const asking of usable) {
    const home = clusters.find(cluster => similarity(cluster.question, asking.question) >= threshold)
    if (home) home.askings.push(asking)
    else clusters.push({ question: asking.question, askings: [asking] })
  }

  const scored = clusters.map(cluster => ({
    question: cluster.question,
    asked: cluster.askings.length,
    wordings: [...new Set(cluster.askings.map(one => one.question))],
    where: cluster.askings.map(one => ({ where: one.where, when: one.when }))
  })).sort((a, b) => b.asked - a.asked)

  return {
    ok: true,
    threshold,
    thresholdIsMeasured: REPEAT_SIMILARITY_IS_MEASURED,
    min,
    clusters: scored.filter(one => one.asked >= min),
    below: scored.filter(one => one.asked < min),
    refusals: []
  }
}

/**
 * What was found, turned into candidate lines a person can go through.
 *
 * Takes `[{ what, where, kind, type, why }]`. `what` and `where` are required.
 * `type` is a judgment and may be absent: an absent one is reported as needing
 * an answer, and a wrong one is a refusal, because Notion rejects an unknown
 * select value and takes the whole write down with it.
 *
 * NOTHING HERE DECIDES ANYTHING. It numbers the candidates, says what it would
 * make each one, and hands the list over. `SKILLS-process.md`: backfill's job
 * is to be usefully wrong in a list you can scan, rather than confidently wrong
 * in your library.
 */
function candidates (found) {
  const refusals = []
  const add = (field, kind, message) => refusals.push({ field, kind, message })

  if (!Array.isArray(found)) {
    return {
      ok: false,
      candidates: [],
      refusals: [{ field: 'found', kind: 'not-a-list', message: `What was found is ${JSON.stringify(found)}. This takes a list, one entry per thing that might belong in the library.` }]
    }
  }

  const out = []
  found.forEach((one, index) => {
    const what = text(one && one.what)
    const where = text(one && one.where)
    const type = text(one && one.type)

    if (!what) {
      add(`found[${index}]`, 'what-missing', 'A candidate with nothing in `what` is a line nobody can judge.')
      return
    }
    if (!where) {
      add(`found[${index}]`, 'provenance-missing', `"${what}" does not say where it came from. Every candidate says where it came from, down to the channel, the thread, or the meeting and date.`)
      return
    }
    if (type && !schema.TYPES.includes(type)) {
      add(`found[${index}]`, 'unknown-type', `"${what}" is proposed as a "${type}", which is not a type this database has. One of: ${schema.TYPES.join(', ')}. An unknown select value takes the whole write down with it, so it is refused here rather than at write time with a drafted artifact already lost.`)
      return
    }

    out.push({
      id: `c${index + 1}`,
      what,
      where,
      kind: text(one && one.kind) || 'unknown',
      type: type || null,
      why: text(one && one.why) || null,
      needs: type ? [] : ['type']
    })
  })

  if (refusals.length) return { ok: false, candidates: [], refusals }

  /*
   * CANDIDATES ARE COMPARED WITH EACH OTHER, NOT WITH THE LIBRARY.
   *
   * The library check is `duplicates` and `judge`, the same one `new` uses, and
   * it runs per candidate before any of them is offered. That is one mechanism
   * rather than two, and it is why no import-tracking field exists. This pass
   * only catches the other case: the same process described in three different
   * channels, arriving as three candidates in one run, which the library check
   * cannot see because none of them is in the library yet.
   */
  const near = []
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const score = Number(similarity(out[i].what, out[j].what).toFixed(3))
      if (score >= REPEAT_SIMILARITY) near.push({ a: out[i].id, b: out[j].id, score })
    }
  }

  return {
    ok: true,
    candidates: out,
    withinRunNearMatches: near,
    threshold: REPEAT_SIMILARITY,
    thresholdIsMeasured: REPEAT_SIMILARITY_IS_MEASURED,
    needType: out.filter(one => !one.type).map(one => one.id)
  }
}

/**
 * An approved candidate, as an artifact ready for `check` and `create`.
 *
 * The caller supplies the content it drafted from what it read. This adds the
 * three things a backfilled artifact is defined by: `backfill: true`, sources
 * built from where it came from, and a Sources section generated from those
 * sources rather than written beside them.
 *
 * IT FILLS NO PERSON AND NO VERIFICATION FIELD, and `artifact.js` refuses the
 * row if one turns up anyway. That is not belt and braces: this is one of two
 * callers and the other is a person writing a JSON file by hand.
 */
function draft (candidate, { today } = {}) {
  const given = candidate || {}
  const refusals = []
  const add = (field, kind, message) => refusals.push({ field, kind, message })

  const name = text(given.Name) || text(given.what)
  if (!name) add('Name', 'missing', 'The draft has no name. Either `Name`, or the candidate\'s `what` to start from.')

  const type = text(given.Type) || text(given.type)
  if (!type) add('Type', 'missing', `The draft has no type, so there is no template to write. One of: ${schema.TYPES.join(', ')}.`)

  const sources = Array.isArray(given.sources) ? given.sources : []
  if (!sources.length) {
    add('sources', 'missing', 'A backfilled artifact records where it came from, and this one carries no sources. Build them from the candidate\'s `where`: that line is the only claim backfill makes that a reader can check.')
  }

  for (const field of REFUSED_ON_A_BACKFILL) {
    // Asked through `artifact.js` rather than repeated, because this is the
    // third copy of the same three-way test and the first two disagreed with
    // each other about `[]`.
    if (artifact.askedForNothing(given[field])) continue
    add(
      field,
      schema.PERSON_FIELDS.includes(field) ? 'backfill-person' : 'backfill-verification',
      `${field} was passed to a backfill draft. ${whyRefused(field)}`
    )
  }

  // ASKED BEFORE THE SECTION IS BUILT. `sourcesSection` drops an entry it cannot
  // render, so building first and validating after handed back an artifact whose
  // Sources section and whose `sources` record disagreed, alongside a refusal
  // that correctly said the list was wrong. The refusal was right and the
  // artifact beside it was already narrowed.
  refusals.push(...artifact.sourceProblems(sources))

  if (refusals.length) return { ok: false, artifact: null, refusals }

  const body = { ...(given.body || {}) }
  body.Sources = artifact.sourcesSection(sources)

  const out = {
    backfill: true,
    Name: name,
    Type: type,
    body,
    sources
  }
  for (const field of ['Description', 'Domain', 'Review cadence', 'Status', ...schema.MULTI_SELECT_FIELDS]) {
    if (given[field] !== undefined) out[field] = given[field]
  }

  // THE PARENT IS CARRIED, BECAUSE DROPPING IT SKIPS THE ONE RULE NOTION CANNOT
  // CHECK. A candidate that named a parent lost it here: it was not on the
  // whitelist, so `problems` saw no parent, the only-a-Strategy-Decision rule
  // never ran, and the person who named it had every reason to believe it had
  // been taken. `create` still writes no relation and says so in as many words,
  // which is a different thing from never having looked at it.
  if (given.parent !== undefined && given.parent !== null && given.parent !== '') {
    out.parent = given.parent
    // AND ITS TYPE, BECAUSE THE NEXT GATE ASKS THE ARTIFACT AND NOT THIS
    // FUNCTION. `draft` validates the parent with the `parentType` it was
    // handed; `create` re-validates with `final.parentType`, off the artifact.
    // Copying the parent and not its type let a valid parent pass here and be
    // refused one step later as parent-type-unknown, for a type that had been
    // supplied and checked.
    if (given.parentType !== undefined) out.parentType = given.parentType
  }

  const problems = artifact.problems(out, { parentType: given.parentType })

  return {
    ok: problems.length === 0,
    artifact: out,
    today: today || null,
    problems,
    concerns: artifact.concerns(out),
    leftEmpty: [...schema.VERIFICATION_FIELDS, 'Owner'],
    leftEmptyNote:
      'Owner, Verified by, Verified date and Last checked for accuracy are all empty, and that is the point rather ' +
      'than an omission. A machine pulled this in and no human has read it, so empty is the honest value. `audit` ' +
      'will flag it as never-verified until somebody does, which is the signal working.',
    refusals: []
  }
}

/**
 * The blanks on an artifact that already exists, filled from a candidate.
 *
 * Gives back an `after` row for `update`, holding only the fields that are
 * genuinely empty on the row as it stands. Anything the candidate would change
 * rather than fill is reported and left alone.
 *
 * NEVER OVERWRITES, AND IT GOES THROUGH `update` RATHER THAN WRITING ITSELF.
 * A second write path would be a second place for the clearing rules, the
 * verification grouping and the person defaults to be got wrong, and those are
 * the three things `update` was corrected on most. `reviewed` is forced to
 * false here: a machine filled these in and nobody re-read the artifact, and
 * `update` leaves all three verification fields alone on a false.
 */
function fill (existing, candidate) {
  /*
   * BOTH CONTAINERS ARE JUDGED BEFORE ANYTHING IS READ OUT OF THEM.
   *
   * The third of these on this branch, after a mailbox that arrived as a list
   * became the default mailbox and a body that arrived as a string became an
   * untouched body. Same shape every time: the wrong-but-readable value was
   * handled and the unreadable one read as absent.
   *
   * Here it went two ways at once. A candidate of `[]` has none of the fillable
   * fields, so nothing was refused, nothing was filled, and the run called itself
   * a finished answer and exited zero: an approved fill dropped in silence, which
   * is indistinguishable from a candidate that genuinely offered nothing. A
   * candidate that was a string, a number or a boolean did not get that far and
   * threw a raw `TypeError` out of the `in` operator, which is the one failure
   * mode this file has no wording for.
   *
   * The row side refused all four already, as `url:missing`, which is true and
   * unhelpful: a row that is not a row has not mislaid its url, and telling
   * somebody to keep the url on it sends them to fix the wrong thing.
   */
  const looksLikeARow = value => value !== null && typeof value === 'object' && !Array.isArray(value)

  if (!looksLikeARow(existing)) {
    return {
      ok: false,
      after: null,
      refusals: [{
        field: 'existing',
        kind: 'not-a-row',
        message: `The existing artifact is ${JSON.stringify(existing)}, which is not a row. It is read as a set of ` +
          'fields, one key per field, and anything else has no fields at all, so every blank would read as filled ' +
          'and nothing would be written. Pass the row you fetched, keyed by logical name.'
      }]
    }
  }

  if (!looksLikeARow(candidate)) {
    return {
      ok: false,
      after: null,
      refusals: [{
        field: 'candidate',
        kind: 'not-a-candidate',
        message: `The candidate is ${JSON.stringify(candidate)}, which is not a set of offered fields. Read as one ` +
          'it offers nothing, so the fill would report that there was nothing to fill and exit zero, and the values ' +
          'somebody approved would be dropped without a word. Pass an object keyed by logical name.'
      }]
    }
  }

  const before = existing
  const given = candidate

  if (!text(before.url)) {
    return {
      ok: false,
      after: null,
      refusals: [{ field: 'url', kind: 'missing', message: 'The existing artifact has no `url`, so nothing can say which page these blanks belong to. Keep the url on the row you fetched.' }]
    }
  }

  // THE SEVENTH COPY OF THIS RULE, AND IT MISSED THE SAME SHAPE AS THE SIX
  // BEFORE IT. An empty multi-select comes back from Notion as `'[]'`, so a
  // field that was empty read as occupied and was never filled: the one thing
  // this command is for, refused for the value Notion actually returns.
  const blank = cameBackEmpty


  const after = { url: before.url, reviewed: false }
  const filling = []
  const refused = []

  for (const field of FILLABLE) {
    if (!(field in given)) continue
    if (blank(given[field])) continue
    if (!blank(before[field])) {
      refused.push({
        field,
        kind: 'occupied',
        holding: before[field],
        offered: given[field],
        why: 'Backfill fills blanks and never overwrites. This field already holds something a person may have put there, and a machine replacing it is exactly the damage the approval gate cannot undo.'
      })
      continue
    }
    after[field] = given[field]
    filling.push(field)
  }

  // THE SAME LIST `draft` REFUSES, not the person half of it. Dropping the other
  // two silently is what let a caller offer `Verified date` and be told there
  // was nothing to fill.
  for (const field of REFUSED_ON_A_BACKFILL) {
    if (artifact.askedForNothing(given[field])) continue
    refused.push({
      field,
      kind: 'never-filled',
      holding: before[field],
      offered: given[field],
      why: `${whyRefused(field)} This holds on a blank row as much as on a full one.`
    })
  }

  /*
   * TWO DIFFERENT THINGS LAND IN `refused` AND ONLY ONE IS A FAULT.
   *
   * A field that is already occupied is backfill working: it fills blanks, and
   * on a re-run over the same folder most fields are occupied. A field on the
   * never-filled list is the caller asking for something backfill does not do,
   * whatever the row holds. Reported as one number, the second disappears into
   * the noise of the first, and the exit code either cries wolf on every normal
   * run or stays silent on the one that matters.
   */
  const neverFilled = refused.filter(one => one.kind === 'never-filled')

  /*
   * WHAT GOES BACK HAS TO BE SOMETHING `update` WILL TAKE.
   *
   * The values came off a candidate a model built, and they were copied into
   * `after` unread: `{ Tags: "refunds" }` came back `ok: true`, listed under
   * `filling`, and then died in `update` with `Tags:not-a-list`. A command whose
   * documented next step refuses its own advertised output is worse than one
   * that refuses up front, because the refusal arrives after the person has
   * approved the candidate.
   *
   * Judged with the identity carried across from the before row, the same way
   * `update` does it, because nothing can be judged without a `Type`: it decides
   * which sections a body has and which values a select takes.
   */
  const offered = {}
  for (const field of filling) offered[field] = after[field]

  // THE IDENTITY IS REQUIRED RATHER THAN FILTERED AWAY. `problems` reports a
  // missing `Name` or `Type` and the filter below dropped those, because they
  // are not fields being filled. So a before row missing either came back
  // `ok: true` with a runnable `after`, and `update` restored its identity from
  // that same incomplete row and refused it. Nothing can judge a value without
  // a `Type`: it decides which values a select takes.
  const identity = ['Name', 'Type'].filter(field => !text(before[field]))
  if (identity.length) {
    return {
      ok: false,
      after: null,
      filling: [],
      refused,
      neverFilled: neverFilled.map(one => one.field),
      refusals: identity.map(field => ({
        field,
        kind: 'missing',
        message: `The artifact as it is now carries no ${field}, so nothing can judge what is being offered for it: the type decides which values a select takes. Fetch the whole row rather than the fields being changed.`
      }))
    }
  }

  const badValues = filling.length
    ? artifact.problems(
      { Name: before.Name, Type: before.Type, ...offered },
      { parentType: before.parentType, partialBody: true }
    ).filter(one => filling.includes(one.field))
    : []

  if (badValues.length) {
    return {
      ok: false,
      after: null,
      filling: [],
      refused,
      neverFilled: neverFilled.map(one => one.field),
      refusals: badValues,
      note:
        'Nothing is being sent. Every refusal above is a value the candidate offered that `update` would reject, ' +
        'and refusing it here rather than there means the person hears about it before they approve the candidate ' +
        'rather than after.'
    }
  }

  /*
   * A NEVER-FILLED REFUSAL EMPTIES THE ANSWER. IT DOES NOT NARROW IT.
   *
   * Round 11 taught the exit code to read `neverFilled` and taught nothing else
   * to, so the list moved the exit code and left the answer alone. Offered
   * alongside a fillable field, `{ Domain, Verified date }` came back `ok: true`
   * carrying a runnable `after` holding the Domain change, with the refusal
   * beside it: the person approved one candidate and a smaller one ran, which is
   * the single thing the approval gate cannot catch. Offered alone it was worse
   * again, because the command exited non-zero while `emptyNote` called the run
   * a finished answer rather than a failure, and gave a reason that was not the
   * one that applied.
   *
   * THIS IS THE RULE A REFUSED `plan` ALREADY CARRIES, and it is emptied here at
   * the return for the reason it is emptied there: removing the refused field
   * where it is refused is a rule every future field has to remember, and the
   * one that forgets is the one that ships.
   */
  if (neverFilled.length) {
    const names = neverFilled.map(one => one.field)
    return {
      ok: false,
      after: null,
      filling: [],
      refused,
      neverFilled: names,
      note:
        `Nothing is being sent. The candidate offered ${names.join(', ')}, which backfill never writes, so the whole ` +
        'update is refused rather than narrowed down to the rest of it. Approving a candidate and having something ' +
        'smaller run is the one failure the approval gate cannot see. Offer the fields backfill fills, without ' +
        'these, and the rest goes through.'
    }
  }

  return {
    ok: filling.length > 0,
    after,
    filling,
    refused,
    neverFilled: neverFilled.map(one => one.field),
    note:
      'Pass this to `update` as the after artifact, with the row you fetched as the before. `reviewed` is false and ' +
      'stays false: nobody re-read this artifact, so Last checked for accuracy, Verified by and Verified date are all ' +
      'left where they are.',
    emptyNote: filling.length
      ? null
      : 'Nothing was filled. Every field the candidate offered is either empty on it or already holds something, so ' +
        'there is no update to send. That is a finished answer rather than a failure.'
  }
}

/**
 * Every logical field `fill` reads off the rows it is given.
 *
 * THE RAW-KEY GUARD IS BUILT FROM THIS AND NOTHING ELSE. It was assembled over
 * there from two of the three lists, and then round 13 taught `fill` to read
 * `Name` and `Type` to judge the values it hands over. Neither is in either
 * list, so a row keyed by the workspace's own name for `Type` walked through the
 * guard, read as absent, and the identity check never ran. That is the third
 * time a reader has been added to a row whose guard was not told about it, so
 * the guard reads one list now and the list lives beside the reading.
 */
const READ_BY_FILL = ['Name', 'Type', ...FILLABLE, ...REFUSED_ON_A_BACKFILL]

module.exports = {
  READ_BY_FILL,
  FILLABLE,
  REFUSED_ON_A_BACKFILL,
  SOURCES,
  CONVERSATION_SOURCES,
  WAYS,
  REPEAT_MIN,
  REPEAT_SIMILARITY,
  REPEAT_SIMILARITY_IS_MEASURED,
  day,
  text,
  nameList,
  notNames,
  plan,
  repeats,
  candidates,
  draft,
  fill
}
