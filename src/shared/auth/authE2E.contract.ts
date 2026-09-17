/** Deliberately narrow opt-in for real login/logout verification; never a business-network bypass. */
export const AUTH_E2E_PRODUCTION_ORIGIN =
  'https://prod-bitterless-hcqmtqwtox.cn-shanghai.fcapp.run';

export const isAllowedAuthE2ERequest = (raw: string, method: string): boolean => {
  const url = new URL(raw);
  if (
    url.origin !== AUTH_E2E_PRODUCTION_ORIGIN ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return false;
  const expected = { '/auth/login': 'POST', '/auth/me': 'GET', '/auth/logout': 'POST' }[
    url.pathname
  ];
  return Boolean(expected && (method === expected || method === 'OPTIONS'));
};

export const assertAuthE2EProfile = (input: {
  packaged: boolean;
  mode: string;
  env: string;
  coreOrigin: string;
  userData: string | undefined;
}): void => {
  if (
    input.packaged ||
    input.mode !== 'debug' ||
    input.env !== 'prod' ||
    input.coreOrigin !== AUTH_E2E_PRODUCTION_ORIGIN ||
    !input.userData
  ) {
    throw new Error(
      'Auth-only E2E requires isolated unpackaged debug_prod with the expected production auth origin.'
    );
  }
};
