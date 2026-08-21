#!/bin/sh
# The full offline gate, before anything leaves the machine. Formatting is
# already handled on commit by lint-staged; this is the slow half — typegen
# drift, both test suites, astro check.
#
# It runs on push rather than on commit deliberately: `pnpm --filter site test`
# builds the fixture site first, so the whole thing takes tens of seconds. A
# hook that slow on every commit gets bypassed habitually, and a hook people
# bypass by reflex is worse than no hook — it makes commits look checked when
# they are not.
if pnpm verify; then
  exit 0
fi

cat >&2 <<'MSG'

✗ pnpm verify failed — nothing was pushed.

  If `pnpm dev` is running, stop it and try again: the Studio's typegen watcher
  rewrites site/src/sanity.types.ts underneath the drift check, which fails it
  for a reason that has nothing to do with your commits.

  To push anyway: git push --no-verify

MSG
exit 1
