#!/bin/bash

# Convert icon to multiple formats for Electron app
# Usage: ./convert_icon.sh <input_image>

set -e

# Ensure yarn global bin is in PATH
export PATH="$HOME/.yarn/bin:$PATH"

INPUT_IMAGE="$1"
BUILD_DIR="$(dirname "$0")/../build"

if [ -z "$INPUT_IMAGE" ]; then
  echo "Usage: $0 <input_image>"
  exit 1
fi

if [ ! -f "$INPUT_IMAGE" ]; then
  echo "Error: Input image not found: $INPUT_IMAGE"
  exit 1
fi

echo "Converting icon from: $INPUT_IMAGE"
echo "Output directory: $BUILD_DIR"

# Create temporary directory for iconset
TEMP_DIR=$(mktemp -d)
ICONSET_DIR="$TEMP_DIR/icon.iconset"
mkdir -p "$ICONSET_DIR"

# Generate PNG at 1024x1024
echo "Generating icon.png..."
sips -z 1024 1024 "$INPUT_IMAGE" --out "$BUILD_DIR/icon.png" > /dev/null

# Generate iconset for macOS (ICNS)
echo "Generating icon.icns..."
sips -z 16 16     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_16x16.png" > /dev/null
sips -z 32 32     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_16x16@2x.png" > /dev/null
sips -z 32 32     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_32x32.png" > /dev/null
sips -z 64 64     "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_32x32@2x.png" > /dev/null
sips -z 128 128   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_128x128.png" > /dev/null
sips -z 256 256   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_128x128@2x.png" > /dev/null
sips -z 256 256   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_256x256.png" > /dev/null
sips -z 512 512   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_256x256@2x.png" > /dev/null
sips -z 512 512   "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_512x512.png" > /dev/null
sips -z 1024 1024 "$INPUT_IMAGE" --out "$ICONSET_DIR/icon_512x512@2x.png" > /dev/null

iconutil -c icns "$ICONSET_DIR" -o "$BUILD_DIR/icon.icns"

# Generate ICO for Windows using png2icons
echo "Generating icon.ico..."
if command -v png2icons &> /dev/null; then
  png2icons "$BUILD_DIR/icon.png" "$BUILD_DIR/icon.ico" -icns
else
  echo "Warning: png2icons not found. Install with: yarn global add png2icons"
  echo "Using PNG as fallback - electron-builder will convert during build."
  cp "$BUILD_DIR/icon.png" "$BUILD_DIR/icon.ico.png"
fi

# Cleanup
rm -rf "$TEMP_DIR"

echo "✓ Icon conversion complete!"
echo "  - $BUILD_DIR/icon.png"
echo "  - $BUILD_DIR/icon.icns"
if [ -f "$BUILD_DIR/icon.ico" ]; then
  echo "  - $BUILD_DIR/icon.ico"
else
  echo "  - $BUILD_DIR/icon.ico.png (will be converted by electron-builder)"
fi
