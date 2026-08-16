export const trenchWalletAvatarInitial = (
  name: string | null,
  canonicalAddress: string,
): string => {
  const source = name?.trim() || canonicalAddress.trim().replace(/^0x/i, '');
  const initial = Array.from(source)[0];
  if (!initial) throw new Error('Trench wallet avatar fallback requires a name or address.');
  const uppercase = initial.toUpperCase();
  return Array.from(uppercase).length === 1 ? uppercase : initial;
};

export const hasTrenchWalletAvatarImage = (
  avatarUrl: string | null,
  failedUrls: ReadonlySet<string>,
): avatarUrl is string => Boolean(avatarUrl && !failedUrls.has(avatarUrl));

export const markTrenchWalletAvatarFailed = (
  failedUrls: ReadonlySet<string>,
  avatarUrl: string,
): ReadonlySet<string> => failedUrls.has(avatarUrl)
  ? failedUrls
  : new Set([...failedUrls, avatarUrl]);
