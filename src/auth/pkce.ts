/*
 * PKCE (RFC 7636, S256) and the sign-in `state`, from Web Crypto only — no dependency.
 * Called only from inside signIn / handleRedirect, never at import (rule 4).
 */

export interface CryptoLike {
  getRandomValues<T extends ArrayBufferView | null>(array: T): T;
  subtle: { digest(algorithm: string, data: BufferSource): Promise<ArrayBuffer> };
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `bytes` random bytes, base64url without padding (32 → 43 chars, 16 → 22 chars). */
export function randomBase64Url(crypto: CryptoLike, bytes: number): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

/** S256 challenge: base64url(SHA-256(ASCII(verifier))). */
export async function challengeFor(crypto: CryptoLike, verifier: string): Promise<string> {
  const data = new Uint8Array(verifier.length);
  for (let i = 0; i < verifier.length; i++) data[i] = verifier.charCodeAt(i);
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export interface PkcePair {
  verifier: string;
  state: string;
}

/** Verifier (43 chars) and state (22 chars), synchronously; the challenge is computed separately. */
export function createPkce(crypto: CryptoLike): PkcePair {
  return { verifier: randomBase64Url(crypto, 32), state: randomBase64Url(crypto, 16) };
}
