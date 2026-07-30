/**
 * Cognito authentication for Scouts Terrain.
 *
 * Terrain sits behind an AWS Cognito user pool in ap-southeast-2. Logins use the
 * USER_PASSWORD_AUTH flow with a username of "{branch}-{memberNumber}".
 *
 * The password is posted directly from the browser to AWS. It is never stored,
 * and never sent to any server operated by this project.
 */

const IDP = 'https://cognito-idp.ap-southeast-2.amazonaws.com/';

/** Terrain fronts several app clients; we try each until one accepts the login. */
export const CLIENT_IDS = [
  '6v98tbc09aqfvh52fml3usas3c',
  '5g9rg6ppc5g1pcs5odb7nf7hf9',
  '1u4uajve0lin0ki5n6b61ovva7',
  '21m9o832lp5krto1e8ioo6ldg2',
];

export const BRANCHES = ['act', 'nsw', 'nt', 'qld', 'sa', 'tas', 'vic', 'wa'];

async function idp(target, body) {
  const res = await fetch(IDP, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-amz-json-1.1',
      'x-amz-target': `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.__type || `Cognito returned ${res.status}`);
  return json;
}

/** Holds tokens in memory for the life of the tab. Never persisted. */
export class Session {
  #idToken = null;
  #refreshToken = null;
  #clientId = null;
  #expiresAt = 0;

  get signedIn() { return Boolean(this.#idToken); }
  get expiresAt() { return this.#expiresAt; }

  async signIn(branch, memberNumber, password) {
    let lastError = 'No Cognito client accepted those credentials.';

    for (const ClientId of CLIENT_IDS) {
      try {
        const res = await idp('InitiateAuth', {
          AuthFlow: 'USER_PASSWORD_AUTH',
          ClientId,
          AuthParameters: {
            USERNAME: `${branch}-${memberNumber}`,
            PASSWORD: password,
          },
        });

        if (res.ChallengeName) {
          throw new Error(
            `Cognito requires "${res.ChallengeName}". Complete that in Terrain itself, then sign in here.`
          );
        }

        const auth = res.AuthenticationResult;
        if (!auth?.IdToken) throw new Error('Cognito response contained no IdToken.');

        this.#idToken = auth.IdToken;
        this.#refreshToken = auth.RefreshToken ?? null;
        this.#clientId = ClientId;
        this.#expiresAt = Date.now() + (auth.ExpiresIn ?? 3600) * 1000;
        return;
      } catch (err) {
        lastError = err.message;
        // These are definitive - trying another client id will not help.
        if (/Challenge|attempts exceeded|PasswordResetRequired|UserNotConfirmed/i.test(err.message)) break;
      }
    }
    throw new Error(lastError);
  }

  signOut() {
    this.#idToken = this.#refreshToken = this.#clientId = null;
    this.#expiresAt = 0;
  }

  /** Returns a valid IdToken, refreshing first if it is close to expiry. */
  async authorization() {
    if (!this.#idToken) throw new Error('Not signed in.');
    await this.#refreshIfNeeded();
    return this.#idToken;
  }

  async #refreshIfNeeded() {
    const REFRESH_MARGIN_MS = 60_000;
    if (!this.#refreshToken || Date.now() < this.#expiresAt - REFRESH_MARGIN_MS) return;

    const res = await idp('InitiateAuth', {
      AuthFlow: 'REFRESH_TOKEN_AUTH',
      ClientId: this.#clientId,
      AuthParameters: { REFRESH_TOKEN: this.#refreshToken, DEVICE_KEY: null },
    });

    const auth = res.AuthenticationResult ?? {};
    if (!auth.IdToken) throw new Error('Token refresh failed - please sign in again.');
    this.#idToken = auth.IdToken;
    this.#expiresAt = Date.now() + (auth.ExpiresIn ?? 3600) * 1000;
  }
}
