import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const source = readFileSync(new URL("../apps/web/features/messenger/realtime.ts", import.meta.url), "utf8");
const {outputText} = ts.transpileModule(source, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS}});
function harness() {
  const sockets = [], intervals = new Map(), timeouts = new Map(), events = [];
  let next = 0;
  class Socket {
    static OPEN = 1;
    readyState = 0;
    sent = [];
    constructor() { sockets.push(this); }
    close() { this.readyState = 3; }
    send(value) { this.sent.push(value); }
    open() { this.readyState = 1; this.onopen?.(); }
  }
  const exports = {};
  vm.runInNewContext(outputText, {exports, WebSocket: Socket, window: {
    location: {protocol: "https:", host: "sudoku.test"},
    setInterval: (fn) => { const id = ++next; intervals.set(id,fn); return id; },
    clearInterval: (id) => intervals.delete(id),
    setTimeout: (fn) => { const id = ++next; timeouts.set(id,fn); return id; },
    clearTimeout: (id) => timeouts.delete(id),
  }});
  const client = new exports.RealtimeClient({onOpen: ()=>events.push("open"), onClose: ()=>events.push("close"), onEvent: event=>events.push(event.type)});
  return {client, sockets, intervals, timeouts, events};
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
