# Bitterless Preview MCP tool

## `preview.open`

Arguments: `{ "path": "<absolute local file or folder path>" }`.

The path must be one non-empty absolute path already known from the user's request or from an
artifact the agent just produced. Newlines, NUL bytes, relative paths, unknown fields, and overlong
values are rejected.

Returns `{ "opened": true }` when Bitterless accepts the request. The response does not echo the
path or return file contents. The tool does not read contents, enumerate directories, mutate files,
or create a separate Preview implementation.

Call it once for the explicit target. Do not use broad filesystem discovery to find a target, and
do not interpret success as evidence about the target's contents.
