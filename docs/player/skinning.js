(function (root) {
  function create(THREE, data) {
    const group = new THREE.Group();
    const material = new THREE.MeshStandardMaterial({
      color: 0x9da9ab, roughness: 0.8, metalness: 0.08, side: THREE.DoubleSide,
    });
    let bindingError = 0;
    let vertices = 0;
    let matched = 0;
    let bounds = null;
    const position = new THREE.Vector3();
    const rotation = new THREE.Quaternion();
    const scale = new THREE.Vector3();
    const parts = data.parts.map((part) => {
      const bones = part.bones.map(({ name, parent, local, inverseBind }) => {
        const bind = new THREE.Matrix4().fromArray(local);
        bind.decompose(position, rotation, scale);
        return {
          name, parent, local: bind, animated: new THREE.Matrix4(),
          inverse: new THREE.Matrix4().fromArray(inverseBind),
          world: new THREE.Matrix4(), skin: new THREE.Matrix4(),
          position: position.toArray(), rotation: rotation.toArray(), scale: scale.toArray(),
        };
      });
      const order = [];
      const visited = new Set();
      function join(i) {
        if (visited.has(i)) return;
        const bone = bones[i];
        const parent = bone.parent >= 0 && bone.parent !== i ? bones[bone.parent] : null;
        if (parent) {
          join(bone.parent);
          bone.world.multiplyMatrices(parent.world, bone.local);
        } else {
          bone.world.copy(bone.local);
        }
        bone.skin.multiplyMatrices(bone.world, bone.inverse);
        for (const [index, value] of bone.skin.elements.entries()) {
          bindingError = Math.max(bindingError, Math.abs(value - (index % 5 === 0 ? 1 : 0)));
        }
        visited.add(i);
        order.push(bone);
      }
      bones.forEach((_, i) => join(i));

      const meshes = part.primitives.map((primitive) => {
        const geometry = new THREE.BufferGeometry();
        // Allocate upload buffers in the renderer's realm, even when this script runs in its reference iframe.
        const positionAttribute = new THREE.Float32BufferAttribute(primitive.positions, 3).setUsage(THREE.DynamicDrawUsage);
        const normalAttribute = new THREE.Float32BufferAttribute(primitive.normals, 3).setUsage(THREE.DynamicDrawUsage);
        const positions = positionAttribute.array;
        const deformedNormals = normalAttribute.array;
        const original = new Float32Array(positions);
        const normals = new Float32Array(deformedNormals);
        geometry.setAttribute('position', positionAttribute);
        geometry.setAttribute('normal', normalAttribute);
        geometry.setIndex(primitive.indices);
        const mesh = new THREE.Mesh(geometry, material.clone());
        mesh.name = part.name;
        mesh.frustumCulled = false;
        if (part.name.includes('_21_')) mesh.material.color.setHex(0x53616a);
        group.add(mesh);
        vertices += positions.length / 3;
        return {
          mesh, original, normals, position: positions, normal: deformedNormals,
          joints: new Uint16Array(primitive.joints), weights: new Float32Array(primitive.weights),
          weightStride: primitive.weights.length / (positions.length / 3),
        };
      });
      return { name: part.name, bones, order, meshes };
    });
    material.dispose();

    function update(sample, bind = false) {
      matched = 0;
      const min = [Infinity, Infinity, Infinity];
      const max = [-Infinity, -Infinity, -Infinity];
      for (const { bones, order, meshes } of parts) {
        for (const bone of order) {
          const pose = sample(bone);
          let local = bone.local;
          if (pose) {
            matched++;
            if (!bind) {
              local = bone.animated.compose(
                position.fromArray(pose.position), rotation.fromArray(pose.rotation), scale.fromArray(pose.scale),
              );
            }
          }
          const parent = bones[bone.parent];
          if (parent && parent !== bone) bone.world.multiplyMatrices(parent.world, local);
          else bone.world.copy(local);
          bone.skin.multiplyMatrices(bone.world, bone.inverse);
        }
        const matrices = bones.map((bone) => bone.skin.elements);
        for (const data of meshes) {
          const { original, normals, position, normal, joints, weights, weightStride, mesh } = data;
          for (let i = 0, slot = 0; i < original.length; i += 3, slot += weightStride) {
            const x = original[i], y = original[i + 1], z = original[i + 2];
            const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
            let px = 0, py = 0, pz = 0, dx = 0, dy = 0, dz = 0;
            for (let j = slot; j < slot + weightStride; j++) {
              const weight = weights[j];
              if (!weight) continue;
              const e = matrices[joints[j]];
              px += weight * (e[0] * x + e[4] * y + e[8] * z + e[12]);
              py += weight * (e[1] * x + e[5] * y + e[9] * z + e[13]);
              pz += weight * (e[2] * x + e[6] * y + e[10] * z + e[14]);
              dx += weight * (e[0] * nx + e[4] * ny + e[8] * nz);
              dy += weight * (e[1] * nx + e[5] * ny + e[9] * nz);
              dz += weight * (e[2] * nx + e[6] * ny + e[10] * nz);
            }
            position[i] = px;
            position[i + 1] = py;
            position[i + 2] = pz;
            const length = Math.hypot(dx, dy, dz) || 1;
            normal[i] = dx / length;
            normal[i + 1] = dy / length;
            normal[i + 2] = dz / length;
            min[0] = Math.min(min[0], px); max[0] = Math.max(max[0], px);
            min[1] = Math.min(min[1], py); max[1] = Math.max(max[1], py);
            min[2] = Math.min(min[2], pz); max[2] = Math.max(max[2], pz);
          }
          mesh.geometry.attributes.position.needsUpdate = true;
          mesh.geometry.attributes.normal.needsUpdate = true;
        }
      }
      bounds = { min, max };
    }

    return {
      group, parts, update,
      get stats() { return { parts: parts.length, vertices, bindingError, matched, bounds }; },
    };
  }

  root.LeonSkinning = { create };
  if (typeof module !== 'undefined') module.exports = root.LeonSkinning;
})(globalThis);
