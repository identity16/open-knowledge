const STATE_PART = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9_-]{43,128}$/;

export interface HandoffState {
  readonly nonce: string;
  readonly challenge: string;
}

export function parseHandoffState(state: string): HandoffState | null {
  const parts = state.split('.');
  if (parts.length !== 2) return null;
  const [nonce, challenge] = parts as [string, string];
  if (!STATE_PART.test(nonce) || !STATE_PART.test(challenge)) return null;
  return { nonce, challenge };
}

export function isWellFormedVerifier(verifier: string): boolean {
  return VERIFIER.test(verifier);
}

export async function challengeFor(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
