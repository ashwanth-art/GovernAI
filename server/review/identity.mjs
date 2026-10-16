import { createRemoteJWKSet, jwtVerify } from "jose";
let jwks;
export async function enterpriseIdentity(request) {
  const issuer = process.env.REVIEW_OIDC_ISSUER;
  if (!issuer) return null;
  const audience = process.env.REVIEW_OIDC_AUDIENCE;
  const jwksUrl = process.env.REVIEW_OIDC_JWKS_URL;
  if (!audience || !jwksUrl || new URL(jwksUrl).protocol !== "https:") throw new Error("Enterprise identity configuration is incomplete.");
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) throw new Error("Enterprise reviewer authentication is required.");
  jwks ??= createRemoteJWKSet(new URL(jwksUrl));
  const { payload } = await jwtVerify(token, jwks, { issuer, audience });
  if (!payload.sub) throw new Error("Authenticated identity has no subject.");
  const roles = Array.isArray(payload.roles) ? payload.roles : [];
  const mayReview = roles.includes("reviewer") || roles.includes("admin");
  if (request.method !== "GET" && !mayReview) throw new Error("A reviewer role is required for this operation.");
  return { subject: `${issuer}:${payload.sub}`, role: mayReview ? "reviewer" : "viewer" };
}
