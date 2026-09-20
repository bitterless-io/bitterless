# workflow-demo

The package a fresh install finds in its workflows folder, so the first look at the Workflows view
is a working example rather than an empty pane next to a directory nobody has heard of.

It exists to answer one question — **is the workflows folder wired up?** — and it has to be able to
answer it while signed out, offline, and with no model configured. So it calls no agent: adding one
would make the smoke test depend on the very things it is there to rule out. That makes it the
exception. A real workflow orchestrates agents; this one measures a string.

## Files

- `workflow.mjs` — the entry. Its `export const meta` is the **only** source of what the library
  shows: name, description, `whenToUse`, phases. There is no manifest beside it to drift from it.
- `README.md` — this file.

## Running it

Pass the text as the input:

```text
workflow workflow-demo   Shared institution workflows work.
```

```json
{ "words": 4, "lines": 1, "characters": 33, "message": "Processed 4 words: Shared institution workflows work." }
```

Whitespace-only input is valid and returns `{"words":0,…,"message":"Processed 0 words: "}`.

The same input gives the same result on every machine and every replay — which is what makes it
usable as a smoke test rather than an illustration.

## Editing it

Open `workflow.mjs` and change it. The host re-reads the folder on every save: no rebuild, no
re-import, no generator to run again. Deleting the package is a decision the app respects — it is
seeded once, and a marker keeps the next launch from putting it back.

It reads no files, spawns no processes, makes no network requests, and contains no credentials or
personal data.
