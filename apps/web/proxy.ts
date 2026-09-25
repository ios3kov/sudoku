import { NextResponse, type NextRequest } from "next/server";

const CSP_HEADER = "Content-Security-Policy";
const NONCE_HEADER = "x-nonce";
const LOCAL_ASSET_ORIGINS = ["http://localhost:9000", "http://127.0.0.1:9000"];

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let value = "";
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function normalizeHost(value: string | null): string {
  return (value ?? "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .trim();
}

function isLocalHost(host: string): boolean {
  const normalized = host.split(":")[0]?.toLowerCase() ?? "";
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "0.0.0.0";
}

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed).origin;
  } catch {
    return null;
  }
}

function getAssetOrigins(requestHost: string): string[] {
  const explicitOrigins = (process.env.ASSET_PUBLIC_ORIGIN ?? "")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => Boolean(value));

  const appDomain = normalizeHost(process.env.APP_DOMAIN ?? null);
  const derivedProductionOrigin = appDomain && !isLocalHost(appDomain) ? `https://assets.${appDomain}` : null;
  const localOrigins = isLocalHost(requestHost) || explicitOrigins.length === 0 ? LOCAL_ASSET_ORIGINS : [];

  return unique([...explicitOrigins, ...(derivedProductionOrigin ? [derivedProductionOrigin] : []), ...localOrigins]);
}

function getWebSocketSources(requestHost: string): string[] {
  if (!requestHost) return ["ws:", "wss:"];
  if (isLocalHost(requestHost)) return [`ws://${requestHost}`, `wss://${requestHost}`];
  return [`wss://${requestHost}`];
}

function createContentSecurityPolicy(request: NextRequest, nonce: string): string {
  const requestHost = normalizeHost(request.headers.get("x-forwarded-host") ?? request.headers.get("host"));
  const assetOrigins = getAssetOrigins(requestHost);
  const websocketSources = getWebSocketSources(requestHost);
  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: ${assetOrigins.join(" ")}`,
    `media-src 'self' blob: ${assetOrigins.join(" ")}`,
    "font-src 'self' data:",
    `connect-src 'self' ${assetOrigins.join(" ")} ${websocketSources.join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];

  if (requestHost && !isLocalHost(requestHost)) {
    directives.push("upgrade-insecure-requests");
  }

  return directives.join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = createNonce();
  const contentSecurityPolicy = createContentSecurityPolicy(request, nonce);
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(NONCE_HEADER, nonce);
  requestHeaders.set(CSP_HEADER, contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set(NONCE_HEADER, nonce);
  response.headers.set(CSP_HEADER, contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!v1/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|map|txt|woff2?|ttf)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
