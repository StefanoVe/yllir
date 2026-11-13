#!/bin/sh
# Prints the release version held in master-screen/VERSION (MAJOR.MINOR.PATCH). The developer
# sets it by hand in the commit, together with the pin in yllir/master-screen.json. Fails
# unless the file holds exactly three numeric parts.
set -eu

root=$(cd "$(dirname "$0")/../.." && pwd)
cd "$root"

v=$(tr -d ' \t\r\n' < master-screen/VERSION)
if ! printf '%s\n' "$v" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$'; then
  echo "version.sh: master-screen/VERSION must be MAJOR.MINOR.PATCH, got '$v'" >&2
  exit 1
fi
echo "$v"
