import type { ActionState, GameEvent } from './contracts.ts';
import type { LeonAssets } from './leon-view.ts';

const bank = 100;
const clips = {
  hold: { id: 160, name: '持枪' },
  raise: { id: 140, name: '举枪' },
  fire: { id: 1100, name: '单发' },
  reload: { id: 1200, name: '换弹' },
} as const;
type Clip = keyof typeof clips;

const markers = {
  raise: { label: '举枪', clip: 'raise' },
  fired: { label: '开火', clip: 'fire' },
  spent: { label: '扣弹', clip: 'fire' },
  refilled: { label: '补弹', clip: 'reload' },
} as const;
type Marker = keyof typeof markers;
type Player = { selectClip(bank: number, id: number): boolean };

export function bindReferenceView() {
  const select = document.querySelector<HTMLSelectElement>('#reference-clip')!;
  const follow = document.querySelector<HTMLInputElement>('#reference-follow')!;
  const frame = document.querySelector<HTMLIFrameElement>('#reference-view')!;
  const status = document.querySelector<HTMLElement>('#reference-status')!;
  const eventList = document.querySelector<HTMLElement>('#reference-events')!;
  const times = new Map<Marker, GameEvent>();
  const buttons = new Map<Marker, HTMLButtonElement>();
  let player: Player | undefined;
  let latestClip: Clip = 'hold';
  let pending = false;
  let restartClip = false;

  for (const id of Object.keys(clips) as Clip[]) {
    const { name, id: motion } = clips[id];
    select.add(new Option(`${name} · ${bank}/${motion}`, id));
  }

  function selectClip(clip: Clip) {
    if (player?.selectClip(bank, clips[clip].id)) select.value = clip;
  }

  function showBookmarks() {
    for (const [key, button] of buttons) {
      const event = times.get(key);
      if (!event) continue;
      button.dataset.timeS = String(event.timeS);
      button.dataset.tick = String(event.tick);
      button.dataset.order = String(event.order);
      const ammo = event.type === 'ammo.committed' ? ` · ${event.magazine}/${event.reserve}` : '';
      button.textContent = `${markers[key].label} ${event.timeS.toFixed(3)} s · ${event.tick}.${event.order}${ammo}`;
      button.disabled = !player;
    }
  }

  for (const key of Object.keys(markers) as Marker[]) {
    const { label, clip } = markers[key];
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = `${label} —`;
    button.dataset.event = key;
    button.disabled = true;
    button.addEventListener('click', () => {
      follow.checked = false;
      selectClip(clip);
    });
    buttons.set(key, button);
    eventList.append(button);
  }
  select.addEventListener('change', () => {
    follow.checked = false;
    selectClip(select.value as Clip);
  });
  follow.addEventListener('change', () => {
    if (follow.checked) selectClip(latestClip);
  });

  function unavailable(message: string) {
    frame.hidden = true;
    status.hidden = false;
    status.textContent = message;
  }

  async function connect(): Promise<LeonAssets | undefined> {
    const local = ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
    // 本地开发走 Vite 中间件；线上部署引用门户上已有的里昂播放器
    const url = local
      ? new URL('./__re9-reference/player_index.html?embed=web-3c', document.baseURI)
      : new URL('../player_index.html?embed=web-3c', document.baseURI);
    if (local) {
      try {
        const response = await fetch(url, { method: 'HEAD' });
        if (!response.ok || response.headers.get('X-RE9-Reference') !== '1') {
          unavailable('本地参考素材未提供。可在仓库内通过 Vite 启动对照。');
          return;
        }
      } catch {
        unavailable('无法连接本地参考播放器。');
        return;
      }
    }
    try {
      return await new Promise<LeonAssets | undefined>((resolve) => {
        frame.addEventListener('load', () => {
          const embedded = frame.contentWindow as (Window & Partial<LeonAssets> & { player?: Player; ModelView?: unknown }) | null;
          const ready = embedded?.MOTION_DATA && embedded.MODEL_DATA &&
            typeof embedded.LeonSkinning?.create === 'function' && typeof embedded.MotionMath?.sample === 'function';
          resolve(ready ? embedded as Window & LeonAssets : undefined);
          if (!embedded?.ModelView || typeof embedded.player?.selectClip !== 'function') {
            unavailable('参考播放器加载失败，请检查本地素材与 WebGL。');
            return;
          }
          player = embedded.player;
          frame.hidden = false;
          status.hidden = true;
          select.disabled = follow.disabled = false;
          if (follow.checked) selectClip(latestClip);
          showBookmarks();
        }, { once: true });
        frame.src = url.href;
        frame.hidden = false;
      });
    } catch {
      unavailable('无法连接参考播放器。');
    }
  }

  return {
    assets: connect(),
    record(previous: ActionState, events: readonly GameEvent[]) {
      if (events.length === 0) return;
      let magazine = previous.magazine;
      let match: Clip | undefined;
      const bookmark = (marker: Marker, event: GameEvent) => {
        times.set(marker, event);
        match = markers[marker].clip;
      };
      for (const event of events) {
        if (event.subjectId !== previous.id) continue;
        switch (event.type) {
          case 'action.accepted':
            if (event.action === 'raise') bookmark('raise', event);
            if (event.action === 'fire' || event.action === 'reload') match = event.action;
            if (event.action === 'raise' || event.action === 'fire' || event.action === 'reload') restartClip = true;
            break;
          case 'weapon.fired':
            bookmark('fired', event);
            break;
          case 'ammo.committed':
            if (event.magazine < magazine) bookmark('spent', event);
            if (event.magazine > magazine) bookmark('refilled', event);
            magazine = event.magazine;
            break;
        }
      }
      if (!match) return;
      latestClip = match;
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        const restart = restartClip;
        restartClip = false;
        showBookmarks();
        if (follow.checked && (restart || select.value !== latestClip)) selectClip(latestClip);
      });
    },
  };
}
