(function(root){
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
function slerp(a,b,t){let dot=a.reduce((s,v,i)=>s+v*b[i],0);if(dot<0){b=b.map(v=>-v);dot=-dot;}if(dot>.9995){const q=lerp(a,b,t),n=Math.hypot(...q);return q.map(v=>v/n);}const theta=Math.acos(Math.min(1,dot)),s=Math.sin(theta);return a.map((v,i)=>(v*Math.sin((1-t)*theta)+b[i]*Math.sin(t*theta))/s);}
function sample(track,t,fallback,rotation=false){if(!track)return fallback;const {times,values}=track;if(t<=times[0])return values[0];if(t>=times.at(-1))return values.at(-1);let lo=0,hi=times.length-1;while(hi-lo>1){let m=(lo+hi)>>1;if(times[m]<=t)lo=m;else hi=m;}const u=(t-times[lo])/(times[hi]-times[lo]);return (rotation?slerp:lerp)(values[lo],values[hi],u);}
function mul(a,b){const[x,y,z,w]=a,[X,Y,Z,W]=b;return[w*X+x*W+y*Z-z*Y,w*Y-x*Z+y*W+z*X,w*Z+x*Y-y*X+z*W,w*W-x*X-y*Y-z*Z];}
function rotate(q,v){const[x,y,z,w]=q,[a,b,c]=v,tx=2*(y*c-z*b),ty=2*(z*a-x*c),tz=2*(x*b-y*a);return[a+w*tx+y*tz-z*ty,b+w*ty+z*tx-x*tz,c+w*tz+x*ty-y*tx];}
function pose(clip,t){const map=new Map(clip.tracks.map(x=>[x.bone,x])),out=[],visiting=new Set();function build(i){if(out[i])return out[i];if(visiting.has(i))throw Error('Skeleton cycle');visiting.add(i);const b=clip.bones[i],tr=map.get(i),p=sample(tr?.position,t,b.position),q=sample(tr?.rotation,t,b.rotation,true),s=sample(tr?.scale,t,[1,1,1]);if(b.parent<0)out[i]={p,q,s};else{const par=build(b.parent),r=rotate(par.q,p.map((v,j)=>v*par.s[j]));out[i]={p:r.map((v,j)=>v+par.p[j]),q:mul(par.q,q),s:s.map((v,j)=>v*par.s[j])};}visiting.delete(i);return out[i];}clip.bones.forEach((_,i)=>build(i));return out;}
root.MotionMath={sample,slerp,mul,rotate,pose};if(typeof module!=='undefined')module.exports=root.MotionMath;
})(globalThis);
