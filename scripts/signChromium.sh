#!/bin/bash
set -e

# Usage: ./scripts/signChromium.sh /path/to/Chromium.app
# Output: /path/to/bitterless-chromium.app (signed with Developer ID)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SIGNING_ENV="$ROOT_DIR/local/signing.env"

# --- Read APPLE_TEAM_ID from signing.env ---
if [ ! -f "$SIGNING_ENV" ]; then
  echo "❌ local/signing.env not found at: $SIGNING_ENV"
  exit 1
fi

APPLE_TEAM_ID=$(grep '^APPLE_TEAM_ID=' "$SIGNING_ENV" | cut -d'=' -f2 | tr -d '[:space:]')
if [ -z "$APPLE_TEAM_ID" ]; then
  echo "❌ APPLE_TEAM_ID not found in local/signing.env"
  exit 1
fi

# --- Auto-detect identity from Keychain by Team ID ---
IDENTITY=$(security find-identity -v -p codesigning | \
  grep "Developer ID Application" | \
  grep "$APPLE_TEAM_ID" | \
  head -1 | \
  sed 's/.*"\(.*\)"/\1/')

if [ -z "$IDENTITY" ]; then
  echo "❌ No 'Developer ID Application' identity found in Keychain for Team ID: $APPLE_TEAM_ID"
  echo "   Run: security find-identity -v -p codesigning"
  exit 1
fi

echo ">>> Using identity: $IDENTITY"

# --- Validate input ---
CHROMIUM_APP="$1"
if [ -z "$CHROMIUM_APP" ]; then
  echo "Usage: $0 /absolute/path/to/Chromium.app"
  exit 1
fi

if [ ! -d "$CHROMIUM_APP" ]; then
  echo "❌ Not a directory: $CHROMIUM_APP"
  exit 1
fi

SOURCE_DIR="$(dirname "$CHROMIUM_APP")"
OUTPUT_APP="$SOURCE_DIR/bitterless-chromium.app"

# --- Copy Chromium.app ---
echo ">>> Copying $(basename "$CHROMIUM_APP") -> bitterless-chromium.app ..."
rm -rf "$OUTPUT_APP"
cp -R "$CHROMIUM_APP" "$OUTPUT_APP"

# --- Sign .dylib files ---
echo ">>> Signing .dylib files ..."
find "$OUTPUT_APP" -name "*.dylib" | while read -r f; do
  codesign --force --sign "$IDENTITY" --timestamp --options runtime "$f"
done

# --- Sign Mach-O executables ---
echo ">>> Signing standalone Mach-O executables ..."
find "$OUTPUT_APP" -type f ! -name "*.dylib" | while read -r f; do
  if file "$f" | grep -qE "Mach-O (64-bit )?executable"; then
    codesign --force --sign "$IDENTITY" --timestamp --options runtime "$f" 2>/dev/null || true
  fi
done

# --- Sign nested .app bundles (deepest first) ---
echo ">>> Signing nested .app bundles (inside-out) ..."
find "$OUTPUT_APP" -name "*.app" -mindepth 1 | sort -r | while read -r app; do
  echo "    signing: $(basename "$app")"
  codesign --force --sign "$IDENTITY" --timestamp --options runtime "$app"
done

# --- Sign root bitterless-chromium.app ---
echo ">>> Signing bitterless-chromium.app ..."
codesign --force --sign "$IDENTITY" --timestamp --options runtime "$OUTPUT_APP"

# --- Verify ---
echo ">>> Verifying ..."
codesign --verify --deep --strict "$OUTPUT_APP" && echo "✅ Verification passed"

echo ""
echo "✅ Done. Signed app: $OUTPUT_APP"
