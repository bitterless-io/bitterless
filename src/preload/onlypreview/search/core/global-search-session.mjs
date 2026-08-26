import { randomUUID } from 'node:crypto';

const MAX_RESULTS = 500;
const MAX_SECTION_RESULTS = 250;

export class OnlyPreviewGlobalSearchSession {
  constructor() {
    this.revoke();
  }

  begin({ workspaceId, generation, requestId }) {
    this.workspaceId = workspaceId;
    this.generation = generation;
    this.requestId = requestId;
    this.resultsByToken = new Map();
    this.tokenByResultKey = new Map();
    this.resultCountBySection = new Map([
      ['files', 0],
      ['contents', 0]
    ]);
  }

  isCurrent({ workspaceId, generation, requestId }) {
    return (
      this.workspaceId === workspaceId &&
      this.generation === generation &&
      this.requestId === requestId
    );
  }

  issue(request, authority) {
    if (!this.isCurrent(request)) throw new TypeError('Global search request is stale');
    const key = `${authority.result.section}\0${authority.relativePath}`;
    const existingToken = this.tokenByResultKey.get(key);
    if (existingToken) {
      this.resultsByToken.set(existingToken, authority);
      return { ...authority.result, resultToken: existingToken };
    }
    if (this.resultsByToken.size >= MAX_RESULTS) {
      throw new TypeError('Global search result capability limit exceeded');
    }
    const sectionCount = this.resultCountBySection.get(authority.result.section);
    if (sectionCount === undefined || sectionCount >= MAX_SECTION_RESULTS) {
      throw new TypeError('Global search section capability limit exceeded');
    }
    let resultToken = randomUUID();
    while (this.resultsByToken.has(resultToken)) resultToken = randomUUID();
    this.resultsByToken.set(resultToken, authority);
    this.tokenByResultKey.set(key, resultToken);
    this.resultCountBySection.set(authority.result.section, sectionCount + 1);
    return { ...authority.result, resultToken };
  }

  issueBatch(request, authority) {
    const key = `${authority.result.section}\0${authority.relativePath}`;
    if (
      !this.tokenByResultKey.has(key) &&
      (this.resultsByToken.size >= MAX_RESULTS ||
        (this.resultCountBySection.get(authority.result.section) ?? MAX_SECTION_RESULTS) >=
          MAX_SECTION_RESULTS)
    ) {
      return undefined;
    }
    return this.issue(request, authority);
  }

  replace(request, authorities) {
    if (!this.isCurrent(request)) throw new TypeError('Global search request is stale');
    const previousTokenByResultKey = this.tokenByResultKey;
    this.resultsByToken = new Map();
    this.tokenByResultKey = new Map();
    this.resultCountBySection = new Map([
      ['files', 0],
      ['contents', 0]
    ]);
    return authorities.map((authority) => {
      const key = `${authority.result.section}\0${authority.relativePath}`;
      const token = previousTokenByResultKey.get(key);
      if (!token) return this.issue(request, authority);
      this.resultsByToken.set(token, authority);
      this.tokenByResultKey.set(key, token);
      this.resultCountBySection.set(
        authority.result.section,
        (this.resultCountBySection.get(authority.result.section) ?? 0) + 1
      );
      return { ...authority.result, resultToken: token };
    });
  }

  resolve({ workspaceId, generation, requestId, resultToken }) {
    if (!this.isCurrent({ workspaceId, generation, requestId })) {
      throw new TypeError('Global search preview request is stale');
    }
    const authority = this.resultsByToken.get(resultToken);
    if (!authority) throw new TypeError('Global search result capability is stale');
    return authority;
  }

  revoke(requestId) {
    if (requestId !== undefined && requestId !== this.requestId) return;
    this.workspaceId = undefined;
    this.generation = undefined;
    this.requestId = undefined;
    this.resultsByToken = new Map();
    this.tokenByResultKey = new Map();
    this.resultCountBySection = new Map([
      ['files', 0],
      ['contents', 0]
    ]);
  }
}

export const createOnlyPreviewGlobalSearchSession = () => new OnlyPreviewGlobalSearchSession();
