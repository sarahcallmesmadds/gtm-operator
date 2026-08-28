'use strict'

const fs = require('fs')
const guard = require('../../plugins/software/scripts/guard-evidence-safety')

const [file, value] = process.argv.slice(2)
if (!file || value === undefined) process.exit(2)

const saved = guard.withFileLock(file, () => {
  const document = JSON.parse(fs.readFileSync(file, 'utf8'))
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20)
  document.values.push(value)
  const temporary = `${file}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(document)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, file)
  return true
})

if (!saved) process.exit(1)
