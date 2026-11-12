#!/bin/sh
# Packs the master screen release: yllir-master-screen-<version>.tar.gz whose root holds
# exactly server.mjs, public/ (the client build) and VERSION. The output is deterministic:
# same inputs give the same bytes. Needs GNU tar (ubuntu-latest) for the fixed flags.
#
# usage: pack.sh <version> <outdir>
# stdout: sha256=<hex> and size=<bytes> (one per line)
# Inputs: MS_SERVER_JS (default master-screen/dist/server.mjs),
#         MS_CLIENT_DIR (default master-screen/client/dist/client/browser).
set -eu

if [ $# -ne 2 ]; then
  echo "usage: pack.sh <version> <outdir>" >&2
  exit 2
fi
version=$1
outdir=$2

case "$version" in
  *[!0-9.]*|""|.*|*.) echo "pack.sh: bad version '$version'" >&2; exit 1 ;;
esac

root=$(cd "$(dirname "$0")/../.." && pwd)
server=${MS_SERVER_JS:-$root/master-screen/dist/server.mjs}
client=${MS_CLIENT_DIR:-$root/master-screen/client/dist/client/browser}

test -f "$server" || { echo "pack.sh: missing server bundle $server" >&2; exit 1; }
test -d "$client" || { echo "pack.sh: missing client build $client" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM
stage="$work/stage"
mkdir -p "$stage/public"
cp "$server" "$stage/server.mjs"
cp -R "$client/." "$stage/public/"
printf '%s\n' "$version" > "$stage/VERSION"

name="yllir-master-screen-$version.tar.gz"
mkdir -p "$outdir"
(
  cd "$stage"
  tar --sort=name --mtime='UTC 2020-01-01' --owner=0 --group=0 --numeric-owner \
    --mode='u=rwX,go=rX' -cf "$work/pkg.tar" server.mjs public VERSION
)
gzip -n -9 -c "$work/pkg.tar" > "$outdir/$name"

if command -v sha256sum >/dev/null 2>&1; then
  sha=$(sha256sum "$outdir/$name" | awk '{print $1}')
else
  sha=$(shasum -a 256 "$outdir/$name" | awk '{print $1}')
fi
size=$(wc -c < "$outdir/$name" | tr -d ' ')
echo "sha256=$sha"
echo "size=$size"
