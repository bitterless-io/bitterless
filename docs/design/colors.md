# Color System

## Purpose

Define the canonical Bitterless product palette and the separate color contract for desktop menu
icon states.

## Product palette

The product theme is Royal Blue. `#4E5882` is the primary application color and the Arco primary
button color.

| Token | Hex | Usage |
|---|---|---|
| `royalblue-50` | `#F3F5FC` | Subtle page and modal background |
| `royalblue-100` | `#E2E4EB` | Soft selected or disabled surface |
| `royalblue-200` | `#C4CADF` | Light border and separator |
| `royalblue-300` | `#A3AAC5` | Muted decoration |
| `royalblue-400` | `#808AB1` | Secondary icon or text candidate |
| `royalblue-500` | `#606B9D` | Primary hover and brand decoration |
| `royalblue-600` | `#4E5882` | Primary action and Arco primary color |
| `royalblue-700` | `#3E4568` | Deep brand surface |
| `royalblue-800` | `#323955` | Primary pressed state, strong label, and heading |
| `royalblue-900` | `#1E2237` | Dark text and dark surface |
| `royalblue-950` | `#101321` | Reserved deepest text/shadow color; never a full-window fill |

### Arco runtime mapping

`theme.ts` maps the Arco palette to a seven-step subset of the Royal Blue colors. Standard primary
buttons must inherit that theme instead of setting a page-local background color. The runtime
pressed color is `#323955` (`arcoblue-7`).

```text
default  #4E5882
   |
   +-- hover   #606B9D
   |
   +-- pressed #323955
```

## Accent orange

`#C2410C` is the Bitterless accent orange. It is separate from the Royal Blue product theme and
must not replace the primary color on buttons, links, form focus, or other standard Arco actions.
Its current roles are selected menu icons, the Omni active-cell frame, and the legacy assistant
avatar/loading identity.

### Provenance

The orange is a repository-owned literal, not a value injected by Arco or `theme.ts`.

- It first appears in repository bootstrap commit `cdb1f8d8eb61c51972c5901a8719a6019cee8e06`
  on 2026-04-04.
- That commit introduced all seven orange `_active.png` menu assets and the hard-coded assistant
  avatar/loading backgrounds in `MessageItem.less` and `MessageList.less` together.
- It does not appear in the original `doc/colors.md` Royal Blue exploration, and the bootstrap
  `package.json` did not include Tailwind.
- The current Tailwind package classifies the same color as `orange-700`. This is a useful palette
  match, but it is not evidence that Tailwind generated the original Bitterless assets.

This document is now the semantic source of truth for the accent.

## Motto reminder red

Motto reminder cards use a feature-local red hierarchy to mark personal importance without
replacing the Royal Blue product theme.

| Token | Hex | Usage |
|---|---|---|
| `motto-reminder-strong` | `#B42318` | card title and left rule |
| `motto-reminder-muted` | `#A65F59` | optional card subtitle on white |

The muted value keeps a softer hierarchy while retaining approximately 4.77:1 contrast on the
white card surface. These colors do not apply to buttons, focus states, navigation, modal controls,
or other product surfaces.

## Menu icon states

Menu icons use the accent orange to identify the active navigation item.

| State | Icon color | Item background | Asset contract |
|---|---|---|---|
| Idle | `#8188A2` | Transparent | `<name>.png` |
| Hover | `#8188A2` | `#F3F4F6` | Reuse idle asset |
| Active | `#C2410C` | `#D9DDEC` | `<name>_active.png` |

```text
Idle                         Active
#8188A2 icon  ----------->   #C2410C icon
transparent background       #D9DDEC background
```

The current `chat`, `todo`, `mini-app`, `connector`, `setting`, `debug`, and `plugin` asset pairs
all follow this exact color contract.

### Maestro icon

`src/renderer/common/assets/icons/maestro.png` is the canonical Maestro Mini App glyph.

- Canvas: `200x200`, transparent.
- Solid core color: exactly `#8188A2`.
- SHA-256: `a2ad876354503292ffd324fd2bed4b58e3301b07b3a3eee845d1b40c5f9619dd`.
- Filename and product label are both `maestro`; the old `cowork.png` asset is retired.
- The Mini Apps card has no selected state, so this asset does not currently need an
  `_active.png` pair. If Maestro becomes a main-menu item, its active asset must preserve the
  same geometry and alpha coverage while using `#C2410C`.

## System tray icons

The desktop tray uses a dedicated bored-cat head rather than the full application icon. Both
platform variants share the same minimal geometry: two cat ears, a broad rounded head, half-lidded
eyes, a small nose, and a short flat mouth. They do not include the body, hand, laptop, rocket, text,
or a background tile.

| Platform | Runtime asset | Color contract | Container contract |
|---|---|---|---|
| macOS | `build/tray-mac@2x.png` | Black opaque core on transparency; Electron marks it as a Template Image so macOS supplies the visible menu-bar color | 80x80 RGBA source, resized to 16x16 at runtime |
| Windows | `build/tray-win.ico` | `#4E5882` Royal Blue core on transparency | ICO representations for 16, 20, 24, 32, 40, 48, 64, and 256 pixels |

Documentation masters live at `doc/bitterless-tray-mac.png` and
`doc/bitterless-tray-win.png`, both 208x208 RGBA. Release packaging copies the runtime assets to
`app.asar.unpacked/icons/`; development loads them from `build/`.

The tray artwork must remain legible at 16x16: use bold filled geometry and negative-space facial
features, not thin line art or hand-drawn surface texture that disappears under downsampling.

### PNG generation rules

- Canvas: `200x200` with a transparent background.
- Solid source color: exactly `#8188A2` for idle or `#C2410C` for active.
- Antialiased edge pixels may use partial alpha and small RGB rounding variations introduced by
  rasterization.
- Idle and active files in a pair must keep identical geometry and alpha coverage.

## Implementation references

- Arco theme: `theme.ts`
- Menu assets: `src/renderer/common/assets/icons/menu-icons/`
- Maestro glyph: `src/renderer/common/assets/icons/maestro.png`
- Menu state selection: `src/renderer/home/src/views/layout/components/homeMenu/homeMenuItem/`
- Login theme usage: `src/renderer/home/src/views/login/Login.less`
- Native/root underpaint: `src/main/windows/mainWindow.helper.ts` and
  `src/renderer/home/src/App.less`
- Legacy assistant accent usage:
  `src/renderer/home/src/views/chat/components/MessageItem/MessageItem.less` and
  `src/renderer/home/src/views/chat/components/MessageList/MessageList.less`
