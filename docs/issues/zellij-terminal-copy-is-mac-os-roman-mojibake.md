# Copying Output out of the Zellij Terminal Returns Mac OS Roman Mojibake

Status: implemented; owner verification pending (needs a rebuild — this is Main-process code)

## Symptom

Text copied out of the Zellij terminal arrives mangled. `没有系统级输入权限` comes back as
`Ê≤°ÊúâÁ≥ªÁªüÁ∫ßËæìÂÖ•ÊùÉÈôê`. The terminal _renders_ the same text correctly, so this is not a
font or a glyph fault — the bytes are intact on screen and break only on the way out.

## Root cause

The mangling is exact, and reproducing it names the encoding:

```
$ printf '没有系统级输入权限' | iconv -f MACINTOSH -t UTF-8
Ê≤°ÊúâÁ≥ªÁªüÁ∫ßËæìÂÖ•ÊùÉÈôê
```

UTF-8 bytes are being decoded as **Mac OS Roman**. On macOS that encoding has one source: it is what
`CFStringGetSystemEncoding()` returns when the process locale is C/POSIX, and it is the documented
fallback of the pasteboard tools — `man pbcopy`: _"If an encoding cannot be determined from the
locale, the standard C encoding will be used."_

Every process under our Zellij tree runs in exactly that locale. Measured inside a live pane:

```
LANG=<unset>  LC_ALL=<unset>  LC_CTYPE=<unset>
locale → LC_CTYPE="C"
```

`resolveZellijChildEnvironment` (`zellijEnvironment.service.ts`) deliberately normalizes the
environment of a GUI terminal — it pins `TERM`, `COLORTERM` and `CLICOLOR`, and strips `NO_COLOR` and
friends — but it says nothing about the locale. Its input is the Main process's `process.env`, and a
macOS app launched from Finder or the Dock is started by launchd with no `LANG` at all. Neither
`~/.zshrc` nor `~/.zprofile` sets one on this machine, so nothing downstream repairs it.

What that function returns reaches everything: `prepareZellijChildEnvironment` feeds both
`spawnServer` (the `zellij web` server) and `runCli` (session create/attach), so the server, the
session, and every pane's shell inherit the C locale together.

Not the cause, and deliberately left alone: `zellijNativeOwner.service.ts` passes `LC_ALL: 'C'` to a
single `/bin/ps` call. That is scoped to that call and exists to keep `lstart` in a fixed format for
the row regex.

## Repair

`resolveZellijChildEnvironment` fills the locale gap the same way it already fills the color gap:
when the launcher supplied no locale signal at all — no `LANG`, no `LC_ALL`, no `LC_CTYPE` — the
child environment gets `LANG=en_US.UTF-8`.

- **It only fills a gap.** Any locale the launcher already set stays, and a `LANG` in the user's KDL
  `env` block still wins: `resolveZellijSessionEnvironment` runs after this and remains the
  documented override point.
- **`en_US.UTF-8`, not `zh_CN.UTF-8`.** The defect is an encoding defect; choosing a language would
  additionally switch every CLI tool's messages. `en_US.UTF-8` is present on every macOS version,
  while `C.UTF-8` arrived only recently.
- **Ordered before the `ZELLIJ_SOCKET_DIR` early return**, so a user who pins their own socket
  directory is not skipped over.
- **macOS only.** Windows has no POSIX locale to lose, and it is the only other supported platform.

## Still open

Which copy path produced the reported paste is not pinned down. Cmd+C goes through
`zellijKeyBridge` (`term.getSelection()` → Electron `clipboard.writeText()`, both Unicode-safe),
while a mouse selection or a scroll-mode copy leaves through Zellij's own OSC 52 path. The C locale
is a real defect either way and repairing it is correct regardless — but if the mojibake survives a
rebuild, that second path is the remaining suspect.

## Verification

- `node --test tests/zellij/zellijEnvironment.test.mjs tests/zellij/zellijShellRuntime.test.mjs
tests/zellij/zellijRuntime.test.mjs tests/zellij/zellijShellIntegration.test.mjs` — 34/34 pass
  (1 new case, asserting the fill, the launcher's own locale winning, the socket-override ordering,
  Windows staying untouched, and the KDL `env` override still landing last).
- `yarn eslint src/main/zellij/zellijEnvironment.service.ts tests/zellij/zellijEnvironment.test.mjs`
  and `prettier --check` — clean.
- `yarn typecheck:node` — the `main` surface is red at **64 pre-existing errors** in this working
  tree (`omniWindow.helper.ts`, `maestro/skills/*`, `onlyPreview*` views, all already modified by
  other in-flight work). Zero of them are in any `src/main/zellij/` file, so this change adds none;
  it does not leave typecheck green either, and that was already true before it.
- Not run: Electron E2E (house rule — never on agent initiative). Confirming the real paste needs a
  rebuild and the owner's own Cmd+C.
