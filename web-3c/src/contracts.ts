// Right-handed world: metres, +Y up, yaw zero faces -Z, positive yaw turns left.
// Positive pitch looks up. Simulation time is in seconds and angles are in radians.
export const STEP_S = 1 / 60;
export const CONTRACT_VERSION = 1;

export type Vec3 = Readonly<{ x: number; y: number; z: number }>;
export type ViewAngles = Readonly<{ yawRad: number; pitchRad: number }>;

export interface InputSnapshot {
  readonly tick: number;
  readonly moveX: number; // -1 left, +1 right
  readonly moveY: number; // -1 backward, +1 forward
  readonly lookDeltaX: number; // Raw signed mouse movement in pixels
  readonly lookDeltaY: number;
  readonly sprintHeld: boolean;
  readonly aimHeld: boolean;
  readonly firePressed: boolean;
  readonly reloadPressed: boolean;
  readonly interactPressed: boolean;
}

export interface CharacterState {
  readonly position: Vec3; // Feet position
  readonly yawRad: number;
  readonly velocity: Vec3;
  readonly grounded: boolean;
}

export type ActionId = 'raise' | 'lower' | 'fire' | 'reload' | 'interact';

export interface ActionState {
  readonly id: string;
  readonly phase: 'ready' | 'raising' | 'aiming' | 'lowering' | 'firing' | 'reloading' | 'recovering';
  readonly aiming: boolean;
  readonly magazine: number;
  readonly reserve: number;
}

export type GameEventPayload =
  | { readonly type: 'input.request' | 'action.accepted' | 'action.recovered'; readonly action: ActionId }
  | { readonly type: 'weapon.fired' }
  | { readonly type: 'ammo.committed'; readonly magazine: number; readonly reserve: number }
  | { readonly type: 'door.changed'; readonly open: boolean }
  | { readonly type: 'target.hit' };

export type GameEvent = Readonly<{
  tick: number;
  order: number; // Zero-based within a tick
  timeS: number; // tick * STEP_S, the end of this step
  subjectId: string; // ActionState.id, or a LevelDefinition object ID
}> & GameEventPayload;

export interface CameraPose extends ViewAngles {
  readonly position: Vec3;
  readonly verticalFovRad: number;
  readonly obstructed: boolean;
  readonly nearClipM?: number; // Source camera profile: near clip with wall avoidance.
}

export interface SceneHit {
  readonly colliderId: string;
  readonly distanceM: number;
  readonly point: Vec3; // Ray hit point, or sphere centre at impact
  readonly normal: Vec3; // Outward world-space collider normal
}

export interface SceneQueries {
  moveCapsule(query: Readonly<{
    feet: Vec3; displacement: Vec3; radiusM: number; heightM: number;
  }>): Readonly<{ displacement: Vec3; grounded: boolean }>;
  sweepSphere(from: Vec3, to: Vec3, radiusM: number): SceneHit | null;
  raycast(origin: Vec3, direction: Vec3, maxDistanceM: number): SceneHit | null;
}

export interface ClipManifest {
  readonly version: number;
  readonly clips: readonly Readonly<{
    id: string;
    glb: string;
    track: string;
    durationS: number;
    blend: 'normal' | 'additive' | 'baked';
    referencePose?: Readonly<{ glb: string; track: string; timeS: number }>;
    boneMask?: readonly string[];
  }>[];
}

export interface LevelDefinition {
  readonly id: string;
  readonly version: number;
  readonly spawn: Readonly<{ position: Vec3; yawRad: number }>;
  readonly render: readonly (Readonly<{ id: string; position: Vec3; yawRad: number }> & (
    | Readonly<{ kind: 'glb'; glb: string }>
    | Readonly<{ kind: 'box'; size: Vec3; color?: string }>
  ))[];
  readonly colliders: readonly Readonly<{ id: string; center: Vec3; size: Vec3; yawRad: number }>[];
  readonly doors: readonly Readonly<{ id: string; colliderId: string; interactionRangeM: number }>[];
  readonly targets: readonly Readonly<{ id: string; colliderId: string; interactionRangeM: number }>[];
}

export interface ReplayTrace {
  readonly version: number;
  readonly stepS: number;
  readonly level: Readonly<{ id: string; version: number }>;
  readonly feelVersion: number;
  readonly inputs: readonly InputSnapshot[];
  readonly events: readonly GameEvent[];
}

export interface FeelParameter {
  readonly value: number;
  readonly source: string;
  readonly evidence: 'measured' | 'observed' | 'tuned';
  readonly conditions: string;
}

export interface FeelConfig {
  readonly version: number;
  readonly movement: Readonly<Record<string, FeelParameter>>;
  readonly camera: Readonly<Record<string, FeelParameter>>;
  readonly actions: Readonly<Record<string, FeelParameter>>;
}