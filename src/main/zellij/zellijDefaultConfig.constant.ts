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
export const ZELLIJ_CONFIG_VERSION_CODE = '260920134020';

/**
 * Replaced with the binds derived from `defaultZellijShortcuts`.
 *
 * A placeholder rather than literal binds: hand-written keys here would be a SECOND source of truth
 * and would read back as drift the first time the settings panel opened.
 */
export const ZELLIJ_BINDS_PLACEHOLDER = '{{BINDS}}';

/**
 * Zellij's session UI uses RGB triples or palette indices in `themes`; the web terminal's separate
 * ANSI palette uses hex strings in `web_client.theme`. Setting one does not configure the other.
 */
export const ZELLIJ_DEFAULT_CONFIG_TEMPLATE = `// Written by Bitterless. Template version ${ZELLIJ_CONFIG_VERSION_CODE}.
// Edits are preserved within this version. A template upgrade backs up and replaces this file.
//
// These shortcuts are also editable from the terminal's settings panel, which performs a surgical
// edit of this file and leaves everything else byte for byte.

keybinds {
  // Option+Left/Right must reach the program as word movement, the way they do in a native macOS
  // input. The web client already sends the right thing (\\x1b[1;3D / \\x1b[1;3C, see its
  // assets/key-handler.js); it is Zellij's own default bind of "Alt left"/"Alt right" to
  // MoveFocusOrTab that consumes them before the pane ever sees them. Unbound globally, not just in
  // normal mode, because the defaults install them through \`shared_except "locked"\`.
  //
  // Left/right pane focus keeps working through "Alt h"/"Alt l" — also a Zellij default, and usable
  // only because \`mac_option_is_meta\` is set below. "Alt up"/"Alt down" are deliberately left
  // bound: no editing key needs them, so pane focus keeps a pair of arrows.
  //
  // BOTH KEYS MUST STAY ON THIS ONE NODE. Zellij reads the global unbind with
  // \`kdl_keybinds.children().get("unbind")\`, which returns the FIRST node of that name and drops
  // every later one (kdl/mod.rs:5179, v0.45.1) — while \`keys_from_kdl!\` takes all arguments of the
  // node it is given. Written as two lines, "Alt right" was silently ignored and Option+Right kept
  // switching panes for four days, through a template that looked correct and a config Zellij
  // validated without complaint. See zellij-terminal-mac-editing-keys-and-esc.md.
  unbind "Alt left" "Alt right"

  normal {
${ZELLIJ_BINDS_PLACEHOLDER}
  }
}

// Colors for Zellij's tab bar, status bar and other session UI.
themes {
    ${ZELLIJ_THEME_NAME} {
        // Preserve the 0.45.1 legacy palette conversion; only text_selected changes.
        // A partial semantic theme would discard the other legacy colors.
        text_unselected {
            base 192 202 245
            background 26 27 38
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 158 206 106
            emphasis_3 187 154 247
        }
        text_selected {
            base 21 22 30
            background 122 162 247
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 158 206 106
            emphasis_3 187 154 247
        }
        ribbon_unselected {
            base 26 27 38
            background 216 222 233
            emphasis_0 247 118 142
            emphasis_1 192 202 245
            emphasis_2 122 162 247
            emphasis_3 187 154 247
        }
        ribbon_selected {
            base 26 27 38
            background 158 206 106
            emphasis_0 247 118 142
            emphasis_1 255 158 100
            emphasis_2 187 154 247
            emphasis_3 122 162 247
        }
        exit_code_success {
            base 158 206 106
            background 0
            emphasis_0 125 207 255
            emphasis_1 26 27 38
            emphasis_2 187 154 247
            emphasis_3 122 162 247
        }
        exit_code_error {
            base 247 118 142
            background 0
            emphasis_0 224 175 104
            emphasis_1 0
            emphasis_2 0
            emphasis_3 0
        }
        frame_selected {
            base 158 206 106
            background 0
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 187 154 247
            emphasis_3 0
        }
        frame_highlight {
            base 255 158 100
            background 0
            emphasis_0 187 154 247
            emphasis_1 0
            emphasis_2 255 158 100
            emphasis_3 255 158 100
        }
        table_title {
            base 158 206 106
            background 0
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 158 206 106
            emphasis_3 187 154 247
        }
        table_cell_unselected {
            base 192 202 245
            background 26 27 38
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 158 206 106
            emphasis_3 187 154 247
        }
        table_cell_selected {
            base 192 202 245
            background 26 27 38
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 158 206 106
            emphasis_3 187 154 247
        }
        list_unselected {
            base 192 202 245
            background 26 27 38
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 158 206 106
            emphasis_3 187 154 247
        }
        list_selected {
            base 192 202 245
            background 26 27 38
            emphasis_0 255 158 100
            emphasis_1 125 207 255
            emphasis_2 158 206 106
            emphasis_3 187 154 247
        }
        multiplayer_user_colors {
            player_1 187 154 247
            player_2 122 162 247
            player_3 0
            player_4 224 175 104
            player_5 125 207 255
            player_6 0
            player_7 247 118 142
            player_8 0
            player_9 0
            player_10 0
        }
    }
}

theme "${ZELLIJ_THEME_NAME}"

// Keep the session UI consistent with the dark web terminal palette below.
explicit_theme_hue "dark"

// The web terminal's ANSI palette. Programs choose which colors to emit; these slots render them.
web_client {
    font "monospace"
    // Option is Meta, as every terminal-as-editor setup has it: Option+Backspace deletes a word,
    // Option+letter reaches the program instead of typing an accent (Option+h was producing "˙"),
    // and Zellij's own "Alt h"/"Alt l" focus binds become reachable at all. xterm.js defaults this
    // to false, which is why none of that worked.
    mac_option_is_meta true
    theme {
        background "#1a1b26"
        foreground "#c0caf5"
        cursor "#c0caf5"
        selection_background "#7aa2f7"
        selection_foreground "#15161e"
        selection_inactive_background "#6686c2"
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
