#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Jack Ruder <jack@djl.foundation>
# SPDX-License-Identifier: AGPL-3.0-or-later

set -euo pipefail

repo='JackatDJL/prex'
case "${1:---stable}" in
  --stable) channel=stable ;;
  --nightly) channel=nightly ;;
  *) printf 'Usage: install [--stable | --nightly]\n' >&2; exit 2 ;;
esac
[[ $# -le 1 ]] || exit 2
case "$(uname -s)" in
  Linux) os=linux ;;
  Darwin) os=darwin ;;
  *) printf 'Prex binaries support Linux and macOS.\n' >&2; exit 1 ;;
esac
case "$(uname -m)" in
  x86_64|amd64) arch=x64 ;;
  arm64|aarch64) arch=arm64 ;;
  *) printf 'Unsupported CPU architecture.\n' >&2; exit 1 ;;
esac

root=${PREX_INSTALL:-"$HOME/.prex"}
mkdir -p "$root/bin"
tmp=$(mktemp -d "$root/.install.XXXXXXXX")
trap 'rm -rf "$tmp"' EXIT
asset=prex-$os-$arch
tag=
for page in {1..10}; do
  releases=$(curl -fsSL --retry 2 "https://api.github.com/repos/$repo/releases?per_page=100&page=$page")
  tag=$(printf '%s\n' "$releases" | sed -nE 's/^[[:space:]]*"tag_name": "(prex-'"$channel"'-[0-9a-f]{40})",?$/\1/p' | sed -n '1p')
  [[ -z "$tag" ]] || break
  [[ "$releases" != '[]' ]] || break
done
if [[ -z "$tag" ]]; then printf 'No published Prex %s build found.\n' "$channel" >&2; exit 1; fi
download="https://github.com/$repo/releases/download/$tag"
curl -fsSL --retry 2 "$download/$asset" -o "$tmp/$asset"
curl -fsSL --retry 2 "$download/$asset.sha256" -o "$tmp/$asset.sha256"
(
  cd "$tmp"
  if command -v sha256sum >/dev/null; then
    sha256sum -c "$asset.sha256"
  else
    shasum -a 256 -c "$asset.sha256"
  fi
)
chmod 755 "$tmp/$asset"
printf '%s\n' "$channel" > "$tmp/channel"
mv -f "$tmp/$asset" "$root/bin/prex"
mv -f "$tmp/channel" "$root/channel"
printf 'Installed Prex (%s) at %s/bin/prex\n' "$channel" "$root"
printf 'Add this directory to PATH: %s/bin\n' "$root"
