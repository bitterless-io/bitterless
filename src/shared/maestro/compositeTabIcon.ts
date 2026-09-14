// Composite mini-app tab icons — the values `MaestroCompositeTabSpec.favicon` is meant to carry.
//
// **Why an inline SVG data URI and not an asset path.** A spec is registered from MAIN
// (`src/main/windows/*CoworkTab.ts`), and a bundled image in this repo is a RENDERER concept:
// `import x from './y.png'` goes through Vite, the emitted name is content-hashed
// (`bitterless-icon-Cj75Zy_s.png`), and anything under Vite's 4096-byte inline threshold is not
// emitted as a file at all. There is no asset manifest, so main cannot name the built file — and
// main has never imported an image (the tray is the one exception, and it ships through
// electron-builder `extraResources`, not through Vite). A data URI sidesteps all of that: one
// string that main, the renderer, XPC and the sqlite `tabs` row all understand, identical in dev
// and packaged.
//
// CSP: the Maestro home renderer allows `img-src 'self' data: https: http:`, so a data URI is
// permitted there. (The sqlite window's header blanking does not reach it — that window runs in the
// default session while Maestro home runs in `persist:bitterless-cowork`, and a blanked response
// header cannot remove a `<meta http-equiv>` policy anyway.)
//
// Drawn for 16px, which is the tab chip's actual size: a rounded-square field plus one simple
// subject, the same shape a real site favicon has, so it carries contrast on the light tab strip.
//
// The byte-identical pair lives in micromeet-cowork as `apps/cowork/src/shared/miniappIcon.ts` —
// the two apps show the same mini apps and should not drift into two different Zellij icons.

const svgDataUri = (svg: string): string => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`

/**
 * Zellij — a terminal MULTIPLEXER, so this draws panes rather than a `>_` prompt.
 * One large pane left, two stacked right: that is what its default layout looks like, and three
 * rectangles still read at 16px where a prompt glyph turns to mush.
 */
export const MAESTRO_ICON_ZELLIJ = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    '<rect width="16" height="16" rx="3.4" fill="#111827"/>' +
    '<rect x="3" y="3.6" width="5.2" height="8.8" rx="1.1" fill="#34D399"/>' +
    '<rect x="9.2" y="3.6" width="3.8" height="3.9" rx="1.1" fill="#34D399" opacity=".78"/>' +
    '<rect x="9.2" y="8.5" width="3.8" height="3.9" rx="1.1" fill="#34D399" opacity=".52"/>' +
    '</svg>'
)

/**
 * OnlyPreview — a square with an eye centred in it.
 *
 * The shape Ral settled on 2026-09-14 (「重做方形,中间是眼睈」), and it is a RETURN to this mini
 * app's own imagery rather than a new idea: the repo's own `onlypreview.svg` has always drawn a
 * sheet of paper with an eye inside it. This version drops the paper — at 16px two nested outlines
 * turn to mush, and the eye is the half that says what the app does (look, never edit).
 *
 * The field is the BRAND colour `#4E5882` (`--onlypreview-royal`, which is also the old icon's
 * stroke), not an arbitrary blue: the menu bar, the settings page and the guide are all that colour,
 * so the chip and the app's own chrome are finally the same thing.
 *
 * The menu bar carries the SAME shape in a mono rendering
 * (`src/renderer/onlypreview/shell/src/components/OnlyPreviewMark.vue`) — that bar is already
 * `#4E5882`, so a solid field would sink into it; there it strokes with `currentColor` instead.
 */
export const MAESTRO_ICON_ONLY_PREVIEW = svgDataUri(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">' +
    '<rect width="16" height="16" rx="3.4" fill="#4E5882"/>' +
    '<path d="M3.2 8C4.75 5.45 6.3 4.2 8 4.2s3.25 1.25 4.8 3.8c-1.55 2.55-3.1 3.8-4.8 3.8S4.75 10.55 3.2 8Z" fill="#fff"/>' +
    '<circle cx="8" cy="8" r="2" fill="#4E5882"/>' +
    // The catchlight is invisible at 16px and stops the pupil reading as a dead dot from 24px up.
    '<circle cx="7.15" cy="7.15" r=".62" fill="#fff" opacity=".92"/>' +
    '</svg>'
)
