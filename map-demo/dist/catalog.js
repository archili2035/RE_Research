(function(root){
const rect=(w,h)=>Array.from({length:w*h},(_,i)=>[i%w,Math.floor(i/w)]);
const shapes={S1:rect(2,2),S2:rect(2,3),S3:rect(3,3),S4:rect(3,4),S5:rect(4,4),S6:rect(4,4).filter(([x,y])=>!(x>=2&&y<2))};
const entries=[['R01','大堂','S3'],['R02','大堂','S5'],['R03','厨房','S4'],['R04','厨房','S6'],['R05','医疗室','S3'],['R06','医疗室','S4'],['R07','储藏室','S1'],['R08','储藏室','S2'],['R09','办公室','S3'],['R10','办公室','S6'],['R11','休息室','S3'],['R12','休息室','S4'],['R13','楼梯间','S2'],['R14','杂物间','S1']];
// Fixed, manufactured door positions: [insideX, insideY, direction], E/S/W/N = 0/1/2/3.
const dirs=[[1,0],[0,1],[-1,0],[0,-1]];
const fixedDoors={
 R01:[[0,1,2],[2,1,0],[1,2,1]], R02:[[0,1,2],[3,1,0],[1,3,1]],
 R03:[[0,1,2],[2,1,0]], R04:[[0,1,2],[3,2,0]],
 R05:[[0,1,2],[1,2,1]], R06:[[0,1,2],[2,1,0]],
 R07:[[0,1,1]], R08:[[0,2,1]], R09:[[0,1,2],[2,1,0]],
 R10:[[0,1,2],[2,3,1]], R11:[[0,1,2],[1,2,1]], R12:[[0,1,2],[2,1,0]],
 R13:[[0,0,3],[0,2,1]], R14:[[0,1,1]]
};
const rooms=entries.map(([id,type,shape])=>({id,type,shape,cells:shapes[shape],area:shapes[shape].length*4,doorCount:fixedDoors[id].length,ports:fixedDoors[id].map(([x,y,d],i)=>({id:'D'+(i+1),kind:'door',inside:[x,y],outside:[x+dirs[d][0],y+dirs[d][1]]}))}));
function variant(id,rotation=0){const m=[...rooms,...corridors].find(m=>m.id===id);if(!m||![0,90,180,270].includes(rotation))throw Error('未知模块或旋转角度');const turn=p=>{let [x,y]=p;for(let i=0;i<rotation/90;i++)[x,y]=[-y,x];return[x,y]};let raw=m.cells.map(turn),minX=Math.min(...raw.map(p=>p[0])),minY=Math.min(...raw.map(p=>p[1]));const normalize=p=>{let [x,y]=turn(p);return[x-minX,y-minY]};return{...m,rotation,enclosure:m.enclosure?.map(normalize),cells:m.cells.map(normalize),ports:m.ports.map(p=>({...p,inside:normalize(p.inside),outside:normalize(p.outside)}))}}
// Whole corridor prefabs. Grid cells describe geometry, never independent assets.
const makeCorridor=(id,name,cells,ends,purpose)=>({id,name,type:'通道',purpose,cells,area:cells.length*4,ports:ends.map(([x,y,d,kind='continuation'],i)=>({id:'P'+(i+1),kind,inside:[x,y],outside:[x+dirs[d][0],y+dirs[d][1]]}))});
const corridors=[
 makeCorridor('C01','短连接廊',rect(3,1),[[0,0,2],[2,0,0]],'近距离配平'),
 makeCorridor('C02','单侧门长廊',rect(7,1),[[0,0,2],[6,0,0],[3,0,1,'room']],'沿廊贴接房间'),
 makeCorridor('C03','错位双侧门长廊',rect(7,1),[[0,0,2],[6,0,0],[2,0,3,'room'],[4,0,1,'room']],'两侧错位布置房间'),
 makeCorridor('C04','不等臂转角廊',[...rect(5,1).map(([x,y])=>[x,2]),[4,1],[4,0]],[[0,2,2],[4,0,3]],'沿房间外缘转折'),
 makeCorridor('C05','错位折廊',[[0,2],[1,2],[2,2],[3,2],[3,1],[3,0],[4,0],[5,0],[6,0]],[[0,2,2],[6,0,3]],'错位与转向；端口相差 90°'),
 makeCorridor('C06','偏置分岔廊',[...rect(7,1),[5,1],[5,2],[5,3]],[[0,0,2],[6,0,0],[5,3,1]],'非对称主支路分流'),
 makeCorridor('C07','半包围回廊',[...rect(7,1),...[1,2,3,4].flatMap(y=>[[0,y],[6,y]])],[[0,4,1],[6,4,1],[3,0,1,'room']],'内侧必须贴接房间'),
 makeCorridor('C08','加宽转角前厅',[[0,2],[1,2],[2,2],[3,2],[2,1],[3,1],[2,0],[3,0]],[[0,2,2],[3,0,3],[3,1,0,'room']],'固定局部加宽与门前平台')
];
corridors.find(m=>m.id==='C07').enclosure=rect(5,4).map(([x,y])=>[x+1,y+1]);
root.ModuleCatalog={shapes,rooms,corridors,variant};if(typeof module!=='undefined')module.exports=root.ModuleCatalog;
})(globalThis);

