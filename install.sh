#!/bin/sh
# Mustr installer — downloads the latest release and puts it in /Applications.
#
#   curl -fsSL https://raw.githubusercontent.com/Tresnanda/mustr/main/install.sh | sh
#
# Why a script: macOS quarantines browser downloads, and an unsigned app that
# carries the quarantine flag gets Gatekeeper's "damaged" dialog. curl sets no
# quarantine flag, so this path installs and opens cleanly. In-app updates
# take over from here.
set -eu

REPO="Tresnanda/mustr"
DEST="/Applications/Mustr.app"

case "$(uname -s)" in
  Darwin) ;;
  *) echo "Mustr is macOS-only for now."; exit 1 ;;
esac
case "$(uname -m)" in
  arm64) ASSET="Mustr_aarch64.app.tar.gz" ;;
  x86_64) ASSET="Mustr_x64.app.tar.gz" ;;
  *) echo "Unsupported architecture: $(uname -m)"; exit 1 ;;
esac

URL="https://github.com/$REPO/releases/latest/download/$ASSET"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "Downloading Mustr ($ASSET)…"
curl -fL --progress-bar "$URL" -o "$TMP/mustr.tar.gz"
tar -xzf "$TMP/mustr.tar.gz" -C "$TMP"
[ -d "$TMP/Mustr.app" ] || { echo "Unexpected archive layout."; exit 1; }

if [ -d "$DEST" ]; then
  echo "Replacing the existing ${DEST}"
  rm -rf "$DEST"
fi
mv "$TMP/Mustr.app" "$DEST" 2>/dev/null || cp -R "$TMP/Mustr.app" "$DEST"

# Defensive: clear quarantine in case the archive was ever browser-downloaded.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Installed Mustr to $DEST"
open "$DEST"
