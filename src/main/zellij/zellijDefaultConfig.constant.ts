/**
 * The literal KDL Bitterless ensures in `<userData>/zellij/config.kdl`.
 *
 * Kept as text in its own file so the config reads as the config — a KDL document you can copy into
 * a terminal and validate — instead of being buried in the string concatenation that builds it.
 * `zellijDefaultConfig.test.mjs` validates the composed result with the bundled 0.45.1 binary.
 */

/** The theme this app defines and selects. Per app, so two installs never argue over one name. */
export const ZELLIJ_THEME_NAME = 'bitterless';

/** Bump when an existing installation must receive a fresh application-owned template. */
export const ZELLIJ_CONFIG_VERSION_CODE = '260913170717';

/**
 * Replaced with the binds derived from `defaultZellijShortcuts`.
 *
 * A placeholder rather than literal binds: hand-written keys here would be a SECOND source of truth
 * and would read back as drift the first time the settings panel opened.
 */
export const ZELLIJ_BINDS_PLACEHOLDER = '{{BINDS}}';

/**
 * Zellij's session UI uses RGB triples in `themes`; the web terminal's separate ANSI palette uses
 * hex strings in `web_client.theme`. Setting the first does not configure the second.
 */
export const ZELLIJ_DEFAULT_CONFIG_TEMPLATE = `// Written by Bitterless. Template version ${ZELLIJ_CONFIG_VERSION_CODE}.
// Edits are preserved within this version. A template upgrade backs up and replaces this file.
//
// These shortcuts are also editable from the terminal's settings panel, which performs a surgical
// edit of this file and leaves everything else byte for byte.

keybinds {
  normal {
${ZELLIJ_BINDS_PLACEHOLDER}
  }
}

// Colors for Zellij's tab bar, status bar and other session UI.
themes {
    ${ZELLIJ_THEME_NAME} {
        fg 216 222 233
        bg 26 27 38
        black 26 27 38
        red 247 118 142
        green 158 206 106
        yellow 224 175 104
        blue 122 162 247
        magenta 187 154 247
        cyan 125 207 255
        white 192 202 245
        orange 255 158 100
    }
}

theme "${ZELLIJ_THEME_NAME}"

// Keep the session UI consistent with the dark web terminal palette below.
explicit_theme_hue "dark"

// The web terminal's ANSI palette. Programs choose which colors to emit; these slots render them.
web_client {
    font "monospace"
    theme {
        background "#1a1b26"
        foreground "#c0caf5"
        cursor "#c0caf5"
        black "#15161e"
        red "#f7768e"
        green "#9ece6a"
        yellow "#e0af68"
        blue "#7aa2f7"
        magenta "#bb9af7"
        cyan "#7dcfff"
        white "#a9b1d6"
        bright_black "#414868"
        bright_red "#f7768e"
        bright_green "#9ece6a"
        bright_yellow "#e0af68"
        bright_blue "#7aa2f7"
        bright_magenta "#bb9af7"
        bright_cyan "#7dcfff"
        bright_white "#c0caf5"
    }
}

// Bitterless owns the shared server; sessions are available to its authenticated web client.
web_server false
web_sharing "on"

// The full layout (tab bar + status bar), not "compact": the pane shortcuts above are discoverable
// from the status bar, and this surface offers no other place to show them.
default_layout "default"
`;
