import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../apps/web/features/messenger/realtime.ts", import.meta.url), "utf8");
const {outputText} = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}});
const accessSource = readFileSync(new URL("../apps/web/features/messenger/device-access.ts", import.meta.url), "utf8");
const accessCode = ts.transpileModule(accessSource, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}}).outputText;
function harness() {
  const sockets = [], intervals = new Map(), timeouts = new Map(), events = [];
  let next = 0;
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor(url, protocols) { this.url=url; this.protocols=protocols; sockets.push(this); }
    close() { this.readyState = 3; }
    send(value) { this.sent.push(value); }
    open() { this.readyState = 1; this.onopen?.(); }
  }
  const eventsTarget = new EventTarget();
  const browser = {
    location: {protocol: "https:", host: "sudoku.test"},
    addEventListener: eventsTarget.addEventListener.bind(eventsTarget),
    removeEventListener: eventsTarget.removeEventListener.bind(eventsTarget),
    dispatchEvent: eventsTarget.dispatchEvent.bind(eventsTarget),
    setInterval: (fn) => { const id = ++next; intervals.set(id,fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn) => { const id = ++next; timeouts.set(id,fn); return id; },
    clearTimeout: (id) => timeouts.delete(id),
  };
  const access = {};
  vm.runInNewContext(accessCode, {exports: access, window: browser, Event, Headers, DOMException});
  const exports = {};
  vm.runInNewContext(outputText, {exports, WebSocket: Socket, window: browser, require: (name) => {
    assert.equal(name, "./device-access"); return access;
  }});
  const client = new exports.RealtimeClient({onOpen: ()=>events.push("open"), onClose: ()=>events.push("close"), onEvent: event=>events.push(event.type)});
  return {client, sockets, intervals, timeouts, events, access};
}

test("start is idempotent while a socket is connecting or open", () => {
  const h=harness();h.client.start();h.client.start();
  assert.equal(h.sockets.length,1);
  h.sockets[0].open();h.client.start();assert.equal(h.sockets.length,1);
  h.client.stop();assert.equal(h.intervals.size,0);
});
test("late open/message after stop cannot retain timers or private events", () => {
  const h=harness();h.client.start();const s=h.sockets[0];
  const open=s.onopen, message=s.onmessage;
  h.client.stop();open();message({data:'{"type":"message.created"}'});
  assert.deepEqual(h.events,[]);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,0);
});
test("a retired socket cannot close the new session heartbeat or reconnect it", () => {
  const h=harness();h.client.start();const old=h.sockets[0];const close=old.onclose;
  h.client.stop();h.client.start();h.sockets[1].open();close({code:1000});
  assert.deepEqual(h.events,["open"]);assert.equal(h.intervals.size,1);assert.equal(h.timeouts.size,0);
});
test("current close still schedules a reconnect and stop cancels it", () => {
  const h=harness();h.client.start();h.sockets[0].open();h.sockets[0].onclose({code:1006});
  assert.deepEqual(h.events,["open","close"]);assert.equal(h.intervals.size,0);assert.equal(h.timeouts.size,1);
  h.client.stop();assert.equal(h.timeouts.size,0);
});
test("server revocation handler can stop without scheduling another connection", () => {
  const h=harness();h.client.start();const s=h.sockets[0];s.open();
  h.client.stop();s.onclose?.({code:4401});assert.equal(h.timeouts.size,0);
});
test("PIN ticket never enters URL; PIN lock does not invoke revoked-session handler", () => {
  const h=harness(), token="p".repeat(43);
  assert.equal(h.access.acceptUnlock(token,h.access.accessEpoch()),true);
  h.client.start(); const s=h.sockets[0]; s.open();
  assert.equal(s.url,"wss://sudoku.test/v1/ws");
  assert.deepEqual(Array.from(s.protocols),["sudoku.v1",`sudoku-unlock.${token}`]);
  s.onclose({code:4423});
  assert.deepEqual(h.events,["open"]);
  assert.equal(h.access.currentUnlockToken(),null);
  assert.equal(h.timeouts.size,0); assert.equal(h.intervals.size,0);
});
test("a newly issued ticket reconnects with new credentials and stopped clients stay stopped", () => {
  const h=harness();h.client.start();
  h.access.acceptUnlock("n".repeat(43),h.access.accessEpoch());
  assert.equal(h.sockets.length,2);
  assert.equal(h.sockets[0].readyState,3);
  h.client.stop();
  h.access.acceptUnlock("x".repeat(43),h.access.accessEpoch());
  assert.equal(h.sockets.length,2);
});
