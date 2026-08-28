'use strict'

const crypto = require('crypto')
const os = require('os')
const path = require('path')

function pointerFileFor (cwd = process.cwd()) {
  const callerKey = crypto.createHash('sha256').update(path.resolve(cwd)).digest('hex').slice(0, 24)
  return path.join(os.tmpdir(), `gtm-software-evaluate-${callerKey}.scope-pointer`)
}

module.exports = { pointerFileFor }
