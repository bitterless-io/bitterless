# Institution workflow demo

A small Kimchi 0.0.9 workflow for testing institution sharing, downloads and the Workflow view.

The three function steps prepare text, count whitespace-separated words, then return a deterministic summary. The workflow does not create agents, access files, spawn processes or make network requests. It contains no credentials or personal data.

## Package files

- `workflow.json`: static display metadata and the three-node graph. Reading this file does not execute the workflow.
- `workflow.ts`: executable entry, default-exporting a committed Kimchi definition.
- `README.md`: this explanation.

The entry imports the public `@kimchi-dev/kimchi-workflows/flow` and `typebox` APIs. Both desktop loaders resolve these packages to their bundled dependencies. Do not install dependencies in this archive.

## Example

Input: `Shared institution workflows work.`

Output:

```json
{"message":"Processed 4 words: Shared institution workflows work."}
```

Whitespace-only input is valid at the engine layer and returns `{"message":"Processed 0 words: "}`. The existing desktop chat launcher requires nonblank input, so use the normal example when launching through chat.

After installing the package, explicitly run its installed absolute entry path using the desktop command:

```text
/workflow "/absolute/managed/path/workflow.ts" Shared institution workflows work.
```

The existing desktop host still requires an active chat and configured runtime. Previewing or synchronizing this package never runs it. The graph is authored preview metadata; for this sample, validation separately checks it against the executable definition.
