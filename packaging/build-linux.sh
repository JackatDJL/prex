#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Jack Ruder <jack@djl.foundation>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v nfpm >/dev/null || { echo "Install nFPM to build Linux packages." >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PREX_STAGE="$work/stage"
export PREX_VERSION
PREX_VERSION=$(bun -p 'require("./package.json").version')
case "$(uname -m)" in
  x86_64) PREX_ARCH=amd64; target=bun-linux-x64-baseline ;;
  aarch64) PREX_ARCH=arm64; target=bun-linux-arm64 ;;
  *) echo "Unsupported Linux architecture." >&2; exit 1 ;;
esac
output="${1:-.artifacts/linux}"
mkdir -p "$PREX_STAGE" "$output"

bun build --compile --target="$target" --define PREX_COMPILED=true src/cli.ts --outfile "$PREX_STAGE/prex"

# nFPM does not expand environment variables in content paths.
sed -e 's|${PREX_STAGE}|'"$PREX_STAGE"'|g' -e 's|${PREX_VERSION}|'"$PREX_VERSION"'|g' \
  -e 's|${PREX_ARCH}|'"$PREX_ARCH"'|g' packaging/nfpm.yaml > "$work/nfpm.yaml"

for format in deb rpm archlinux; do
  nfpm package --config "$work/nfpm.yaml" --packager "$format" --target "$output/"
done
