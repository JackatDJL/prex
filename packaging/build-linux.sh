#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
command -v nfpm >/dev/null || { echo "Install nFPM to build Linux packages." >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
export PREX_STAGE="$work/stage"
export PREX_VERSION
PREX_VERSION=$(node -p 'require("./package.json").version')
output="${1:-.artifacts/linux}"
mkdir -p "$PREX_STAGE" "$output"

npm pack --pack-destination "$work" >/dev/null
tar -xzf "$work/jackatdjl-prex-$PREX_VERSION.tgz" -C "$PREX_STAGE" --strip-components=1
cp package-lock.json "$PREX_STAGE/"
npm ci --prefix "$PREX_STAGE" --omit=dev --ignore-scripts --no-audit --no-fund
rm -f "$PREX_STAGE/package-lock.json" "$PREX_STAGE/node_modules/.package-lock.json"

# nFPM does not expand environment variables in content paths.
sed -e 's|${PREX_STAGE}|'"$PREX_STAGE"'|g' -e 's|${PREX_VERSION}|'"$PREX_VERSION"'|g' \
  packaging/nfpm.yaml > "$work/nfpm.yaml"

for format in deb rpm archlinux; do
  nfpm package --config "$work/nfpm.yaml" --packager "$format" --target "$output/"
done
