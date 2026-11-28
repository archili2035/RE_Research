import { CONTRACT_VERSION, STEP_S } from './contracts.ts';
import type { FeelConfig, GameEvent, ReplayTrace } from './contracts.ts';
import { createSimulation } from './simulation.ts';
import type { SimulationStages } from './simulation.ts';
import type { createTestRoom } from './level.ts';

export function createRoutePlayback(
  route: ReplayTrace, room: Awaited<ReturnType<typeof createTestRoom>>,
  feel: FeelConfig, publish: SimulationStages['publish'],
) {
  if (route.version !== CONTRACT_VERSION || route.stepS !== STEP_S ||
      route.level.id !== room.level.id || route.level.version !== room.level.version) {
    throw new Error('回放版本、固定步长或关卡版本不匹配');
  }
  if (route.inputs.length === 0 || route.inputs.some((input, index) => input.tick !== index + 1)) {
    throw new Error('回放输入必须从第 1 步连续排列');
  }

  const events: GameEvent[] = [];
  const stages: SimulationStages = {
    ...room.stages,
    sampleInput: (tick) => route.inputs[tick - 1],
    publish: (snapshot, input, batch) => {
      events.push(...batch);
      room.syncView(snapshot.tick);
      publish(snapshot, input, batch);
    },
  };
  let state = room.reset(feel);
  let step = createSimulation(state, room.queries, stages);
  // Keyframes every SNAPSHOT_TICKS steps let seek() jump without replaying from the spawn.
  const SNAPSHOT_TICKS = 60;
  let keyframes = new Map([[0, { state, room: room.snapshot(), events: 0 }]]);

  return {
    get state() { return state; },
    get done() { return state.tick === route.inputs.length; },
    step() {
      if (state.tick < route.inputs.length) {
        state = step();
        if (state.tick % SNAPSHOT_TICKS === 0 && !keyframes.has(state.tick)) {
          keyframes.set(state.tick, { state, room: room.snapshot(), events: events.length });
        }
      }
      return state;
    },
    /** Restores the nearest earlier keyframe and steps forward to the requested tick. Publishes the replayed steps. */
    seek(tick: number) {
      const target = Math.max(0, Math.min(route.inputs.length, Math.floor(tick)));
      const from = Math.max(...[...keyframes.keys()].filter((key) => key <= target));
      const frame = keyframes.get(from)!;
      room.restore(frame.room);
      state = frame.state;
      events.length = frame.events;
      step = createSimulation(state, room.queries, stages);
      room.syncView(state.tick);
      while (state.tick < target) this.step();
      return state;
    },
    reset(config = feel) {
      feel = config;
      state = room.reset(feel);
      step = createSimulation(state, room.queries, stages);
      events.length = 0;
      keyframes = new Map([[0, { state, room: room.snapshot(), events: 0 }]]);
    },
    trace(): ReplayTrace {
      return { ...route, feelVersion: feel.version, inputs: route.inputs.slice(0, state.tick), events: [...events] };
    },
  };
}

export function matchesReferenceEvents(actual: ReplayTrace, reference: ReplayTrace) {
  return actual.version === reference.version && actual.stepS === reference.stepS &&
    actual.level.id === reference.level.id && actual.level.version === reference.level.version &&
    actual.feelVersion === reference.feelVersion &&
    actual.inputs.length === reference.inputs.length &&
    actual.events.length === reference.events.length &&
    actual.events.every((event, index) => {
      const expected = reference.events[index];
      return Object.keys(event).length === Object.keys(expected).length &&
        Object.entries(event).every(([field, value]) => expected[field as keyof GameEvent] === value);
    });
}