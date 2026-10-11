/* Solar system exhibit: scene, astronomy, interface. Classic script; three.js is loaded through the page's import map. */
(async function () {
  'use strict';
  const $ = (s, el = document) => el.querySelector(s);
  const progEl = $('#prog'), progTxt = $('#prog-txt'), errEl = $('#intro-err'), startBtn = $('#start');
  const fail = (msg) => { errEl.hidden = false; errEl.textContent = msg; progTxt.textContent = ''; };
  const progress = (f, txt) => { progEl.style.width = (Math.min(1, f) * 100).toFixed(1) + '%'; if (txt) progTxt.textContent = txt; };

  let THREE, OrbitControls, EffectComposer, RenderPass, UnrealBloomPass, OutputPass;
  try {
    THREE = await import('three');
    [{ OrbitControls }, { EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import('three/addons/controls/OrbitControls.js'),
      import('three/addons/postprocessing/EffectComposer.js'),
      import('three/addons/postprocessing/RenderPass.js'),
      import('three/addons/postprocessing/UnrealBloomPass.js'),
      import('three/addons/postprocessing/OutputPass.js'),
    ]);
  } catch (e) {
    console.error(e);
    fail('Không tải được thư viện đồ họa 3D. Hãy kiểm tra kết nối mạng rồi tải lại trang.');
    return;
  }
  const T0 = performance.now(); const marks = { lib: Math.round(T0) };
  progress(0.06, 'Đang chuẩn bị cảnh…');

  // ------------------------------------------------------------------ constants
  const { AU_KM, BODIES, byId, EVENTS } = window.SOLAR;
  const SH = window.SHADERS;
  const SKY = window.SKY;
  const DEG = Math.PI / 180, TAU = Math.PI * 2, J2000 = 2451545.0;
  const OBLIQ = 23.4392911 * DEG;
  const U = 40;                       // scene units per AU at true scale
  const SUN_VIS = 10;
  const GM_SUN = 1.32712440018e11;    // km^3 s^-2
  const C_KM = 299792.458;
  const JD_MIN = 2378496.5, JD_MAX = 2524593.5; // 1800-01-01 … 2200-01-01
  const coarse = matchMedia('(pointer: coarse)').matches;
  const qParam = new URLSearchParams(location.search).get('q');
  const LOWQ = qParam ? qParam === 'low' : (coarse || Math.min(screen.width, screen.height) < 700);
  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('hmt.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('hmt.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  const SPEEDS = [
    { v: -365.25, t: '−1 năm/giây' }, { v: -30.4375, t: '−1 tháng/giây' }, { v: -7, t: '−1 tuần/giây' },
    { v: -1, t: '−1 ngày/giây' }, { v: -1 / 24, t: '−1 giờ/giây' }, { v: 1 / 86400, t: 'Thời gian thực' },
    { v: 1 / 24, t: '1 giờ/giây' }, { v: 1, t: '1 ngày/giây' }, { v: 7, t: '1 tuần/giây' },
    { v: 30.4375, t: '1 tháng/giây' }, { v: 365.25, t: '1 năm/giây' },
  ];

  const MOONS = BODIES.filter((b) => b.kind === 'moon');
  const ORBITERS = BODIES.filter((b) => b.el);
  const sun = byId.sun, earth = byId.earth;

  // ------------------------------------------------------------------ math
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const blendLog = (a, b, t) => Math.exp(Math.log(a) * (1 - t) + Math.log(b) * t);
  const smooth = (t) => t * t * (3 - 2 * t);
  const smoothstep = (a, b, x) => smooth(clamp((x - a) / (b - a), 0, 1));
  const easeIO = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const wrapPi = (a) => { a = (a + Math.PI) % TAU; if (a < 0) a += TAU; return a - Math.PI; };
  const jdNow = () => Date.now() / 86400000 + 2440587.5;
  const jdToDate = (jd) => new Date(Math.round((jd - 2440587.5) * 86400000));
  const dateToJd = (d) => d.getTime() / 86400000 + 2440587.5;
  function mulberry32(a) { return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // ------------------------------------------------------------------ astronomy
  function kepler(M, e) {
    let E = M + e * Math.sin(M);
    for (let i = 0; i < 15; i++) { const d = (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E)); E -= d; if (Math.abs(d) < 1e-12) break; }
    return E;
  }
  function elementsAt(el, T) { const o = new Array(6); for (let i = 0; i < 6; i++) o[i] = el[0][i] + el[1][i] * T; return o; }
  // Ecliptic J2000 -> scene axes: x = x_ecl, y = z_ecl (north), z = -y_ecl.
  function orbitPoint(elv, E, out) {
    const a = elv[0], e = elv[1], I = elv[2] * DEG, w = (elv[4] - elv[5]) * DEG, O = elv[5] * DEG;
    const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
    const cw = Math.cos(w), sw = Math.sin(w), cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(I), si = Math.sin(I);
    const x = (cw * cO - sw * sO * ci) * xp + (-sw * cO - cw * sO * ci) * yp;
    const y = (cw * sO + sw * cO * ci) * xp + (-sw * sO + cw * cO * ci) * yp;
    const z = (sw * si) * xp + (cw * si) * yp;
    return out.set(x, z, -y);
  }
  function planetAU(b, jd, out) {
    const elv = elementsAt(b.el, (jd - J2000) / 36525);
    let Md = (elv[3] - elv[4]) % 360; if (Md > 180) Md -= 360; else if (Md < -180) Md += 360;
    const E = kepler(Md * DEG, elv[1]);
    orbitPoint(elv, E, out);
    return { E, elv };
  }
  const gmst = (jd) => ((280.46061837 + 360.98564736629 * (jd - J2000)) % 360) * DEG;
  // Low-precision lunar ephemeris (Astronomical Almanac), geocentric, km, scene axes.
  function lunarKm(jd, out) {
    const T = (jd - J2000) / 36525;
    const s = (x) => Math.sin(x * DEG), c = (x) => Math.cos(x * DEG);
    let lam = 218.32 + 481267.881 * T + 6.29 * s(135.0 + 477198.87 * T) - 1.27 * s(259.3 - 413335.36 * T) + 0.66 * s(235.7 + 890534.22 * T)
      + 0.21 * s(269.9 + 954397.74 * T) - 0.19 * s(357.5 + 35999.05 * T) - 0.11 * s(186.5 + 966404.03 * T);
    const bet = 5.13 * s(93.3 + 483202.02 * T) + 0.28 * s(228.2 + 960400.89 * T) - 0.28 * s(318.3 + 6003.15 * T) - 0.17 * s(217.6 - 407332.21 * T);
    const par = 0.9508 + 0.0518 * c(135.0 + 477198.87 * T) + 0.0095 * c(259.3 - 413335.36 * T) + 0.0078 * c(235.7 + 890534.22 * T) + 0.0028 * c(269.9 + 954397.74 * T);
    lam -= 1.3972 * T; // of-date equinox -> J2000
    const r = 6378.14 / Math.sin(par * DEG), cb = Math.cos(bet * DEG);
    return out.set(r * cb * Math.cos(lam * DEG), r * Math.sin(bet * DEG), -r * cb * Math.sin(lam * DEG));
  }
  function eqToScene(raDeg, decDeg, out) {
    const ra = raDeg * DEG, de = decDeg * DEG;
    const x = Math.cos(de) * Math.cos(ra), y = Math.cos(de) * Math.sin(ra), z = Math.sin(de);
    const ye = y * Math.cos(OBLIQ) + z * Math.sin(OBLIQ), ze = -y * Math.sin(OBLIQ) + z * Math.cos(OBLIQ);
    return out.set(x, ze, -ye);
  }
  const eclLon = (v) => { let l = Math.atan2(-v.z, v.x) / DEG; if (l < 0) l += 360; return l; };

  // ------------------------------------------------------------------ state
  const S = {
    jd: jdNow(), speedIdx: 7, playing: true,
    scaleT: 0, scaleTo: 0, scaleAnim: null,
    focus: null, flight: null, hover: null, tour: null, started: false,
    idle: 0, viewShift: new THREE.Vector2(), time: 0,
    layers: Object.assign({ orbits: true, labels: true, moons: true, belt: true, kuiper: true, axes: false, constellations: false, milkyway: true }, store.get('layers', {})),
  };
  const mapR = (r, t = S.scaleT) => blendLog(U * Math.pow(r, 0.62), U * r, t);

  // ------------------------------------------------------------------ renderer
  let canvas = $('#scene');
  let renderer = null;
  // The GPU process may still be recovering from an earlier reset; retry a couple of times before giving up.
  for (let attempt = 0; attempt < 3 && !renderer; attempt++) {
    try {
      if (attempt) { const c2 = canvas.cloneNode(false); canvas.replaceWith(c2); canvas = c2; }
      const r = new THREE.WebGLRenderer({ canvas, antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
      if (r.capabilities.isWebGL2) renderer = r; else { r.dispose(); r.forceContextLoss(); }
    } catch (e) { /* retry */ }
    if (!renderer) await new Promise((res) => setTimeout(res, 1200));
  }
  if (!renderer) {
    fail('Không khởi tạo được WebGL 2 nên không thể hiển thị mô hình 3D. Hãy tải lại trang, hoặc thử Chrome, Edge, Firefox, Safari bản mới.');
    return;
  }
  let DPR = Math.min(window.devicePixelRatio || 1, LOWQ ? 1.75 : 2);
  let W = innerWidth, H = innerHeight;
  renderer.setPixelRatio(DPR);
  renderer.setSize(W, H, false);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    S.lost = true;
    if (!S.started) fail('Card đồ họa đã ngừng phản hồi khi dựng mô hình. Hãy tải lại trang; nếu lỗi lặp lại, thử đóng bớt thẻ khác.');
    else toast('Card đồ họa đã ngừng phản hồi. Hãy tải lại trang để tiếp tục.');
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 1);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const maxTex = renderer.capabilities.maxTextureSize;

  // Periodic gradient noise in a 3D texture: bake shaders sample it instead of computing simplex noise,
  // which keeps their compile time short on Direct3D-backed browsers.
  function makeNoiseTexture(N, P) {
    const r = mulberry32(1234);
    const G = new Float32Array(P * P * P * 3);
    for (let i = 0; i < P * P * P; i++) {
      let x, y, z, l;
      do { x = r() * 2 - 1; y = r() * 2 - 1; z = r() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
      l = Math.sqrt(l); G[i * 3] = x / l; G[i * 3 + 1] = y / l; G[i * 3 + 2] = z / l;
    }
    const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
    const vals = new Float32Array(N * N * N);
    let mx = 0;
    const k = P / N;
    for (let zi = 0; zi < N; zi++) for (let yi = 0; yi < N; yi++) for (let xi = 0; xi < N; xi++) {
      const px = xi * k, py = yi * k, pz = zi * k;
      const ix = Math.floor(px), iy = Math.floor(py), iz = Math.floor(pz);
      const fx = px - ix, fy = py - iy, fz = pz - iz;
      let v = 0;
      const u = fade(fx), w = fade(fy), t = fade(fz);
      for (let c = 0; c < 8; c++) {
        const cx = c & 1, cy = (c >> 1) & 1, cz = (c >> 2) & 1;
        const gi = (((iz + cz) % P) * P * P + ((iy + cy) % P) * P + ((ix + cx) % P)) * 3;
        const d = G[gi] * (fx - cx) + G[gi + 1] * (fy - cy) + G[gi + 2] * (fz - cz);
        v += d * (cx ? u : 1 - u) * (cy ? w : 1 - w) * (cz ? t : 1 - t);
      }
      vals[(zi * N + yi) * N + xi] = v;
      mx += v * v;
    }
    // match the spread of the GLSL simplex noise the surface recipes were tuned with (std ≈ 0.4)
    const k2 = 0.4 / Math.sqrt(mx / vals.length);
    const half = new Uint16Array(N * N * N);
    for (let i = 0; i < vals.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.max(-1, Math.min(1, vals[i] * k2)));
    const tex = new THREE.Data3DTexture(half, N, N, N);
    tex.format = THREE.RedFormat; tex.type = THREE.HalfFloatType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    return tex;
  }
  const noiseTex = makeNoiseTexture(LOWQ ? 96 : 128, 32);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, W / H, 1e-7, 3e5);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.55;
  controls.zoomSpeed = 1.1;
  controls.panSpeed = 0.7;
  controls.screenSpacePanning = true;
  controls.autoRotateSpeed = 0.35;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

  const rtMain = new THREE.WebGLRenderTarget(W * DPR, H * DPR, { type: THREE.HalfFloatType, samples: LOWQ ? 0 : 4 });
  const composer = new EffectComposer(renderer, rtMain);
  composer.setPixelRatio(DPR);
  composer.setSize(W, H);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.4, 0.92);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const V0 = new THREE.Vector3(), V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), V3 = new THREE.Vector3();
  const Q0 = new THREE.Quaternion();
  const AXIS_Y = new THREE.Vector3(0, 1, 0);
  const ORIGIN = new THREE.Vector3();

  // ------------------------------------------------------------------ sky
  const SKY_R = 50000;
  const sky = new THREE.Group();
  scene.add(sky);
  const GN = eqToScene(192.85948, 27.12825, new THREE.Vector3());
  const GC = eqToScene(266.405, -28.936, new THREE.Vector3());
  const mwMat = new THREE.ShaderMaterial({
    vertexShader: SH.SKY_VERT, fragmentShader: SH.SKY_FRAG,
    uniforms: { uGN: { value: GN }, uGC: { value: GC }, uK: { value: 0.075 }, uNoise: { value: noiseTex } },
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const milky = new THREE.Mesh(new THREE.SphereGeometry(SKY_R, 64, 32), mwMat);
  milky.renderOrder = -10; milky.frustumCulled = false;
  sky.add(milky);

  function bvColor(bv) {
    const stops = [[-0.35, [0.62, 0.71, 1.0]], [0.0, [0.79, 0.85, 1.0]], [0.3, [0.98, 0.97, 0.98]], [0.6, [1.0, 0.94, 0.82]],
      [1.0, [1.0, 0.83, 0.62]], [1.5, [1.0, 0.71, 0.46]], [2.0, [1.0, 0.6, 0.36]]];
    if (bv <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (bv <= stops[i][0]) { const [a, ca] = stops[i - 1], [b, cb] = stops[i]; const t = (bv - a) / (b - a); return ca.map((v, k) => v + (cb[k] - v) * t); }
    }
    return stops[stops.length - 1][1];
  }
  (function buildStars() {
    const st = SKY.stars, n = st.length / 4, extra = LOWQ ? 6000 : 14000;
    const pos = new Float32Array((n + extra) * 3), col = new Float32Array((n + extra) * 3), size = new Float32Array(n + extra);
    for (let i = 0; i < n; i++) {
      eqToScene(st[i * 4], st[i * 4 + 1], V0).multiplyScalar(SKY_R * 0.96);
      pos.set([V0.x, V0.y, V0.z], i * 3);
      const m = st[i * 4 + 2], f = Math.pow(10, -0.4 * m);
      const c = bvColor(st[i * 4 + 3]), k = clamp(0.22 + 0.95 * Math.pow(f, 0.42), 0, 1.7);
      col.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
      size[i] = 1.5 + 1.9 * Math.pow(f, 0.33);
    }
    const rnd = mulberry32(11), gy = new THREE.Vector3().crossVectors(GN, GC);
    for (let j = 0; j < extra; j++) {
      const i = n + j;
      let d;
      if (rnd() < 0.62) {
        const l = rnd() * TAU, b = (rnd() + rnd() + rnd() - 1.5) * 0.28 * (0.6 + 0.6 * Math.cos(l * 0.5) ** 2);
        d = V0.copy(GC).multiplyScalar(Math.cos(b) * Math.cos(l)).addScaledVector(gy, Math.cos(b) * Math.sin(l)).addScaledVector(GN, Math.sin(b));
      } else {
        const u = rnd() * 2 - 1, t = rnd() * TAU;
        d = V0.set(Math.sqrt(1 - u * u) * Math.cos(t), u, Math.sqrt(1 - u * u) * Math.sin(t));
      }
      d.normalize().multiplyScalar(SKY_R * 0.97);
      pos.set([d.x, d.y, d.z], i * 3);
      const c = bvColor(rnd() * 1.6 - 0.1), k = 0.08 + rnd() * 0.14;
      col.set([c[0] * k, c[1] * k, c[2] * k], i * 3);
      size[i] = 1.3 + rnd() * 0.5;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SH.STAR_VERT, fragmentShader: SH.STAR_FRAG,
      uniforms: { uPix: { value: DPR }, uK: { value: 1 } },
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    });
    const pts = new THREE.Points(g, mat);
    pts.renderOrder = -9; pts.frustumCulled = false;
    sky.add(pts);
    S.starMat = mat;
  })();

  const CONS_VI = {
    Ori: 'Lạp Hộ', UMa: 'Đại Hùng', UMi: 'Tiểu Hùng', Cas: 'Tiên Hậu', Cyg: 'Thiên Nga', Lyr: 'Thiên Cầm', Aql: 'Thiên Ưng',
    Sco: 'Thiên Yết', Sgr: 'Nhân Mã', Tau: 'Kim Ngưu', Gem: 'Song Tử', Leo: 'Sư Tử', Vir: 'Xử Nữ', Lib: 'Thiên Bình',
    Cap: 'Ma Kết', Aqr: 'Bảo Bình', Psc: 'Song Ngư', Ari: 'Bạch Dương', Cnc: 'Cự Giải', Cru: 'Nam Thập Tự', Cen: 'Bán Nhân Mã',
    CMa: 'Đại Khuyển', Peg: 'Phi Mã', And: 'Tiên Nữ', Per: 'Anh Tiên', Aur: 'Ngự Phu', Boo: 'Mục Phu', Car: 'Thuyền Để',
    Dra: 'Thiên Long', Her: 'Vũ Tiên', Oph: 'Xà Phu',
  };
  const STAR_VI = { Sirius: 'Thiên Lang · Sirius', Polaris: 'Bắc Cực · Polaris', Vega: 'Chức Nữ · Vega', Altair: 'Ngưu Lang · Altair' };
  const consGroup = new THREE.Group();
  sky.add(consGroup);
  const skyLabels = [];
  (function buildConstellations() {
    const pts = [];
    for (const id in SKY.lines) {
      for (const line of SKY.lines[id]) {
        for (let i = 0; i < line.length - 1; i++) {
          eqToScene(line[i][0], line[i][1], V0).multiplyScalar(SKY_R * 0.95); pts.push(V0.x, V0.y, V0.z);
          eqToScene(line[i + 1][0], line[i + 1][1], V0).multiplyScalar(SKY_R * 0.95); pts.push(V0.x, V0.y, V0.z);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: new THREE.Color(0.03, 0.045, 0.09), blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    lines.renderOrder = -8; lines.frustumCulled = false;
    consGroup.add(lines);
    const ecl = [];
    for (let i = 0; i <= 360; i += 2) ecl.push(Math.cos(i * DEG) * SKY_R * 0.95, 0, -Math.sin(i * DEG) * SKY_R * 0.95);
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.Float32BufferAttribute(ecl, 3));
    const eLine = new THREE.Line(eg, new THREE.LineDashedMaterial({ color: new THREE.Color(0.08, 0.06, 0.025), dashSize: 900, gapSize: 700, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false }));
    eLine.computeLineDistances(); eLine.renderOrder = -8; eLine.frustumCulled = false;
    consGroup.add(eLine);
    const host = $('#labels');
    for (const id in CONS_VI) {
      const c = SKY.cons[id]; if (!c) continue;
      const el = document.createElement('div'); el.className = 'sky-lbl'; el.textContent = CONS_VI[id]; el.hidden = true;
      host.appendChild(el);
      skyLabels.push({ el, dir: eqToScene(c[1], c[2], new THREE.Vector3()), w: 0 });
    }
    for (const s of SKY.named) {
      const el = document.createElement('div'); el.className = 'sky-lbl star'; el.textContent = STAR_VI[s[0]] || s[0]; el.hidden = true;
      host.appendChild(el);
      skyLabels.push({ el, dir: eqToScene(s[1], s[2], new THREE.Vector3()), star: true, w: 0 });
    }
    const eclEl = document.createElement('div'); eclEl.className = 'sky-lbl'; eclEl.textContent = 'Hoàng đạo'; eclEl.hidden = true;
    eclEl.style.color = 'rgba(242,182,96,0.55)';
    host.appendChild(eclEl);
    skyLabels.push({ el: eclEl, dir: new THREE.Vector3(Math.cos(200 * DEG), 0, -Math.sin(200 * DEG)), w: 0 });
  })();

  // ------------------------------------------------------------------ bodies
  const geoHi = new THREE.SphereGeometry(1, LOWQ ? 96 : 160, LOWQ ? 64 : 100);
  const geoMd = new THREE.SphereGeometry(1, 72, 48);
  function lumpy(seed) {
    const g = new THREE.SphereGeometry(1, 64, 40), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + 0.07 * Math.sin(x * 3.1 + seed) * Math.cos(y * 2.3 + seed * 0.7) + 0.05 * Math.sin(y * 4.7 + z * 3.3 + seed * 2.1) + 0.035 * Math.sin(z * 6.1 + x * 5.2 + seed * 3.7);
      p.setXYZ(i, x * k, y * k, z * k);
    }
    g.computeVertexNormals();
    return g;
  }
  function solidTex(hex, alpha = 255) {
    const n = parseInt(hex.slice(1), 16);
    const t = new THREE.DataTexture(new Uint8Array([(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha]), 1, 1);
    t.needsUpdate = true;
    return t;
  }
  function planetUniforms() {
    return {
      map: { value: null }, uSunV: { value: new THREE.Vector3() }, uCenterV: { value: new THREE.Vector3() },
      uAtmo: { value: new THREE.Vector3() }, uAtmoK: { value: 0 }, uWrap: { value: 0 }, uBump: { value: 0 }, uSpec: { value: 0 },
      uAmbient: { value: 0.014 }, uUmbra: { value: new THREE.Vector3() }, uRingOn: { value: 0 }, uSunDirL: { value: new THREE.Vector3(1, 0, 0) },
      uFlat: { value: 0 }, uCloud: { value: 0 }, uOpacity: { value: 1 }, uEmis: { value: 0 },
      uOcc: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uOccN: { value: 0 }, uSunAng: { value: 0.0047 },
      uSunDirV: { value: new THREE.Vector3(1, 0, 0) },
    };
  }
  const BUMP = { mercury: 0.9, moon: 0.6, mars: 0.18, earth: 0.1, pluto: 0.35, charon: 0.9, io: 0, europa: 0.15, ganymede: 1.4, callisto: 1.6, enceladus: 1.0,
    titania: 1.8, oberon: 1.8, miranda: 1.8, phobos: 2.2, deimos: 1.8, triton: 1.0 };

  for (const b of BODIES) {
    b.visR = (b.kind === 'star') ? SUN_VIS : Math.max(Math.pow(b.R / 6371, 0.55), b.kind === 'moon' ? 0.07 : 0.2);
    b.realR = b.R / AU_KM * U;
    b.rad = b.visR;
    b.pos = new THREE.Vector3(); b.realKm = new THREE.Vector3(); b.realRel = new THREE.Vector3(); b.helio = new THREE.Vector3();
    b.spinShown = 0; b.dist = 0; b.theta = 0; b.hidden = false;
    b.root = new THREE.Group(); b.tilt = new THREE.Group(); b.spinG = new THREE.Group();
    b.root.add(b.tilt); b.tilt.add(b.spinG);
    b.shapeK = b.shape ? b.shape.map((v) => v / b.R) : [1, 1, 1];
    if (b.kind !== 'moon') {
      if (b.id === 'earth') b.tilt.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -OBLIQ);
      else {
        // IAU frame: local Y = north pole, local X = ascending node of the body's equator on the Earth's equator (J2000)
        const pole = eqToScene(b.pole[0], b.pole[1], new THREE.Vector3());
        const node = new THREE.Vector3().crossVectors(eqToScene(0, 90, new THREE.Vector3()), pole).normalize();
        const third = new THREE.Vector3().crossVectors(node, pole);
        b.tilt.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(node, pole, third));
      }
      scene.add(b.root);
    }
  }
  for (const m of MOONS) {
    const p = byId[m.parent];
    m.orbitPlane = new THREE.Group();
    if (m.special === 'luna') { p.root.add(m.orbitPlane); p.root.add(m.root); }
    else { m.orbitPlane.rotation.x = ((m.inc || 0) + (p.spin < 0 ? 180 : 0)) * DEG; p.tilt.add(m.orbitPlane); m.orbitPlane.add(m.root); }
  }

  // Sun
  sun.mat = new THREE.ShaderMaterial({ vertexShader: SH.PLANET_VERT, fragmentShader: SH.SUN_FRAG, uniforms: { uTime: { value: 0 }, uNoise: { value: noiseTex } } });
  sun.mesh = new THREE.Mesh(geoHi, sun.mat);
  sun.spinG.add(sun.mesh);
  const coronaMat = new THREE.ShaderMaterial({
    vertexShader: SH.CORONA_VERT, fragmentShader: SH.CORONA_FRAG,
    uniforms: { uTime: { value: 0 }, uSunQ: { value: 0.15 }, uFade: { value: 1 }, uStar: { value: 0 }, uNoise: { value: noiseTex } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const corona = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), coronaMat);
  corona.renderOrder = 5; corona.frustumCulled = false;
  scene.add(corona);

  // Planets and moons
  for (const b of BODIES) {
    if (b.kind === 'star') continue;
    const u = planetUniforms();
    u.map.value = solidTex(b.color);
    u.uBump.value = BUMP[b.id] || 0;
    u.uFlat.value = b.f || 0;
    if (b.atmo) {
      u.uAtmo.value.fromArray(b.atmo.color);
      u.uAtmoK.value = b.atmo.rim;
      u.uWrap.value = b.id === 'venus' || b.id === 'titan' ? 0.18 : (b.kind === 'planet' && b.R > 20000 ? 0.02 : 0.04);
    }
    if (b.id === 'earth') u.uSpec.value = 1.0;
    if (b.id === 'moon') u.uUmbra.value.set(0.30, 0.075, 0.025);
    if (b.rings === 'saturn') u.uRingOn.value = 1;
    b.mat = new THREE.ShaderMaterial({ vertexShader: SH.PLANET_VERT, fragmentShader: SH.PLANET_FRAG, uniforms: u });
    const geo = b.shape ? lumpy(b.id === 'phobos' ? 1.3 : b.id === 'halley' ? 7.7 : 4.1) : (b.kind === 'moon' || b.kind === 'comet' ? geoMd : geoHi);
    b.mesh = new THREE.Mesh(geo, b.mat);
    b.spinG.add(b.mesh);
    if (b.atmo) {
      b.shellK = 1 + b.atmo.h * 4;
      b.atmoMat = new THREE.ShaderMaterial({
        vertexShader: SH.PLANET_VERT, fragmentShader: SH.ATMO_FRAG,
        uniforms: { uSunV: u.uSunV, uCenterV: u.uCenterV, uR: { value: 1 }, uH: { value: b.atmo.h }, uShell: { value: 1 },
          uColor: { value: new THREE.Vector3().fromArray(b.atmo.color) }, uK: { value: b.atmo.k }, uTint: { value: b.id === 'earth' || b.id === 'mars' ? 1 : 0 } },
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.BackSide,
      });
      b.atmoMesh = new THREE.Mesh(geoMd, b.atmoMat);
      b.atmoMesh.renderOrder = 2;
      b.tilt.add(b.atmoMesh);
    }
    if (b.rings) {
      const sat = b.rings === 'saturn';
      const g = new THREE.RingGeometry(sat ? 1.105 : 1.6, sat ? 2.34 : 2.05, LOWQ ? 192 : 360, sat ? 6 : 2);
      g.rotateX(-Math.PI / 2);
      b.ringMat = new THREE.ShaderMaterial({
        vertexShader: SH.PLANET_VERT, fragmentShader: SH.RING_FRAG,
        uniforms: { uSunDirL: { value: new THREE.Vector3() }, uCamL: { value: new THREE.Vector3() }, uFlat: { value: b.f }, uKind: { value: sat ? 0 : 1 }, uKmPerUnit: { value: b.R } },
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      b.ringMesh = new THREE.Mesh(g, b.ringMat);
      b.ringMesh.renderOrder = 3;
      b.tilt.add(b.ringMesh);
    }
    if (b.kind !== 'moon') {
      const mk = (y0, y1, op) => {
        const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, y0, 0), new THREE.Vector3(0, y1, 0)]);
        return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xf2b660, transparent: true, opacity: op, depthWrite: false }));
      };
      b.axis = new THREE.Group();
      b.axis.add(mk(0, 1.7, 0.95), mk(-1.7, 0, 0.3));
      b.axis.visible = false;
      b.tilt.add(b.axis);
    }
  }
  // Earth clouds share the occlusion uniforms of the ground
  {
    const u = planetUniforms();
    const eu = earth.mat.uniforms;
    u.uSunV = eu.uSunV; u.uCenterV = eu.uCenterV; u.uOcc = eu.uOcc; u.uOccN = eu.uOccN; u.uSunAng = eu.uSunAng; u.uSunDirV = eu.uSunDirV;
    u.map.value = solidTex('#ffffff', 0);
    u.uCloud.value = 1; u.uOpacity.value = 0.95; u.uWrap.value = 0.05; u.uAmbient.value = 0.004;
    earth.cloudMat = new THREE.ShaderMaterial({ vertexShader: SH.PLANET_VERT, fragmentShader: SH.PLANET_FRAG, uniforms: u, transparent: true, depthWrite: false });
    earth.clouds = new THREE.Mesh(geoHi, earth.cloudMat);
    earth.clouds.renderOrder = 1;
    earth.tilt.add(earth.clouds);
    earth.cloudDrift = 0;
  }
  // Halley: coma and two tails that always point away from the Sun
  const halley = byId.halley;
  {
    const g = new THREE.ConeGeometry(1, 1, 48, 1, true);
    g.translate(0, -0.5, 0);
    const tailMat = (rgb) => new THREE.ShaderMaterial({
      vertexShader: SH.TAIL_VERT, fragmentShader: SH.TAIL_FRAG,
      uniforms: { uColor: { value: new THREE.Vector3(rgb[0], rgb[1], rgb[2]) }, uAct: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    halley.ionTail = new THREE.Mesh(g, tailMat([0.35, 0.62, 1.0]));
    halley.dustTail = new THREE.Mesh(g, tailMat([1.0, 0.86, 0.62]));
    halley.coma = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: SH.CORONA_VERT, fragmentShader: SH.COMA_FRAG,
      uniforms: { uColor: { value: new THREE.Vector3(0.75, 0.9, 1.0) }, uAct: { value: 0 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    for (const m of [halley.ionTail, halley.dustTail, halley.coma]) { m.frustumCulled = false; m.renderOrder = 6; halley.root.add(m); }
  }
  const cometTmp = new THREE.Vector3();
  function updateComet() {
    const rAU = halley.helio.length();
    const act = Math.pow(clamp(1 - (rAU - 0.6) / 3.4, 0, 1), 1.5);
    const on = act > 0.002;
    halley.ionTail.visible = halley.dustTail.visible = halley.coma.visible = on;
    if (!on) return;
    const t = S.scaleT;
    const len = act * (32 * (1 - t) + 12 * t) + 0.5;
    const toSun = V0.copy(halley.pos).negate().normalize();
    planetAU(halley, S.jd + 0.5, cometTmp);
    const vel = cometTmp.sub(halley.helio).normalize();
    halley.ionTail.quaternion.setFromUnitVectors(AXIS_Y, toSun);
    halley.ionTail.scale.set(len * 0.035, len, len * 0.035);
    // the dust tail lags behind the motion: tilting the sunward axis forward bends the tail backwards
    const fwd = V2.copy(vel).addScaledVector(toSun, -vel.dot(toSun)).normalize();
    const dustAxis = V3.copy(toSun).multiplyScalar(Math.cos(0.32)).addScaledVector(fwd, Math.sin(0.32)).normalize();
    halley.dustTail.quaternion.setFromUnitVectors(AXIS_Y, dustAxis);
    halley.dustTail.scale.set(len * 0.13, len * 0.8, len * 0.13);
    halley.ionTail.material.uniforms.uAct.value = act * 0.9;
    halley.dustTail.material.uniforms.uAct.value = act * 0.75;
    const comaR = (0.25 + act * 2.2) * (1 - t) + (0.004 + act * 0.25) * t;
    halley.coma.scale.setScalar(comaR);
    halley.coma.quaternion.copy(camera.quaternion);
    // fade the coma when the camera is inside it, so the nucleus stays visible
    const dc = camera.position.distanceTo(halley.pos);
    halley.coma.material.uniforms.uAct.value = (0.35 + act * 0.65) * smoothstep(comaR * 0.8, comaR * 3, dc);
  }

  // Who can eclipse whom (real geometry, see SHADOW_FN)
  for (const b of BODIES) {
    if (b.kind === 'star') { b.occ = []; continue; }
    if (b.kind === 'moon') {
      const p = byId[b.parent];
      b.occ = [p, ...MOONS.filter((m) => m.parent === b.parent && m !== b).sort((x, y) => y.R - x.R)].slice(0, 4);
    } else {
      b.occ = MOONS.filter((m) => m.parent === b.id).sort((x, y) => y.R - x.R).slice(0, 4);
    }
  }

  // ------------------------------------------------------------------ orbits
  const ORBIT_N = 1024;
  function orbitMaterial(hex, opacity) {
    return new THREE.ShaderMaterial({
      vertexShader: SH.ORBIT_VERT, fragmentShader: SH.ORBIT_FRAG,
      uniforms: { uColor: { value: new THREE.Color(hex) }, uPhase: { value: 0 }, uOpacity: { value: opacity }, uBodyV: { value: new THREE.Vector3() }, uBodyR: { value: 1 }, uDir: { value: 1 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
  }
  function lineLoop(n, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const ph = new Float32Array(n); for (let i = 0; i < n; i++) ph[i] = i / n;
    g.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    const l = new THREE.LineLoop(g, mat); l.frustumCulled = false;
    return l;
  }
  for (const b of ORBITERS) {
    b.orbit = lineLoop(ORBIT_N, orbitMaterial(b.color, b.kind === 'dwarf' || b.kind === 'comet' ? 0.45 : 0.6));
    b.orbit.renderOrder = 4;
    scene.add(b.orbit);
    b.orbitJd = -1e9; b.orbitT = -1;
  }
  function rebuildOrbit(b) {
    const elv = elementsAt(b.el, (S.jd - J2000) / 36525);
    const arr = b.orbit.geometry.attributes.position;
    for (let i = 0; i < ORBIT_N; i++) {
      orbitPoint(elv, (i / ORBIT_N) * TAU, V0);
      const r = V0.length();
      V0.multiplyScalar(mapR(r) / r);
      arr.setXYZ(i, V0.x, V0.y, V0.z);
    }
    arr.needsUpdate = true;
    b.orbitJd = S.jd; b.orbitT = S.scaleT;
  }
  const circle = (n) => { const a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const t = (i / n) * TAU; a[i * 3] = Math.cos(t); a[i * 3 + 2] = -Math.sin(t); } return a; };
  for (const m of MOONS) {
    m.orbit = lineLoop(256, orbitMaterial(m.color, 0.5));
    m.orbit.geometry.attributes.position.array.set(circle(256));
    m.orbit.renderOrder = 4;
    m.orbitPlane.add(m.orbit);
  }

  // ------------------------------------------------------------------ belts
  const beltMats = [];
  function makeBelt(n, gen, hex, opacity, px) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    const el = new Float32Array(n * 4), el2 = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { const o = gen(i); el.set([o.a, o.e, o.i, o.O], i * 4); el2.set([o.w, o.M0, o.n, 0], i * 4); }
    g.setAttribute('aEl', new THREE.BufferAttribute(el, 4));
    g.setAttribute('aEl2', new THREE.BufferAttribute(el2, 4));
    const mat = new THREE.ShaderMaterial({
      vertexShader: SH.BELT_VERT, fragmentShader: SH.BELT_FRAG,
      uniforms: { uDays: { value: 0 }, uMix: { value: 0 }, uPix: { value: px * DPR }, uLamJ: { value: 0 }, uColor: { value: new THREE.Color(hex) }, uOpacity: { value: opacity } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    mat.userData.px = px;
    beltMats.push(mat);
    const p = new THREE.Points(g, mat); p.frustumCulled = false; p.renderOrder = 4;
    scene.add(p);
    return p;
  }
  const rnd = mulberry32(7);
  const gauss = () => { let u = 0; while (!u) u = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * rnd()); };
  const KIRKWOOD = [2.502, 2.825, 2.958, 3.279];
  const K_GAUSS = 0.01720209895;
  const beltMain = makeBelt(LOWQ ? 5000 : 9000, () => {
    let a;
    do { a = 2.1 + 1.25 * rnd(); } while (KIRKWOOD.some((g) => Math.abs(a - g) < 0.012 + 0.012 * rnd()) || (a > 3.0 && rnd() < 0.45));
    return { a, e: Math.min(0.3, Math.abs(0.07 + gauss() * 0.06)), i: Math.abs(gauss()) * 0.12, O: rnd() * TAU, w: rnd() * TAU, M0: rnd() * TAU, n: K_GAUSS / Math.pow(a, 1.5) };
  }, '#b8a68f', 0.3, 1.4);
  const nJ = (3034.74612775 / 36525) * DEG, lamJ0 = 34.39644051 * DEG;
  const trojans = makeBelt(LOWQ ? 1000 : 1800, (i) => {
    const side = i % 2 ? 1 : -1, O = rnd() * TAU, w = rnd() * TAU;
    return { a: 5.2026 + gauss() * 0.04, e: Math.abs(gauss() * 0.06), i: Math.abs(gauss()) * 0.2, O, w, M0: lamJ0 + side * 60 * DEG + gauss() * 13 * DEG - O - w, n: nJ };
  }, '#c9a77c', 0.32, 1.4);
  const kuiper = makeBelt(LOWQ ? 3000 : 5500, () => {
    const plut = rnd() < 0.22;
    const a = plut ? 39.45 + gauss() * 0.25 : 42 + rnd() * 6.5;
    return { a, e: plut ? 0.08 + rnd() * 0.22 : Math.abs(gauss() * 0.05), i: Math.abs(gauss()) * (plut ? 0.18 : 0.06) + (rnd() < 0.25 ? rnd() * 0.45 : 0),
      O: rnd() * TAU, w: rnd() * TAU, M0: rnd() * TAU, n: K_GAUSS / Math.pow(a, 1.5) };
  }, '#8fa6c4', 0.26, 1.4);

  // ------------------------------------------------------------------ labels, strip
  const labelsEl = $('#labels');
  const tipEl = $('#tip');
  for (const b of BODIES) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'lbl off' + (b.kind === 'moon' ? ' moon' : '');
    el.style.setProperty('--c', b.color);
    el.innerHTML = `<span class="dot"></span><span>${b.name}</span>`;
    el.setAttribute('aria-label', 'Xem ' + b.name);
    el.addEventListener('click', (e) => { e.stopPropagation(); select(b); });
    el.addEventListener('pointerenter', () => { S.hoverLabel = b; });
    el.addEventListener('pointerleave', () => { if (S.hoverLabel === b) S.hoverLabel = null; });
    labelsEl.appendChild(el);
    b.label = el; b.lw = 0; b.lblVisible = false;
  }
  const STRIP = ['sun', 'mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  const stripEl = $('#strip');
  for (const id of STRIP) {
    const b = byId[id];
    const el = document.createElement('button');
    el.className = 'sbtn'; el.type = 'button';
    el.style.setProperty('--c', b.color);
    el.innerHTML = `<span class="th"><span class="ph"></span></span><span class="nm">${b.name.replace('Sao ', '')}</span><span class="key">${b.key}</span>`;
    el.title = `${b.name} (${b.key})`;
    el.setAttribute('aria-label', b.name);
    el.addEventListener('click', () => (S.focus === b ? goHome() : select(b)));
    stripEl.appendChild(el);
    b.stripBtn = el;
  }
  function updateStrip() {
    const cur = S.focus ? (S.focus.kind === 'moon' ? byId[S.focus.parent] : S.focus) : null;
    for (const id of STRIP) byId[id].stripBtn.setAttribute('aria-current', cur && cur.id === id ? 'true' : 'false');
  }

  // ------------------------------------------------------------------ formatting
  const nf = (x, d = 0) => x.toLocaleString('vi-VN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  const pad = (n) => String(n).padStart(2, '0');
  function fmtKm(km) {
    if (km < 1e6) return { v: nf(km), u: 'km' };
    if (km < 1e9) return { v: nf(km / 1e6, km < 1e8 ? 2 : 1), u: 'triệu km' };
    return { v: nf(km / 1e9, 2), u: 'tỉ km' };
  }
  function fmtTime(sec) {
    if (sec < 0.1) return nf(sec * 1000, sec < 0.01 ? 2 : 1) + ' mili giây';
    if (sec < 60) return nf(sec, sec < 10 ? 2 : 1) + ' giây';
    if (sec < 3600) { const m = Math.floor(sec / 60), s = Math.round(sec % 60); return `${m} phút ${s} giây`; }
    const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
    return `${h} giờ ${m} phút`;
  }

  // ------------------------------------------------------------------ panel
  const panel = $('#panel');
  function eyebrowOf(b) {
    if (b.kind === 'star') return b.eyebrow;
    if (b.kind === 'moon') return 'Vệ tinh của ' + byId[b.parent].name;
    if (b.kind === 'dwarf') return 'Hành tinh lùn · vành đai Kuiper';
    if (b.kind === 'comet') return 'Sao chổi chu kỳ ngắn · quỹ đạo nghịch hành';
    return `Hành tinh ${b.type} · thứ ${b.order} tính từ Mặt Trời`;
  }
  function compareSvg(b) {
    let ref = earth, refName = 'Trái Đất';
    if (b.id === 'earth') { ref = byId.moon; refName = 'Mặt Trăng'; }
    else if (b.kind === 'moon' && b.id !== 'moon' && b.R < 2000) { ref = byId.moon; refName = 'Mặt Trăng'; }
    if (b.id === 'sun') {
      const er = 92 / 109;
      return `<svg viewBox="0 0 300 120" width="300" height="120" role="img" aria-label="Mặt Trời lớn gấp 109 lần Trái Đất">
        <defs><radialGradient id="cg" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff2cf"/><stop offset="0.7" stop-color="#f6b453"/><stop offset="1" stop-color="#d9722a"/></radialGradient></defs>
        <circle cx="150" cy="${120 + 92 - 108}" r="92" fill="url(#cg)" opacity="0.9"/>
        <circle cx="262" cy="104" r="${Math.max(er, 0.9)}" fill="#6aa6e0"/>
        <text x="262" y="92" text-anchor="middle" font-size="10" fill="rgba(238,232,220,0.6)" font-family="Be Vietnam Pro, sans-serif">Trái Đất</text></svg>
        <div class="cap">Đặt cạnh nhau, Trái Đất chỉ là một chấm nhỏ: đường kính Mặt Trời gấp 109 lần.</div>`;
    }
    const big = Math.max(b.R, ref.R), k = 52 / big;
    const r1 = Math.max(b.R * k, 0.8), r2 = Math.max(ref.R * k, 0.8);
    const ratio = b.R / ref.R;
    const txt = ratio >= 1 ? `Đường kính gấp ${nf(ratio, ratio < 10 ? 2 : 1)} lần ${refName}.` : `Đường kính bằng ${nf(ratio * 100, ratio < 0.1 ? 1 : 0)}% ${refName}.`;
    const vw = Math.ceil(r1 * 2 + Math.max(r2 * 2, 56) + 40);
    return `<svg viewBox="0 0 ${vw} 116" width="${vw}" height="116" role="img" aria-label="${txt}">
      <defs><radialGradient id="cg" cx="0.38" cy="0.35" r="0.75"><stop offset="0" stop-color="${b.color}"/><stop offset="1" stop-color="${b.color}" stop-opacity="0.35"/></radialGradient></defs>
      <circle cx="${r1 + 2}" cy="${106 - r1}" r="${r1}" fill="url(#cg)"/>
      <circle cx="${r1 * 2 + Math.max(r2, 28) + 14}" cy="${106 - r2}" r="${r2}" fill="none" stroke="rgba(238,232,220,0.55)" stroke-dasharray="3 3"/>
      <text x="${r1 * 2 + Math.max(r2, 28) + 14}" y="${Math.max(10, 106 - r2 * 2 - 6)}" text-anchor="middle" font-size="10" fill="rgba(238,232,220,0.6)" font-family="Be Vietnam Pro, sans-serif">${refName}</text>
    </svg><div class="cap">${txt}</div>`;
  }
  function renderPanel(b) {
    panel.style.setProperty('--body', b.color);
    const stats = (b.stats || []).map(([title, rows]) => `<section class="p-sec"><h3>${title}</h3><dl class="stats">${rows.map((r) =>
      `<div class="row"><dt>${r[0]}</dt><dd>${r[1]}${r[2] ? `<small>${r[2]}</small>` : ''}</dd></div>`).join('')}</dl></section>`).join('');
    const kids = b.moons.length ? `<section class="p-sec"><h3>Vệ tinh trong mô hình</h3><div class="chips">${b.moons.map((id) =>
      `<button class="chip" data-go="${id}" style="--c:${byId[id].color}"><i></i>${byId[id].name}</button>`).join('')}</div></section>` : '';
    const parent = b.parent ? `<section class="p-sec"><h3>Quay quanh</h3><div class="chips"><button class="chip" data-go="${b.parent}" style="--c:${byId[b.parent].color}"><i></i>${byId[b.parent].name}</button>${
      byId[b.parent].moons.filter((id) => id !== b.id).map((id) => `<button class="chip" data-go="${id}" style="--c:${byId[id].color}"><i></i>${byId[id].name}</button>`).join('')}</div></section>` : '';
    const g = b.g;
    const calc = g ? `<section class="p-sec"><h3>Nếu bạn đứng ở đó</h3><div class="calc">
        <div class="two">
          <div><label for="c-w">Cân nặng trên Trái Đất</label><div class="in"><input id="c-w" type="number" inputmode="decimal" min="1" max="500" step="1"><span class="unit">kg</span></div></div>
          ${b.Pdays ? `<div><label for="c-b">Ngày sinh của bạn</label><div class="in"><input id="c-b" type="date" min="1900-01-01"></div></div>` : ''}
        </div>
        <output id="c-wo"></output>${b.Pdays ? '<output id="c-bo"></output>' : ''}
      </div></section>` : '';
    panel.innerHTML = `
      <div class="p-grab" id="p-grab" role="button" tabindex="0" aria-label="Mở rộng hoặc thu gọn bảng thông tin"></div>
      <div class="p-head">
        <div class="p-eyebrow"><span class="p-dot"></span><span>${eyebrowOf(b)}</span></div>
        <h2 class="p-name">${b.name}</h2>
        ${b.en && b.en !== b.name ? `<div class="p-en">${b.en}</div>` : ''}
        <button class="p-close" id="p-close" aria-label="Đóng và về tổng quan" title="Đóng (Esc)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
      </div>
      <div class="p-scroll" id="p-scroll">
        <p class="p-lede">${b.desc}</p>
        <section class="p-sec"><h3>Ngay lúc này <span class="when" id="live-when"></span></h3><div class="live" id="live"></div></section>
        <section class="p-sec"><h3>${b.id === 'earth' || (b.kind === 'moon' && b.id !== 'moon' && b.R < 2000) ? 'So sánh kích thước' : 'So với Trái Đất'}</h3><div class="compare">${compareSvg(b)}</div></section>
        ${stats}
        ${calc}
        <section class="p-sec"><h3>Có thể bạn chưa biết</h3><ul class="facts">${b.facts.map((f) => `<li>${f}</li>`).join('')}</ul></section>
        ${kids}${parent}
        <p class="p-src">${b.src}</p>
      </div>`;
    panel.hidden = false;
    panel.classList.remove('tall');
    $('#p-close').addEventListener('click', goHome);
    const grab = $('#p-grab');
    const toggleTall = () => panel.classList.toggle('tall');
    grab.addEventListener('click', toggleTall);
    grab.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleTall(); } });
    panel.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => select(byId[el.dataset.go])));
    if (g) {
      const wIn = $('#c-w'), bIn = $('#c-b');
      wIn.value = store.get('weight', 60);
      if (bIn) bIn.value = store.get('birth', '2000-01-01');
      const upd = () => {
        const w = parseFloat(wIn.value);
        const wo = $('#c-wo');
        if (w > 0) {
          const v = w * g / 9.80665;
          wo.innerHTML = `Cân sẽ chỉ khoảng ${nf(v, v < 10 ? 2 : 1)} kg<small>${b.gNote ? 'Tính ' + b.gNote + ', vì ở đây không có mặt đất để đứng.' : `Khối lượng của bạn không đổi, chỉ lực hút thay đổi (${nf(g / 9.80665, 3)} g).`}</small>`;
          store.set('weight', w);
        } else wo.textContent = '';
        if (bIn) {
          const d = new Date(bIn.value + 'T00:00:00');
          const bo = $('#c-bo');
          if (!isNaN(d)) {
            const days = (jdToDate(S.jd) - d) / 86400000;
            if (days > 0) {
              const age = days / b.Pdays;
              const next = b.Pdays * (Math.floor(age) + 1) - days;
              bo.innerHTML = `Bạn ${nf(age, age < 10 ? 2 : 1)} tuổi ${b.name}<small>${next > 0 ? `Sinh nhật kế tiếp theo năm ${b.name} sau ${nf(next, 0)} ngày.` : ''}</small>`;
              store.set('birth', bIn.value);
            } else bo.textContent = '';
          } else bo.textContent = '';
        }
      };
      wIn.addEventListener('input', upd);
      if (bIn) bIn.addEventListener('input', upd);
      upd();
    }
    updateLive(true);
  }
  function liveCell(k, v, u, s) { return `<div><div class="k">${k}</div><div class="v">${v}${u ? ` <small>${u}</small>` : ''}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`; }
  let liveTimer = 0;
  function updateLive(force) {
    if (panel.hidden || !S.focus) return;
    const now = performance.now();
    if (!force && now - liveTimer < 220) return;
    liveTimer = now;
    const b = S.focus, el = $('#live');
    if (!el) return;
    const d = jdToDate(S.jd);
    $('#live-when').textContent = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const cells = [];
    const eKm = earth.realKm;
    if (b.id === 'sun') {
      const r = eKm.length(), f = fmtKm(r);
      cells.push(liveCell('Cách Trái Đất', f.v, f.u, nf(r / AU_KM, 4) + ' AU'));
      cells.push(liveCell('Ánh sáng tới Trái Đất mất', fmtTime(r / C_KM), '', ''));
      const ls = (eclLon(V0.copy(eKm).negate()));
      cells.push(liveCell('Kinh độ hoàng đạo', nf(ls, 1) + '°', '', 'nhìn từ Trái Đất'));
      cells.push(liveCell('Mùa ở Bắc bán cầu', seasonOf(ls), '', 'theo thiên văn'));
    } else if (b.id === 'moon') {
      const rel = b.realRel, r = rel.length();
      const sunDir = V0.copy(eKm).negate().normalize();
      const elong = ((eclLon(rel) - eclLon(sunDir)) % 360 + 360) % 360;
      const cosE = rel.clone().normalize().dot(sunDir);
      const illum = (1 - cosE) / 2 * 100;
      cells.push(liveCell('Cách Trái Đất', nf(r), 'km', `${nf(r / 6371, 1)} lần bán kính Trái Đất`));
      cells.push(liveCell('Pha trăng', moonPhase(elong), '', `${nf(illum, 0)}% mặt trăng được chiếu sáng`));
      cells.push(liveCell('Tuổi trăng', nf(elong / 360 * 29.530589, 1), 'ngày', 'tính từ lần trăng non gần nhất'));
      cells.push(liveCell('Ánh sáng tới Trái Đất mất', fmtTime(r / C_KM), '', ''));
    } else {
      const rs = b.realKm.length(), fs = fmtKm(rs);
      const re = V0.copy(b.realKm).sub(eKm).length();
      if (b.kind === 'moon') {
        const p = byId[b.parent];
        cells.push(liveCell('Cách ' + p.name, nf(b.a), 'km', `${nf(b.a / p.R, 1)} lần bán kính ${p.name}`));
        const fe = fmtKm(re);
        cells.push(liveCell('Cách Trái Đất', fe.v, fe.u, nf(re / AU_KM, 3) + ' AU'));
        cells.push(liveCell('Tín hiệu từ Trái Đất mất', fmtTime(re / C_KM), '', 'đi với tốc độ ánh sáng'));
        cells.push(liveCell('Một vòng quỹ đạo', b.P < 1 ? nf(b.P * 24, 1) : nf(b.P, 2), b.P < 1 ? 'giờ' : 'ngày', b.inc > 90 ? 'chiều nghịch' : ''));
      } else {
        cells.push(liveCell('Cách Mặt Trời', fs.v, fs.u, nf(rs / AU_KM, 3) + ' AU'));
        if (b.id !== 'earth') {
          const fe = fmtKm(re);
          cells.push(liveCell('Cách Trái Đất', fe.v, fe.u, `tín hiệu mất ${fmtTime(re / C_KM)}`));
        } else {
          const ls = eclLon(V0.copy(eKm).negate());
          cells.push(liveCell('Mùa ở Bắc bán cầu', seasonOf(ls), '', 'Nam bán cầu: ' + seasonOf((ls + 180) % 360).toLowerCase()));
        }
        const a = b.elv ? b.elv[0] * AU_KM : rs;
        const v = Math.sqrt(GM_SUN * (2 / rs - 1 / a));
        cells.push(liveCell('Tốc độ quỹ đạo', nf(v, 2), 'km/s', `${nf(v * 3600)} km/h`));
        cells.push(liveCell('Ánh sáng Mặt Trời tới mất', fmtTime(rs / C_KM), '', ''));
      }
    }
    el.innerHTML = cells.join('');
  }
  function seasonOf(ls) { return ['Xuân', 'Hạ', 'Thu', 'Đông'][Math.floor(((ls % 360) + 360) % 360 / 90)]; }
  function moonPhase(e) {
    if (e < 7 || e > 353) return 'Trăng non';
    if (e < 83) return 'Lưỡi liềm đầu tháng';
    if (e < 97) return 'Thượng huyền';
    if (e < 173) return 'Trăng gần tròn';
    if (e < 187) return 'Trăng tròn';
    if (e < 263) return 'Trăng đang khuyết';
    if (e < 277) return 'Hạ huyền';
    return 'Lưỡi liềm cuối tháng';
  }

  // ------------------------------------------------------------------ selection & camera flights
  function select(b, opts = {}) {
    if (!b) { goHome(); return; }
    if (b.kind === 'moon' && !S.layers.moons) setLayer('moons', true);
    S.focus = b;
    prioritize(b.id);
    flyTo(b, opts);
    renderPanel(b);
    updateStrip();
    setHash(b.id);
  }
  function goHome() {
    const had = S.focus;
    S.focus = null;
    panel.hidden = true;
    panel.innerHTML = '';
    updateStrip();
    setHash('');
    if (had || camera.position.length() > overviewDist() * 3) flyTo(null);
    if (S.tour) stopTour();
  }
  function setHash(id) { try { history.replaceState(null, '', id ? '#' + id : location.pathname + location.search); } catch (e) { /* sandboxed */ } }
  function overviewDist() { return mapR(10) * (W / H < 0.8 ? 3.4 : 2.05); }
  function focusDist(b) {
    if (b.kind === 'comet') return Math.max(b.rad * 6, 9 * (1 - S.scaleT) + 0.3 * S.scaleT) * (W / H < 0.8 ? 1.55 : 1);
    const k = b.kind === 'star' ? 5.2 : b.rings === 'saturn' ? 8.2 : b.rings ? 6.6 : 5.4;
    return b.rad * k * (W / H < 0.8 ? 1.55 : 1);
  }
  function niceDir(b, view) {
    const toSun = V1.copy(b.pos).negate();
    if (toSun.lengthSq() < 1e-12) return V2.copy(camera.position).sub(controls.target).normalize().setY(0.35).normalize();
    toSun.normalize();
    const side = V2.crossVectors(AXIS_Y, toSun).normalize();
    const out = new THREE.Vector3();
    if (view === 'sun') out.copy(toSun).multiplyScalar(0.96).addScaledVector(AXIS_Y, 0.18).addScaledVector(side, 0.12);
    else if (view === 'eclipse') {
      // aim at the point where the Moon's shadow axis meets the Earth (falls back to the Moon's direction)
      const M = byId.moon.realRel, R = b.R;
      const along = M.dot(toSun);
      const p = M.clone().addScaledVector(toSun, -along);
      const g = p.length();
      if (g < R) out.copy(p).addScaledVector(toSun, Math.sqrt(R * R - g * g)).normalize().multiplyScalar(0.75).addScaledVector(toSun, 0.45);
      else out.copy(M).normalize();
    }
    else if (view === 'earthside') out.copy(earth.pos).sub(b.pos).normalize().multiplyScalar(0.98).addScaledVector(AXIS_Y, 0.08).addScaledVector(side, 0.08);
    else out.copy(toSun).multiplyScalar(0.62).addScaledVector(side, 0.72).addScaledVector(AXIS_Y, 0.3);
    out.normalize();
    if (b.rings && !view) {
      // look at the rings from the side the Sun lights, at least ~20 degrees out of the ring plane
      const n = V3.set(0, 1, 0).applyQuaternion(b.tilt.getWorldQuaternion(Q0));
      const sgn = toSun.dot(n) < 0 ? -1 : 1;
      const el = out.dot(n) * sgn;
      const want = Math.sin(22 * DEG);
      if (el < want) {
        const flat = out.clone().addScaledVector(n, -out.dot(n));
        if (flat.lengthSq() < 1e-6) flat.copy(side);
        flat.normalize().multiplyScalar(Math.cos(22 * DEG)).addScaledVector(n, sgn * want);
        out.copy(flat).normalize();
      }
    }
    return out;
  }
  function flyTo(b, opts = {}) {
    updateBodies(0); updateWorld();
    const startTarget = controls.target.clone();
    const off = camera.position.clone().sub(startTarget);
    const d0 = Math.max(off.length(), 1e-9);
    const startDir = off.clone().divideScalar(d0);
    let endDir, d1;
    if (b) { endDir = niceDir(b, opts.view); d1 = opts.distK ? b.rad * opts.distK : focusDist(b); }
    else {
      endDir = startDir.clone();
      const el = Math.asin(clamp(endDir.y, -1, 1));
      const want = clamp(el, 22 * DEG, 62 * DEG);
      const h = Math.hypot(endDir.x, endDir.z) || 1;
      endDir.set(endDir.x / h * Math.cos(want), Math.sin(want), endDir.z / h * Math.cos(want));
      if (opts.dir) endDir.copy(opts.dir).normalize();
      d1 = opts.dist || overviewDist();
    }
    const endTarget = b ? b.pos : ORIGIN;
    const travel = startTarget.distanceTo(endTarget);
    const mid = Math.max(d0, d1, travel * 0.55);
    const dur = reduceMotion() ? 0.35 : clamp(1.5 + 0.55 * Math.log10(1 + travel / Math.max(1e-9, Math.min(d0, d1))), 1.6, 3.6) * (opts.slow || 1);
    S.flight = { body: b, t: 0, dur, startTarget, startDir, q: new THREE.Quaternion().setFromUnitVectors(startDir, endDir), d0, d1, mid };
    controls.enabled = false;
    controls.autoRotate = false;
  }
  function setLimits() {
    const f = S.focus;
    controls.minDistance = f ? f.rad * (f.kind === 'star' ? 1.5 : 1.18) : sun.rad * 1.6;
    controls.maxDistance = mapR(60) * 4;
    controls.enablePan = !f;
  }
  function updateCamera(dt) {
    if (S.flight) {
      const f = S.flight;
      f.t = Math.min(1, f.t + dt / f.dur);
      const e = easeIO(f.t);
      const endT = f.body ? f.body.pos : ORIGIN;
      controls.update();
      const target = V0.lerpVectors(f.startTarget, endT, e);
      const dir = V1.copy(f.startDir).applyQuaternion(Q0.identity().slerp(f.q, e));
      const ld = (1 - e) * (1 - e) * Math.log(f.d0) + 2 * e * (1 - e) * Math.log(f.mid) + e * e * Math.log(f.d1);
      camera.position.copy(target).addScaledVector(dir, Math.exp(ld));
      controls.target.copy(target);
      camera.lookAt(target);
      if (f.t >= 1) { S.flight = null; controls.enabled = true; setLimits(); if (S.tour) controls.autoRotate = true; }
      return;
    }
    if (S.focus) {
      V0.copy(S.focus.pos).sub(controls.target);
      camera.position.add(V0);
      controls.target.copy(S.focus.pos);
    }
    controls.update();
  }

  // ------------------------------------------------------------------ per-frame physics
  function setScale(real, quiet) {
    const to = real ? 1 : 0;
    $('#scale-vis').setAttribute('aria-pressed', String(!real));
    $('#scale-real').setAttribute('aria-pressed', String(real));
    store.set('real', real);
    if (to === S.scaleTo && !S.scaleAnim) return;
    S.scaleTo = to;
    S.scaleAnim = { from: S.scaleT, t: 0, dur: quiet || reduceMotion() ? 0.01 : 2.2 };
    if (!quiet) toast(real ? 'Tỉ lệ thật: hành tinh nhỏ như hạt bụi so với khoảng cách giữa chúng. Dùng tên hoặc dải thiên thể bên dưới để chọn.' : 'Tỉ lệ trực quan: khoảng cách được nén, hành tinh được phóng to để dễ quan sát.');
  }
  // Prime meridian angle: GMST for the Earth, IAU W = W0 + W'·d for the others (texture longitude 0 sits on local +X).
  const primeW = (b, jd) => ((b.W[0] + b.W[1] * (jd - J2000)) % 360) * DEG;
  function spinTarget(b, jd) {
    if (b.id === 'earth') return gmst(jd);
    if (b.W) return primeW(b, jd);
    return b.spin * ((jd - J2000) * 24 / b.rotH) * TAU;
  }
  function updateBodies(dt) {
    const jd = S.jd, t = S.scaleT;
    const rate = S.playing ? SPEEDS[S.speedIdx].v : 0; // days per second
    for (const b of BODIES) b.rad = blendLog(b.visR, b.realR, t);
    for (const b of ORBITERS) {
      const st = planetAU(b, jd, b.helio);
      b.E = st.E; b.elv = st.elv;
      const r = b.helio.length();
      b.realKm.copy(b.helio).multiplyScalar(AU_KM);
      b.root.position.copy(b.helio).multiplyScalar(mapR(r) / r);
    }
    for (const m of MOONS) {
      const p = byId[m.parent];
      if (m.special === 'luna') {
        lunarKm(jd, m.realRel);
        const aKm = m.realRel.length();
        m.dist = blendLog(p.visR * (1.6 + 0.9 * Math.log(aKm / p.R)), aKm / AU_KM * U, t);
        m.root.position.copy(m.realRel).multiplyScalar(m.dist / aKm);
        m.spinG.rotation.y = Math.atan2(m.root.position.z, -m.root.position.x);
        const T = (jd - J2000) / 36525;
        const node = (125.04452 - 1934.136261 * T - 1.3972 * T) * DEG;
        m.orbitPlane.quaternion.setFromAxisAngle(AXIS_Y, node).multiply(Q0.setFromAxisAngle(new THREE.Vector3(1, 0, 0), 5.145 * DEG));
        V0.copy(m.root.position).applyQuaternion(Q0.copy(m.orbitPlane.quaternion).invert());
        m.theta = Math.atan2(-V0.z, V0.x);
      } else {
        // Charon keeps Pluto's prime meridian pointed at it (mutual tidal lock)
        const lam = m.id === 'charon' ? primeW(p, jd) : (m.L0 + 360 / m.P * (jd - J2000)) % 360 * DEG;
        m.theta = lam;
        m.dist = blendLog(p.visR * (1.6 + 0.9 * Math.log(m.a / p.R)), m.a / AU_KM * U, t);
        m.root.position.set(Math.cos(lam) * m.dist, 0, -Math.sin(lam) * m.dist);
        m.spinG.rotation.y = lam + Math.PI;
      }
      m.orbit.scale.setScalar(m.dist);
      // fast moons alias at high speed: hide the body, keep the orbit
      const step = Math.abs(TAU / m.P * rate * dt);
      m.hidden = step > 0.7 || !S.layers.moons;
      m.root.visible = !m.hidden;
      m.orbit.visible = S.layers.moons && S.layers.orbits;
    }
    // spins; at high speed show a capped rotation instead of strobing
    for (const b of BODIES) {
      if (b.kind === 'moon') continue;
      const target = spinTarget(b, jd);
      const per = b.id === 'pluto' ? byId.charon.P * 24 : b.rotH;
      const stepExact = Math.abs(TAU * 24 / per * rate * dt);
      const cap = 0.11;
      if (stepExact > cap * 1.3) b.spinShown += Math.sign(rate) * Math.sign(b.id === 'pluto' ? 1 : b.spin) * cap;
      else {
        const diff = wrapPi(target - b.spinShown);
        b.spinShown += Math.abs(diff) <= cap * 1.5 ? diff : Math.sign(diff) * cap;
      }
      b.spinG.rotation.y = b.spinShown;
    }
    if (earth.clouds) {
      earth.cloudDrift += dt * 0.004 + rate * dt * 0.02;
      earth.clouds.rotation.y = earth.spinShown + earth.cloudDrift;
    }
    // scales
    for (const b of BODIES) {
      const r = b.rad, k = b.shapeK, f = b.f || 0;
      b.mesh.scale.set(r * k[0], r * k[1] * (1 - f), r * k[2]);
      if (b.atmoMesh) b.atmoMesh.scale.set(r * b.shellK, r * b.shellK * (1 - f), r * b.shellK);
      if (b.ringMesh) b.ringMesh.scale.setScalar(r);
      if (b.axis) { b.axis.scale.setScalar(r); b.axis.visible = S.layers.axes; }
    }
    earth.clouds.scale.set(earth.rad * 1.007, earth.rad * 1.007 * (1 - earth.f), earth.rad * 1.007);
    // orbits
    for (const b of ORBITERS) {
      if (Math.abs(b.orbitT - t) > 1e-5 || Math.abs(b.orbitJd - jd) > 3650) rebuildOrbit(b);
      b.orbit.visible = S.layers.orbits;
      const u = b.orbit.material.uniforms;
      u.uPhase.value = ((b.E / TAU) % 1 + 1) % 1;
      u.uDir.value = S.playing && SPEEDS[S.speedIdx].v < 0 ? -1 : 1;
    }
    for (const mat of beltMats) { mat.uniforms.uDays.value = jd - J2000; mat.uniforms.uMix.value = t; }
    beltMain.visible = trojans.visible = S.layers.belt;
    kuiper.visible = S.layers.kuiper;
  }
  function updateWorld() {
    scene.updateMatrixWorld();
    for (const b of BODIES) b.root.getWorldPosition(b.pos);
    for (const m of MOONS) {
      const p = byId[m.parent];
      if (m.special !== 'luna') m.realRel.copy(m.pos).sub(p.pos).normalize().multiplyScalar(m.a);
    }
    for (const m of MOONS) m.realKm.copy(byId[m.parent].realKm).add(m.realRel);
  }

  // ------------------------------------------------------------------ uniforms
  const viewRot = new THREE.Matrix3();
  const sunV = new THREE.Vector3();
  function updateUniforms() {
    const V = camera.matrixWorldInverse;
    viewRot.setFromMatrix4(V);
    sunV.set(0, 0, 0).applyMatrix4(V);
    sun.mat.uniforms.uTime.value = S.time;
    coronaMat.uniforms.uTime.value = S.time;
    for (const b of BODIES) {
      if (b.kind === 'star') continue;
      const u = b.mat.uniforms;
      u.uBump.value = (BUMP[b.id] || 0) * b.rad / b.visR;   // height is in world units, so it scales with the body
      u.uSunV.value.copy(sunV);
      u.uCenterV.value.copy(b.pos).applyMatrix4(V);
      u.uSunAng.value = sun.R / b.realKm.length();
      u.uSunDirV.value.copy(b.pos).negate().normalize().applyMatrix3(viewRot).normalize();
      let n = 0;
      for (const o of b.occ) {
        if (n >= 4) break;
        V0.copy(o.realKm).sub(b.realKm).divideScalar(b.R).applyMatrix3(viewRot);
        u.uOcc.value[n].set(V0.x, V0.y, V0.z, o.R / b.R);
        n++;
      }
      u.uOccN.value = n;
      if (b.atmoMat) {
        const a = b.atmoMat.uniforms;
        a.uR.value = b.rad; a.uShell.value = b.rad * b.shellK;
      }
      if (b.ringMat || b.rings) {
        V1.copy(b.pos).negate().normalize();
        b.tilt.getWorldQuaternion(Q0).invert();
        b.ringMat.uniforms.uSunDirL.value.copy(V1).applyQuaternion(Q0);
        b.ringMat.uniforms.uCamL.value.copy(camera.position);
        b.ringMesh.worldToLocal(b.ringMat.uniforms.uCamL.value);
        b.mesh.getWorldQuaternion(Q0).invert();
        u.uSunDirL.value.copy(V1).applyQuaternion(Q0);
      }
    }
    // corona billboard keeps a visible glow when the Sun is far away
    const tanH = Math.tan(camera.fov * DEG / 2);
    const dist = Math.max(camera.position.length(), 1e-9);
    const sunPx = sun.rad / (dist * tanH) * (H / 2);
    const perPx = 2 * dist * tanH / H;
    const hs = Math.max(sun.rad * 5, 70 * perPx);
    corona.scale.setScalar(hs);
    corona.quaternion.copy(camera.quaternion);
    coronaMat.uniforms.uSunQ.value = sun.rad / hs;
    coronaMat.uniforms.uStar.value = 1 - smoothstep(3, 16, sunPx);
    const frac = sunPx / H;
    bloom.strength = 0.62 - 0.42 * smoothstep(0.03, 0.3, frac);
    coronaMat.uniforms.uFade.value = 1 - 0.6 * smoothstep(0.06, 0.4, frac);
    // orbit trails fade near their body
    const fp = S.focus ? (S.focus.kind === 'moon' ? byId[S.focus.parent] : S.focus) : null;
    for (const b of ORBITERS) {
      const u = b.orbit.material.uniforms; u.uBodyV.value.copy(b.pos).applyMatrix4(V); u.uBodyR.value = b.rad;
      const base = b.kind === 'dwarf' || b.kind === 'comet' ? 0.45 : 0.6;
      u.uOpacity.value += ((fp && fp !== b ? base * 0.2 : base) - u.uOpacity.value) * 0.08;
    }
    for (const m of MOONS) {
      const u = m.orbit.material.uniforms;
      u.uBodyV.value.copy(m.pos).applyMatrix4(V); u.uBodyR.value = m.rad;
      u.uPhase.value = ((m.theta / TAU) % 1 + 1) % 1;
      u.uDir.value = S.playing && SPEEDS[S.speedIdx].v < 0 ? -1 : 1;
      // moon orbits fade in only when the camera is near the planet
      const p = byId[m.parent];
      const dc = camera.position.distanceTo(p.pos);
      u.uOpacity.value = 0.55 * (1 - smoothstep(m.dist * 6, m.dist * 18, dc));
    }
    for (const mat of beltMats) mat.uniforms.uPix.value = mat.userData.px * DPR;
    S.starMat.uniforms.uPix.value = DPR;
  }

  // ------------------------------------------------------------------ labels, picking
  const projV = new THREE.Vector3();
  function project(b) {
    projV.copy(b.pos).project(camera);
    const camDir = V3.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const rel = V2.copy(b.pos).sub(camera.position);
    b.depth = rel.length();
    b.front = rel.dot(camDir) > 0;
    b.sx = (projV.x + 1) / 2 * W;
    b.sy = (1 - projV.y) / 2 * H;
    b.rpx = b.rad / (Math.max(b.depth, 1e-12) * Math.tan(camera.fov * DEG / 2)) * (H / 2);
    b.onScreen = b.front && b.sx > -50 && b.sx < W + 50 && b.sy > -50 && b.sy < H + 50;
  }
  function moonNear(m) {
    const p = byId[m.parent];
    if (camera.position.distanceTo(p.pos) > Math.max(p.rad * 60, m.dist * 5)) return false;
    return !m.onScreen || !p.onScreen || Math.hypot(m.sx - p.sx, m.sy - p.sy) > Math.max(p.rpx + 10, 16);
  }
  const placed = [];
  function updateLabels() {
    for (const b of BODIES) project(b);
    const cand = [];
    for (const b of BODIES) {
      let show = S.layers.labels && b.onScreen && !b.hidden && b.rpx < H * 0.3;
      if (b.kind === 'moon') show = show && S.layers.moons && moonNear(b);
      if (b === S.focus && b.rpx > 30) show = false;
      if (show) {
        for (const o of BODIES) {
          if (o === b || !o.onScreen || o.depth >= b.depth || o.rpx < 3) continue;
          if (Math.hypot(o.sx - b.sx, o.sy - b.sy) < o.rpx * 0.98) { show = false; break; }
        }
      }
      if (show) {
        let pr = b.kind === 'star' ? 100 : b.kind === 'planet' ? 90 - b.order : b.kind === 'dwarf' ? 60 : b.kind === 'comet' ? 58 : (S.focus && (S.focus.id === b.parent || S.focus.parent === b.parent) ? 55 : 30);
        if (b === S.hoverLabel || b === S.hover) pr += 1000;
        cand.push([pr, b]);
      } else if (b.lblVisible) { b.label.classList.add('off'); b.lblVisible = false; }
    }
    cand.sort((a, c) => c[0] - a[0]);
    placed.length = 0;
    for (const [, b] of cand) {
      const el = b.label;
      if (!b.lblVisible) { el.classList.remove('off'); b.lblVisible = true; }
      if (!b.lw) b.lw = el.offsetWidth || 60;
      const dot = b.rpx < 4.5;
      let x = dot ? b.sx - 4.5 : b.sx + b.rpx * 0.72 + 8;
      const y = b.sy - 10;
      const hits = (x0) => placed.some((r) => x0 < r[2] && x0 + b.lw > r[0] && y < r[3] && y + 20 > r[1]);
      let flip = false;
      if (hits(x)) {
        // try the other side of the body before giving up
        const alt = dot ? b.sx - b.lw + 4.5 : b.sx - b.rpx * 0.72 - 8 - b.lw;
        if (!hits(alt)) { x = alt; flip = true; } else { el.classList.add('off'); b.lblVisible = false; continue; }
      }
      x = clamp(x, 6, W - b.lw - 6);
      placed.push([x, y, x + b.lw, y + 20]);
      el.classList.toggle('flip', flip);
      el.classList.toggle('nodot', !dot);
      el.classList.toggle('hover', b === S.hover);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    }
    // sky labels
    const showSky = S.layers.constellations;
    for (const s of skyLabels) {
      if (!showSky) { if (!s.el.hidden) s.el.hidden = true; continue; }
      V0.copy(s.dir).multiplyScalar(1000).add(camera.position);
      const front = V1.copy(s.dir).dot(V2.set(0, 0, -1).applyQuaternion(camera.quaternion)) > 0.05;
      V0.project(camera);
      const x = (V0.x + 1) / 2 * W, y = (1 - V0.y) / 2 * H;
      let vis = front && x > -100 && x < W + 100 && y > 0 && y < H;
      if (vis) for (const b of BODIES) { if (b.onScreen && b.rpx > 3 && Math.hypot(b.sx - x, b.sy - y) < b.rpx * (b.rings ? 2.4 : 1.1)) { vis = false; break; } }
      s.el.hidden = !vis;
      if (vis) {
        if (!s.w) s.w = s.el.offsetWidth;
        s.el.style.transform = `translate3d(${(x - (s.star ? -6 : s.w / 2)).toFixed(1)}px, ${(y - 6).toFixed(1)}px, 0)`;
      }
    }
  }
  function pickAt(x, y) {
    let inside = null, near = null, nearD = Infinity;
    for (const b of BODIES) {
      if (!b.onScreen || b.hidden) continue;
      if (b.kind === 'moon' && !moonNear(b)) continue;
      const d = Math.hypot(x - b.sx, y - b.sy);
      if (d <= b.rpx) { if (!inside || b.depth < inside.depth) inside = b; continue; }
      const hit = b.kind === 'moon' ? 14 : 22;
      if (d <= Math.max(hit, b.rpx + 8) && d < nearD) { near = b; nearD = d; }
    }
    return inside || near;
  }

  // ------------------------------------------------------------------ texture baking
  const bakeScene = new THREE.Scene();
  const bakeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bakeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  bakeQuad.frustumCulled = false;
  bakeScene.add(bakeQuad);
  const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 60); });
  async function bake(id, w, h, uniforms) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: SH.BAKE_VERT, fragmentShader: SH.BAKE_HEAD + SH.SURF[id] + SH.BAKE_MAIN,
      uniforms: Object.assign({ uZero: { value: 0 }, uNoise: { value: noiseTex } }, uniforms || {}), depthTest: false, depthWrite: false,
    });
    bakeQuad.material = mat;
    const rt = new THREE.WebGLRenderTarget(w, h, {
      generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, anisotropy: Math.min(8, maxAniso),
    });
    try { await Promise.race([renderer.compileAsync(bakeScene, bakeCam), new Promise((r) => setTimeout(r, 2500))]); } catch (e) { /* falls back to sync compile */ }
    S.bakeLog = S.bakeLog || [];
    const t0 = performance.now();
    const rows = Math.max(4, Math.floor((LOWQ ? 1.2e5 : 2.6e5) / w));
    for (let y = 0; y < h; y += rows) {
      if (S.lost) throw new Error('context lost');
      rt.scissor.set(0, y, w, Math.min(rows, h - y));
      rt.scissorTest = true;
      renderer.setRenderTarget(rt);
      renderer.render(bakeScene, bakeCam);
      renderer.setRenderTarget(null);
      await nextFrame();
    }
    rt.scissorTest = false;
    S.bakeLog.push([id, w, Math.round(performance.now() - t0)]);
    mat.dispose();
    return rt.texture;
  }
  const bakeQueue = [];
  let bakeMask = null, bakeTotal = 0, bakeDone = 0, bakeReady = null;
  function prioritize(id) {
    const ids = [id, ...(byId[id] ? byId[id].moons : []), ...(byId[id] && byId[id].parent ? [byId[id].parent] : [])];
    if (id === 'earth') ids.push('clouds');
    for (const k of ids.reverse()) {
      const i = bakeQueue.findIndex((e) => e[0] === k);
      if (i > 0) bakeQueue.unshift(bakeQueue.splice(i, 1)[0]);
    }
  }
  async function bakeAll() {
    bakeMask = await new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const t = new THREE.Texture(img);
        t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.wrapS = THREE.RepeatWrapping;
        t.needsUpdate = true; res(t);
      };
      img.onerror = rej;
      img.src = window.EARTH_MASK;
    });
    const q = LOWQ ? 0.5 : 1;
    bakeQueue.push(
      ['earth', 4096], ['clouds', 2048], ['jupiter', 4096], ['saturn', 2048], ['mars', 2048], ['venus', 1024], ['mercury', 2048],
      ['moon', 2048], ['uranus', 1024], ['neptune', 1024], ['pluto', 1024], ['io', 1024], ['europa', 1024], ['ganymede', 1024],
      ['callisto', 1024], ['titan', 512], ['charon', 512], ['triton', 1024], ['enceladus', 512], ['titania', 512],
      ['oberon', 512], ['miranda', 512], ['phobos', 512], ['deimos', 512], ['halley', 512],
    );
    bakeTotal = bakeQueue.reduce((s, [, w]) => s + w * w / 2, 0);
    marks.bakeStart = Math.round(performance.now());
    const gate = new Set(['earth', 'clouds', 'jupiter', 'saturn']);
    let ready = false;
    while (bakeQueue.length) {
      const [id, w0] = bakeQueue.shift();
      const w = Math.min(maxTex, Math.max(256, Math.round(w0 * q))), h = w / 2;
      const target = id === 'clouds' ? earth : byId[id];
      const label = `Đang dựng bề mặt ${id === 'clouds' ? 'mây Trái Đất' : target.name}…`;
      if (!ready) progress(0.08 + 0.9 * bakeDone / bakeTotal, label);
      let tex = null;
      try { tex = await bake(id, w, h, id === 'earth' || id === 'clouds' ? { uMask: { value: bakeMask } } : null); }
      catch (e) { if (S.lost) throw e; console.error('bake', id, e); }
      if (tex) { if (id === 'clouds') earth.cloudMat.uniforms.map.value = tex; else target.mat.uniforms.map.value = tex; }
      bakeDone += w0 * w0 / 2;
      gate.delete(id);
      if (target.stripBtn && (id !== 'earth' || !gate.has('clouds'))) makeThumb(target);
      if (id === 'clouds') makeThumb(earth);
      if (!ready && gate.size === 0) { ready = true; marks.ready = Math.round(performance.now()); progress(1, 'Sẵn sàng. Các bề mặt còn lại tiếp tục được dựng khi bạn khám phá.'); bakeReady && bakeReady(); }
      if (ready) noteBake(bakeQueue.length ? `Đang dựng bề mặt: ${bakeQueue.length} thiên thể còn lại` : '');
    }
    if (!ready) { progress(1, 'Sẵn sàng'); bakeReady && bakeReady(); }
  }
  let bakeNote = '';
  function noteBake(t) { bakeNote = t; noteT = 0; }

  // Thumbnails: render each body once, lit from the upper left, into a small offscreen target.
  const TH = { N: 112 };
  function makeThumb(b) {
    if (!TH.rt) {
      TH.rt = new THREE.WebGLRenderTarget(TH.N, TH.N);
      TH.buf = new Uint8Array(TH.N * TH.N * 4);
      TH.cv = document.createElement('canvas'); TH.cv.width = TH.cv.height = TH.N;
      TH.ctx = TH.cv.getContext('2d');
      TH.scene = new THREE.Scene();
      TH.cam = new THREE.PerspectiveCamera(24, 1, 0.1, 100);
    }
    const { N, rt, buf, cv, ctx, cam } = TH, tScene = TH.scene;
    const sunW = new THREE.Vector3(-700, 260, 520);
    {
      const id = b.id;
      let src;
      if (id === 'sun') {
        ctx.clearRect(0, 0, N, N);
        const g = ctx.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
        g.addColorStop(0, '#fff6dc'); g.addColorStop(0.32, '#ffd27a'); g.addColorStop(0.5, '#f29a35'); g.addColorStop(0.62, 'rgba(242,140,50,0.35)'); g.addColorStop(1, 'rgba(242,140,50,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, N, N);
        src = cv.toDataURL();
      } else {
        const grp = new THREE.Group();
        grp.rotation.set(0.42, 0.5, b.rings === 'saturn' ? -0.3 : -0.12);
        tScene.add(grp);
        const R = 1;
        const camD = b.rings === 'saturn' ? 6.6 : b.rings ? 5.2 : b.atmo ? 5.0 : 4.75;
        cam.position.set(0, 0, camD); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
        const V = cam.matrixWorldInverse;
        const u = b.mat.uniforms;
        const save = { sun: u.uSunV.value.clone(), c: u.uCenterV.value.clone(), n: u.uOccN.value, dl: u.uSunDirL.value.clone() };
        u.uSunV.value.copy(sunW).applyMatrix4(V);
        u.uCenterV.value.set(0, 0, -camD);
        u.uOccN.value = 0;
        const m1 = new THREE.Mesh(b.mesh.geometry, b.mat);
        m1.scale.set(b.shapeK[0], b.shapeK[1] * (1 - (b.f || 0)), b.shapeK[2]);
        grp.add(m1);
        grp.updateMatrixWorld(true);
        const sunDir = sunW.clone().normalize();
        u.uSunDirL.value.copy(sunDir).applyQuaternion(m1.getWorldQuaternion(new THREE.Quaternion()).invert());
        let ringSave, atmoSave;
        if (b.ringMesh) {
          const rm = new THREE.Mesh(b.ringMesh.geometry, b.ringMat);
          grp.add(rm); grp.updateMatrixWorld(true);
          const ru = b.ringMat.uniforms;
          ringSave = { d: ru.uSunDirL.value.clone(), c: ru.uCamL.value.clone() };
          ru.uSunDirL.value.copy(sunDir).applyQuaternion(rm.getWorldQuaternion(new THREE.Quaternion()).invert());
          ru.uCamL.value.copy(cam.position); rm.worldToLocal(ru.uCamL.value);
        }
        if (b.atmoMesh) {
          const am = new THREE.Mesh(b.atmoMesh.geometry, b.atmoMat);
          am.scale.setScalar(b.shellK); grp.add(am);
          const au = b.atmoMat.uniforms;
          atmoSave = { r: au.uR.value, s: au.uShell.value };
          au.uR.value = R; au.uShell.value = b.shellK;
        }
        if (b === earth) {
          const cm = new THREE.Mesh(earth.clouds.geometry, earth.cloudMat); cm.scale.setScalar(1.007); grp.add(cm);
        }
        renderer.setRenderTarget(rt);
        renderer.setClearColor(0x000000, 0);
        renderer.clear();
        renderer.render(tScene, cam);
        renderer.readRenderTargetPixels(rt, 0, 0, N, N, buf);
        renderer.setRenderTarget(null);
        renderer.setClearColor(0x000000, 1);
        u.uSunV.value.copy(save.sun); u.uCenterV.value.copy(save.c); u.uOccN.value = save.n; u.uSunDirL.value.copy(save.dl);
        if (ringSave) { b.ringMat.uniforms.uSunDirL.value.copy(ringSave.d); b.ringMat.uniforms.uCamL.value.copy(ringSave.c); }
        if (atmoSave) { b.atmoMat.uniforms.uR.value = atmoSave.r; b.atmoMat.uniforms.uShell.value = atmoSave.s; }
        tScene.remove(grp);
        const img = ctx.createImageData(N, N);
        for (let y = 0; y < N; y++) {
          for (let x = 0; x < N; x++) {
            const s = ((N - 1 - y) * N + x) * 4, d = (y * N + x) * 4;
            for (let k = 0; k < 3; k++) img.data[d + k] = Math.round(255 * Math.pow(buf[s + k] / 255, 1 / 2.2));
            img.data[d + 3] = buf[s + 3];
          }
        }
        ctx.clearRect(0, 0, N, N);
        ctx.putImageData(img, 0, 0);
        src = cv.toDataURL();
      }
      const th = b.stripBtn.querySelector('.th');
      th.innerHTML = `<img alt="" src="${src}">`;
    }
  }

  makeThumb(sun);

  // ------------------------------------------------------------------ UI: time
  const speedIn = $('#speed'), speedOut = $('#speed-out'), playBtn = $('#t-play'), nowBtn = $('#t-now');
  const dateMain = $('#date-main'), dateSub = $('#date-sub');
  const ICON_PLAY = '<path d="M8 5.5v13l10.5-6.5z"/>';
  const ICON_PAUSE = '<rect x="6.5" y="5.5" width="3.6" height="13" rx="1"/><rect x="13.9" y="5.5" width="3.6" height="13" rx="1"/>';
  function setSpeed(i) {
    S.speedIdx = clamp(i, 0, SPEEDS.length - 1);
    speedIn.value = S.speedIdx;
    speedOut.textContent = SPEEDS[S.speedIdx].t;
  }
  function setPlaying(p) {
    S.playing = p;
    $('#play-ico').innerHTML = p ? ICON_PAUSE : ICON_PLAY;
    playBtn.setAttribute('aria-label', p ? 'Tạm dừng' : 'Chạy tiếp');
  }
  function setJd(jd) {
    S.jd = clamp(jd, JD_MIN, JD_MAX);
    const y = jdToDate(S.jd).getFullYear();
    if ((y < 1800 || y > 2050) && !S.warnedRange) { S.warnedRange = true; toast('Ngoài khoảng 1800–2050, vị trí hành tinh kém chính xác dần.'); }
  }
  let lastDateStr = '';
  function updateDateUI() {
    const d = jdToDate(S.jd);
    const main = `${d.getDate()} tháng ${d.getMonth() + 1}, ${d.getFullYear()}`;
    const sub = `${WEEKDAYS[d.getDay()]} · ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    const key = main + sub;
    if (key !== lastDateStr) { dateMain.textContent = main; dateSub.textContent = sub; lastDateStr = key; }
    nowBtn.classList.toggle('live', Math.abs(S.jd - jdNow()) < 2 / 1440);
  }
  speedIn.addEventListener('input', () => { setSpeed(+speedIn.value); if (!S.playing) setPlaying(true); });
  $('#t-slow').addEventListener('click', () => setSpeed(S.speedIdx - 1));
  $('#t-fast').addEventListener('click', () => setSpeed(S.speedIdx + 1));
  playBtn.addEventListener('click', () => setPlaying(!S.playing));
  nowBtn.addEventListener('click', () => { setJd(jdNow()); if (S.speedIdx < 5) setSpeed(5); toast('Đã về thời điểm hiện tại.'); });

  const datePop = $('#date-pop'), dateBtn = $('#t-date');
  const evHost = $('#events');
  EVENTS.forEach((ev, i) => {
    const b = document.createElement('button');
    b.className = 'ev'; b.type = 'button';
    b.innerHTML = `<b>${ev.label}</b><time>${ev.date}</time><span>${ev.note}</span>`;
    b.addEventListener('click', () => {
      setJd(dateToJd(new Date(ev.iso)));
      setSpeed(ev.speed);
      setPlaying(false);
      closePops();
      if (ev.focus) select(byId[ev.focus], { view: ev.view, distK: ev.distK });
      else { if (S.tour) stopTour(); S.focus = null; panel.hidden = true; updateStrip(); setHash(''); flyTo(null, { dir: new THREE.Vector3(0.0, 0.82, 0.57), dist: mapR(12) * 1.8 }); }
      toast(`${ev.label}, ${ev.date}. Thời gian đang tạm dừng; bấm nút chạy để xem diễn biến.`);
    });
    evHost.appendChild(b);
  });
  function openDatePop() {
    const d = jdToDate(S.jd);
    $('#dt-date').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    $('#dt-time').value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  $('#dt-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#dt-date').value, t = $('#dt-time').value || '12:00';
    const d = new Date(`${v}T${t}:00`);
    if (isNaN(d)) { toast('Ngày chưa hợp lệ. Hãy chọn một ngày từ 1800 đến 2199.'); return; }
    setJd(dateToJd(d));
    closePops();
  });

  // ------------------------------------------------------------------ UI: popovers, layers, scale, tour
  const pops = [[$('#btn-layers'), $('#layers-pop')], [$('#btn-help'), $('#help-pop')], [dateBtn, datePop]];
  function closePops(except) {
    for (const [btn, pop] of pops) if (pop !== except) { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
  }
  for (const [btn, pop] of pops) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = pop.hidden;
      closePops(pop);
      pop.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open && pop === datePop) openDatePop();
    });
    pop.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('click', () => closePops());

  const LAYER_IDS = { orbits: 'ly-orbits', labels: 'ly-labels', moons: 'ly-moons', belt: 'ly-belt', kuiper: 'ly-kuiper', axes: 'ly-axes', constellations: 'ly-const', milkyway: 'ly-mw' };
  function applyLayers() {
    consGroup.visible = S.layers.constellations;
    milky.visible = S.layers.milkyway;
    labelsEl.style.visibility = 'visible';
    for (const k in LAYER_IDS) $('#' + LAYER_IDS[k]).checked = !!S.layers[k];
  }
  function setLayer(k, v) { S.layers[k] = v; store.set('layers', S.layers); applyLayers(); }
  for (const k in LAYER_IDS) $('#' + LAYER_IDS[k]).addEventListener('change', (e) => setLayer(k, e.target.checked));
  applyLayers();

  $('#scale-vis').addEventListener('click', () => setScale(false));
  $('#scale-real').addEventListener('click', () => setScale(true));
  $('#btn-home').addEventListener('click', goHome);
  $('#btn-full').addEventListener('click', () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else {
        const el = document.documentElement;
        const r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
        if (r && r.catch) r.catch(() => toast('Trình duyệt không cho phép toàn màn hình ở đây.'));
      }
    } catch (e) { toast('Trình duyệt không cho phép toàn màn hình ở đây.'); }
  });

  let toastT = 0;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 4800);
  }

  const TOUR = ['sun', 'mercury', 'venus', 'earth', 'moon', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune', 'pluto'];
  const TOUR_STAY = 12;
  const tourHud = $('#tour-hud'), tourTxt = $('#tour-txt'), tourBar = $('#tour-bar'), tourBtn = $('#btn-tour');
  function startTour() {
    closePops();
    S.tour = { i: -1, t: 0 };
    tourHud.hidden = false;
    tourBtn.setAttribute('aria-pressed', 'true');
    if (S.speedIdx > 6) setSpeed(6);
    setPlaying(true);
    nextTour();
  }
  function nextTour() {
    const tr = S.tour; if (!tr) return;
    tr.i++; tr.t = 0;
    if (tr.i >= TOUR.length) { stopTour(); goHome(); return; }
    const b = byId[TOUR[tr.i]];
    select(b);
    if (S.tour) S.tour = tr;
    tourTxt.textContent = `Tham quan · ${tr.i + 1}/${TOUR.length} · ${b.name}`;
  }
  function stopTour() {
    if (!S.tour) return;
    S.tour = null;
    tourHud.hidden = true;
    tourBtn.setAttribute('aria-pressed', 'false');
    controls.autoRotate = false;
  }
  tourBtn.addEventListener('click', () => (S.tour ? stopTour() : startTour()));
  $('#tour-stop').addEventListener('click', stopTour);

  // ------------------------------------------------------------------ input
  let down = null;
  canvas.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    S.idle = 0;
    controls.autoRotate = false;
    if (S.tour) stopTour();
    closePops();
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved < 7 && quick && S.started) {
      const b = pickAt(e.clientX, e.clientY);
      if (b) select(b);
    }
  });
  let hoverXY = null;
  canvas.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') hoverXY = [e.clientX, e.clientY]; });
  canvas.addEventListener('pointerleave', () => { hoverXY = null; S.hover = null; tipEl.hidden = true; canvas.classList.remove('pointer'); });
  canvas.addEventListener('wheel', () => { S.idle = 0; controls.autoRotate = false; if (S.tour) stopTour(); }, { passive: true });
  function updateHover() {
    if (!hoverXY || down || S.flight) { if (!hoverXY) return; }
    const b = hoverXY && !down ? pickAt(hoverXY[0], hoverXY[1]) : null;
    S.hover = b;
    canvas.classList.toggle('pointer', !!b);
    if (b && b !== S.focus) {
      tipEl.hidden = false;
      tipEl.innerHTML = `${b.name}<small>${b.kind === 'moon' ? 'Vệ tinh · ' + byId[b.parent].name : b.kind === 'star' ? 'Ngôi sao' : b.kind === 'dwarf' ? 'Hành tinh lùn' : b.kind === 'comet' ? 'Sao chổi' : 'Hành tinh'} · bấm để xem</small>`;
      tipEl.style.transform = `translate(${hoverXY[0] + 14}px, ${hoverXY[1] + 14}px)`;
    } else tipEl.hidden = true;
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pops.some(([, p]) => !p.hidden)) {
      const open = pops.find(([, p]) => !p.hidden);
      closePops(); if (open) open[0].focus(); e.preventDefault(); return;
    }
    if (e.defaultPrevented || e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
    if ((e.key === ' ' || e.key === 'Enter') && e.target.closest('button, [role="button"], a')) return;
    if (!S.started) { if (e.key === 'Enter' && !startBtn.disabled) startBtn.click(); return; }
    const k = e.key;
    let handled = true;
    if (k === ' ') setPlaying(!S.playing);
    else if (k === 'ArrowRight') setSpeed(S.speedIdx + 1);
    else if (k === 'ArrowLeft') setSpeed(S.speedIdx - 1);
    else if (k === 'Escape') { if (pops.some(([, p]) => !p.hidden)) closePops(); else goHome(); }
    else if (/^[0-9]$/.test(k)) { const b = BODIES.find((x) => x.key === k); if (b) select(b); }
    else if (k === 't' || k === 'T') nowBtn.click();
    else if (k === 'r' || k === 'R') setScale(S.scaleTo < 0.5);
    else if (k === 'l' || k === 'L') setLayer('labels', !S.layers.labels);
    else if (k === 'o' || k === 'O') setLayer('orbits', !S.layers.orbits);
    else if (k === 'f' || k === 'F') $('#btn-full').click();
    else if (k === 'h' || k === 'H') goHome();
    else handled = false;
    if (handled) { e.preventDefault(); S.idle = 0; if (S.tour && k !== ' ') stopTour(); }
  });

  function onResize() {
    W = innerWidth; H = innerHeight;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(DPR);
    renderer.setSize(W, H, false);
    composer.setPixelRatio(DPR);
    composer.setSize(W, H);
    for (const b of BODIES) b.lw = 0;
    for (const s of skyLabels) s.w = 0;
  }
  window.addEventListener('resize', onResize);
  document.fonts && document.fonts.ready.then(() => { for (const b of BODIES) b.lw = 0; for (const s of skyLabels) s.w = 0; });

  // ------------------------------------------------------------------ scale note
  const noteEl = $('#scalenote');
  let noteT = 0;
  function updateNote() {
    const now = performance.now();
    if (now - noteT < 250) return;
    noteT = now;
    const extra = bakeNote ? `<br><span style="color:var(--sun)">${bakeNote}</span>` : '';
    if (S.scaleT < 0.5) { noteEl.innerHTML = 'Tỉ lệ trực quan · khoảng cách được nén,<br>hành tinh phóng to hàng trăm lần' + extra; return; }
    const dist = camera.position.distanceTo(controls.target);
    const perPx = 2 * dist * Math.tan(camera.fov * DEG / 2) / H;
    const kmPerPx = perPx / U * AU_KM;
    const target = kmPerPx * 110;
    const p = Math.pow(10, Math.floor(Math.log10(target)));
    const nice = [1, 2, 5, 10].map((m) => m * p).filter((v) => v <= target).pop() || p;
    const px = nice / kmPerPx;
    const f = fmtKm(nice);
    const au = nice / AU_KM;
    noteEl.innerHTML = `<div class="scalebar"><i style="width:${px.toFixed(0)}px"></i>${f.v} ${f.u}${au >= 0.01 ? ` · ${nf(au, au < 1 ? 2 : 1)} AU` : ''}</div>Tỉ lệ thật · ánh sáng đi ${fmtTime(nice / C_KM)} cho đoạn này` + extra;
  }

  // ------------------------------------------------------------------ main loop
  let last = performance.now(), fpsAcc = 0, fpsN = 0;
  // opening shot: low over the inner system, Sun in frame
  camera.position.set(-70, 46, 175);
  controls.target.set(18, 0, 0);
  setLimits();
  controls.maxDistance = 1e5;
  controls.autoRotate = !reduceMotion();
  controls.autoRotateSpeed = 0.25;
  if (store.get('real', false)) setScale(true, true);

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    tick(dt, true);
  }
  function tick(dt, render) {
    S.time += dt;
    if (S.playing) {
      setJd(S.jd + SPEEDS[S.speedIdx].v * dt);
      if (S.jd >= JD_MAX || S.jd <= JD_MIN) setPlaying(false);
    }
    // scale mode tween, camera keeps the same apparent framing
    let refBefore = 0;
    if (S.scaleAnim) {
      refBefore = S.focus ? S.focus.rad : mapR(30);
      const a = S.scaleAnim;
      a.t = Math.min(1, a.t + dt / a.dur);
      S.scaleT = a.from + (S.scaleTo - a.from) * easeIO(a.t);
    }
    updateBodies(dt);
    updateWorld();
    if (S.scaleAnim) {
      const refAfter = S.focus ? S.focus.rad : mapR(30);
      if (S.flight) {
        const k = refAfter / refBefore;
        S.flight.d0 *= k; S.flight.d1 *= k; S.flight.mid *= k;
      } else {
        if (S.focus) V0.copy(S.focus.pos); else V0.copy(controls.target).multiplyScalar(refAfter / refBefore);
        const off = V1.copy(camera.position).sub(controls.target).multiplyScalar(refAfter / refBefore);
        controls.target.copy(V0);
        camera.position.copy(V0).add(off);
        setLimits();
      }
      if (S.scaleAnim.t >= 1) S.scaleAnim = null;
    }
    if (S.started && !S.flight && !S.focus && !S.tour) {
      S.idle += dt;
      if (S.idle > 45 && !reduceMotion()) { controls.autoRotate = true; controls.autoRotateSpeed = 0.25; }
    }
    if (S.tour && !S.flight) {
      S.tour.t += dt;
      tourBar.style.width = (100 * S.tour.t / TOUR_STAY).toFixed(1) + '%';
      controls.autoRotateSpeed = 0.6;
      if (S.tour.t > TOUR_STAY) nextTour();
    }
    // keep the focused body in the visible part of the screen (beside the panel / above the sheet)
    let sx = 0, sy = 0;
    if (!S.started) { if (W > 760) sx = -W * 0.2; else sy = H * 0.2; }
    else if (!panel.hidden) {
      if (W > 760) sx = (404 + 18) / 2;
      else sy = panel.getBoundingClientRect().height / 2 - 30;
    }
    S.viewShift.x += (sx - S.viewShift.x) * Math.min(1, dt * 4);
    S.viewShift.y += (sy - S.viewShift.y) * Math.min(1, dt * 4);
    if (Math.abs(S.viewShift.x) > 0.5 || Math.abs(S.viewShift.y) > 0.5) camera.setViewOffset(W, H, S.viewShift.x, S.viewShift.y, W, H);
    else if (camera.view && camera.view.enabled) camera.clearViewOffset();

    updateCamera(dt);
    camera.updateMatrixWorld();
    sky.position.copy(camera.position);
    sky.updateMatrixWorld();
    updateUniforms();
    updateComet();
    updateLabels();
    updateHover();
    updateDateUI();
    updateLive(false);
    updateNote();
    if (render) composer.render(dt);

    // adaptive resolution on slow devices
    if (render && dt < 0.09 && S.started && !bakeQueue.length && !document.hidden) { fpsAcc += dt; fpsN++; }
    if (fpsAcc > 4) {
      const avg = fpsAcc / fpsN;
      if (avg > 0.045 && DPR > 1) { DPR = Math.max(1, DPR - 0.25); onResize(); }
      fpsAcc = 0; fpsN = 0;
    }
  }
  requestAnimationFrame(frame);
  /* DEV */
  async function devRebake(ids) {
    const txt = await (await fetch('js/shaders.js?' + Date.now())).text();
    const saved = window.SHADERS; (0, eval)(txt); const fresh = window.SHADERS; window.SHADERS = saved;
    Object.assign(SH.SURF, fresh.SURF);
    for (const k of ['PLANET_FRAG', 'ATMO_FRAG', 'RING_FRAG', 'SUN_FRAG', 'CORONA_FRAG', 'SKY_FRAG', 'ORBIT_FRAG', 'BELT_FRAG']) {
      if (SH[k] === fresh[k]) continue;
      scene.traverse((o) => { if (o.material && o.material.fragmentShader === SH[k]) { o.material.fragmentShader = fresh[k]; o.material.needsUpdate = true; } });
      SH[k] = fresh[k];
    }
    if (!bakeMask) bakeMask = await new Promise((res) => { const img = new Image(); img.onload = () => { const t = new THREE.Texture(img); t.minFilter = THREE.LinearMipmapLinearFilter; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true; res(t); }; img.src = window.EARTH_MASK; });
    for (const [id, w] of ids) {
      const tex = await bake(id, w, w / 2, id === 'earth' || id === 'clouds' ? { uMask: { value: bakeMask } } : null);
      if (id === 'clouds') earth.cloudMat.uniforms.map.value = tex; else byId[id].mat.uniforms.map.value = tex;
    }
    return 'rebaked';
  }
  async function devDump(id, name) {
    const tex = id === 'clouds' ? earth.cloudMat.uniforms.map.value : byId[id].mat.uniforms.map.value;
    const w = 1024, h = 512;
    const rt = new THREE.WebGLRenderTarget(w, h);
    const sc = new THREE.Scene();
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: SH.BAKE_VERT, uniforms: { t: { value: tex } }, depthTest: false,
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ vec4 c = texture2D(t, vUv); gl_FragColor = vec4(' + (id === 'clouds' ? 'c.rrr' : 'c.rgb') + ', 1.0); }' }));
    m.frustumCulled = false; sc.add(m);
    renderer.setRenderTarget(rt); renderer.render(sc, bakeCam); 
    const buf = new Uint8Array(w * h * 4); renderer.readRenderTargetPixels(rt, 0, 0, w, h, buf); renderer.setRenderTarget(null);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const ctx = cv.getContext('2d'); const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) img.data.set(buf.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
    ctx.putImageData(img, 0, 0);
    await fetch('/' + (name || 'tex-' + id), { method: 'POST', body: cv.toDataURL('image/jpeg', 0.9) });
    rt.dispose();
    return 'dumped';
  }
  /* /DEV */
  marks.setup = Math.round(performance.now());
  window.__solar = { S, byId, tick, select, /* DEV */devRebake, devDump, /* /DEV */THREE, scene, bakeQueue, marks, goHome, setJd, setScale, setSpeed, setPlaying, setLayer, camera, controls, renderer };

  // ------------------------------------------------------------------ start
  setSpeed(5);
  setPlaying(true);
  const readyP = new Promise((r) => { bakeReady = r; });
  bakeAll().catch((e) => {
    console.error(e);
    if (S.lost) return;
    noteBake('');
    if (S.started) toast('Một số bề mặt chưa dựng được; mô hình dùng màu đơn giản thay thế.');
    bakeReady && bakeReady();
  });
  await readyP;
  if (S.lost) return;
  startBtn.disabled = false;
  startBtn.focus({ preventScroll: true });
  startBtn.addEventListener('click', () => {
    S.started = true;
    document.body.classList.remove('intro');
    $('#intro').classList.add('gone');
    setJd(jdNow());
    setSpeed(6);
    controls.autoRotate = false;
    controls.autoRotateSpeed = 0.25;
    S.idle = 0;
    const id = (location.hash || '').slice(1);
    if (Object.prototype.hasOwnProperty.call(byId, id)) select(byId[id]);
    else flyTo(null, { slow: 1.3 });
    setTimeout(() => { const el = $('#intro'); if (el) el.hidden = true; }, 1300);
  });

})();
