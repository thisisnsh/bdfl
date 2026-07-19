#!/usr/bin/env sh
set -eu

BDFL_UNINSTALL_TEMP="$(mktemp -d)"
trap 'rm -rf "$BDFL_UNINSTALL_TEMP"' EXIT HUP INT TERM
curl -fsSL https://github.com/thisisnsh/bdfl/releases/latest/download/install.sh -o "$BDFL_UNINSTALL_TEMP/install.sh"
sh "$BDFL_UNINSTALL_TEMP/install.sh" --uninstall "$@"
