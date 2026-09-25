import { NextRequest, NextResponse } from "next/server";

function optionalOrigin(name: string, allowedProtocols: readonly string[]): string | null {
  const raw = process.env[name]?.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw);
    if (!allowedProtocols.includes(url.protocol)) return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

function buildContentSecurityPolicy(nonce: string): string {
  const connectSources = new Set(["'self'"]);
  const assetOrigin = optionalOrigin("CSP_ASSET_ORIGIN", ["http:", "https:"]);
  const websocketOrigin = optionalOrigin("CSP_WEBSOCKET_ORIGIN", ["ws:", "wss:"]);

  if (assetOrigin) connectSources.add(assetOrigin);
  if (websocketOrigin) connectSources.add(websocketOrigin);

  const directives = [
    "default-src 'self'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data:${assetOrigin ? ` ${assetOrigin}` : ""}`,
    `media-src 'self' blob:${assetOrigin ? ` ${assetOrigin}` : ""}`,
    "font-src 'self' data:",
    `connect-src ${Array.from(connectSources).join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
  ];

  if (process.env.CSP_UPGRADE_INSECURE_REQUESTS === "true") {
    directives.push("upgrade-insecure-requests");
  }

  return `${directives.join("; ")};`;
}

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const contentSecurityPolicy = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
  response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!v1/|_next/static|_next/image|favicon.ico|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|manifest.webmanifest|sw.js).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
