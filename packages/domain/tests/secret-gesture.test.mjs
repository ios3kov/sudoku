import test from "node:test";
import assert from "node:assert/strict";
import { armFromFive, beginSwipe, createGestureState, finishSwipe } from "../dist/secret-gesture.js";

test("press five then quick upward drag unlocks", () => {
  let state = armFromFive(createGestureState(), 1000);
  state = beginSwipe(state, { x: 100, y: 300 }, 1100);
  const result = finishSwipe(state, { x: 108, y: 190 }, 1350);
  assert.equal(result.unlocked, true);
});

test("ordinary horizontal movement does not unlock", () => {
  let state = armFromFive(createGestureState(), 1000);
  state = beginSwipe(state, { x: 100, y: 300 }, 1100);
  const result = finishSwipe(state, { x: 190, y: 200 }, 1350);
  assert.equal(result.unlocked, false);
});

test("expired arm window does not unlock", () => {
  let state = armFromFive(createGestureState(), 1000);
  state = beginSwipe(state, { x: 100, y: 300 }, 2300);
  const result = finishSwipe(state, { x: 100, y: 180 }, 2400);
  assert.equal(result.unlocked, false);
});
