export type CellValue=0|1|2|3|4|5|6|7|8|9;
export type Grid=readonly CellValue[];
export const CELL_COUNT=81;
export function parseGrid(s:string):CellValue[]{const c=s.replace(/\s+/g,"");if(c.length!==81)throw new Error("Expected 81 cells");return [...c].map(x=>x==="."||x==="0"?0:Number(x) as CellValue)}
export const rowOf=(i:number)=>Math.floor(i/9); export const colOf=(i:number)=>i%9;
export function peersOf(i:number){const r=rowOf(i),c=colOf(i),set=new Set<number>();for(let n=0;n<9;n++){set.add(r*9+n);set.add(n*9+c)}const br=Math.floor(r/3)*3,bc=Math.floor(c/3)*3;for(let y=br;y<br+3;y++)for(let x=bc;x<bc+3;x++)set.add(y*9+x);set.delete(i);return [...set]}
export const conflictsFor=(g:Grid,i:number,v:CellValue)=>v===0?[]:peersOf(i).filter(p=>g[p]===v);
export const isValidGrid=(g:Grid)=>g.length===81&&g.every((v,i)=>v===0||conflictsFor(g,i,v).length===0);
export const isSolved=(g:Grid,s:Grid)=>g.length===81&&g.every((v,i)=>v===s[i]);
export function candidatesFor(g:Grid,i:number){if(g[i]!==0)return[];const out:CellValue[]=[];for(let v=1;v<=9;v++)if(conflictsFor(g,i,v as CellValue).length===0)out.push(v as CellValue);return out}
