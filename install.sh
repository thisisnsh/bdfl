#!/usr/bin/env sh
set -eu

if [ -n "${BDFL_VERSION:-}" ]; then
  BDFL_BASE_URL="https://github.com/thisisnsh/bdfl/releases/download/v${BDFL_VERSION}"
else
  BDFL_BASE_URL="https://github.com/thisisnsh/bdfl/releases/latest/download"
fi
BDFL_ARCHIVE="bdfl.tar.gz"
BDFL_TEMP="$(mktemp -d)"
trap 'rm -rf "$BDFL_TEMP"' EXIT HUP INT TERM

curl -fsSL "${BDFL_BASE_URL}/${BDFL_ARCHIVE}" -o "${BDFL_TEMP}/${BDFL_ARCHIVE}"
curl -fsSL "${BDFL_BASE_URL}/checksums.txt" -o "${BDFL_TEMP}/checksums.txt"
BDFL_EXPECTED="$(awk -v file="$BDFL_ARCHIVE" '$2 == file { print $1 }' "${BDFL_TEMP}/checksums.txt")"
[ -n "$BDFL_EXPECTED" ] || { echo "Missing checksum for ${BDFL_ARCHIVE}" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  BDFL_ACTUAL="$(sha256sum "${BDFL_TEMP}/${BDFL_ARCHIVE}" | awk '{print $1}')"
else
  BDFL_ACTUAL="$(shasum -a 256 "${BDFL_TEMP}/${BDFL_ARCHIVE}" | awk '{print $1}')"
fi
[ "$BDFL_ACTUAL" = "$BDFL_EXPECTED" ] || { echo "Checksum verification failed" >&2; exit 1; }

mkdir "${BDFL_TEMP}/source"
tar -xzf "${BDFL_TEMP}/${BDFL_ARCHIVE}" -C "${BDFL_TEMP}/source"
node "${BDFL_TEMP}/source/bin/install.js" "$@"
