import type { TrenchChain } from '@shared/trench/trench.type';
import type { TrenchIndexError } from '@shared/trench/trenchIndex.type';
import type {
  TrenchPersonDetail,
  TrenchPersonListPage,
  TrenchPersonSummary,
  TrenchPersonUpdateProfileInput,
  TrenchPersonWalletAccountRow,
  TrenchPersonWalletRow,
} from '@shared/trench/trenchPerson.type';
import { canonicalizeTrenchAddress } from '@shared/trench/trench.validation';

interface TrenchPersonClient {
  listPersons: typeof import('./trenchPerson.client').trenchPersonClient.listPersons;
  getPerson: typeof import('./trenchPerson.client').trenchPersonClient.getPerson;
  updatePersonProfile: typeof import('./trenchPerson.client').trenchPersonClient.updatePersonProfile;
  attachWalletToPerson: typeof import('./trenchPerson.client').trenchPersonClient.attachWalletToPerson;
  subscribe: typeof import('./trenchPerson.client').trenchPersonClient.subscribe;
}

export interface TrenchWalletMoveCandidate {
  wallet: TrenchPersonWalletRow;
  account: TrenchPersonWalletAccountRow;
  sourcePersonId: string;
  sourceDisplayName: string | null;
  targetPersonId: string;
  expectedRevision: number;
}

type TrenchPersonPhase = 'idle' | 'loading' | 'refreshing' | 'ready' | 'unavailable';
type TrenchPersonProfileFields = Pick<
  TrenchPersonUpdateProfileInput,
  'displayName' | 'avatarUrl' | 'note'
>;

interface TrenchPersonProfileBaseline {
  displayName: string | null;
  avatarUrl: string | null;
  note: string | null;
}

export type TrenchWalletMoveAdvanceResult = 'lookup-ready' | 'moved' | 'error';

export class TrenchPersonStore {
  phase: TrenchPersonPhase = 'idle';
  detailPhase: TrenchPersonPhase = 'idle';
  page: TrenchPersonListPage | null = null;
  detail: TrenchPersonDetail | null = null;
  query = '';
  selectedPersonId: string | null = null;
  listError: TrenchIndexError | null = null;
  detailError: TrenchIndexError | null = null;
  mutationError: TrenchIndexError | null = null;
  detailPaneRequested = false;
  profileDraftDisplayName = '';
  profileDraftAvatarUrl = '';
  profileDraftNote = '';
  profileSubmitPending = false;
  moveChain: TrenchChain = 'bsc';
  moveAddress = '';
  movePending = false;
  moveLookupPhase: 'idle' | 'loading' | 'ready' | 'error' = 'idle';
  moveCandidate: TrenchWalletMoveCandidate | null = null;
  private initialized = false;
  private cursors: string[] = [''];
  private listSequence = 0;
  private detailSequence = 0;
  private profileDraftRevision: number | null = null;
  private profileDraftBaseline: TrenchPersonProfileBaseline | null = null;

  constructor(private readonly client: TrenchPersonClient) {}

  get pageNumber(): number {
    return this.cursors.length;
  }

  get hasPreviousPage(): boolean {
    return this.cursors.length > 1;
  }

  get hasNextPage(): boolean {
    return !!this.page?.nextCursor;
  }

  get items(): TrenchPersonSummary[] {
    return this.page?.items ?? [];
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.client.subscribe((event) => {
      if ((this.page?.revision ?? -1) <= event.revision) void this.refresh(true);
    });
    await this.loadPage('', true);
  }

  async refresh(restart = false): Promise<void> {
    if (restart) this.cursors = [''];
    await this.loadPage(this.cursors.at(-1) ?? '', true);
  }

  async search(query: string): Promise<void> {
    this.query = query.trim();
    this.cursors = [''];
    await this.loadPage('', false);
  }

  async nextPage(): Promise<void> {
    const cursor = this.page?.nextCursor;
    if (!cursor) return;
    this.cursors.push(cursor);
    await this.loadPage(cursor, false);
  }

  async previousPage(): Promise<void> {
    if (this.cursors.length <= 1) return;
    this.cursors.pop();
    await this.loadPage(this.cursors.at(-1) ?? '', false);
  }

  async selectPerson(personId: string): Promise<void> {
    if (this.selectedPersonId === personId && this.detail?.personId === personId) return;
    this.selectedPersonId = personId;
    await this.loadDetail(personId);
  }

  async requestPersonDetail(personId: string): Promise<void> {
    this.detailPaneRequested = true;
    await this.selectPerson(personId);
  }

  closePersonDetail(): void {
    this.detailPaneRequested = false;
  }

  beginProfileEdit(): boolean {
    if (!this.detail || !this.page) return false;
    this.mutationError = null;
    this.profileDraftDisplayName = this.detail.displayName ?? '';
    this.profileDraftAvatarUrl = this.detail.avatarUrl ?? '';
    this.profileDraftNote = this.detail.note ?? '';
    this.profileDraftRevision = this.page.revision;
    this.profileDraftBaseline = {
      displayName: this.detail.displayName,
      avatarUrl: this.detail.avatarUrl,
      note: this.detail.note,
    };
    return true;
  }

  cancelProfileEdit(): void {
    if (this.profileSubmitPending) return;
    this.clearProfileDraft();
    this.mutationError = null;
  }

  async submitProfileEdit(): Promise<boolean> {
    const expectedRevision = this.profileDraftRevision;
    const baseline = this.profileDraftBaseline;
    if (!baseline || expectedRevision === null || this.profileSubmitPending) return false;
    const normalized: TrenchPersonProfileBaseline = {
      displayName: this.profileDraftDisplayName.trim() || null,
      avatarUrl: this.profileDraftAvatarUrl.trim() || null,
      note: this.profileDraftNote.trim() || null,
    };
    const fields: TrenchPersonProfileFields = {};
    if (normalized.displayName !== baseline.displayName) fields.displayName = normalized.displayName;
    if (normalized.avatarUrl !== baseline.avatarUrl) fields.avatarUrl = normalized.avatarUrl;
    if (normalized.note !== baseline.note) fields.note = normalized.note;
    if (Object.keys(fields).length === 0) {
      this.clearProfileDraft();
      this.mutationError = null;
      return true;
    }
    this.profileSubmitPending = true;
    try {
      const updated = await this.updateProfile(fields, expectedRevision);
      if (updated) {
        this.clearProfileDraft();
        return true;
      }
      if (this.mutationError?.code === 'REVISION_CONFLICT') this.rebaseProfileDraft();
      return false;
    } finally {
      this.profileSubmitPending = false;
    }
  }

  async updateProfile(
    fields: TrenchPersonProfileFields,
    expectedRevision = this.page?.revision,
  ): Promise<boolean> {
    if (!this.detail || !this.page || expectedRevision === undefined) return false;
    this.mutationError = null;
    const personId = this.detail.personId;
    const result = await this.client.updatePersonProfile({
      personId,
      expectedRevision,
      ...fields,
    });
    if (!result.ok) {
      this.mutationError = result.error;
      if (result.error.code === 'REVISION_CONFLICT') await this.refresh(true);
      return false;
    }
    await this.refresh(true);
    await this.selectPerson(personId);
    return true;
  }

  async lookupMoveWallet(chain: TrenchChain, address: string): Promise<boolean> {
    this.moveLookupPhase = 'loading';
    this.moveCandidate = null;
    this.mutationError = null;
    if (!this.detail) {
      this.moveLookupPhase = 'error';
      this.mutationError = { code: 'NOT_FOUND', message: 'Select a target person first.' };
      return false;
    }
    let canonicalAddress: string;
    try {
      canonicalAddress = canonicalizeTrenchAddress(address, chain, 'address');
    } catch {
      this.moveLookupPhase = 'error';
      this.mutationError = { code: 'INVALID_INPUT', message: 'The wallet address is invalid.' };
      return false;
    }
    const pageResult = await this.client.listPersons({ query: canonicalAddress, limit: 100 });
    if (!pageResult.ok) {
      this.moveLookupPhase = 'error';
      this.mutationError = pageResult.error;
      return false;
    }
    const matches: TrenchWalletMoveCandidate[] = [];
    for (const summary of pageResult.value.items) {
      const detailResult = await this.client.getPerson({ personId: summary.personId });
      if (!detailResult.ok) {
        this.moveLookupPhase = 'error';
        this.mutationError = detailResult.error;
        return false;
      }
      for (const wallet of detailResult.value.wallets) {
        if (wallet.canonicalAddress !== canonicalAddress) continue;
        const account = wallet.accounts.find((entry) => entry.chain === chain);
        if (!account || account.walletKind !== 'user') continue;
        matches.push({
          wallet,
          account,
          sourcePersonId: detailResult.value.personId,
          sourceDisplayName: detailResult.value.displayName,
          targetPersonId: this.detail.personId,
          expectedRevision: pageResult.value.revision,
        });
      }
    }
    if (matches.length !== 1 || pageResult.value.nextCursor) {
      this.moveLookupPhase = 'error';
      this.mutationError = {
        code: matches.length > 1 || pageResult.value.nextCursor ? 'IDENTITY_CONFLICT' : 'NOT_FOUND',
        message: matches.length > 1 || pageResult.value.nextCursor
          ? 'The wallet lookup is ambiguous.'
          : 'No person-linked user wallet matches this chain and address.',
      };
      return false;
    }
    if (matches[0]!.sourcePersonId === matches[0]!.targetPersonId) {
      this.moveLookupPhase = 'error';
      this.mutationError = {
        code: 'INVALID_INPUT',
        message: 'This wallet already belongs to the selected person.',
      };
      return false;
    }
    this.moveCandidate = matches[0]!;
    this.moveLookupPhase = 'ready';
    return true;
  }

  async confirmMoveWallet(): Promise<boolean> {
    const candidate = this.moveCandidate;
    if (!candidate) return false;
    this.mutationError = null;
    const result = await this.client.attachWalletToPerson({
      personId: candidate.targetPersonId,
      walletId: candidate.wallet.walletId,
      expectedRevision: candidate.expectedRevision,
      expectedCurrentPersonId: candidate.sourcePersonId,
    });
    if (!result.ok) {
      this.mutationError = result.error;
      if (result.error.code === 'REVISION_CONFLICT' || result.error.code === 'MEMBERSHIP_CONFLICT') {
        this.moveCandidate = null;
        this.moveLookupPhase = 'error';
        await this.refresh(true);
      }
      return false;
    }
    const targetPersonId = candidate.targetPersonId;
    this.clearMoveLookup();
    await this.refresh(true);
    await this.selectPerson(targetPersonId);
    return true;
  }

  beginMoveWallet(): void {
    if (this.movePending) return;
    this.moveAddress = '';
    this.clearMoveLookup();
  }

  setMoveChain(chain: TrenchChain): void {
    if (this.movePending || this.moveChain === chain) return;
    this.moveChain = chain;
    this.clearMoveLookup();
  }

  setMoveAddress(address: string): void {
    if (this.movePending || this.moveAddress === address) return;
    this.moveAddress = address;
    this.clearMoveLookup();
  }

  cancelMoveWallet(): void {
    if (this.movePending) return;
    this.moveAddress = '';
    this.clearMoveLookup();
  }

  async advanceMoveWallet(): Promise<TrenchWalletMoveAdvanceResult> {
    if (this.movePending) return 'error';
    this.movePending = true;
    try {
      if (this.moveCandidate) {
        return await this.confirmMoveWallet() ? 'moved' : 'error';
      }
      return await this.lookupMoveWallet(this.moveChain, this.moveAddress)
        ? 'lookup-ready'
        : 'error';
    } finally {
      this.movePending = false;
    }
  }

  clearMutationError(): void {
    this.mutationError = null;
  }

  clearMoveLookup(): void {
    this.moveLookupPhase = 'idle';
    this.moveCandidate = null;
    this.mutationError = null;
  }

  private clearProfileDraft(): void {
    this.profileDraftDisplayName = '';
    this.profileDraftAvatarUrl = '';
    this.profileDraftNote = '';
    this.profileDraftRevision = null;
    this.profileDraftBaseline = null;
  }

  private rebaseProfileDraft(): void {
    if (!this.detail || !this.page) return;
    this.profileDraftDisplayName = this.detail.displayName ?? '';
    this.profileDraftAvatarUrl = this.detail.avatarUrl ?? '';
    this.profileDraftNote = this.detail.note ?? '';
    this.profileDraftRevision = this.page.revision;
    this.profileDraftBaseline = {
      displayName: this.detail.displayName,
      avatarUrl: this.detail.avatarUrl,
      note: this.detail.note,
    };
  }

  private async loadPage(cursor: string, preserveOffPageSelection: boolean): Promise<void> {
    const sequence = ++this.listSequence;
    this.phase = this.page ? 'refreshing' : 'loading';
    this.listError = null;
    const result = await this.client.listPersons({
      query: this.query || undefined,
      cursor: cursor || undefined,
      limit: 50,
    });
    if (sequence !== this.listSequence) return;
    if (!result.ok) {
      if (cursor && result.error.code === 'CURSOR_STALE') {
        this.cursors = [''];
        await this.loadPage('', preserveOffPageSelection);
        return;
      }
      this.phase = 'unavailable';
      this.listError = result.error;
      return;
    }
    const previousSelection = this.selectedPersonId;
    this.page = result.value;
    this.phase = 'ready';
    const selectedInPage = result.value.items.find(({ personId }) => personId === previousSelection);
    if (selectedInPage) {
      await this.loadDetail(selectedInPage.personId, sequence);
      return;
    }
    if (preserveOffPageSelection && previousSelection) {
      const detailSequence = ++this.detailSequence;
      const redirected = await this.client.getPerson({ personId: previousSelection });
      if (sequence !== this.listSequence || detailSequence !== this.detailSequence) return;
      if (redirected.ok) {
        this.selectedPersonId = redirected.value.personId;
        this.detail = redirected.value;
        this.detailError = null;
        this.detailPhase = 'ready';
        return;
      }
    }
    const firstPersonId = result.value.items[0]?.personId ?? null;
    this.selectedPersonId = firstPersonId;
    if (firstPersonId) await this.loadDetail(firstPersonId, sequence);
    else {
      this.detail = null;
      this.detailError = null;
      this.detailPhase = 'idle';
    }
  }

  private async loadDetail(personId: string, parentListSequence?: number): Promise<void> {
    const sequence = ++this.detailSequence;
    const sameIdentity = this.detail?.personId === personId;
    this.detailPhase = sameIdentity ? 'refreshing' : 'loading';
    if (!sameIdentity) this.detail = null;
    this.detailError = null;
    const result = await this.client.getPerson({ personId });
    if (
      sequence !== this.detailSequence ||
      this.selectedPersonId !== personId ||
      (parentListSequence !== undefined && parentListSequence !== this.listSequence)
    ) return;
    if (!result.ok) {
      this.detailPhase = 'unavailable';
      this.detailError = result.error;
      return;
    }
    this.detail = result.value;
    this.selectedPersonId = result.value.personId;
    this.detailPhase = 'ready';
  }
}
