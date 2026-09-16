# Workbench LAN address

Status: implemented; code-verified, human testing pending — 2026-09-16.

Owner decision: Ral, 2026-09-16.

Ral requires the Workbench settings surface to show this machine's LAN IPv4 address. The address is
resolved once and cached — never re-resolved on every render or every panel open — and a Refresh
button forces a re-resolve as the fallback for "went offline / reconnected to another network".
Apply the same behavior to BL and COWORK.

## Behavior

The address row lives in Settings. It shows one value, one secondary line that explains the value,
and one borderless icon button that forces a re-resolve.

```text
Local network address
192.168.2.45
en0                                                    [ ⟳ ]

              ↓ no usable address on this machine

Local network address
—
No local network address
Ignored virtual adapters: 198.18.0.1 · utun1024       [ ⟳ ]
```

| state | value slot | secondary line | Refresh |
| --- | --- | --- | --- |
| not yet resolved | `—` | nothing at all | enabled |
| `ok` | the address | the interface name (`en0`) | enabled |
| `none` | `—` | *No local network address*, plus the ignored candidates when there are any | enabled |
| `error` | `—` | *Could not read network interfaces* | enabled |
| refreshing | the previous value stays on screen | unchanged | disabled |

Four rules that are easy to "tidy away" and must not be:

- **Before the first response, no message is rendered.** Only the em dash. A *No local network
  address* line shown before the first resolve lands is a lie, so the not-yet-loaded state and
  `status: 'none'` are separate cases, not one falsy check.
- **Refresh stays enabled in every failure state.** `none` and `error` are exactly the states the
  button exists to recover from. Only an in-flight read (`busy`) disables it.
- **A refresh never blanks the value.** Blanking during a re-read looks like a broken pane.
- **The interface name is kept in the `ok` state.** The design deliberately ships no runners-up
  disclosure while an address is found, so that one word is the entire diagnostic affordance.

## Resolution

Resolution is pure and synchronous. `pickLanIpv4(interfaces, platform)` takes the interface table as
a **parameter** rather than calling `os.networkInterfaces()` itself. That seam is the point of the
design, not a testing convenience: it shrinks the untested part of the feature to the five-line
`src/main/lanIp/lanIp.service.ts`, and every decision below is exercised by plain fixtures. Do not
"simplify" the reader back into the helper.

**Step 1 — admit.** An entry is a candidate only when `family` is `'IPv4'` (or the numeric `4`),
`internal !== true`, the address is four octets each `<= 255`, and the address is outside the denied
ranges. Anything malformed — an empty address, `192.168.1`, `999.1.1.1`, a `null` array entry, an
`undefined` value for a key — is dropped as a data case. It must never throw: this shape crosses xpc,
and a throw blanks the pane.

**Denied ranges** (dropped by address, whatever the interface is called):

| range | why |
| --- | --- |
| `127.0.0.0/8` | loopback |
| `0.0.0.0/8` | "this network" |
| `169.254.0.0/16` | APIPA — DHCP failed, never a usable LAN |
| `198.18.0.0/15` | RFC 2544 benchmark — this is what Clash / Xray TUN hands out on this machine |
| `192.0.2.0/24`, `198.51.100.0/24`, `203.0.113.0/24` | TEST-NET 1/2/3 |
| `224.0.0.0/4` | multicast |
| `240.0.0.0/4` | reserved, covers `255.255.255.255` |

RFC1918 is **not** required and CGNAT `100.64.0.0/10` is **not** dropped. A public-IPv4 LAN is rare
but real, and some CPE hands out CGNAT. They are ranked, not filtered.

**Step 2 — classify.** On `win32` the interface key is the user-renamable, localized Connection
name, so an allow-list is structurally wrong and matching is by lowercase **substring**
(`vethernet`, `wsl`, `hyper-v`, `vmware`, `virtualbox`, `docker`, `wintun`, `tun`, `openvpn`,
`wireguard`, `tailscale`, `zerotier`, `clash`, `mihomo`, `bluetooth`, `teredo`, `isatap`, `6to4`,
`pseudo`, and so on). Elsewhere matching is by **prefix** (`utun`, `ipsec`, `ppp`, `awdl`, `llw`,
`anpi`, `bridge`, `vmnet`, `vboxnet`, `vnic`, `gif`, `stf`, `docker`, `veth`, `br-`, `lo`) plus the
exact pattern `^ap\d+$` — `ap1` is the Wi-Fi hotspot interface and carries `192.168.2.1` under
Internet Sharing, while `startsWith('ap')` would wrongly swallow a renamed real NIC. `en*` is allowed
in full: `en0` is Wi-Fi, `en1`–`en6` only get an IPv4 when something real is plugged in, and a
USB-tethered iPhone is `en*` with `172.20.10.x` and is a legitimate LAN.

**Step 3 — score.** `score = nameScore + addressScore + prefixScore`.

- `nameScore` — `100` for a real interface, `0` for a virtual one, so a deny-list survivor always
  outranks a virtual candidate.
- `addressScore` — RFC1918 `30`, CGNAT `10`, other global unicast `20`.
- `prefixScore` — `+5` when the CIDR prefix is 8–24. A `/30`, `/31` or `/32` is a point-to-point
  link, not a LAN, so it earns no bonus. The prefix is read from `cidr`, falling back to counting the
  set bits of `netmask`.

**Step 4 — total order.** `os.networkInterfaces()` key order is OS insertion order and is not
contractually stable, so equal scores must never let a re-resolve flip the shown address or Refresh
becomes a slot machine. Candidates sort by score descending, then prefix ascending, then interface
name (`localeCompare` with `numeric: true`, so `en2` sorts before `en10`), then address.

**Step 5 — pick.** The primary is the first **non-virtual** candidate in that order. When there is
none the result is `none`, even if virtual candidates exist. A deny-listed interface can never become
the primary: showing `192.168.56.1` (VirtualBox) as "your LAN IP" is silently wrong, and "no local
network address" is recoverable.

**No sentinel address is ever emitted.** Not `0.0.0.0`, not `127.0.0.1`, not `''`, not `unknown`, not
`-`. A plausible-looking fake is the worst possible failure here, because someone pastes it into a
colleague's browser and gets a dead end with no error.

**No raw error text crosses the wire.** `status: 'error'` carries no message. Main logs the
exception; the UI renders a translated string. That structurally forecloses an untranslated exception
appearing in the pane.

## Cache and refresh

The cache lives in Main and is a dependency-injected class (`read` / `platform` / `now` are
constructor dependencies), which is what lets both repos run the same cache tests with no stubbing.

| | behaviour |
| --- | --- |
| first read | resolves, stamps `resolvedAt`, caches, returns |
| every later read | returns the identical cached snapshot; the interface table is not read again |
| panel close → reopen | zero re-resolve — the renderer store's `loaded` guard short-circuits before the xpc call, and a different renderer is answered from the Main cache |
| panel close → reopen after an `error` | re-reads. The store settles `loaded` **after** the read and only on an answer (`ok` / `none`), so a failure does not consume the resolve-once budget. This is what makes the "error is not cached" row below reachable from the UI at all — a `loaded` set before the call would pin the first failure for the app's lifetime |
| Refresh | clears the cache and re-resolves, unconditionally |
| `resolvedAt` | changes on a re-resolve and on nothing else — the assertable proof that "resolve once" held |
| `status: 'none'` | **is cached.** Going offline is exactly what the button is for. |
| `status: 'error'` | **is not cached.** A failed read is not an answer; the next read retries. |
| TTL | none. A TTL reintroduces the per-open re-resolve this feature forbids. |

`status: 'error'` is the one deliberate asymmetry. With button-only invalidation, caching a transient
throw at boot would pin a broken state for the whole app lifetime. The cost of not caching it is a
sub-millisecond re-read on panel open, and only while the machine is genuinely broken.

**Resolution is synchronous**, so there is no in-flight promise to dedupe in Main and none in the
store beyond the `busy` re-entrancy flag. This is deliberately simpler than
`generalSetting.store.ts`, whose `chatMenuLoadPromise` exists only because *its* loader is async all
the way down. Do not copy that machinery back in.

A second user click cannot reach the store at all — the button is disabled while `busy`. A refresh
asked for by the `'online'` listener while a read is in flight is **queued, never dropped**: that
listener fires on a network change the in-flight read may predate, so its answer can already be
stale. Requests collapse into exactly one follow-up, so a flapping link cannot build a backlog.
Dropping it instead is how the self-heal below fails **silently**: the pane keeps the pre-change
address, and the "network changed" hint does not even survive to warn about it, because the older
read that was already in flight clears `stale` when it lands.

**Invalidation is global, with no event.** Bitterless renders this same Setting tree in two renderer
processes — the Home window and the Maestro workbench — and both read one Main cache. Pressing
Refresh in one window therefore changes what the other shows on its next read, with no broadcast and
no ordering. That is correct for one machine with one answer, but it is surprising, so it is written
here rather than discovered in review.

**Two convenience triggers, neither a guarantee.**

- Main marks the snapshot dirty on Electron's `powerMonitor` `'resume'`. It is a flag only
  (`snapshot = null`) — never a push or broadcast — so the next read from any renderer re-resolves
  with no channel, no subscribe/unsubscribe and no store change. `'resume'` is an incomplete signal
  by construction: it misses a Wi-Fi hop while the machine is awake and it fires for sleeps with no
  network change at all.
- The renderer store installs one module-scope `window` `'online'` listener that marks the value
  stale and asks for a re-resolve. This self-heals the machine that boots with no network, which
  would otherwise sit at `none` for the app's entire life. It is installed once at module scope and
  never removed, because the store is a module singleton.

`online` / `offline` is a hint, not a guarantee. An SSID hop that never drops to fully offline may
fire no event at all. Ral called Refresh "the fallback"; in practice the button is the guarantee and
the listener is the convenience, and this document does not claim automatic detection is complete.
When a transition was observed but the re-resolve has not landed, the row shows *The network changed.
Refresh to update the address.*

**`navigator.onLine` is never read as a value**, only used as an event trigger. In Electron it reads
`true` with nothing but a tunnel up. The address always comes from a real resolve. A future "show an
offline badge" request must not be wired to it.

## Placement

The row is one more `general-setting__section` in the General pane, between Search Engine and
Experimental — an experimental/advanced block conventionally sits last. Its `h4` section title *is*
the label, because it already sits under a General tab among sibling labeled sections, so there is no
separate "Network" heading here (cowork's flat settings page needs one; Bitterless's left-nav pane
stack does not).

Bitterless's `src/renderer/maestro/workbench/src/views/WorkbenchSettingsView.vue` is a nine-line
wrapper around the **home** renderer's Setting tree, so one edit lands on both the Home window's
Settings and the Maestro workbench. That is what the feature wants, but it means any visual check has
to be done twice, against two different stylesheet stacks.

**Rejected placement — the About tab.** A LAN address is a host fact of the same class as
`version_code`, and `about.store.ts` already proves a Main handler is reachable from inside workbench
Settings, so About was a real candidate. General wins because the address is something the user acts
on (they read it out, they paste it) rather than build metadata they report, and because General is
the pane already open when someone goes looking for "how do I reach this machine". Recorded here so
the question is not re-litigated.

**Not folded into `application-diagnostics.md`.** That doc is the nearest owner of "Settings exposes
live runtime facts", but cowork has no counterpart doc and folding would break the byte-identical
parity this feature depends on. Because this feature uses a dedicated `LanIpHandler` and never
touches `DiagnosticsHandler.getSnapshot()`, that document's closed snapshot allowlist needs no
amendment.

## Vendoring

Five files are written in Bitterless and copied **byte-for-byte** into micromeet-cowork. Bitterless
is the source; cowork only receives — the same direction rule as
`apps/cowork/scripts/sync-onlypreview-native-labels.mjs`, and the same precedent as the 22
byte-identical files already shared under `src/shared/onlypreview/`.

| path suffix | what it is |
| --- | --- |
| `src/shared/lanIp/lanIp.helper.ts` | the vendored file that matters — zero imports, `pickLanIpv4`, the deny-lists, the ranking, the wire types, the injected `LanIpCache` |
| `src/shared/lanIp/lanIp.api.ts` | the xpc contract: `state()` / `refresh()`, both zero-arg |
| `src/main/lanIp/lanIp.service.ts` | the injected readers plus the `powerMonitor` invalidation |
| `src/main/xpc/lanIp.handler.ts` | `LanIpHandler extends XpcMainHandler implements LanIpApi` |
| `tests/…/lanIp.cases.mjs` | the fixture table, driving both repos' test runners |

`lanIp.helper.ts` is the one where drift would be silent and dangerous: a deny-list entry added on
one side only means the two apps disagree about which address is "your LAN IP" on the same machine,
with no error anywhere. The other four are shells, vendored because keeping them identical is free.

Two properties make the helper vendorable and must survive any edit. It has **zero imports** — the
interface table is described structurally rather than importing `os.NetworkInterfaceInfo`, because
the moment it imports anything it becomes tsconfig-dependent. And **all I/O is injected**, which is
what lets cowork's `vm` loader and Bitterless's esbuild bundle run the same fixtures.

Drift is enforced by `apps/cowork/scripts/check-lan-ip-vendor.mjs` on the receiving side. That guard
exits 0 when the Bitterless checkout is absent, so it only ever fires on Ral's machine: every future
change to these files must run `yarn workspace @micromeet/cowork check:lan-ip-vendor` explicitly. The
direction rule is repeated in `lanIp.helper.ts`'s own header so it travels with the file.

The two renderer stores are not byte-identical (different i18n systems, different idiom) but their
**semantics are**: same fields (`snapshot`, `busy`, private `loaded`, private `queued`), same two
methods, same error handling, same `reactive(new …State())` module singleton with method shorthand
and never arrow class fields.

## Pending questions

- **Copy button.** Ral asked for display plus refresh. Adding one later needs either a second Main
  method — which would break the property that this contract is two idempotent reads and nothing
  else — or renderer `navigator.clipboard`, which is unreliable on these custom-scheme surfaces.
  Deferred rather than guessed.
- **A runners-up disclosure in the `ok` state** ("N more addresses"). The wire already carries
  `others` in `ok`, so no contract change is needed. Held back because the string would need
  interpolation, which Bitterless's i18n does not have.

## Verification

Run for this change:

- `yarn typecheck:surfaces shared main renderer/home renderer/maestro`, judged against a pre-change
  baseline of the same working tree — `yarn typecheck` is not green at HEAD and `yarn lint` OOMs, so
  a green/red read would either hide a new error or falsely blame this change.
- `yarn test:lan-ip` — the fixture table, including the cache contract.
- `yarn check:renderer-i18n`, `yarn check:maestro`.

**Not covered by any committed test:** the renderer store's own contract — resolve-once across
mounts, "an error does not consume the resolve-once budget", and "an `'online'` transition during an
in-flight read is queued, not dropped". `tests/lanIp/` covers the pure helper and the Main cache
only. The three store rules were checked with a throwaway esbuild harness during review (bundle the
store, stub `globalThis.xpcRenderer` and `window`); they are regression-prone and deserve a real
test the next time this file is touched.

**Not run:** no Electron E2E, no packaged smoke run, no `yarn build` (it rewrites `package.json`
`name` to `Bitterless_DEBUG_*`). The borderless refresh control and the row's appearance in both the
Home window and the Maestro workbench are unverified in compiled CSS and remain human testing.
