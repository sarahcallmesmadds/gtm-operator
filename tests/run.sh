#!/bin/sh
# Every test, in one command.
#
# There is no test framework here on purpose. Each file is plain Node with a
# handful of assertions, runnable on its own, and readable by somebody who does
# not know a runner's conventions. That matters more here than tidiness: these
# tests are the record of what Notion actually does, and the next person to read
# them will be trying to find out whether a claim is measured or assumed.
#
# Usage: sh tests/run.sh

set -e
cd "$(dirname "$0")/.."

status=0
for test in tests/*.test.js; do
  node "$test" || status=1
done

if [ $status -eq 0 ]; then
  echo "Everything passed."
else
  echo "Something failed. The output above says what."
fi

exit $status
