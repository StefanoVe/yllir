#!/bin/sh
# Starts the Yllir master screen for one campaign folder (macOS and Linux).
# Usage: start.sh <campaign dir> [--lang it|en]
#
# Finds Node.js >= 20 on PATH, then in $YLLIR_HOME/node. When there is none, it
# downloads the Node LTS pinned in node-version.txt, checks its sha256 against that
# file (never against a hash fetched at the same time) and extracts it into
# $YLLIR_HOME/node. Then it runs launch.mjs with the same arguments.
#
# Environment:
#   YLLIR_HOME                  default $HOME/.yllir
#   YLLIR_NODE_BASE_URL         default https://nodejs.org/dist (tests use a local mirror)
#   YLLIR_NODE_SHA256_OVERRIDE  TEST ONLY: replaces the pinned sha256 of this computer.
#                               Never set it for a real run.

HERE=$(cd "$(dirname "$0")" && pwd)
YLLIR_HOME=${YLLIR_HOME:-$HOME/.yllir}
BASE_URL=${YLLIR_NODE_BASE_URL:-https://nodejs.org/dist}

# Language of the messages shown here (campaign.yaml is read by launch.mjs).
LANG_CODE=en
prev=
for arg in "$@"; do
  if [ "$prev" = "--lang" ]; then LANG_CODE=$arg; fi
  case "$arg" in
    --lang=*) LANG_CODE=${arg#--lang=} ;;
  esac
  prev=$arg
done
case "$LANG_CODE" in
  it) ;;
  *) LANG_CODE=en ;;
esac

msg() {
  case "$1:$LANG_CODE" in
    M2:it) text="Preparo il programma necessario, ci vorrà un minuto…" ;;
    M2:en) text="Setting up a required component, this takes a minute…" ;;
    M4:it) text="Non riesco ad avviare il master screen. Riprova; se continua, chiedi aiuto all'assistente." ;;
    M4:en) text="I could not start the master screen. Try again; if it keeps happening, ask the assistant for help." ;;
    M5:it) text="Non riesco a scaricare il componente necessario. Controlla la connessione e riprova." ;;
    M5:en) text="I could not download a required component. Check your connection and try again." ;;
  esac
  printf '%s\n' "$text" >&2
}

# Reads one key of node-version.txt.
pin() {
  sed -n "s/^$1=//p" "$HERE/node-version.txt" | head -n 1
}

# True when the given node binary exists and is at least the minimum major version.
node_ok() {
  [ -n "$1" ] && [ -x "$1" ] && "$1" -e "process.exit(Number(process.versions.node.split('.')[0]) >= $(pin minimum) ? 0 : 1)" >/dev/null 2>&1
}

# Downloads, verifies and extracts the pinned Node into $YLLIR_HOME/node. Returns 1 on failure.
install_node() {
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) msg M4; return 1 ;;
  esac
  case "$(uname -m)" in
    arm64|aarch64) cpu=arm64 ;;
    x86_64|amd64) cpu=x64 ;;
    *) msg M4; return 1 ;;
  esac
  platform=$os-$cpu
  case "$platform" in
    darwin-arm64|darwin-x64) ext=tar.gz ;;
    linux-x64|linux-arm64) ext=tar.xz ;;
    *) msg M4; return 1 ;;
  esac

  version=$(pin version)
  expected=$(pin "sha256.$platform")
  # TEST ONLY: see the header.
  if [ -n "${YLLIR_NODE_SHA256_OVERRIDE:-}" ]; then expected=$YLLIR_NODE_SHA256_OVERRIDE; fi
  if [ -z "$version" ] || [ -z "$expected" ]; then msg M4; return 1; fi

  file=node-v$version-$platform.$ext
  mkdir -p "$YLLIR_HOME" 2>/dev/null || { msg M4; return 1; }
  tmp=$(mktemp -d "$YLLIR_HOME/tmp.XXXXXX") || { msg M4; return 1; }

  msg M2
  if ! curl -fsSL --connect-timeout 20 --retry 2 -o "$tmp/$file" "$BASE_URL/v$version/$file"; then
    rm -rf "$tmp"; msg M5; return 1
  fi

  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tmp/$file" | cut -d ' ' -f 1)
  else
    actual=$(sha256sum "$tmp/$file" | cut -d ' ' -f 1)
  fi
  if [ "$actual" != "$expected" ]; then
    rm -rf "$tmp"; msg M5; return 1
  fi

  mkdir "$tmp/extract" && tar -xf "$tmp/$file" -C "$tmp/extract" || { rm -rf "$tmp"; msg M4; return 1; }
  src=$tmp/extract/node-v$version-$platform
  if [ ! -x "$src/bin/node" ]; then rm -rf "$tmp"; msg M4; return 1; fi
  rm -rf "$YLLIR_HOME/node"
  mv "$src" "$YLLIR_HOME/node" || { rm -rf "$tmp"; msg M4; return 1; }
  rm -rf "$tmp"
  return 0
}

NODE=
if p=$(command -v node 2>/dev/null) && node_ok "$p"; then
  NODE=$p
elif node_ok "$YLLIR_HOME/node/bin/node"; then
  NODE=$YLLIR_HOME/node/bin/node
fi

if [ -z "$NODE" ]; then
  install_node || exit 1
  NODE=$YLLIR_HOME/node/bin/node
  if ! node_ok "$NODE"; then msg M4; exit 1; fi
fi

exec "$NODE" "$HERE/launch.mjs" "$@"
