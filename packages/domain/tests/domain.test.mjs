import test from "node:test"; import assert from "node:assert/strict";
import {parseGrid,isValidGrid,isSolved,candidatesFor,createGestureState,armFromFive,beginSwipe,finishSwipe} from "../dist/index.js";
const p=parseGrid("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79");
const s=parseGrid("534678912672195348198342567859761423426853791713924856961537284287419635345286179");
test("puzzle valid",()=>assert.equal(isValidGrid(p),true));
test("solution",()=>assert.equal(isSolved(s,s),true));
test("candidates",()=>assert.deepEqual(candidatesFor(p,2),[1,2,4]));
test("gesture unlock",()=>{let g=armFromFive(createGestureState(),1000);g=beginSwipe(g,{x:100,y:300},1100);assert.equal(finishSwipe(g,{x:105,y:190},1300).unlocked,true)});
test("horizontal rejected",()=>{let g=armFromFive(createGestureState(),1000);g=beginSwipe(g,{x:100,y:300},1100);assert.equal(finishSwipe(g,{x:200,y:190},1300).unlocked,false)});
