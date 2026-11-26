import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { LevelDefinition, SceneQueries, Vec3 } from './contracts.ts';
import { CHARACTER_BODY } from './movement.ts';

export const previewBoxes = [
  { id: 'floor', x: 0, y: -0.15, z: -3.5, w: 20, h: 0.3, d: 20, color: 0x44555b },
  { id: 'west-wall', x: -2.5, y: 1.25, z: -2, w: 0.24, h: 2.5, d: 13, color: 0x607a85 },
  { id: 'inside-wall', x: 2.5, y: 1.25, z: 0, w: 0.24, h: 2.5, d: 9, color: 0x526b75 },
  { id: 'north-wall', x: 2.5, y: 1.25, z: -8.5, w: 10, h: 2.5, d: 0.24, color: 0x607a85 },
  { id: 'east-wall', x: 7.5, y: 1.25, z: -6.5, w: 0.24, h: 2.5, d: 4, color: 0x607a85 },
  { id: 'south-wall', x: 5, y: 1.25, z: -4.5, w: 5, h: 2.5, d: 0.24, color: 0x526b75 },
  { id: 'rear-wall', x: 0, y: 1.25, z: 7.6, w: 5, h: 2.5, d: 0.24, color: 0x607a85 },
  { id: 'practice-block', x: 6.8, y: 0.8, z: -6.5, w: 0.5, h: 1.6, d: 0.75, color: 0xde9060 },
];

type RenderBox = Extract<LevelDefinition['render'][number], { kind: 'box' }>;
type CapsuleQuery = Parameters<SceneQueries['moveCapsule']>[0];
type CapsuleResult = ReturnType<SceneQueries['moveCapsule']>;

export async function createPreviewScene() {
  const boxes = previewBoxes.map(({ id, x, y, z, w, h, d, color }): RenderBox => ({
    id, kind: 'box', position: { x, y, z }, size: { x: w, y: h, z: d },
    yawRad: 0, color: `#${color.toString(16).padStart(6, '0')}`,
  }));
  const result = await createBoxScene(boxes, boxes.map(({ id, position, size, yawRad }) => ({
    id, center: position, size, yawRad,
  })), false); // Preserve the M7 v1 route's collision settings.
  const grid = new THREE.GridHelper(20, 20, 0x8ea5aa, 0x62787f);
  grid.position.set(0, 0.003, -3.5);
  result.scene.add(grid);
  return result;
}

export async function createBoxScene(
  render: readonly RenderBox[], definitions: LevelDefinition['colliders'], enableSteps = true,
) {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x223239);
  scene.fog = new THREE.Fog(0x223239, 14, 34);
  scene.add(new THREE.HemisphereLight(0xe1f2f5, 0x697472, 2));
  const light = new THREE.DirectionalLight(0xffffff, 1.65);
  light.position.set(-3, 7, 2);
  scene.add(light);

  const meshes = new Map<string, THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>>();
  for (const { id, position, size, yawRad, color } of render) {
    const geometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
    mesh.name = id;
    mesh.position.set(position.x, position.y, position.z);
    mesh.rotation.y = yawRad;
    scene.add(mesh);
    meshes.set(id, mesh);
  }

  const colliderIds = new Map<number, string>();
  const colliders = new Map<string, RAPIER.Collider>();
  for (const { id, center, size, yawRad } of definitions) {
    const desc = RAPIER.ColliderDesc.cuboid(size.x / 2, size.y / 2, size.z / 2);
    desc.setTranslation(center.x, center.y, center.z);
    desc.setRotation({ x: 0, y: Math.sin(yawRad / 2), z: 0, w: Math.cos(yawRad / 2) });
    const collider = world.createCollider(desc);
    colliderIds.set(collider.handle, id);
    colliders.set(id, collider);
  }

  const { radiusM, heightM } = CHARACTER_BODY;
  const halfSegment = heightM / 2 - radiusM;
  const avatar = new THREE.Mesh(
    new THREE.CapsuleGeometry(radiusM, 2 * halfSegment, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x9ae4d3 }),
  );
  const facing = new THREE.Mesh(
    new THREE.BoxGeometry(0.19, 0.12, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x28544f }),
  );
  facing.position.set(0, 0.4, -radiusM);
  avatar.add(facing);
  scene.add(avatar);

  const capsule = world.createCollider(RAPIER.ColliderDesc.capsule(halfSegment, radiusM));
  let capsuleRadius = radiusM;
  let capsuleHeight = heightM;
  const controller = world.createCharacterController(0.025);
  if (enableSteps) {
    controller.enableAutostep(0.25, 0.30, false);
    controller.enableSnapToGround(0.25);
  }
  world.step(); // Populate the query structures for the static greybox.

  let lastMove: { query: CapsuleQuery; result: CapsuleResult } | undefined;
  function readMovementDebug() {
    if (!lastMove) return undefined;
    const contacts: { colliderId: string; point: Vec3; normal: Vec3 }[] = [];
    for (let index = 0; index < controller.numComputedCollisions(); index += 1) {
      const contact = controller.computedCollision(index);
      if (contact?.collider) {
        const colliderId = colliderIds.get(contact.collider.handle)!;
        contacts.push({ colliderId, point: contact.witness1, normal: contact.normal1 });
      }
    }
    return { ...lastMove, contacts };
  }

  const rotation = { x: 0, y: 0, z: 0, w: 1 };
  const queries: SceneQueries = {
    moveCapsule(query) {
      const { feet, displacement, heightM, radiusM } = query;
      if (radiusM !== capsuleRadius || heightM !== capsuleHeight) {
        capsule.setShape(new RAPIER.Capsule(heightM / 2 - radiusM, radiusM));
        capsuleRadius = radiusM;
        capsuleHeight = heightM;
      }
      capsule.setTranslation({ x: feet.x, y: feet.y + heightM / 2, z: feet.z });
      controller.computeColliderMovement(capsule, displacement);
      const result = { displacement: controller.computedMovement(), grounded: controller.computedGrounded() };
      lastMove = { query, result };
      return result;
    },
    sweepSphere(from, to, radiusM) {
      const delta = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
      const distance = Math.hypot(delta.x, delta.y, delta.z);
      if (distance === 0) return null;
      const hit = world.castShape(from, rotation, delta, new RAPIER.Ball(radiusM), 0, 1, true, undefined, undefined, capsule);
      if (!hit) return null;
      return {
        colliderId: colliderIds.get(hit.collider.handle)!,
        distanceM: hit.time_of_impact * distance,
        point: {
          x: from.x + delta.x * hit.time_of_impact,
          y: from.y + delta.y * hit.time_of_impact,
          z: from.z + delta.z * hit.time_of_impact,
        },
        normal: hit.normal1,
      };
    },
    raycast(origin, direction, maxDistanceM) {
      const length = Math.hypot(direction.x, direction.y, direction.z);
      if (length === 0 || maxDistanceM < 0) return null;
      const unit: Vec3 = { x: direction.x / length, y: direction.y / length, z: direction.z / length };
      const ray = new RAPIER.Ray(origin, unit);
      const hit = world.castRayAndGetNormal(ray, maxDistanceM, true, undefined, undefined, capsule);
      if (!hit) return null;
      return {
        colliderId: colliderIds.get(hit.collider.handle)!,
        distanceM: hit.timeOfImpact,
        point: ray.pointAt(hit.timeOfImpact),
        normal: hit.normal,
      };
    },
  };

  return {
    scene, avatar, queries, meshes, readMovementDebug,
    resetMovementDebug() { lastMove = undefined; },
    setColliderEnabled(id: string, enabled: boolean) {
      const collider = colliders.get(id);
      if (!collider) throw new Error(`Unknown collider: ${id}`);
      collider.setEnabled(enabled);
      world.step(); // Refresh queries before the camera and the rest of this step.
    },
  };
}
