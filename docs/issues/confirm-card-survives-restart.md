# A confirmation you were asked must survive a restart, and must not lie about it

**Status:** Fixed in both projects (code + tests, red-checked). Owner acceptance pending.
**Reported:** 2026-09-18 — Ral, after the parity gap surfaced while auditing
[turn-and-compaction-saves-still-rewrite.md](turn-and-compaction-saves-still-rewrite.md).
**Decision:** Ral chose option 1 — keep the history, and retire an unanswered card as **expired**
rather than as answered.

## What a confirm card is

When a task needs a human decision (write this file, spend more budget), the chat gets its own
timeline entry — the amber card — and the only place it can be answered is the action panel at the
bottom of the chat. The card has three moments where it changes: it **appears**, you **answer it**,
or the task **withdraws it** / it is answered elsewhere.

## Three separate defects

**1. Cowork never persisted a confirm card. At all.** Not on appear, not on answer, not on
withdrawal — `syncTaskConfirm`, `closeConfirmMessage` and `answerConfirm` all mutated the message
and returned. It reached the database only by riding whatever full rewrite happened next. That is
not a save, it is a coincidence, and the incremental save lanes remove it: once a save writes only
the messages it was told changed, a card nobody registered as changed is never written. The symptom
after that change would have been "I clicked Allow, restarted, and the transcript shows the question
with no answer" — or no question at all.

**2. Bitterless persisted it but restored it live.** The action panel's pending queue is
`messages.filter(m => m.confirm && !m.confirm.answer)`, and the load path copied the card verbatim.
So a question that was still open when the app closed came back with working-looking Allow/Deny
buttons, aimed at a `taskId` that died with the previous main process. Pressing them called
`respondTaskConfirm` for a task that does not exist, failed, and showed *"this question was already
answered elsewhere"* — a sentence with no relationship to what happened. Worse, a dead card sits at
the **head** of the queue, so the real pending question is behind it.

**3. Cowork restored it as `elsewhere`.** Cowork had already noticed defect 2 and neutralised it by
reading every unanswered card back as `answer: 'elsewhere'`. That stops the dead buttons, but
`elsewhere` means *somebody answered this*. Nobody did. The app restarted.

## Fix

**A fourth answer value, `expired`**, in both `MaestroChatConfirm` and `CoworkChatConfirm`.

It lives in `answer` rather than in a sibling `expired` flag on purpose: every "is this still
pending?" test in both apps is `!confirm.answer`, so one new value retires the card **everywhere at
once** — the panel queue, the card's own rendering, the queued-count badge. A separate boolean would
have needed each of those found and updated, and the one that got missed would be exactly the dead
card at the head of the queue that this issue is about.

- **Load path (both):** an unanswered card restored from the database becomes `expired`. Derived at
  load, so nothing untrue is ever written to disk and no migration is needed — existing rows get the
  new behaviour on the next open.
- **Rendering (both):** a third state. Neutral grey instead of amber, because amber in this UI means
  *blocking, look at me* and an expired card blocks nothing. No tick and no cross — those two glyphs
  mean "this option was chosen". No "↓ answer in the panel below", because it is not there any more.
  The question itself stays, which is the part worth keeping: *what* was asked, and that it went
  unanswered.
- **Cowork persistence:** all three moments now write. The answer is written **after** the bridge
  call returns, so a failed delivery is stored as `elsewhere` rather than as an optimistic `confirm`
  that would claim you allowed something that never happened.
- **Cowork parity gap, also closed:** when one task replaced its own question, Cowork appended the
  new card without closing the old one, leaving it permanently "waiting on you" at the head of the
  queue. Bitterless always closed it; Cowork now does too.

### Which save lane each site uses, and why they differ

| site | lane | why |
| --- | --- | --- |
| answer / answered-elsewhere / withdrawn | `persistMessages(session, [message])` | one existing message changes, nothing is appended — audit step 2 |
| card appears | `persistSession` (full rewrite) | `appendTimelineEntry` also **seals the open assistant segment**, and that message is in no `changed` list. Narrowing it would defer the sealed segment's final text to turn end — audit step 4, pending the captured return value |

That split is the corrected order in
[turn-and-compaction-saves-still-rewrite.md](turn-and-compaction-saves-still-rewrite.md), applied
rather than restated. It is only safe because
[`persistMessages` stopped matching by object identity](incremental-save-reports-unwritten-messages-as-saved.md)
— before that, handing it a message set could write nothing and still answer `true`.

## Verification

`tests/onlypreview/confirmCardSurvivesRestart.test.mjs` — shared with Cowork, byte-identical,
host-aware. **8/8 on both.** Red-checked: reverting the load-path line and the answer save turns 3 of
the 8 red and leaves the other 5 green, so they are not vacuous.

- answering writes exactly one message row, never a full rewrite;
- a failed delivery is stored as `elsewhere`, not as the answer that was clicked;
- an already-answered card cannot be answered twice and writes nothing;
- a superseded question is closed before the replacement is appended;
- a withdrawn question costs one message row, not the history;
- the load path retires an unanswered card as `expired` and **not** as `elsewhere` (asserted against
  the shipping source, since that line is the whole point);
- the panel's queue gates on `!answer`, which is what makes one value enough;
- the expired branch renders before the answered branch and carries neither tick nor cross.

i18n: new strings in both languages (`en.ts` / `zh.ts`) and all four Cowork locales; Cowork's
`messages.test.mjs` key-parity test passes 5/5.

Typecheck: Bitterless `shared` + `renderer/maestro` and Cowork `typecheck:node` (19) and
`typecheck:web` (2) all identical to their HEAD baselines, with no diagnostic in a touched file.
Both pre-existing web errors belong to another session's in-flight work.

Not run: Electron E2E (CLAUDE.md). Owner step: with a chat that has an answered confirmation and one
that was open when the app was killed, restart and check the transcript — the answered one shows
your choice, the killed one reads "not answered", grey, with no buttons, and the action panel is
empty rather than offering a dead card.

## One thing deliberately not done

Neither app tells main "this card expired" on load. There is nothing to tell: the task registry is
in-memory and died with the process. If a future version makes confirmations outlive a restart on
the main side, this is the line to revisit — the renderer would then have to ask rather than assume.
