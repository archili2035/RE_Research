import { STEP_S } from './contracts.ts';
import type { ActionState, GameEvent } from './contracts.ts';

const FEEDBACK_TICKS = Math.ceil(1 / STEP_S);

export function createHud(viewport: HTMLElement) {
  const ammo = viewport.querySelector<HTMLOutputElement>('#ammo')!;
  const hint = viewport.querySelector<HTMLParagraphElement>('#door-hint')!;
  const feedback = viewport.querySelector<HTMLParagraphElement>('#scene-feedback')!;
  let message = '';
  let showUntil = 0;

  return {
    update(tick: number, state: ActionState, events: readonly GameEvent[], doorPrompt: string) {
      const counts = `${state.magazine} / ${state.reserve}`;
      if (ammo.value !== counts) ammo.value = counts;
      if (hint.textContent !== doorPrompt) hint.textContent = doorPrompt;
      for (const event of events) {
        if (event.type === 'door.changed') {
          message = event.open ? '门已打开' : '门已关闭';
        } else if (event.type === 'target.hit') {
          message = '命中练习靶';
        } else {
          continue;
        }
        showUntil = tick + FEEDBACK_TICKS;
      }
      const visible = tick < showUntil ? message : '';
      if (feedback.textContent !== visible) feedback.textContent = visible;
    },
  };
}
