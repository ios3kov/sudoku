"use client";
import {useMemo,useState} from "react"; import {armFromFive,beginSwipe,createGestureState,finishSwipe,parseGrid,type CellValue} from "@sudoku/domain";
const puzzle=parseGrid("53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79");
export function SudokuBoard({onUnlock}:{onUnlock:()=>void}){const[grid,setGrid]=useState([...puzzle]);const[selected,setSelected]=useState<number|null>(null);const[gesture,setGesture]=useState(createGestureState());const givens=useMemo(()=>puzzle.map(Boolean),[]);
function put(v:CellValue){if(selected===null||givens[selected])return;setGrid(g=>g.map((x,i)=>i===selected?v:x))}
return <main className="shell"><section className="card"><h1>Sudoku</h1><div className="grid" onPointerDown={e=>setGesture(g=>beginSwipe(g,{x:e.clientX,y:e.clientY},performance.now()))} onPointerUp={e=>{const r=finishSwipe(gesture,{x:e.clientX,y:e.clientY},performance.now());setGesture(r.state);if(r.unlocked)onUnlock()}}>
{grid.map((v,i)=><button key={i} className={"cell "+(givens[i]?"given ":"")+(selected===i?"selected":"")} onClick={()=>{setSelected(i);if(v===5)setGesture(g=>armFromFive(g,performance.now()))}}>{v||""}</button>)}</div>
<div className="digits">{([1,2,3,4,5,6,7,8,9] as CellValue[]).map(v=><button key={v} onClick={()=>put(v)}>{v}</button>)}</div></section></main>}
