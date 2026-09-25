import { expect, test } from "@playwright/test";

function scriptDirective(csp: string): string {
  const directive = csp
    .split(";")
    .map((value) => value.trim())
    .find((value) => value.startsWith("script-src "));
  expect(directive, "script-src directive must exist").toBeTruthy();
  return directive!;
}

test("document CSP uses a fresh script nonce and blocks arbitrary inline scripts", async ({ page, request }) => {
  const first = await page.goto("/");
  expect(first).not.toBeNull();
  expect(first!.ok()).toBe(true);

  const firstHeaders = first!.headers();
  const firstCsp = firstHeaders["content-security-policy"];
  const firstNonce = firstHeaders["x-nonce"];

  expect(firstCsp).toBeTruthy();
  expect(firstNonce).toBeTruthy();

  const scripts = scriptDirective(firstCsp);
  expect(scripts).toContain("'self'");
  expect(scripts).toContain(`'nonce-${firstNonce}'`);
  expect(scripts).toContain("'strict-dynamic'");
  expect(scripts).toContain("'wasm-unsafe-eval'");
  expect(scripts).not.toContain("'unsafe-inline'");

  const documentNonces = await page.evaluate(() =>
    Array.from(document.scripts)
      .map((script) => script.nonce)
      .filter(Boolean),
  );
  expect(documentNonces.length).toBeGreaterThan(0);
  expect(documentNonces.every((nonce) => nonce === firstNonce)).toBe(true);

  await page.evaluate(() => {
    const state = window as typeof window & { __cspInlineRan?: boolean };
    state.__cspInlineRan = false;
    const script = document.createElement("script");
    script.textContent = "window.__cspInlineRan = true";
    document.head.appendChild(script);
  });
  await page.waitForTimeout(50);
  expect(
    await page.evaluate(
      () => (window as typeof window & { __cspInlineRan?: boolean }).__cspInlineRan,
    ),
  ).toBe(false);

  const second = await request.get("/");
  expect(second.ok()).toBe(true);
  const secondHeaders = second.headers();
  const secondCsp = secondHeaders["content-security-policy"];
  const secondNonce = secondHeaders["x-nonce"];

  expect(secondCsp).toBeTruthy();
  expect(secondNonce).toBeTruthy();
  expect(secondNonce).not.toBe(firstNonce);
  expect(scriptDirective(secondCsp)).toContain(`'nonce-${secondNonce}'`);
});
