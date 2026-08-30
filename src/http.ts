/** Small HTTP helpers shared by the Worker entry point and the consent screen. */

export function json(
  body: unknown,
  status: number,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Constant-time secret comparison.
 *
 * Both sides are hashed first so that `timingSafeEqual` always sees equal
 * lengths — it throws otherwise, and the throw itself would leak the token
 * length.
 */
export async function secretsMatch(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return crypto.subtle.timingSafeEqual(new Uint8Array(left), new Uint8Array(right));
}
