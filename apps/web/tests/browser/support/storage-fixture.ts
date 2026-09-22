import { BrowserProtocolStateStore } from "../../../features/messenger/crypto/browser-state-store";
declare global { interface Window { __storageAudit: typeof BrowserProtocolStateStore; } }
window.__storageAudit = BrowserProtocolStateStore;
