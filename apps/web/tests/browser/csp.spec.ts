import { expect, test } from "@playwright/test";

function scriptDirective(csp: string): string {
  return (
    csp
      .split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("script-src ")) ?? ""
  );
}

function nonceFromCsp(csp: string): string {
  const match = scriptDirective(csp).match(/'nonce-([^']+)'/);
  expect(match, "script-src must contain a nonce").not.toBeNull();
  return match![1];
}

test("document CSP uses fresh nonces and blocks unsanctioned inline scripts", async ({
  page,
  request,
}) => {
  const first = await request.get("/");
  const second = await request.get("/");
  expect(first.ok()).toBe(true);
  expect(second.ok()).toBe(true);

  const firstCsp = first.headers()["content-security-policy"] ?? "";
  const secondCsp = second.headers()["content-security-policy"] ?? "";
  const firstHeaderNonce = first.headers()["x-nonce"] ?? "";
  const secondHeaderNonce = second.headers()["x-nonce"] ?? "";

  const firstScript = scriptDirective(firstCsp);
  expect(firstScript).toContain("'strict-dynamic'");
  expect(firstScript).toContain("'wasm-unsafe-eval'");
  expect(firstScript).not.toContain("'unsafe-inline'");
  expect(firstHeaderNonce).not.toBe("");
  expect(secondHeaderNonce).not.toBe("");
  expect(nonceFromCsp(firstCsp)).toBe(firstHeaderNonce);
  expect(nonceFromCsp(secondCsp)).toBe(secondHeaderNonce);
  expect(secondHeaderNonce).not.toBe(firstHeaderNonce);

  const response = await page.goto("/");
  expect(response).not.toBeNull();
  const pageCsp = response!.headers()["content-security-policy"] ?? "";
  const pageNonce = response!.headers()["x-nonce"] ?? "";
  expect(nonceFromCsp(pageCsp)).toBe(pageNonce);

  const scriptNonces = await page.locator("script").evaluateAll((scripts) =>
    scripts
      .map((script) => (script as HTMLScriptElement).nonce)
      .filter((nonce) => nonce.length > 0),
  );
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect([...new Set(scriptNonces)]).toEqual([pageNonce]);

  await page.evaluate(() => {
    delete (window as Window & { __cspInlineExecuted?: boolean }).__cspInlineExecuted;
    const script = document.createElement("script");
    script.textContent = "window.__cspInlineExecuted = true";
    document.head.appendChild(script);
  });
  await page.waitForTimeout(50);

  expect(
    await page.evaluate(() =>
      Boolean((window as Window & { __cspInlineExecuted?: boolean }).__cspInlineExecuted),
    ),
  ).toBe(false);
});
