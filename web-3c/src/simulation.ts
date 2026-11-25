import { STEP_S } from './contracts.ts';
import type {
  ActionState, CameraPose, CharacterState, GameEvent, GameEventPayload, InputSnapshot, SceneQueries,
} from './contracts.ts';

export interface SimulationState {
  readonly tick: number;
  readonly character: CharacterState;
  readonly action: ActionState;
  readonly camera: CameraPose;
}

export type EmitEvent = (subjectId: string, event: GameEventPayload) => void;

export interface SimulationStages {
  sampleInput(tick: number): InputSnapshot;
  move(input: InputSnapshot, previous: SimulationState, scene: SceneQueries): CharacterState;
  act(input: InputSnapshot, character: CharacterState, previous: ActionState, emit: EmitEvent): ActionState;
  camera(
    input: InputSnapshot, character: CharacterState, action: ActionState,
    previous: CameraPose, scene: SceneQueries,
  ): CameraPose;
  resolveSceneEvents?(state: SimulationState, events: readonly GameEvent[], emit: EmitEvent): void;
  publish(state: SimulationState, input: InputSnapshot, events: readonly GameEvent[]): void;
}

export function createSimulation(initial: SimulationState, scene: SceneQueries, stages: SimulationStages) {
  let current = initial;
  return () => {
    const previous = current;
    const tick = previous.tick + 1;
    const input = stages.sampleInput(tick);
    if (input.tick !== tick) throw new Error(`Expected input for tick ${tick}, got ${input.tick}`);

    const events: GameEvent[] = [];
    const emit: EmitEvent = (subjectId, event) => {
      events.push({ ...event, subjectId, tick, order: events.length, timeS: tick * STEP_S });
    };
    const character = stages.move(input, previous, scene);
    const action = stages.act(input, character, previous.action, emit);
    const camera = stages.camera(input, character, action, previous.camera, scene);

    current = { tick, character, action, camera };
    stages.resolveSceneEvents?.(current, events, emit);
    stages.publish(current, input, Object.freeze(events));
    return current;
  };
}

const STEP_MS = STEP_S * 1000;
const MAX_FRAME_MS = 250;
const ROUNDING_MS = 1e-8;

export function createFixedLoop(step: () => void, render: (alpha: number) => void) {
  let lastMs: number | undefined;
  let accumulatorMs = 0;

  return {
    frame(nowMs: number) {
      if (lastMs !== undefined) {
        accumulatorMs += Math.min(MAX_FRAME_MS, Math.max(0, nowMs - lastMs));
      }
      lastMs = nowMs;
      while (accumulatorMs + ROUNDING_MS >= STEP_MS) {
        step();
        accumulatorMs = Math.max(0, accumulatorMs - STEP_MS);
      }
      render(accumulatorMs / STEP_MS);
    },
    resetClock() {
      lastMs = undefined;
      accumulatorMs = 0;
    },
  };
}
