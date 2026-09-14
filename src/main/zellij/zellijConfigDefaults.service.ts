import { parse } from '@bgotink/kdl/v1-compat';
import { getLocation, type Document, type Node } from '@bgotink/kdl';
import { ZellijConfigEditError } from './zellijConfigEdit.service';
import { buildZellijDefaultConfig } from './zellijDefaultConfig';

/** Add absent defaults without reformatting or replacing any explicit setting or key binding. */
export const ensureZellijConfigDefaults = (source: string, platform: string): string => {
  const defaults = buildZellijDefaultConfig({ platform });
  const parseSource = (text: string): Document => {
    try {
      return parse(text, { storeLocations: true });
    } catch {
      throw new ZellijConfigEditError('config-invalid');
    }
  };
  const document = parseSource(source);
  const defaultDocument = parseSource(defaults);
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const edits: { offset: number; text: string }[] = [];
  const locationOf = (element: Node | Document): NonNullable<ReturnType<typeof getLocation>> => {
    const location = getLocation(element);
    if (!location) throw new ZellijConfigEditError('config-invalid');
    return location;
  };
  const renderDefault = (node: Node, depth: number): string => {
    const location = locationOf(node);
    const originalIndent = location.start.column - 1;
    return defaults
      .slice(location.start.offset, location.end.offset)
      .trimEnd()
      .split('\n')
      .map((line, index) => `${'    '.repeat(depth)}${index ? line.slice(originalIndent) : line}`)
      .join(newline);
  };
  const merge = (
    existing: Document | null,
    starting: Document,
    path: string[],
    parent?: Node
  ): void => {
    const missing: Node[] = [];
    for (const node of starting.nodes) {
      const name = node.getName();
      const found = existing?.nodes.find((entry) => entry.getName() === name);
      if (!found) {
        missing.push(node);
      } else if (
        node.children &&
        ((path.length === 0 && ['themes', 'web_client'].includes(name)) ||
          (path.length === 1 && path[0] === 'web_client' && name === 'theme'))
      ) {
        // Explicit session themes and existing keybinds are opaque. Only the web palette is
        // completed property by property, preserving custom colors and other web settings.
        merge(found.children, node.children, [...path, name], found);
      }
    }
    if (!missing.length) return;
    const text = missing.map((node) => renderDefault(node, path.length)).join(newline);
    if (!parent) {
      edits.push({
        offset: source.length,
        text: `${source.endsWith('\n') ? '' : newline}${text}${newline}`
      });
    } else if (existing) {
      edits.push({
        offset: locationOf(existing).end.offset,
        text: `${newline}${text}${newline}${'    '.repeat(path.length - 1)}`
      });
    } else {
      const location = locationOf(parent);
      const offset =
        location.start.offset +
        source.slice(location.start.offset, location.end.offset).trimEnd().length;
      edits.push({
        offset,
        text: ` {${newline}${text}${newline}${'    '.repeat(path.length - 1)}}`
      });
    }
  };
  merge(document, defaultDocument, []);
  let candidate = source;
  // At EOF an absent child block and new root nodes share an offset. Apply the later root
  // append first so the child block lands immediately after its existing parent node.
  for (const edit of edits.reverse().sort((left, right) => right.offset - left.offset)) {
    candidate = candidate.slice(0, edit.offset) + edit.text + candidate.slice(edit.offset);
  }
  parseSource(candidate);
  return candidate;
};
