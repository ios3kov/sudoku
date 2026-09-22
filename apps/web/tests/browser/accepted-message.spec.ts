import { expect, test } from "@playwright/test";
import { acceptedMessage } from "./support/accepted-message";

// This is a selector-contract regression, not a substitute for real MLS sends.
// The markup matches MessageTimeline and the encrypted view's pending composer.
test("accepted-message checks ignore pending sends and composer text", async ({ page }) => {
  await page.setContent(`
    <div aria-label="Message history">
      <div class="message-bubble pending"><p>outgoing text</p><small>Sending…</small></div>
    </div>
    <textarea aria-label="Message">outgoing text</textarea>
  `);
  await expect(page.getByText("outgoing text", { exact: true })).toHaveCount(2);
  await expect(acceptedMessage(page, "outgoing text")).toHaveCount(0);

  // A settled projection may appear before the optimistic row/input are cleared.
  await page.getByLabel("Message history", { exact: true }).evaluate((history) => {
    const row = document.createElement("div");
    row.dataset.messageId = "accepted-1";
    row.innerHTML = '<div class="message-bubble"><p>outgoing text</p><small>Sent</small></div>';
    history.append(row);
  });
  await expect(acceptedMessage(page, "outgoing text")).toHaveCount(1);
  await expect(acceptedMessage(page, "outgoing text")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Message", exact: true })).toHaveValue("outgoing text");
});

test("quoted text and action previews cannot masquerade as accepted message bodies", async ({ page }) => {
  await page.setContent(`
    <div aria-label="Message history">
      <div data-message-id="reply-1"><div class="message-bubble">
        <div class="reply-preview">original text</div><p>reply text</p>
      </div></div>
    </div>
    <div role="dialog" aria-label="Message actions"><p>original text</p></div>
  `);
  await expect(acceptedMessage(page, "original text")).toHaveCount(0);
  await expect(acceptedMessage(page, "reply text")).toHaveCount(1);
});

test("duplicate accepted messages remain detectable instead of selecting the first", async ({ page }) => {
  await page.setContent(`
    <div aria-label="Message history">
      <div data-message-id="accepted-1"><div class="message-bubble"><p>duplicate text</p></div></div>
      <div data-message-id="accepted-2"><div class="message-bubble"><p>duplicate text</p></div></div>
    </div>
  `);
  await expect(acceptedMessage(page, "duplicate text")).toHaveCount(2);
});
