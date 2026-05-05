import { createHash, randomBytes } from "node:crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

const ISSUER = "https://oauth.telegram.org";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));

const CLIENT_ID = process.env.TELEGRAM_LOGIN_CLIENT_ID ?? "";
const CLIENT_SECRET = process.env.TELEGRAM_LOGIN_CLIENT_SECRET ?? "";
const REDIRECT_URI = process.env.TELEGRAM_LOGIN_REDIRECT_URI ?? "";

const b64url = (buf: Buffer) => buf.toString("base64url");

export const makePkceVerifier = () => b64url(randomBytes(32));
export const makePkceChallenge = (verifier: string) =>
  b64url(createHash("sha256").update(verifier).digest());
export const makeState = () => b64url(randomBytes(16));

export function buildAuthorizationUrl(args: {
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: "openid profile",
    state: args.state,
    code_challenge: args.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ISSUER}/auth?${params}`;
}

const TgClaimsSchema = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
});
export type TgIdTokenClaims = z.infer<typeof TgClaimsSchema>;

export async function exchangeCodeForIdToken(args: {
  code: string;
  codeVerifier: string;
}): Promise<TgIdTokenClaims> {
  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${ISSUER}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: REDIRECT_URI,
      client_id: CLIENT_ID,
      code_verifier: args.codeVerifier,
    }),
  });
  if (!res.ok) throw new Error(`token exchange ${res.status}: ${await res.text()}`);
  const { id_token } = (await res.json()) as { id_token?: string };
  const { payload } = await jwtVerify(id_token!, JWKS, {
    issuer: ISSUER,
    audience: CLIENT_ID,
  });
  return TgClaimsSchema.parse(payload);
}
