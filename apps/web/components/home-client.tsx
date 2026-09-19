"use client";
import {useEffect,useRef,useState} from "react"; import {SudokuBoard} from "../features/sudoku/sudoku-board"; import {AuthGate} from "../features/messenger/auth-gate";
export function HomeClient(){const[privateMode,setPrivateMode]=useState(false);const hiddenAt=useRef<number|null>(null);
useEffect(()=>{const f=()=>{if(document.visibilityState==="hidden"){hiddenAt.current=Date.now();return}if(hiddenAt.current&&Date.now()-hiddenAt.current>=30000)setPrivateMode(false);hiddenAt.current=null};document.addEventListener("visibilitychange",f);return()=>document.removeEventListener("visibilitychange",f)},[]);
return privateMode?<AuthGate onHide={()=>setPrivateMode(false)}/>:<SudokuBoard onUnlock={()=>setPrivateMode(true)}/>;}
