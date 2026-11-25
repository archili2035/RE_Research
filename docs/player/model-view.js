(function () {
  const T = THREE;
  const byId = (id) => document.getElementById(id);
  const viewport = document.querySelector('.viewport');
  const canvas = document.createElement('canvas');
  canvas.id = 'modelview';
  canvas.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
  viewport.prepend(canvas);
  let renderer;
  try {
    renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (error) {
    window.modelError = error.message;
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0x14212a);
  renderer.outputColorSpace = T.SRGBColorSpace;

  const rig = LeonSkinning.create(T, MODEL_DATA);
  const scene = new T.Scene();
  const camera = new T.PerspectiveCamera(35, 1, 0.01, 100);
  const key = new T.DirectionalLight(0xfff0d9, 3);
  const fill = new T.DirectionalLight(0xaccfff, 1.2);
  key.position.set(3, 5, 4);
  fill.position.set(-3, 2, -3);
  scene.add(rig.group, key, fill, new T.HemisphereLight(0xddecff, 0x35434c, 2.5),
    new T.GridHelper(4, 16, 0x47616e, 0x293e4c));

  const lineGeometry = new T.BufferGeometry();
  const lines = new T.LineSegments(lineGeometry, new T.LineBasicMaterial({
    vertexColors: true, depthTest: false, transparent: true, opacity: 0.85,
  }));
  lines.renderOrder = 10;
  scene.add(lines);

  let lastClip;
  let lastTime;
  let lastBind;
  let tracks;
  function update(clip, time, bind) {
    if (lastClip === clip && lastTime === time && lastBind === bind) return;
    if (lastClip !== clip) {
      tracks = new Map(clip.tracks.map((track) => [clip.bones[track.bone].name, track]));
    }
    lastClip = clip;
    lastTime = time;
    lastBind = bind;
    rig.update((bone) => {
      const track = tracks.get(bone.name);
      if (!track) return;
      return {
        position: MotionMath.sample(track.position, time, bone.position),
        rotation: MotionMath.sample(track.rotation, time, bone.rotation, true),
        scale: MotionMath.sample(track.scale, time, bone.scale),
      };
    }, bind);
  }

  function drawLines(clip, pose) {
    const positions = [];
    const colors = [];
    const mask = MASK_DATA.find((item) => item.ID === Number(byId('mask').value));
    clip.bones.forEach((bone, i) => {
      if (bone.parent < 0 || (!byId('helpers').checked && /Target|Cam|Wep|Ground|_IK/.test(bone.name)) ||
        (!byId('fingers').checked && /Hand_(?!Palm)/.test(bone.name))) return;
      let color = bone.name.startsWith('L_') ? 0xf5b66b : bone.name.startsWith('R_') ? 0x73c9f3 : 0xd9e4e9;
      if (mask) color = mask.Joints.some((joint) => joint.Name === bone.name) ? 0xaddfce : 0x3c505c;
      const tint = new T.Color(color);
      for (const index of [bone.parent, i]) {
        positions.push(...pose[index].p);
        colors.push(tint.r, tint.g, tint.b);
      }
    });
    lineGeometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    lineGeometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
    lines.position.copy(rig.group.position);
  }

  window.ModelView = {
    render(clip, time, yaw, pitch, zoom, pose) {
      const mode = byId('displayMode').value;
      const enabled = mode !== 'skeleton' && !clip.additive;
      canvas.style.visibility = enabled ? 'visible' : 'hidden';
      byId('view').style.opacity = enabled ? '0' : '1';
      byId('names').disabled = enabled;
      document.querySelector('.legend').style.visibility = enabled && mode === 'model' ? 'hidden' : 'visible';
      byId('kind').textContent = clip.additive ? '补偿轨道 · 仅骨架' :
        enabled ? '真实网格 · 灰模预览' : '原始动画 · 骨骼轨道';
      if (!enabled) return;

      const { clientWidth: width, clientHeight: height } = viewport;
      const pixelRatio = Math.min(devicePixelRatio, 2);
      if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) {
        renderer.setSize(width, height, false);
      }
      camera.aspect = width / height;
      camera.fov = 2 * Math.atan(height / (2 * Math.min(width * .35, height * .43) * zoom * 4)) * 180 / Math.PI;
      camera.updateProjectionMatrix();
      camera.position.set(4 * Math.sin(yaw) * Math.cos(pitch), .9 + 4 * Math.sin(pitch), 4 * Math.cos(yaw) * Math.cos(pitch));
      camera.lookAt(0, .9, 0);
      const bind = byId('bindpose').checked;
      update(clip, time, bind);
      const follow = byId('follow').checked && !bind;
      const [x, , z] = pose[0].p;
      rig.group.position.set(follow ? -x : 0, 0, follow ? -z : 0);
      const wireframe = byId('wireframe').checked;
      for (const part of rig.parts) {
        for (const { mesh } of part.meshes) mesh.material.wireframe = wireframe;
      }
      lines.visible = mode === 'both' && !bind;
      if (lines.visible) drawLines(clip, pose);
      renderer.render(scene, camera);
    },
    get stats() { return rig.stats; },
    parts: rig.parts,
  };
})();
