import { describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { base64Url, challengeFor, createPkce, randomBase64Url, type CryptoLike } from '../../src/auth/pkce';
import { fakeCrypto } from './fakes';

const B64URL = /^[A-Za-z0-9_-]+$/;
const realCrypto = webcrypto as unknown as CryptoLike;

describe('PKCE (RFC 7636, S256)', () => {
  it.each([
    ['Web Crypto', realCrypto],
    ['test crypto', fakeCrypto],
  ])('matches the RFC 7636 Appendix B vector with %s', async (_label, crypto) => {
    expect(await challengeFor(crypto, 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });

  it('verifier is 43 chars, state 22, challenge 43, all base64url', async () => {
    const { verifier, state } = createPkce(realCrypto);
    const challenge = await challengeFor(realCrypto, verifier);
    expect(verifier).toHaveLength(43);
    expect(state).toHaveLength(22);
    expect(challenge).toHaveLength(43);
    for (const s of [verifier, state, challenge]) expect(s).toMatch(B64URL);
  });

  it('values differ between calls', () => {
    expect(randomBase64Url(realCrypto, 32)).not.toBe(randomBase64Url(realCrypto, 32));
  });

  it('base64url uses - and _ and no padding', () => {
    expect(base64Url(new Uint8Array([0xfb, 0xff, 0xbf]))).toBe('-_-_');
    expect(base64Url(new Uint8Array([1]))).toBe('AQ');
  });
});
