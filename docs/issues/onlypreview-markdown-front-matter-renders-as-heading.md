# Markdown Preview Shows Front Matter Instead of Starting at the Body

Status: fixed; owner verification pending

## Symptom

Previewing a Markdown file that opens with YAML front matter — for example an agent `SKILL.md` —
shows a separate `FRONT MATTER` metadata card above the document. Front matter is authoring metadata,
not preview content; the reading surface should start at the document body.

## Evidence

The original parser bug was real: sending the complete source through `marked` made the closing
delimiter act as a setext underline and turned the metadata into a large heading. Task 111 removed
the block before parsing, but then added a custom Vue card that put the same metadata back into the
visible preview.

That second presentation step is unnecessary and conflicts with the intended document-only preview.

## Root cause

The renderer conflated two concerns: stripping non-document metadata before Markdown compilation,
which is required, and presenting that metadata in a new UI, which is not required.

## Repair contract

- A YAML front-matter block — an opening `---` on the document's first line, closed by a later line
  that is exactly `---` or `...` — is removed from the Markdown source before parsing, so the body
  renders as the author wrote it and the document's real first heading is its first heading.
- A leading `---` with no closing delimiter is not front matter. It stays a thematic break, exactly
  as today.
- The removed front matter is not parsed, returned to the component, or rendered anywhere. Delete
  the metadata card, its styling, its localized labels, and its YAML parsing model.
- The Markdown document retains its existing centered reading column and starts at its normal top
  padding with the first body element; add no placeholder, label, setting, or replacement chrome.
- Markdown admission by original byte size, the `too-large` and `render-failed` results, character
  counting, Find, and the Global Search rich preview keep their current behavior.

Delivery: [onlypreview-markdown-front-matter-111](../plan/tasks/onlypreview-markdown-front-matter-111.md).
