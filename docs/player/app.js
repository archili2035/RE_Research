const $=id=>document.getElementById(id),ctx=$('view').getContext('2d'),clips=MOTION_DATA.clips.sort((a,b)=>a.bank-b.bank||a.id-b.id);
const CSS=getComputedStyle(document.documentElement),c=n=>CSS.getPropertyValue(n).trim();
const titles={120:'持枪移动 · 前',122:'持枪移动 · 左',124:'持枪移动 · 后',126:'持枪移动 · 右',140:'抬枪',160:'持枪循环',161:'放下枪',165:'持枪转向 · 左',167:'持枪转向 · 右',1100:'射击',1200:'换弹',1201:'换弹 · All 变体'};
const request=new URLSearchParams(location.search),embedded=request.get('embed')==='web-3c';
if(embedded)document.body.classList.add('web-3c-reference');
let clip,time=0,playing=!embedded,yaw=.6,pitch=.12,zoom=1,last=performance.now(),pose=[],drag=null;
let displayClip,firePreview;
function displayMotion(source){
  if(!embedded||source.bank!==100||source.id!==1100)return source;
  const hold=clips.find(c=>c.bank===100&&c.id===160);
  return firePreview??=MotionMath.previewOnBasePose(source,hold);
}
function list(){const query=$('search').value.toLowerCase();$('clips').replaceChildren();for(const c of clips){let label=titles[c.id]+(c.additive?' · 补偿':'');if(!(label+c.name+c.id).toLowerCase().includes(query))continue;let b=document.createElement('button');b.className='clip'+(c===clip?' active':'');b.innerHTML=`<span>${label}<small>${c.bank} / ${c.id} · ${c.frames} frames</small></span><em>${c.additive?'ADD':'MOT'}</em>`;b.onclick=()=>choose(c);$('clips').append(b);}}
function choose(c){displayClip=displayMotion(c);clip=c;time=0;$('title').textContent=titles[c.id]+(c.additive?' · 补偿':'');$('subtitle').textContent=c.name;$('kind').textContent=c.additive?'补偿轨道 · 单独预览':'原始动画 · 骨骼轨道';$('source').textContent=c.source;$('counts').textContent=`${c.bones.length} 骨骼 / ${c.tracks.length} 动画轨道`;$('warning').textContent=c.additive?'补偿片段仅显示骨架；未与基础姿态叠加，避免将增量轨道误用于模型。':'身体灰模使用源动画驱动，未执行布料、面部表情、IK、武器动画或游戏分层。遮罩选项仅着色骨架。';$('timeline').max=c.duration;if(!embedded)list();draw();}
function project(p,w,h){let x=p[0]*Math.cos(yaw)-p[2]*Math.sin(yaw),z=p[0]*Math.sin(yaw)+p[2]*Math.cos(yaw),y=p[1]-.9;let yy=y*Math.cos(pitch)-z*Math.sin(pitch),zz=y*Math.sin(pitch)+z*Math.cos(pitch);let f=4/(4+zz),s=Math.min(w*.35,h*.43)*zoom;return[w/2+x*s*f,h*.53-yy*s*f,zz];}
function draw(){if(!clip)return;let canvas=$('view'),w=canvas.clientWidth,h=canvas.clientHeight,dpr=window.devicePixelRatio||1;if(!w||!h)return;if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);const grad=ctx.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,w*.6);grad.addColorStop(0,c('--viewport-a'));grad.addColorStop(1,c('--viewport-b'));ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
function line(a,b,color,width){const A=project(a,w,h),B=project(b,w,h);ctx.beginPath();ctx.moveTo(A[0],A[1]);ctx.lineTo(B[0],B[1]);ctx.strokeStyle=color;ctx.lineWidth=width;ctx.lineCap='round';ctx.stroke();}
for(let i=-6;i<=6;i++){line([i*.25,0,-1.5],[i*.25,0,1.5],i===0?c('--grid-major'):c('--grid-minor'),1);line([-1.5,0,i*.25],[1.5,0,i*.25],i===0?c('--grid-major'):c('--grid-minor'),1);}
pose=MotionMath.pose(displayClip,time);const root=pose[0].p,points=pose.map(x=>x.p.map((v,j)=>v-($('follow').checked&&j!==1?root[j]:0)));let visible=displayClip.bones.map((b,i)=>({b,i,z:project(points[i],w,h)[2]})).filter(({b})=>$('fingers').checked||!(/Hand_(?!Palm)/.test(b.name))).filter(({b})=>$("helpers").checked||!(/Target|Cam|Wep|Ground|_IK/.test(b.name))).sort((a,b)=>b.z-a.z);
for(const {b,i} of visible){if(b.parent<0)continue;let color=b.name.startsWith('L_')?c('--bone-left'):b.name.startsWith('R_')?c('--bone-right'):c('--bone-center');const hand=/Hand_/.test(b.name),helper=/Target|Cam|Wep|Ground|_IK/i.test(b.name);const mask=MASK_DATA.find(m=>m.ID===Number($("mask").value));if(mask)color=mask.Joints.some(j=>j.Name===b.name)?c('--bone-mask'):c('--bone-dim');line(points[b.parent],points[i],helper?c('--bone-helper'):color,hand?2:helper?1:5);let p=project(points[i],w,h);ctx.beginPath();ctx.arc(p[0],p[1],hand?2:3.5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();if($('names').checked){ctx.fillStyle=c('--bone-label');ctx.font='9px Segoe UI';ctx.fillText(b.name,p[0]+5,p[1]-5);}}
const frame=Math.min(clip.frames,Math.round(time*clip.fps));
$('timeline').value=time;
$('time').textContent=embedded?`参考 ${time.toFixed(3)} s · ${frame} / ${clip.frames} 帧`:`${frame} / ${clip.frames} 帧  ·  ${time.toFixed(2)}s`;
$('play').textContent=playing?'暂停':'播放';
if(window.ModelView)ModelView.render(displayClip,time,yaw,pitch,zoom,pose);
if(displayClip!==clip)$('kind').textContent='单发叠加示意 · 基于持枪第 0 帧';
}
function advance(dt){if(playing){time+=dt*Number($('speed').value);if(time>=clip.duration){if($('loop').checked)time%=clip.duration;else{time=clip.duration;playing=false;}}}draw();}
function tick(now){if(!embedded||playing)advance(Math.min((now-last)/1000,.1));last=now;requestAnimationFrame(tick);}
function seekFrame(frame){
  playing=false;
  time=Math.min(clip.duration,Math.max(0,Math.min(clip.frames,frame))/clip.fps);
  draw();
}
function stepFrame(delta){
  if(embedded){seekFrame(Math.round(time*clip.fps)+delta);return;}
  playing=false;
  time=Math.max(0,Math.min(clip.duration,time+delta/clip.fps));
  draw();
}
$('play').onclick=()=>{if(time>=clip.duration)time=0;playing=!playing;draw();};
$('prev').onclick=()=>stepFrame(-1);
$('next').onclick=()=>stepFrame(1);
$('timeline').oninput=()=>{
  const selected=Number($('timeline').value);
  if(embedded){seekFrame(Math.round(selected*clip.fps));return;}
  playing=false;time=selected;draw();
};
$('search').oninput=list;$('reset').onclick=()=>{yaw=.6;pitch=.12;zoom=1;draw();};$('front').onclick=()=>{yaw=0;pitch=0;draw();};$('side').onclick=()=>{yaw=Math.PI/2;pitch=0;draw();};
$('view').onpointerdown=e=>{drag=[e.clientX,e.clientY];$('view').setPointerCapture(e.pointerId);};$('view').onpointermove=e=>{if(!drag)return;yaw+=(e.clientX-drag[0])*.008;pitch=Math.max(-1,Math.min(1,pitch+(e.clientY-drag[1])*.006));drag=[e.clientX,e.clientY];draw();};$('view').onpointerup=$('view').onpointercancel=()=>drag=null;$('view').addEventListener('wheel',e=>{e.preventDefault();zoom=Math.max(.3,Math.min(4,zoom*Math.exp(-e.deltaY*.001)));draw();},{passive:false});document.addEventListener('keydown',e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();$('play').click();}});
function selectClip(bank,id){
  const selected=clips.find(c=>c.bank===bank&&c.id===id);
  if(!selected)return false;
  playing=false;
  choose(selected);
  return true;
}
window.player={get clip(){return clip},get time(){return time},get playing(){return playing},get pose(){return pose},choose,advance,selectClip};
if(embedded){
  $('timeline').step='any';
  $('time').setAttribute('aria-label','参考动画时间');
  $('loop').checked=false;
  new ResizeObserver(draw).observe($('view'));
}
const requested=clips.find(c=>c.id===Number(request.get('motion'))&&c.bank===Number(request.get('bank')||100));
choose(requested||clips.find(c=>c.id===160&&!c.additive));
requestAnimationFrame(tick);


