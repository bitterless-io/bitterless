const escapeRegex = (character) =>
  /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;

export const globToRegExp = (globValue) => {
  const normalized = String(globValue)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '');
  if (!normalized || normalized.includes('\0')) throw new TypeError('Invalid exclusion glob');
  let source = '^';
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '/' && normalized.slice(index) === '/**') {
      source += '(?:/.*)?';
      index += 2;
    } else if (character === '*' && normalized[index + 1] === '*') {
      source += normalized[index + 2] === '/' ? '(?:.*/)?' : '.*';
      index += normalized[index + 2] === '/' ? 2 : 1;
    } else if (character === '*') {
      source += '[^/]*';
    } else if (character === '?') {
      source += '[^/]';
    } else {
      source += escapeRegex(character);
    }
  }
  return new RegExp(`${source}$`, 'u');
};

export const compileOrderedGlobRules = (patterns = []) => patterns.map((value) => {
  if (typeof value !== 'string' || value.length > 4096) throw new TypeError('Invalid exclusion glob');
  const include = value.startsWith('!');
  const pattern = include ? value.slice(1) : value;
  return { include, pattern, regex: globToRegExp(pattern) };
});

export const isExcludedByOrderedGlobs = (relativePathValue, rules) => {
  const relativePath = String(relativePathValue)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/\/$/u, '');
  let excluded = false;
  for (const rule of rules) {
    if (rule.regex.test(relativePath)) excluded = !rule.include;
  }
  return excluded;
};

export const canOrderedGlobReincludeDescendant = (relativePathValue, rules) => {
  const relativePath = String(relativePathValue).replaceAll('\\', '/').replace(/\/$/u, '');
  let lastMatch = -1;
  let excluded = false;
  for (const [index, rule] of rules.entries()) {
    if (rule.regex.test(relativePath)) {
      lastMatch = index;
      excluded = !rule.include;
    }
  }
  if (!excluded) return false;
  return rules.slice(lastMatch + 1).some((rule) => {
    if (!rule.include) return false;
    const literalPrefix = rule.pattern.split(/[*?[]/u, 1)[0].replace(/\/$/u, '');
    return !literalPrefix || literalPrefix === relativePath ||
      literalPrefix.startsWith(`${relativePath}/`);
  });
};
