#!/bin/bash
set -e

# Usage: ./scripts/signElectron.sh /path/to/Electron.app
# Signs Electron.app in-place with proper entitlements for each helper.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
SIGNING_ENV="$ROOT_DIR/local/signing.env"
ENTITLEMENTS_MAIN="$ROOT_DIR/build/entitlements.mac.plist"

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
ELECTRON_APP="$1"
if [ -z "$ELECTRON_APP" ]; then
  echo "Usage: $0 /absolute/path/to/Electron.app"
  exit 1
fi

if [ ! -d "$ELECTRON_APP" ]; then
  echo "❌ Not a directory: $ELECTRON_APP"
  exit 1
fi

# --- Write temporary entitlements plist files ---
ENTITLEMENTS_RENDERER=$(mktemp /tmp/electron-entitlements-renderer.XXXXXX.plist)
ENTITLEMENTS_HELPER=$(mktemp /tmp/electron-entitlements-helper.XXXXXX.plist)

cleanup() {
  rm -f "$ENTITLEMENTS_RENDERER" "$ENTITLEMENTS_HELPER"
}
trap cleanup EXIT

# Renderer helper: needs JIT for JavaScript execution
cat > "$ENTITLEMENTS_RENDERER" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
</dict>
</plist>
EOF

# GPU / Plugin / base helper: no JIT needed
cat > "$ENTITLEMENTS_HELPER" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.allow-dyld-environment-variables</key>
  <true/>
</dict>
</plist>
EOF

# --- Sign .dylib files ---
echo ">>> Signing .dylib files ..."
find "$ELECTRON_APP" -name "*.dylib" | while read -r f; do
  codesign --force --sign "$IDENTITY" --timestamp --options runtime "$f"
done

# --- Sign standalone Mach-O executables (non-.dylib, non-.app) ---
echo ">>> Signing standalone Mach-O executables ..."
find "$ELECTRON_APP" -type f ! -name "*.dylib" | while read -r f; do
  if file "$f" | grep -qE "Mach-O (64-bit )?executable"; then
    codesign --force --sign "$IDENTITY" --timestamp --options runtime "$f" 2>/dev/null || true
  fi
done

# --- Sign frameworks (inside-out) ---
echo ">>> Signing frameworks ..."
find "$ELECTRON_APP" -name "*.framework" -mindepth 1 | sort -r | while read -r fw; do
  echo "    signing framework: $(basename "$fw")"
  codesign --force --sign "$IDENTITY" --timestamp --options runtime "$fw"
done

# --- Sign Electron Helper (Renderer).app with JIT entitlements ---
RENDERER_HELPER="$ELECTRON_APP/Contents/Frameworks/Electron Helper (Renderer).app"
if [ -d "$RENDERER_HELPER" ]; then
  echo ">>> Signing Electron Helper (Renderer).app [JIT entitlements] ..."
  codesign --force --sign "$IDENTITY" --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS_RENDERER" "$RENDERER_HELPER"
fi

# --- Sign remaining helper .app bundles ---
echo ">>> Signing remaining helper .app bundles ..."
find "$ELECTRON_APP/Contents/Frameworks" -name "*.app" -mindepth 1 | sort -r | while read -r app; do
  BASENAME="$(basename "$app")"
  if [ "$BASENAME" = "Electron Helper (Renderer).app" ]; then
    continue
  fi
  echo "    signing: $BASENAME"
  codesign --force --sign "$IDENTITY" --timestamp --options runtime \
    --entitlements "$ENTITLEMENTS_HELPER" "$app"
done

# --- Sign root Electron.app ---
echo ">>> Signing Electron.app ..."
codesign --force --sign "$IDENTITY" --timestamp --options runtime \
  --entitlements "$ENTITLEMENTS_MAIN" "$ELECTRON_APP"

# --- Verify ---
echo ">>> Verifying ..."
codesign --verify --deep --strict "$ELECTRON_APP" && echo "✅ Verification passed"

echo ""
echo "✅ Done. Signed: $ELECTRON_APP"
