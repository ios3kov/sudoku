import { expect, test } from "@playwright/test";

function scriptSource(policy: string): string {
  return policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("script-src ")) ?? "";
}

function nonceFrom(policy: string): string {
  const match = policy.match(/'nonce-([^']+)'/);
  expect(match, "CSP must contain a nonce source").not.toBeNull();
  return match![1]!;
}

test("document CSP uses a fresh nonce and no unsafe-inline script allowance", async ({ request }) => {
  const first = await request.get("/");
  const second = await request.get("/");

  expect(first.ok()).toBeTruthy();
  expect(second.ok()).toBeTruthy();

  const firstPolicy = first.headers()["content-security-policy"] ?? "";
  const secondPolicy = second.headers()["content-security-policy"] ?? "";
  const firstNonce = nonceFrom(firstPolicy);
  const secondNonce = nonceFrom(secondPolicy);

  expect(scriptSource(firstPolicy)).not.toContain("'unsafe-inline'");
  expect(scriptSource(firstPolicy)).toContain("'wasm-unsafe-eval'");
  expect(secondNonce).not.toBe(firstNonce);

  const html = await first.text();
  const scriptTags = [...html.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  expect(scriptTags.length).toBeGreaterThan(0);
  for (const tag of scriptTags) {
    expect(tag).toContain(`nonce="${firstNonce}"`);
  }
});

test("CSP blocks a parser-inserted untrusted inline script", async ({ page }) => {
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.resourceType() !== "document") {
      await route.continue();
      return;
    }

    const response = await route.fetch();
    const html = await response.text();
    const injected =
      '<script>window.__sudokuUntrustedInlineRan = true;<\\/script>';
    await route.fulfill({
      response,
      body: html.replace("</head>", `${injected}</head>`),
    });
  });

  await page.goto("/");
  const ran = await page.evaluate(
    () =>
      Boolean(
        (window as typeof window & { __sudokuUntrustedInlineRan?: boolean })
          .__sudokuUntrustedInlineRan,
      ),
  );
  expect(ran).toBe(false);
});
