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
case "$root" in /*) ;; *) root="$PWD/$root" ;; esac
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
curl -fsSL --retry 2 "$download/$asset.sha256" -o "$tmp/$asset.sha256"
if command -v sha256sum >/dev/null; then
  checksum=(sha256sum)
else
  checksum=(shasum -a 256)
fi
read -r expected filename < "$tmp/$asset.sha256" || true
if [[ ! "$expected" =~ ^[0-9a-f]{64}$ || "$filename" != "$asset" ]]; then
  printf 'Invalid checksum for %s.\n' "$asset" >&2
  exit 1
fi

binary="$root/bin/prex"
installed=
if [[ -f "$binary" && -r "$binary" && -x "$binary" ]]; then
  installed=$("${checksum[@]}" < "$binary")
fi

if [[ "${installed%% *}" == "$expected" ]]; then
  printf 'Prex is already up to date (%s).\n' "$tag"
else
  printf 'Downloading Prex (%s)…\n' "$tag" >&2
  if [[ -t 2 ]]; then
    curl -fSL --progress-bar --retry 2 "$download/$asset" -o "$tmp/$asset"
  else
    curl -fsSL --retry 2 "$download/$asset" -o "$tmp/$asset"
  fi
  printf 'Verifying download…\n' >&2
  downloaded=$("${checksum[@]}" < "$tmp/$asset")
  if [[ "${downloaded%% *}" != "$expected" ]]; then
    printf 'Checksum mismatch for %s.\n' "$asset" >&2
    exit 1
  fi
  chmod 755 "$tmp/$asset"
  mv -f "$tmp/$asset" "$binary"
  printf 'Installed Prex (%s) at %s\n' "$channel" "$binary"
fi
printf '%s\n' "$channel" > "$tmp/channel"
mv -f "$tmp/channel" "$root/channel"
case "${SHELL:-}" in
  zsh|*/zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" ;;
  bash|*/bash) rc="$HOME/.bashrc" ;;
  *) rc= ;;
esac

printf -v path_line 'export PATH=%q:"$PATH"' "$root/bin"
if [[ -n "$rc" ]]; then
  if [[ -f "$rc" ]] && grep -Fxq -- "$path_line" "$rc"; then
    printf 'PATH is already configured in %s\n' "$rc"
  elif printf '\n# Prex\n%s\n' "$path_line" >> "$rc"; then
    printf 'Added Prex to PATH in %s\n' "$rc"
  else
    rc=
  fi
fi
if [[ -n "$rc" ]]; then
  printf 'Open a new terminal or run: source %q\n' "$rc"
else
  printf 'Add Prex to PATH: %s\n' "$path_line"
fi
