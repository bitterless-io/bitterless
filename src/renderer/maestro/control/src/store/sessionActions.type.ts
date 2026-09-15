export type SessionUndoRecord =
  | { kind: 'archive'; id: string; title: string }
  | { kind: 'rename'; id: string; title: string; previous: { title: string; titleCustomized?: boolean } }
