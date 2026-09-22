import { BrowserProtocolStateStore } from "../../../features/messenger/crypto/browser-state-store";
export const stateStore = new BrowserProtocolStateStore();
declare global { interface Window { __stateStore: BrowserProtocolStateStore } }
window.__stateStore = stateStore;
