(function(root){
'use strict';
const Catalog=root.ModuleCatalog||(typeof require==='function'?require('./catalog.js'):null);
const dirs=[[1,0],[0,1],[-1,0],[0,-1]], k=(x,y)=>x+','+y;
function build(c,attempt=0){
 c={...c};delete c.loops;
 const fail=m=>{throw Error(m)},integer=(v,a,b,n)=>{if(!Number.isInteger(v)||v<a||v>b)fail(n+' 必须为 '+a+'–'+b+' 的整数')};
 integer(c.explore,0,16,'探索房间');integer(c.reward,0,4,'奖励房间');integer(c.stairs,1,2,'楼梯组数');
 if(!Number.isFinite(c.minArea)||!Number.isFinite(c.maxArea)||c.minArea<16||c.maxArea>64||c.minArea>c.maxArea)fail('房间面积需满足 16 ≤ 下限 ≤ 上限 ≤ 64');
 const n=10+c.explore+c.reward;
 if(!Number.isFinite(c.totalMin)||!Number.isFinite(c.totalMax)||c.totalMin>c.totalMax)fail('总面积上下限无效');
 if(c.minArea>24||c.maxArea<24)fail('固定楼梯间 R13 为 24 m²，单房间面积范围必须包含 24');
 let h=2166136261;for(const ch of c.seed+(attempt?'|layout-'+attempt:''))h=Math.imul(h^ch.charCodeAt(0),16777619);const rand=()=>{h+=0x6D2B79F5;let t=h;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296};const pick=a=>a[Math.floor(rand()*a.length)],ri=(a,b)=>a+Math.floor(rand()*(b-a+1));const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=ri(0,i);[a[i],a[j]]=[a[j],a[i]]}return a};
 const stairCount=2*c.stairs,remainingCount=n-stairCount,types=[...new Set(Catalog.rooms.map(m=>m.type))],rules=new Map();
 for(const t of c.types){if(!types.includes(t.name)||rules.has(t.name))fail('未知或重复房间类别：'+t.name);integer(t.min,0,30,t.name+'下限');integer(t.max,t.min,30,t.name+'上限');rules.set(t.name,t)}
 if(rules.has('楼梯间')){const t=rules.get('楼梯间');if(stairCount<t.min||stairCount>t.max)fail('楼梯间数量必须等于楼梯组数 × 2')}
 const allowed=Catalog.rooms.filter(m=>m.type!=='楼梯间'&&m.area>=c.minArea&&m.area<=c.maxArea),categories=types.filter(t=>t!=='楼梯间'),layers=[new Map([[0,null]])];
 // Exact dynamic programming over category count and discrete area. No stretching or random false rejection.
 for(let ci=0;ci<categories.length;ci++){const name=categories[ci],rule=rules.get(name)||{min:0,max:remainingCount},mods=allowed.filter(m=>m.type===name),options=[],combos=[new Map([[0,[]]])];if(rule.min>0&&!mods.length)fail(name+' 没有符合面积范围的固定模块');for(let count=1;count<=Math.min(rule.max,remainingCount);count++){const level=new Map();for(const [area,ids] of combos[count-1])for(const mod of shuffle([...mods]))if(!level.has(area+mod.area/4))level.set(area+mod.area/4,[...ids,mod.id]);combos.push(level)}for(let count=rule.min;count<combos.length;count++)for(const [area,ids] of combos[count])options.push({count,area,ids,singles:mods[0]?.doorCount===1?count:0});shuffle(options);const next=new Map();for(const [prev] of layers.at(-1)){const count=Math.floor(prev/1000000),singles=Math.floor(prev%1000000/10000),area=prev%10000;for(const o of options){const nc=count+o.count,ns=singles+o.singles,na=area+o.area;if(nc>remainingCount||ns>c.explore+c.reward||(na+stairCount*6)*4>c.totalMax)continue;const code=nc*1000000+ns*10000+na;if(!next.has(code))next.set(code,{prev,option:o})}}layers.push(next)}
 const targets=[...layers.at(-1).keys()].filter(code=>Math.floor(code/1000000)===remainingCount&&Math.floor(code%1000000/10000)>=c.reward&&(code%10000+stairCount*6)*4>=c.totalMin);if(!targets.length)fail('固定模块无法同时满足主路双门、奖励单门、类型数量与总面积，请调整规则');let cursor=pick(targets),pool=[];for(let i=categories.length;i>0;i--){const entry=layers[i].get(cursor);pool.push(...entry.option.ids);cursor=entry.prev}shuffle(pool);const single=pool.filter(id=>Catalog.rooms.find(m=>m.id===id).doorCount===1),multi=pool.filter(id=>Catalog.rooms.find(m=>m.id===id).doorCount>1),moduleIds=Array(n);for(let i=0;i<10;i++)moduleIds[i]=i===4||i===5||(c.stairs===2&&(i===0||i===9))?'R13':multi.pop();for(let i=10;i<10+c.reward;i++)moduleIds[i]=single.pop();const extra=shuffle([...single,...multi]);for(let i=10+c.reward;i<n;i++)moduleIds[i]=extra.pop();const variants=moduleIds.map(id=>Catalog.variant(id,ri(0,3)*90));variants[5]=Catalog.variant('R13',variants[4].rotation);if(c.stairs===2)variants[9]=Catalog.variant('R13',variants[0].rotation);
 return (root.ModularLayout||(typeof require==='function'?require('./modular-layout.js'):null)).layout(Catalog,c,moduleIds,rand,attempt);
}

function generate(c){let last,best=null,successes=0;for(let attempt=0;attempt<256;attempt++){try{const m=build(c,attempt);const score=m.corridorArea+m.bounds.w*m.bounds.h*.35+m.unservedLoopArea*50+m.longestEmptyRun*25+Math.max(...m.directGroups.map(g=>g.length))**2*30;if(!best||score<best.score)best={map:m,score};successes++;if(successes>=12)break}catch(e){last=e;if(!/模块布局：/.test(e.message))throw e}}if(best){best.map.layoutCandidates=successes;return best.map}throw Error(last.message+'（已尝试 256 个确定性布局）')}
root.MapGenerator={generate};if(typeof module!=='undefined')module.exports={generate};
})(globalThis);

