import test from "node:test";
import assert from "node:assert/strict";
import { buildTimeline, countNewIncoming, dayLabel, deliveryLabel, gestureIntent, SessionDrafts } from "../dist/messenger-ux.js";

const message = (id, senderId, sequence, createdAt) => ({id, senderId, sequence, createdAt});
const time = new Date(2026, 8, 21, 12, 0);
const at = (minutes) => new Date(time.getTime() + minutes * 60_000).toISOString();

test("groups consecutive same-sender messages within five minutes", () => {
 const items = [message("a", "alice", 1, at(0)), message("b", "alice", 2, at(5)), message("c", "bob", 3, at(6)), message("d", "alice", 4, at(7))];
 const result = buildTimeline(items);
 assert.deepEqual(result.get("a"), {groupStart:true,groupEnd:false,date:at(0)});
 assert.deepEqual(result.get("b"), {groupStart:false,groupEnd:true,date:null});
 assert.equal(result.get("c").groupStart,true);assert.equal(result.get("d").groupStart,true);
});
test("long gaps, reversed timestamps and deletions break groups", () => {
 for (const second of [message("b","alice",2,at(5.01)),message("b","alice",2,at(-1)),{...message("b","alice",2,at(1)),deleted:true}]) {
  assert.equal(buildTimeline([message("a","alice",1,at(0)),second]).get("b").groupStart,true);
 }
});
test("crossing a local day creates a separator even within a minute", () => {
 const first=new Date(2026,8,21,23,59,30);const second=new Date(first.getTime()+60_000);
 const result=buildTimeline([message("a","alice",1,first.toISOString()),message("b","alice",2,second.toISOString())]);
 assert.equal(result.get("b").date,second.toISOString());assert.equal(result.get("b").groupStart,true);
});
test("legacy, absent and invalid dates are never fabricated", () => {
 const result=buildTimeline([message("a","alice",1),message("b","alice",2,"not-a-date")]);
 for(const item of result.values()){assert.equal(item.date,null);assert.equal(item.groupStart,true);}
 assert.equal(dayLabel(undefined),null);assert.equal(dayLabel("invalid"),null);
});
test("day labels use local calendar days and retain actual older dates", () => {
 const now=new Date(2026,8,21,12);const yesterday=new Date(2026,8,20,10);
 assert.equal(dayLabel(now.toISOString(),now),"Today");
 assert.equal(dayLabel(yesterday.toISOString(),now),"Yesterday");
 assert.match(dayLabel(new Date(2025,0,1).toISOString(),now),/2025/);
});
test("status distinguishes server acceptance from real read receipts", () => {
 assert.equal(deliveryLabel(0,[99]),"Sending");assert.equal(deliveryLabel(3,[]),"Sent");
 assert.equal(deliveryLabel(3,[2,1]),"Sent");assert.equal(deliveryLabel(3,[3]),"Read");
 assert.equal(deliveryLabel(3,[3,1]),"Read by 1 of 2");assert.equal(deliveryLabel(3,[3,4]),"Read");
});
test("incoming count counts messages rather than sequence gaps, edits or own sends", () => {
 const items=[message("old","bob",2),message("mine","alice",90),message("new","bob",100)];
 assert.equal(countNewIncoming(2,items,"alice"),1);
 assert.equal(countNewIncoming(100,items,"alice"),0);
});
test("gesture intent ignores small jitter and rejects vertical, left and diagonal drags", () => {
 assert.equal(gestureIntent(5,6),"pending");assert.equal(gestureIntent(64,3),"reply");
 for(const [x,y] of [[0,50],[-80,1],[70,60],[15,11]])assert.equal(gestureIntent(x,y),"scroll");
});
test("drafts are isolated and empty value removes them", () => {
 const drafts=new SessionDrafts();drafts.set("a","first");drafts.set("b","second");
 assert.equal(drafts.get("a"),"first");assert.equal(drafts.get("b"),"second");drafts.set("a","");assert.equal(drafts.get("a"),"");
 const otherAccount=new SessionDrafts();assert.equal(otherAccount.get("b"),"");
 drafts.clear();assert.equal(drafts.get("b"),"");
});
test("draft store bounds text and uses least recently accessed eviction", () => {
 const drafts=new SessionDrafts(2);drafts.set("a","A");drafts.set("b","B");drafts.get("a");drafts.set("c","C");
 assert.equal(drafts.get("b"),"");assert.equal(drafts.get("a"),"A");
 drafts.set("a","x".repeat(21000));assert.equal(drafts.get("a").length,20000);
 for(const value of [0,-1,1.2,NaN])assert.throws(()=>new SessionDrafts(value));
});
