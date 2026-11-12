#!/bin/sh
# yllir-shortcut v1
# Opens the Yllir master screen for the campaign folder this file is in.
# Written by Yllir; refreshed by the framework when it changes.

HERE=$(cd "$(dirname "$0")" && pwd)
FW=$(head -n 1 "$HOME/.yllir/framework-path" 2>/dev/null)
if [ ! -f "$FW/scripts/launcher/start.sh" ]; then
  FW="{{FRAMEWORK_DEFAULT}}"
fi
if [ ! -f "$FW/scripts/launcher/start.sh" ]; then
  echo "{{NOT_FOUND}}"
  read -r _
  exit 1
fi

sh "$FW/scripts/launcher/start.sh" "$HERE" --lang {{LANG}}
status=$?
if [ "$status" -ne 0 ]; then
  read -r _
fi
exit "$status"
