import { CONTRACT_VERSION, STEP_S } from './contracts.ts';
import type { FeelConfig, GameEvent, ReplayTrace, SceneQueries } from './contracts.ts';
import { createPreviewStages } from './preview-stages.ts';
import { createSimulation } from './simulation.ts';
import type { SimulationStages } from './simulation.ts';

export const previewRouteLevel = { id: 'm7-preview-route', version: 1 };

export function createRoutePlayback(
  route: ReplayTrace, feel: FeelConfig, scene: SceneQueries, publish: SimulationStages['publish'],
) {
  if (route.version !== CONTRACT_VERSION || route.stepS !== STEP_S ||
      route.level.id !== previewRouteLevel.id || route.level.version !== previewRouteLevel.version) {
    throw new Error('回放版本、固定步长或关卡版本不匹配');
  }
  if (route.inputs.length === 0 || route.inputs.some((input, index) => input.tick !== index + 1)) {
    throw new Error('回放输入必须从第 1 步连续排列');
  }

  const stages = createPreviewStages(feel);
  const events: GameEvent[] = [];
  let state = stages.previewInitialState;
  const step = createSimulation(state, scene, {
    sampleInput: (tick) => route.inputs[tick - 1],
    move: stages.movePreview, act: stages.actPreview, camera: stages.cameraPreview,
    publish: (snapshot, input, batch) => {
      events.push(...batch);
      publish(snapshot, input, batch);
    },
  });

  return {
    get state() { return state; },
    get done() { return state.tick === route.inputs.length; },
    step() {
      if (state.tick < route.inputs.length) state = step();
      return state;
    },
    trace(): ReplayTrace {
      return { ...route, feelVersion: feel.version, inputs: route.inputs.slice(0, state.tick), events: [...events] };
    },
  };
}

export function matchesReferenceEvents(actual: ReplayTrace, reference: ReplayTrace) {
  return actual.feelVersion === reference.feelVersion &&
    actual.inputs.length === reference.inputs.length &&
    actual.events.length === reference.events.length &&
    actual.events.every((event, index) => {
      const expected = reference.events[index];
      return Object.keys(event).length === Object.keys(expected).length &&
        Object.entries(event).every(([field, value]) => expected[field as keyof GameEvent] === value);
    });
}
