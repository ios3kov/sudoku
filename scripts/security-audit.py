#!/usr/bin/env python3
from __future__ import annotations
import argparse, ast, json, re, subprocess
from dataclasses import dataclass, asdict
from pathlib import Path

SKIP={".git","node_modules",".next","dist","build",".venv","venv","__pycache__","coverage","target"}
EXT={".py",".js",".jsx",".ts",".tsx",".mjs",".cjs",".rs",".swift",".sh",".sql",".json",".yml",".yaml",".toml",".ini",".cfg",".md",".txt",".env"}
SECRET={
"openai":re.compile(r"\bsk-(?!ant-)[A-Za-z0-9_-]{20,}\b"),
"anthropic":re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}\b"),
"aws":re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
"github":re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b"),
"stripe":re.compile(r"\bsk_live_[A-Za-z0-9]{20,}\b"),
"pem":re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
}
GENERIC=re.compile(r"""(?ix)\b(api[_-]?key|secret|password|token|private[_-]?key)\b\s*[:=]\s*["']?([A-Za-z0-9_./+=:@-]{20,})["']?""")
PLACEHOLDER=re.compile(r"(?i)(replace|example|dummy|changeme|generate|test|localhost|sudoku-ci|ci-secret|not-a-secret)")

@dataclass
class Finding:
    id:str; severity:str; path:str; line:int; detail:str; fix:str

def add(out,id,sev,path,line,detail,fix): out.append(Finding(id,sev,path,line,detail,fix))
def line_of(s,p): return s.count("\n",0,p)+1
def mask(s): return s[:6]+"…"+s[-2:] if len(s)>10 else "***"

def files(root):
    for p in root.rglob("*"):
        if p.is_symlink() or not p.is_file() or any(x in SKIP for x in p.parts): continue
        if p.stat().st_size>2_000_000: continue
        if p.suffix.lower() not in EXT and not p.name.startswith(".env"): continue
        try: yield p.relative_to(root).as_posix(),p.read_text(encoding="utf-8",errors="ignore")
        except OSError: pass

def git(root,*args):
    r=subprocess.run(["git","-c","core.hooksPath=/dev/null","-c","core.fsmonitor=false","-C",str(root),*args],
                     capture_output=True,text=True,timeout=120,check=False)
    return r.stdout if r.returncode==0 else ""

def check_secrets(root,fs,out,history):
    for path,text in fs.items():
        for name,rx in SECRET.items():
            for m in rx.finditer(text):
                v=m.group(0)
                if not PLACEHOLDER.search(v):
                    add(out,"secret."+name,"critical",path,line_of(text,m.start()),"Potential live secret "+mask(v),"Rotate and move to runtime secret storage.")
        for m in GENERIC.finditer(text):
            v=m.group(2)
            if not PLACEHOLDER.search(v):
                add(out,"secret.generic","high",path,line_of(text,m.start()),"Hard-coded secret-like value "+mask(v),"Move to secret storage and rotate if exposed.")
    tracked=set(git(root,"ls-files").splitlines())
    for path in tracked:
        n=Path(path).name
        if n.startswith(".env") and not n.endswith((".example",".sample")):
            add(out,"git.env","critical",path,1,"Tracked environment file","Remove from Git and rotate contained credentials.")
    if ".env" not in fs.get(".gitignore",""):
        add(out,"git.envignore","medium",".gitignore",1,".env is not ignored","Ignore .env and .env.* except examples.")
    if history:
        patch=git(root,"log","--all","--format=","-p","--no-ext-diff","--no-textconv")
        for name,rx in SECRET.items():
            for m in rx.finditer(patch):
                ls=patch.rfind("\n",0,m.start())+1
                v=m.group(0)
                if patch[ls:m.start()].startswith("+") and not PLACEHOLDER.search(v):
                    add(out,"history.secret."+name,"critical","git-history",0,"Secret-like value remains in history "+mask(v),"Rotate immediately; rewrite history if required.")

def route_decorators(fn):
    out=[]
    for d in getattr(fn,"decorator_list",[]):
        if isinstance(d,ast.Call) and isinstance(d.func,ast.Attribute) and d.func.attr.lower() in {"get","post","put","patch","delete","websocket"}:
            path=d.args[0].value if d.args and isinstance(d.args[0],ast.Constant) and isinstance(d.args[0].value,str) else ""
            out.append((d.func.attr.lower(),path))
    return out

def segment(text,node):
    lines=text.splitlines()
    return "\n".join(lines[node.lineno-1:getattr(node,"end_lineno",node.lineno)])

def check_routes(fs,out):
    for path,text in fs.items():
        if not(path.startswith("apps/api/") and path.endswith(".py")): continue
        try: tree=ast.parse(text)
        except SyntaxError: continue
        pm=re.search(r"""APIRouter\s*\(\s*prefix\s*=\s*["']([^"']+)["']""",text)
        prefix=pm.group(1) if pm else ""
        for fn in [n for n in ast.walk(tree) if isinstance(n,(ast.FunctionDef,ast.AsyncFunctionDef))]:
            decos=route_decorators(fn)
            if not decos: continue
            seg=segment(text,fn)
            auth="Depends(get_auth_context)" in seg or "Depends(get_session_context)" in seg
            rate=any(x in seg for x in ("enforce_login_rate_limit(","enforce_user_rate_limit(","enforce_ip_rate_limit("))
            for method,route in decos:
                absolute=(prefix+route) if route.startswith("/") else route
                full=(absolute+" "+fn.name).lower()
                if method=="websocket":
                    if "origin" not in seg.lower():
                        add(out,"route.websocket-origin","high",path,fn.lineno,"WebSocket lacks obvious origin enforcement","Require exact PUBLIC_ORIGIN before accept.")
                    continue
                public=any(x in full for x in ("health","login","accept_invite","assetlinks"))
                if absolute.startswith("/v1/") and not public and not auth:
                    add(out,"route.auth","high",path,fn.lineno,method.upper()+" "+absolute+" lacks obvious auth dependency","Use session/PIN dependency and object ownership checks.")
                sensitive=any(x in full for x in ("login","unlock","invite","search","upload","send","message","contact","push","biometric","pin"))
                if sensitive and method in {"post","put","patch","delete"} and not rate:
                    add(out,"route.rate-limit","medium",path,fn.lineno,method.upper()+" "+(absolute or fn.name)+" has no local rate limit","Add user/IP/account bucket or documented shared guard.")

def check_sinks(fs,out):
    for path,text in fs.items():
        if path.startswith("apps/web/"):
            for m in re.finditer(r"https?://api\.(?:openai|anthropic|stripe)\.com",text,re.I):
                add(out,"client.paid-api","critical",path,line_of(text,m.start()),"Paid API called from browser","Proxy through authenticated server.")
            for m in re.finditer(r"(NEXT_PUBLIC_|VITE_|REACT_APP_)[A-Z0-9_]*(SECRET|PRIVATE|TOKEN|PASSWORD|KEY)",text):
                add(out,"client.public-secret","critical",path,line_of(text,m.start()),"Browser-exposed secret-like env name","Keep secrets server-side.")
            for m in re.finditer(r"\b(?:localStorage|sessionStorage)\b",text):
                lo=max(0,m.start()-240); hi=min(len(text),m.end()+240)
                context=text[lo:hi].lower()
                if re.search(r"\b(token|secret|private[_-]?key|pin|unlock|mls|crypto[_-]?state|session[_-]?key)\b",context):
                    add(out,"client.crypto-webstorage","high",path,line_of(text,m.start()),"Sensitive security state may touch Web Storage","Do not persist raw secrets, unlock capabilities or MLS state in local/session storage.")
        if path.endswith(".py"):
            for id,sev,rx,fix in (
                ("python.eval","critical",re.compile(r"(?<![\w.])(?:eval|exec)\s*\("),"Remove dynamic code execution."),
                ("python.shell","high",re.compile(r"subprocess\.(?:run|Popen|call|check_output)\([^\n]*shell\s*=\s*True"),"Use argv arrays and shell=False."),
                ("python.os-system","high",re.compile(r"\bos\.system\s*\("),"Use subprocess with fixed argv."),
                ("python.pickle","high",re.compile(r"\bpickle\.loads?\s*\("),"Never load untrusted pickle data."),
            ):
                for m in rx.finditer(text): add(out,id,sev,path,line_of(text,m.start()),m.group(0)[:100],fix)

def check_invariants(fs,out):
    compose=fs.get("compose.production.yaml","")
    caddy=fs.get("infra/caddy/Caddyfile.production","")
    config=fs.get("apps/api/app/config.py","")
    middleware=fs.get("apps/api/app/middleware.py","")
    security=fs.get("apps/api/app/security.py","")
    obs=fs.get("apps/api/app/observability.py","")
    if 'REQUIRE_E2EE_NEW_CONVERSATIONS: "true"' not in compose:
        add(out,"invariant.e2ee-prod","critical","compose.production.yaml",1,"Production E2EE gate missing","Force E2EE for new conversations.")
    for h in ("Strict-Transport-Security","Content-Security-Policy","X-Content-Type-Options","X-Frame-Options","Referrer-Policy"):
        if h not in caddy: add(out,"invariant.header","high","infra/caddy/Caddyfile.production",1,"Missing "+h,"Restore production security header.")
    csp=re.search(r'Content-Security-Policy\s+"([^"]+)"',caddy)
    if csp and "script-src" in csp.group(1) and "'unsafe-inline'" in csp.group(1):
        add(out,"invariant.csp-unsafe-inline","medium","infra/caddy/Caddyfile.production",1,"CSP allows unsafe-inline scripts","Prefer nonce/hash-based Next.js scripts; keep this as a reviewed exception only if required.")
    if "origin != self.expected_origin" not in middleware:
        add(out,"invariant.same-origin","critical","apps/api/app/middleware.py",1,"Exact-origin mutation gate missing","Require exact PUBLIC_ORIGIN.")
    if "secure_cookies: bool = Field(default=True" not in config:
        add(out,"invariant.secure-cookie","high","apps/api/app/config.py",1,"Secure cookie default missing","Default Secure cookies on.")
    if "secrets.token_urlsafe" not in security or "PasswordHasher" not in security:
        add(out,"invariant.auth-primitives","critical","apps/api/app/security.py",1,"Expected CSPRNG/Argon2 primitives missing","Use CSPRNG sessions and Argon2id.")
    if "_redact_sensitive" not in obs or 'logging.getLogger("uvicorn.access").disabled = True' not in obs:
        add(out,"invariant.logging","high","apps/api/app/observability.py",1,"Expected log privacy controls missing","Keep bodies/secrets out of access logs and redact keys.")

def reports(out,md,jp):
    rank={"critical":0,"high":1,"medium":2,"info":3}
    uniq={(f.id,f.path,f.line,f.detail):f for f in out}
    out=sorted(uniq.values(),key=lambda f:(rank.get(f.severity,9),f.path,f.line,f.id))
    counts={k:sum(f.severity==k for f in out) for k in rank}
    data={"summary":{"total":len(out),**counts},"findings":[asdict(f) for f in out]}
    jp.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    lines=["# Sudoku security audit","",f"**{len(out)} findings — critical {counts['critical']}, high {counts['high']}, medium {counts['medium']}, info {counts['info']}**",""]
    for f in out:
        lines += ["## ["+f.severity.upper()+"] "+f.id,"- Where: "+f.path+":"+str(f.line),"- Finding: "+f.detail,"- Fix: "+f.fix,""]
    if not out: lines.append("No deterministic findings. This is not proof of security.")
    md.write_text("\n".join(lines)+"\n",encoding="utf-8")
    return counts

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("path",nargs="?",default=".")
    ap.add_argument("--report",default="security-audit-report.md")
    ap.add_argument("--json",default="security-audit-report.json")
    ap.add_argument("--no-history",action="store_true")
    a=ap.parse_args(); root=Path(a.path).resolve(); fs=dict(files(root)); out=[]
    check_secrets(root,fs,out,not a.no_history); check_routes(fs,out); check_sinks(fs,out); check_invariants(fs,out)
    c=reports(out,root/a.report,root/a.json)
    print(json.dumps({"summary":{"total":sum(c.values()),**c}},ensure_ascii=False))
    raise SystemExit(2 if c["critical"] or c["high"] else (1 if c["medium"] else 0))

if __name__=="__main__": main()
