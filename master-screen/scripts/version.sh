#!/bin/sh
# Prints the release version: MAJOR.MINOR from master-screen/VERSION, then the number of
# commits that touched master-screen/ (MAJOR.MINOR.<n>). Needs a full clone (fetch-depth: 0).
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

base=$(tr -d ' \t\r\n' < master-screen/VERSION)
case "$base" in
  [0-9]*.[0-9]*)
    case "$base" in
      *[!0-9.]*|*.*.*) echo "version.sh: master-screen/VERSION must be MAJOR.MINOR, got '$base'" >&2; exit 1 ;;
    esac ;;
  *) echo "version.sh: master-screen/VERSION must be MAJOR.MINOR, got '$base'" >&2; exit 1 ;;
esac

if [ "$(git rev-parse --is-shallow-repository)" = "true" ]; then
  echo "version.sh: shallow clone, the commit count would be wrong (use fetch-depth: 0)" >&2
  exit 1
fi

n=$(git rev-list --count HEAD -- master-screen)
echo "$base.$n"
