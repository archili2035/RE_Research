import type { LevelDefinition } from '../contracts.ts';
import { testRoom } from '../level.ts';

interface Playfield {
  readonly id: string;
  readonly name: string;
  readonly heading?: string;
  readonly route: string;
  load(): LevelDefinition | Promise<LevelDefinition>;
}

export const defaultPlayfield: Playfield = {
  id: 'test-room',
  name: '走廊测试场',
  route: '从储藏室进入走廊，沿路左转。走廊右墙有练习靶，尽头可开门进入杂物间。',
  load: () => testRoom,
};

export const playfields: readonly Playfield[] = [
  defaultPlayfield,
  {
    id: 'm3',
    name: '碰撞测试场',
    route: '沿中线穿过门框，直行上低台阶。偏离中线可测试门柱阻挡，穿门后右移可测试高台阶。',
    load: async () => (await import('../../fixtures/m3-greybox.json')).default as LevelDefinition,
  },
  {
    id: 'rhodes',
    name: '疗养院大堂（RE9 白盒）',
    heading: '罗兹山疗养院 · 中央大堂到警卫室',
    route: '从 2 楼回廊出发，沿东侧楼梯下到平台，再走弧形楼梯到中央大堂。往南穿过回廊下方，在西墙门前按 E 进入警卫室；西南台阶通往投药室。大堂南端有练习靶。',
    load: async () => (await import('./rhodes-1f.json')).default as LevelDefinition,
  },
];
