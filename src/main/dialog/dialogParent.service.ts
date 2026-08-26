export interface DialogParentCandidate {
  isDestroyed(): boolean;
  isVisible(): boolean;
}

const canOwnDialog = <WindowCandidate extends DialogParentCandidate>(
  candidate: WindowCandidate | null
): candidate is WindowCandidate => Boolean(candidate && !candidate.isDestroyed() && candidate.isVisible());

export const selectDialogParent = <WindowCandidate extends DialogParentCandidate>(
  focusedCandidate: WindowCandidate | null,
  candidates: readonly WindowCandidate[]
): WindowCandidate | null => {
  if (canOwnDialog(focusedCandidate)) return focusedCandidate;
  return candidates.find((candidate) => canOwnDialog(candidate)) ?? null;
};
