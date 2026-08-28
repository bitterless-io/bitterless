const escapeRegex = (character) =>
  /[\\^$.*+?()[\]{}|]/u.test(character) ? `\\${character}` : character;

const TOKEN_LITERAL = 0;
const TOKEN_NON_SLASH = 1;
const TOKEN_NON_SLASH_STAR = 2;
const TOKEN_ANY_STAR = 3;
const TOKEN_GLOBSTAR_SLASH_ENTRY = 4;
const TOKEN_GLOBSTAR_SLASH_BODY = 5;
const TOKEN_OPTIONAL_SLASH = 6;
const SLASH_CODE_POINT = '/'.codePointAt(0);
const SEGMENT_GLOBSTAR = 0;
const SEGMENT_CONSTRAINT = 1;
const MAX_ANCHORLESS_FALLBACK_STATES = 64;
const MAX_DESCENDANT_LANGUAGE_OPERATIONS = 16_384;

const normalizeGlob = (globValue) => {
  const normalized = String(globValue)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '');
  if (!normalized || normalized.includes('\0')) throw new TypeError('Invalid exclusion glob');
  return normalized;
};

const longestMandatoryLiteralAnchor = (normalizedPattern) => {
  let anchor = '';
  let candidate = '';
  for (const character of normalizedPattern) {
    if (character === '*' || character === '?' || character === '/') {
      candidate = '';
      continue;
    }
    candidate += character;
    if (candidate.length > anchor.length) anchor = candidate;
  }
  return anchor;
};

const terminalSegmentLengthConstraint = (normalizedPattern) => {
  for (let index = 1; index < normalizedPattern.length - 2; index += 1) {
    if (normalizedPattern.slice(index, index + 3) === '**/' && normalizedPattern[index - 1] !== '/')
      return undefined;
  }
  const segment = normalizedPattern.slice(normalizedPattern.lastIndexOf('/') + 1);
  if (!segment || segment.includes('**')) return undefined;
  let minimum = 0;
  let unbounded = false;
  for (const character of segment) {
    if (character === '*') unbounded = true;
    else minimum += 1;
  }
  return unbounded ? { minimum } : { exact: minimum };
};

const compileSegmentConstraint = (segment) => {
  if (!segment || [...segment].some((character) => character !== '*' && character !== '?')) {
    return undefined;
  }
  if (segment.includes('**')) return undefined;
  const minimum = [...segment].filter((character) => character === '?').length;
  const exact = segment.includes('*') ? undefined : minimum;
  return {
    kind: SEGMENT_CONSTRAINT,
    minimum,
    exact,
    any: minimum === 0 && exact === undefined,
    key: exact === undefined ? `m${minimum}` : `e${exact}`
  };
};

const ANY_SEGMENT = Object.freeze({
  kind: SEGMENT_CONSTRAINT,
  minimum: 0,
  exact: undefined,
  any: true,
  key: 'm0'
});
const GLOBSTAR_SEGMENTS = Object.freeze({ kind: SEGMENT_GLOBSTAR, key: 'g' });

const collapseConsecutiveSegmentGlobstars = (tokens) => {
  const collapsed = [];
  for (const token of tokens) {
    if (token.kind === SEGMENT_GLOBSTAR && collapsed.at(-1)?.kind === SEGMENT_GLOBSTAR) continue;
    collapsed.push(token);
  }
  return collapsed;
};

const ordinarySegmentTokens = (tokens) => {
  const ordinary = [];
  let arbitraryCount = 0;
  let unbounded = false;
  const flushArbitrary = () => {
    for (let index = 0; index < arbitraryCount; index += 1) ordinary.push(ANY_SEGMENT);
    if (unbounded) ordinary.push(GLOBSTAR_SEGMENTS);
    arbitraryCount = 0;
    unbounded = false;
  };
  for (const token of tokens) {
    if (token.kind === SEGMENT_GLOBSTAR) unbounded = true;
    else if (token.any) arbitraryCount += 1;
    else {
      flushArbitrary();
      ordinary.push(token);
    }
  }
  flushArbitrary();
  return ordinary;
};

const segmentTokensKey = (tokens, terminal) =>
  `${tokens.map(({ key }) => key).join(',')}>${terminal.key}`;

const compileFullSegmentWildcard = (normalizedPattern) => {
  const segments = normalizedPattern.split('/');
  if (segments.some((segment) => !segment)) return undefined;
  const terminal = compileSegmentConstraint(segments.at(-1));
  if (!terminal) return undefined;
  const prefix = [];
  for (const segment of segments.slice(0, -1)) {
    if (segment === '**') prefix.push(GLOBSTAR_SEGMENTS);
    else {
      const constraint = compileSegmentConstraint(segment);
      if (!constraint) return undefined;
      prefix.push(constraint);
    }
  }
  const lineTerminatorTokens = collapseConsecutiveSegmentGlobstars(prefix);
  const ordinaryTokens = ordinarySegmentTokens(lineTerminatorTokens);
  const requiredConstraints = [];
  const requiredSequence = [];
  const seenConstraints = new Set();
  for (const token of prefix) {
    if (token.kind !== SEGMENT_CONSTRAINT || token.any) continue;
    requiredSequence.push(token);
    if (seenConstraints.has(token.key)) continue;
    seenConstraints.add(token.key);
    requiredConstraints.push(token);
  }
  requiredSequence.push(terminal);
  return {
    terminal,
    requiredConstraints,
    requiredSequence,
    requiredSequenceKey: requiredSequence.map(({ key }) => key).join(','),
    minimumPrefixSegments: prefix.filter(({ kind }) => kind === SEGMENT_CONSTRAINT).length,
    ordinaryTokens,
    ordinaryKey: segmentTokensKey(ordinaryTokens, terminal),
    lineTerminatorTokens,
    lineTerminatorKey: segmentTokensKey(lineTerminatorTokens, terminal)
  };
};

const globSource = (globValue) => {
  const normalized = normalizeGlob(globValue);
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
  return source;
};

const compileGlobTokens = (normalizedPattern) => {
  const characters = [...normalizedPattern];
  const tokenKinds = [];
  const tokenValues = [];
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    if (
      character === '/' &&
      index === characters.length - 3 &&
      characters[index + 1] === '*' &&
      characters[index + 2] === '*'
    ) {
      tokenKinds.push(TOKEN_OPTIONAL_SLASH, TOKEN_ANY_STAR);
      tokenValues.push(0, 0);
      index += 2;
    } else if (character === '*' && characters[index + 1] === '*') {
      if (characters[index + 2] === '/') {
        tokenKinds.push(TOKEN_GLOBSTAR_SLASH_ENTRY, TOKEN_GLOBSTAR_SLASH_BODY);
        tokenValues.push(0, 0);
        index += 2;
      } else {
        tokenKinds.push(TOKEN_ANY_STAR);
        tokenValues.push(0);
        index += 1;
      }
    } else if (character === '*') {
      tokenKinds.push(TOKEN_NON_SLASH_STAR);
      tokenValues.push(0);
    } else if (character === '?') {
      tokenKinds.push(TOKEN_NON_SLASH);
      tokenValues.push(0);
    } else {
      tokenKinds.push(TOKEN_LITERAL);
      tokenValues.push(character.codePointAt(0));
    }
  }
  return {
    kinds: Uint8Array.from(tokenKinds),
    values: Uint32Array.from(tokenValues)
  };
};

const validDescendantSuffixStates = ({ kinds, values }) => {
  const needsSegmentCharacter = new Uint8Array(kinds.length + 1);
  const insideSegment = new Uint8Array(kinds.length + 1);
  insideSegment[kinds.length] = 1;
  for (let state = kinds.length - 1; state >= 0; state -= 1) {
    const kind = kinds[state];
    if (kind === TOKEN_LITERAL) {
      if (values[state] === SLASH_CODE_POINT) {
        insideSegment[state] = needsSegmentCharacter[state + 1];
      } else {
        needsSegmentCharacter[state] = insideSegment[state + 1];
        insideSegment[state] = insideSegment[state + 1];
      }
    } else if (kind === TOKEN_NON_SLASH) {
      needsSegmentCharacter[state] = insideSegment[state + 1];
      insideSegment[state] = insideSegment[state + 1];
    } else if (kind === TOKEN_NON_SLASH_STAR) {
      insideSegment[state] = insideSegment[state + 1];
      needsSegmentCharacter[state] = needsSegmentCharacter[state + 1] || insideSegment[state + 1];
    } else if (kind === TOKEN_ANY_STAR) {
      const reachable = needsSegmentCharacter[state + 1] || insideSegment[state + 1];
      needsSegmentCharacter[state] = reachable;
      insideSegment[state] = reachable;
    } else if (kind === TOKEN_GLOBSTAR_SLASH_BODY) {
      needsSegmentCharacter[state] = needsSegmentCharacter[state + 1];
      insideSegment[state] = needsSegmentCharacter[state + 1];
    } else if (kind === TOKEN_GLOBSTAR_SLASH_ENTRY) {
      needsSegmentCharacter[state] =
        needsSegmentCharacter[state + 1] || needsSegmentCharacter[state + 2];
      insideSegment[state] = insideSegment[state + 1] || insideSegment[state + 2];
    } else {
      needsSegmentCharacter[state] = needsSegmentCharacter[state + 2];
      insideSegment[state] = insideSegment[state + 2] || needsSegmentCharacter[state + 1];
    }
  }
  return needsSegmentCharacter;
};

const regexDotMatches = (character) =>
  character !== '\n' && character !== '\r' && character !== '\u2028' && character !== '\u2029';

const compileGlobMatcher = (normalizedPattern) => {
  const tokens = compileGlobTokens(normalizedPattern);
  const canMatchValidSuffix = validDescendantSuffixStates(tokens);
  let activeFlags = new Uint8Array(tokens.kinds.length + 1);
  let nextFlags = new Uint8Array(tokens.kinds.length + 1);
  let activeStates = [];
  let nextStates = [];
  let operationCount = 0;
  const addState = (flags, states, state) => {
    if (flags[state] === 1) return;
    flags[state] = 1;
    states.push(state);
  };
  const clearStates = (flags, states) => {
    for (const state of states) flags[state] = 0;
    states.length = 0;
  };
  const closeEpsilonTransitions = (flags, states) => {
    for (let cursor = 0; cursor < states.length; cursor += 1) {
      operationCount += 1;
      const state = states[cursor];
      const kind = tokens.kinds[state];
      if (kind === TOKEN_NON_SLASH_STAR || kind === TOKEN_ANY_STAR) {
        addState(flags, states, state + 1);
      } else if (kind === TOKEN_GLOBSTAR_SLASH_ENTRY) {
        addState(flags, states, state + 1);
        addState(flags, states, state + 2);
      } else if (kind === TOKEN_OPTIONAL_SLASH) {
        addState(flags, states, state + 2);
      }
    }
  };
  const beginMatch = () => {
    operationCount = 0;
    clearStates(activeFlags, activeStates);
    clearStates(nextFlags, nextStates);
    addState(activeFlags, activeStates, 0);
    closeEpsilonTransitions(activeFlags, activeStates);
  };
  const consumeCharacter = (character) => {
    clearStates(nextFlags, nextStates);
    const codePoint = character.codePointAt(0);
    const isSlash = codePoint === SLASH_CODE_POINT;
    for (const state of activeStates) {
      operationCount += 1;
      const kind = tokens.kinds[state];
      if (kind === TOKEN_LITERAL && tokens.values[state] === codePoint) {
        addState(nextFlags, nextStates, state + 1);
      } else if (kind === TOKEN_NON_SLASH && !isSlash) {
        addState(nextFlags, nextStates, state + 1);
      } else if (kind === TOKEN_NON_SLASH_STAR && !isSlash) {
        addState(nextFlags, nextStates, state);
      } else if (kind === TOKEN_ANY_STAR && regexDotMatches(character)) {
        addState(nextFlags, nextStates, state);
      } else if (kind === TOKEN_GLOBSTAR_SLASH_BODY && regexDotMatches(character)) {
        addState(nextFlags, nextStates, state);
        if (isSlash) addState(nextFlags, nextStates, state + 1);
      } else if (kind === TOKEN_OPTIONAL_SLASH && isSlash) {
        addState(nextFlags, nextStates, state + 1);
      }
    }
    closeEpsilonTransitions(nextFlags, nextStates);
    [activeFlags, nextFlags] = [nextFlags, activeFlags];
    [activeStates, nextStates] = [nextStates, activeStates];
    return activeStates.length > 0;
  };
  const matchesPathOrAncestor = (relativePath) => {
    beginMatch();
    const acceptState = tokens.kinds.length;
    for (const character of relativePath) {
      if (character === '/' && activeFlags[acceptState] === 1) return true;
      if (!consumeCharacter(character)) return false;
    }
    return activeFlags[acceptState] === 1;
  };
  const couldMatchDescendant = (relativePath) => {
    beginMatch();
    const descendantPrefix = relativePath ? `${relativePath}/` : '';
    for (const character of descendantPrefix) {
      if (!consumeCharacter(character)) return false;
    }
    return activeStates.some((state) => canMatchValidSuffix[state] === 1);
  };
  return {
    matchesPathOrAncestor,
    couldMatchDescendant,
    diagnostics: () => ({
      operationCount,
      stateCount: tokens.kinds.length + 1
    })
  };
};

export const globToRegExp = (globValue) => new RegExp(`${globSource(globValue)}$`, 'u');

export const compileOrderedGlobRules = (patterns = []) => {
  const entries = patterns.map((value) => {
    if (typeof value !== 'string' || value.length > 4096)
      throw new TypeError('Invalid exclusion glob');
    const include = value.startsWith('!');
    const pattern = include ? value.slice(1) : value;
    const normalizedPattern = normalizeGlob(pattern);
    return { include, pattern, normalizedPattern };
  });
  const retainedNormalizedPatterns = new Set();
  const retainedEntries = [];
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (retainedNormalizedPatterns.has(entry.normalizedPattern)) continue;
    retainedNormalizedPatterns.add(entry.normalizedPattern);
    retainedEntries.push(entry);
  }
  retainedEntries.reverse();
  let anchorlessFallbackStates = 0;
  return retainedEntries.map(({ include, pattern, normalizedPattern }) => {
    const source = globSource(pattern);
    const matcher = compileGlobMatcher(normalizedPattern);
    const mandatoryLiteralAnchor = longestMandatoryLiteralAnchor(normalizedPattern);
    const fullSegmentWildcard = compileFullSegmentWildcard(normalizedPattern);
    if (!mandatoryLiteralAnchor && !fullSegmentWildcard) {
      anchorlessFallbackStates += matcher.diagnostics().stateCount;
      if (anchorlessFallbackStates > MAX_ANCHORLESS_FALLBACK_STATES) {
        throw new TypeError('Anchorless exclusion globs are too complex');
      }
    }
    return {
      include,
      pattern,
      regex: new RegExp(`${source}$`, 'u'),
      literalPrefix: normalizedPattern.split(/[*?[]/u, 1)[0].replace(/\/$/u, ''),
      mandatoryLiteralAnchor,
      terminalSegmentLength: terminalSegmentLengthConstraint(normalizedPattern),
      fullSegmentWildcard,
      matchesPathOrAncestor: matcher.matchesPathOrAncestor,
      couldMatchDescendant: include ? matcher.couldMatchDescendant : undefined,
      matcherDiagnostics: matcher.diagnostics
    };
  });
};

const normalizeRelativePath = (relativePathValue) =>
  String(relativePathValue)
    .replaceAll('\\', '/')
    .replace(/^\.\//u, '')
    .replace(/^\//u, '')
    .replace(/\/$/u, '');

const describePathSegments = (relativePath) => {
  const lengths = new Set();
  const segments = [];
  let currentLength = 0;
  let currentOrdinary = true;
  let maximumLength = 0;
  for (const character of relativePath) {
    if (character === '/') {
      lengths.add(currentLength);
      segments.push({ length: currentLength, ordinary: currentOrdinary });
      maximumLength = Math.max(maximumLength, currentLength);
      currentLength = 0;
      currentOrdinary = true;
    } else {
      currentLength += 1;
      if (!regexDotMatches(character)) currentOrdinary = false;
    }
  }
  lengths.add(currentLength);
  segments.push({ length: currentLength, ordinary: currentOrdinary });
  return {
    emptyPath: relativePath === '',
    lengths,
    segments,
    hasLineTerminator: segments.some(({ ordinary }) => !ordinary),
    maximumLength: Math.max(maximumLength, currentLength)
  };
};

const pathMatchesTerminalSegmentLength = (description, constraint) =>
  constraint.exact === undefined
    ? description.maximumLength >= constraint.minimum
    : description.lengths.has(constraint.exact);

const segmentMatchesConstraint = ({ length }, constraint) =>
  constraint.exact === undefined ? length >= constraint.minimum : length === constraint.exact;

const pathContainsSegmentConstraintSequence = (description, constraints) => {
  let constraintIndex = 0;
  for (const segment of description.segments) {
    if (segmentMatchesConstraint(segment, constraints[constraintIndex])) constraintIndex += 1;
    if (constraintIndex === constraints.length) return true;
  }
  return false;
};

const minimumLineSegmentsBeforeTerminal = (description, terminal) => {
  let lineSegmentCount = 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const segment of description.segments) {
    if (segmentMatchesConstraint(segment, terminal)) minimum = Math.min(minimum, lineSegmentCount);
    if (!segment.ordinary) lineSegmentCount += 1;
  }
  return minimum;
};

const closeSegmentGlobstars = (active, tokens) => {
  for (let state = 0; state < tokens.length; state += 1) {
    if (active[state] === 1 && tokens[state].kind === SEGMENT_GLOBSTAR) {
      active[state + 1] = 1;
    }
  }
};

const advanceSegmentStates = (active, next, tokens, segment) => {
  next.fill(0);
  for (let state = 0; state < tokens.length; state += 1) {
    if (active[state] !== 1) continue;
    const token = tokens[state];
    if (token.kind === SEGMENT_GLOBSTAR) {
      if (segment.ordinary) next[state] = 1;
    } else if (segmentMatchesConstraint(segment, token)) next[state + 1] = 1;
  }
  closeSegmentGlobstars(next, tokens);
};

const segmentWildcardTokens = (description, compiled) =>
  description.hasLineTerminator ? compiled.lineTerminatorTokens : compiled.ordinaryTokens;

const matchesFullSegmentWildcard = (description, compiled) => {
  if (description.segments.length < compiled.minimumPrefixSegments + 1) return false;
  if (!pathMatchesTerminalSegmentLength(description, compiled.terminal)) return false;
  if (
    compiled.requiredConstraints.some(
      (constraint) => !pathMatchesTerminalSegmentLength(description, constraint)
    )
  )
    return false;
  const tokens = segmentWildcardTokens(description, compiled);
  let active = new Uint8Array(tokens.length + 1);
  let next = new Uint8Array(tokens.length + 1);
  active[0] = 1;
  closeSegmentGlobstars(active, tokens);
  for (const segment of description.segments) {
    if (active[tokens.length] === 1 && segmentMatchesConstraint(segment, compiled.terminal)) {
      return true;
    }
    advanceSegmentStates(active, next, tokens, segment);
    [active, next] = [next, active];
  }
  return false;
};

const canFullSegmentWildcardMatchDescendant = (description, compiled) => {
  const tokens = segmentWildcardTokens(description, compiled);
  let active = new Uint8Array(tokens.length + 1);
  let next = new Uint8Array(tokens.length + 1);
  active[0] = 1;
  closeSegmentGlobstars(active, tokens);
  const existingSegments = description.emptyPath ? [] : description.segments;
  for (const segment of existingSegments) {
    advanceSegmentStates(active, next, tokens, segment);
    [active, next] = [next, active];
  }
  return active.some((value) => value === 1);
};

const beginFullSegmentContinuation = (description, compiled) => {
  const tokens = compiled.lineTerminatorTokens;
  let active = new Uint8Array(tokens.length + 1);
  let next = new Uint8Array(tokens.length + 1);
  active[0] = 1;
  closeSegmentGlobstars(active, tokens);
  for (const segment of description.emptyPath ? [] : description.segments) {
    advanceSegmentStates(active, next, tokens, segment);
    [active, next] = [next, active];
  }
  return active;
};

const spendCoverageBudget = (budget, units) => {
  if (units > budget.remaining) {
    budget.remaining = 0;
    return false;
  }
  budget.remaining -= units;
  return true;
};

const appendContinuationStateKey = (parts, offset, { accepted, active }) => {
  parts[offset] = accepted ? 'a' : 's';
  offset += 1;
  for (const value of active) {
    parts[offset] = value === 1 ? '1' : '0';
    offset += 1;
  }
  parts[offset] = '|';
  return offset + 1;
};

const continuationProductKey = (include, excludes, size) => {
  const parts = new Array(size);
  let offset = appendContinuationStateKey(parts, 0, include);
  for (const exclude of excludes) offset = appendContinuationStateKey(parts, offset, exclude);
  return parts.join('');
};

const advanceFullSegmentContinuation = (state, compiled, segment) => {
  if (state.accepted) return state;
  const tokens = compiled.lineTerminatorTokens;
  if (state.active[tokens.length] === 1 && segmentMatchesConstraint(segment, compiled.terminal)) {
    return { accepted: true, active: new Uint8Array(0) };
  }
  const active = new Uint8Array(tokens.length + 1);
  advanceSegmentStates(state.active, active, tokens, segment);
  return { accepted: false, active };
};

const descendantSegmentRepresentatives = (compiledLanguages) => {
  const lengths = new Set([1]);
  const addConstraint = (constraint) => {
    const boundary = constraint.exact ?? constraint.minimum;
    for (const length of [boundary - 1, boundary, boundary + 1]) {
      if (length >= 1) lengths.add(length);
    }
  };
  for (const compiled of compiledLanguages) {
    addConstraint(compiled.terminal);
    for (const token of compiled.lineTerminatorTokens) {
      if (token.kind === SEGMENT_CONSTRAINT) addConstraint(token);
    }
  }
  return [...lengths].flatMap((length) => [
    { length, ordinary: true },
    { length, ordinary: false }
  ]);
};

const descendantLanguageIsCoveredByUnion = (
  description,
  include,
  excludes,
  excludeLanguageKeys,
  budget
) => {
  if (excludeLanguageKeys.has(include.lineTerminatorKey)) {
    return spendCoverageBudget(budget, 1);
  }
  const languageCount = excludes.length + 1;
  if (!spendCoverageBudget(budget, languageCount)) return false;
  let tokenCount = include.lineTerminatorTokens.length + 1;
  for (const exclude of excludes) tokenCount += exclude.lineTerminatorTokens.length + 1;
  // The compiled-language array and its token scan are reserved before either operation.
  if (!spendCoverageBudget(budget, languageCount + tokenCount)) return false;
  const languages = [include, ...excludes];
  let constraintCount = languageCount;
  for (const compiled of languages) {
    for (const token of compiled.lineTerminatorTokens) {
      if (token.kind === SEGMENT_CONSTRAINT) constraintCount += 1;
    }
  }
  // Each possible boundary reserves its Set/array slots and two segment records.
  if (!spendCoverageBudget(budget, tokenCount + (1 + constraintCount * 3) * 16)) return false;
  const representatives = descendantSegmentRepresentatives(languages);
  const existingSegmentCount = description.emptyPath ? 0 : description.segments.length;
  const productKeySize = tokenCount + languageCount * 2;
  // Prefix transitions, buffers, first product state/key, queue, and visited entry.
  const initialUnits =
    existingSegmentCount * tokenCount + tokenCount * 2 + productKeySize * 2 + languageCount * 4 + 4;
  if (!spendCoverageBudget(budget, initialUnits)) return false;
  const initial = {
    include: { accepted: false, active: beginFullSegmentContinuation(description, include) },
    excludes: excludes.map((exclude) => ({
      accepted: false,
      active: beginFullSegmentContinuation(description, exclude)
    }))
  };
  const queue = [initial];
  const visited = new Set([
    continuationProductKey(initial.include, initial.excludes, productKeySize)
  ]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    for (const segment of representatives) {
      // Matcher work, next typed arrays, and composite state precede construction.
      if (!spendCoverageBudget(budget, tokenCount * 2 + languageCount * 3)) return false;
      const next = {
        include: advanceFullSegmentContinuation(queue[cursor].include, include, segment),
        excludes: queue[cursor].excludes.map((state, index) =>
          advanceFullSegmentContinuation(state, excludes[index], segment)
        )
      };
      if (next.excludes.some(({ accepted }) => accepted)) continue;
      if (next.include.accepted) return false;
      if (!next.include.active.some((value) => value === 1)) continue;
      // Composite serialization, queue slot, and visited entry precede key allocation.
      if (!spendCoverageBudget(budget, productKeySize * 2 + 2)) return false;
      const key = continuationProductKey(next.include, next.excludes, productKeySize);
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push(next);
    }
  }
  return true;
};

const orderedGlobState = (relativePathValue, rules) => {
  const relativePath = normalizeRelativePath(relativePathValue);
  let pathSegments;
  let fullSegmentConstraintSequences;
  let fullSegmentLineRequirements;
  let seenFullSegmentLanguages;
  for (let index = rules.length - 1; index >= 0; index -= 1) {
    const rule = rules[index];
    if (rule.mandatoryLiteralAnchor && !relativePath.includes(rule.mandatoryLiteralAnchor)) {
      continue;
    }
    if (rule.literalPrefix && !relativePath.startsWith(rule.literalPrefix)) continue;
    if (rule.fullSegmentWildcard) {
      pathSegments ??= describePathSegments(relativePath);
      fullSegmentConstraintSequences ??= new Map();
      const sequenceKey = rule.fullSegmentWildcard.requiredSequenceKey;
      let sequenceMatches = fullSegmentConstraintSequences.get(sequenceKey);
      if (sequenceMatches === undefined) {
        sequenceMatches = pathContainsSegmentConstraintSequence(
          pathSegments,
          rule.fullSegmentWildcard.requiredSequence
        );
        fullSegmentConstraintSequences.set(sequenceKey, sequenceMatches);
      }
      if (!sequenceMatches) continue;
      if (pathSegments.hasLineTerminator) {
        fullSegmentLineRequirements ??= new Map();
        const terminalKey = rule.fullSegmentWildcard.terminal.key;
        let requiredLineSegments = fullSegmentLineRequirements.get(terminalKey);
        if (requiredLineSegments === undefined) {
          requiredLineSegments = minimumLineSegmentsBeforeTerminal(
            pathSegments,
            rule.fullSegmentWildcard.terminal
          );
          fullSegmentLineRequirements.set(terminalKey, requiredLineSegments);
        }
        if (requiredLineSegments > rule.fullSegmentWildcard.minimumPrefixSegments) continue;
      }
      const languageKey = pathSegments.hasLineTerminator
        ? rule.fullSegmentWildcard.lineTerminatorKey
        : rule.fullSegmentWildcard.ordinaryKey;
      seenFullSegmentLanguages ??= new Set();
      if (seenFullSegmentLanguages.has(languageKey)) continue;
      seenFullSegmentLanguages.add(languageKey);
      if (matchesFullSegmentWildcard(pathSegments, rule.fullSegmentWildcard)) {
        return { excluded: !rule.include, lastMatch: index };
      }
      continue;
    }
    if (rule.terminalSegmentLength) {
      pathSegments ??= describePathSegments(relativePath);
      if (!pathMatchesTerminalSegmentLength(pathSegments, rule.terminalSegmentLength)) continue;
    }
    if (rule.matchesPathOrAncestor(relativePath)) {
      return { excluded: !rule.include, lastMatch: index };
    }
  }
  return { excluded: false, lastMatch: -1 };
};

export const isExcludedByOrderedGlobs = (relativePathValue, rules) =>
  rules.length > 0 && orderedGlobState(relativePathValue, rules).excluded;

export const canOrderedGlobReincludeDescendant = (relativePathValue, rules) => {
  if (rules.length === 0) return false;
  const relativePath = normalizeRelativePath(relativePathValue);
  const { excluded, lastMatch } = orderedGlobState(relativePath, rules);
  if (!excluded) return false;
  let pathSegments;
  let seenFullSegmentLanguages;
  const laterFullSegmentExcludes = [];
  const laterFullSegmentExcludeLanguages = new Set();
  const coverageBudget = { remaining: MAX_DESCENDANT_LANGUAGE_OPERATIONS };
  for (let index = rules.length - 1; index > lastMatch; index -= 1) {
    const rule = rules[index];
    const literalPrefix = rule.literalPrefix;
    if (
      relativePath &&
      literalPrefix &&
      !relativePath.startsWith(literalPrefix) &&
      !literalPrefix.startsWith(`${relativePath}/`)
    )
      continue;
    if (rule.fullSegmentWildcard) {
      pathSegments ??= describePathSegments(relativePath);
      if (!rule.include) {
        if (!laterFullSegmentExcludeLanguages.has(rule.fullSegmentWildcard.lineTerminatorKey)) {
          laterFullSegmentExcludeLanguages.add(rule.fullSegmentWildcard.lineTerminatorKey);
          laterFullSegmentExcludes.push(rule.fullSegmentWildcard);
        }
        continue;
      }
      const languageKey = rule.fullSegmentWildcard.lineTerminatorKey;
      seenFullSegmentLanguages ??= new Set();
      if (seenFullSegmentLanguages.has(languageKey)) continue;
      seenFullSegmentLanguages.add(languageKey);
      const covered =
        coverageBudget.remaining > 0 &&
        laterFullSegmentExcludes.length > 0 &&
        descendantLanguageIsCoveredByUnion(
          pathSegments,
          rule.fullSegmentWildcard,
          laterFullSegmentExcludes,
          laterFullSegmentExcludeLanguages,
          coverageBudget
        );
      if (covered) continue;
      if (canFullSegmentWildcardMatchDescendant(pathSegments, rule.fullSegmentWildcard)) {
        return true;
      }
      continue;
    }
    if (!rule.include) continue;
    if (rule.couldMatchDescendant(relativePath)) return true;
  }
  return false;
};
