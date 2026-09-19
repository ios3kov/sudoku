"use client";
import {FormEvent,useEffect,useState} from "react";
export function AuthGate({onHide}:{onHide:()=>void}){const[checking,setChecking]=useState(true);const[ok,setOk]=useState(false);const[error,setError]=useState("");
async function check(){try{const r=await fetch("/v1/me",{credentials:"include",cache:"no-store"});setOk(r.ok)}finally{setChecking(false)}}
useEffect(()=>{void check()},[]);
async function login(e:FormEvent<HTMLFormElement>){e.preventDefault();setError("");const fd=new FormData(e.currentTarget);const r=await fetch("/v1/auth/login",{method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({email:fd.get("email"),password:fd.get("password"),device_name:"Web PWA"})});if(r.ok){setOk(true)}else setError("Sign in failed")}
if(checking)return <main className="shell">Loading…</main>;
if(ok)return <main className="shell"><section className="card"><div className="top"><h2>Messages</h2><button className="action" onClick={onHide}>Hide</button></div><p>Secure session active. Conversation UI is the next vertical slice.</p></section></main>;
return <main className="shell"><form className="card auth" onSubmit={login}><div className="top"><h2>Sign in</h2><button type="button" className="action" onClick={onHide}>Hide</button></div><input name="email" type="email" autoComplete="username" required placeholder="Email"/><input name="password" type="password" autoComplete="current-password" required placeholder="Password"/>{error&&<p className="error">{error}</p>}<button className="action">Continue</button></form></main>}
