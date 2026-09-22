import type { Locator, Page } from "@playwright/test";

/** Match a projected message body, never a draft, optimistic send or quote. */
export function acceptedMessage(page: Page, body: string): Locator {
  return page.getByLabel("Message history", { exact: true })
    .locator("[data-message-id] .message-bubble:not(.pending) > p")
    .and(page.getByText(body, { exact: true }));
}
