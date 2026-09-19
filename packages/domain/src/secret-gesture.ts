export interface Point { x:number; y:number }
export interface GestureState { armedUntil:number; start:(Point & {at:number}) | null }
export const createGestureState=():GestureState=>({armedUntil:0,start:null});
export const armFromFive=(s:GestureState,now:number):GestureState=>({armedUntil:now+1200,start:null});
export const beginSwipe=(s:GestureState,p:Point,now:number):GestureState=>now>s.armedUntil?createGestureState():{...s,start:{...p,at:now}};
export function finishSwipe(s:GestureState,p:Point,now:number){const a=s.start;if(!a||now>s.armedUntil)return{state:createGestureState(),unlocked:false};const dx=p.x-a.x,dy=p.y-a.y,d=now-a.at;return{state:createGestureState(),unlocked:d>=0&&d<=700&&dy<=-80&&Math.abs(dx)<=55};}
