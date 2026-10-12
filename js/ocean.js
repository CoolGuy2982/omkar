/*
 * Ocean renderer — a single full-screen WebGL2 pass.
 *
 * Above the surface: a ray-marched height field built from layered
 * exponential-sine waves with domain drag, a small analytic sky with clouds,
 * Fresnel reflection, subsurface light through the crests and a sun glitter path.
 * Below: refraction through Snell's window, total internal reflection,
 * slanted light shafts, wavelength-dependent absorption and drifting marine snow.
 * The camera is driven from the page scroll (see main.js).
 */
(function () {
  'use strict';

  const VERT = `#version 300 es
  in vec2 p;
  void main(){ gl_Position = vec4(p, 0.0, 1.0); }`;

  const FRAG = `#version 300 es
  precision highp float;
  out vec4 outColor;

  uniform vec2  uRes;
  uniform float uTime;
  uniform vec3  uCam;      // camera position (y = height in metres, negative below sea level)
  uniform vec2  uLook;     // yaw, pitch (radians)
  uniform vec3  uSun;
  uniform vec2  uMouse;    // -1..1
  uniform float uMarchIt;  // wave octaves used while marching
  uniform float uNormIt;   // wave octaves used for normals
  uniform float uExposure;

  #define WAVE_H 1.15
  #define DRAG 0.30
  #define PI 3.14159265

  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){
    float v = 0.0, a = 0.5;
    mat2 r = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 5; i++){ v += a * noise(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
    return v;
  }

  // Sum of sharp-crested waves. Each octave drags the sample point along the
  // previous wave's slope, which bunches crests together like real swell.
  float waves(vec2 p, float iters){
    float phase = length(p) * 0.08;
    float seed = 0.0, freq = 0.62, speed = 1.35, w = 1.0, sum = 0.0, wsum = 0.0;
    for (int i = 0; i < 48; i++){
      if (float(i) >= iters) break;
      vec2 d = vec2(sin(seed), cos(seed));
      float x = dot(d, p) * freq + uTime * speed + phase;
      float wv = exp(sin(x) - 1.0);
      float dx = wv * cos(x);
      p += d * dx * w * DRAG;
      sum += wv * w; wsum += w;
      w = mix(w, 0.0, 0.19);
      freq *= 1.19; speed *= 1.07;
      seed += 1232.399963;
    }
    return sum / wsum;
  }
  float surfaceY(vec2 p, float it){ return waves(p, it) * WAVE_H - WAVE_H; }

  vec3 surfNormal(vec2 p, float e, float it){
    float h  = surfaceY(p, it);
    float hx = surfaceY(p + vec2(e, 0.0), it);
    float hz = surfaceY(p + vec2(0.0, e), it);
    return normalize(vec3(h - hx, e, h - hz));
  }

  // ---------- sky ----------
  vec3 sky(vec3 rd){
    float sd = max(dot(rd, uSun), 0.0);
    float y = clamp(rd.y, 0.0, 1.0);
    vec3 zenith  = vec3(0.012, 0.035, 0.10);
    vec3 horizon = vec3(0.13, 0.17, 0.23);
    vec3 col = mix(horizon, zenith, pow(y, 0.38));
    // warm forward scattering low around the sun
    float low = pow(1.0 - y, 4.0);
    col = mix(col, vec3(0.95, 0.46, 0.20), pow(sd, 14.0) * low * 0.85);
    col += vec3(0.22, 0.10, 0.03) * pow(sd, 6.0) * low;
    col += vec3(1.0, 0.55, 0.25) * pow(sd, 40.0) * 0.7;
    col += vec3(1.0, 0.72, 0.45) * pow(sd, 900.0) * 2.5;
    // sun disc
    col += vec3(1.0, 0.82, 0.60) * smoothstep(0.99984, 0.99992, sd) * 40.0;
    // clouds on a curved layer
    if (rd.y > 0.0){
      vec2 cp = rd.xz / (rd.y + 0.06) * 0.9 + vec2(uTime * 0.012, uTime * 0.004);
      float c = fbm(cp * 0.9) * 0.65 + fbm(cp * 3.1 + 4.0) * 0.35;
      float cov = smoothstep(0.46, 0.80, c) * smoothstep(0.0, 0.14, rd.y);
      vec3 lit = mix(vec3(0.10, 0.10, 0.13), vec3(1.15, 0.55, 0.28), pow(sd, 9.0));
      vec3 shade = vec3(0.05, 0.055, 0.075);
      vec3 cc = mix(lit, shade, smoothstep(0.5, 0.9, c) * 0.85);
      col = mix(col, cc, cov * 0.85);
      // silver lining
      col += vec3(1.0, 0.6, 0.35) * cov * pow(sd, 14.0) * 0.9;
    }
    // haze band at the horizon
    col = mix(col, vec3(0.15, 0.16, 0.19) + vec3(0.8, 0.34, 0.1) * pow(sd, 10.0), exp(-y * 45.0) * 0.6);
    return col;
  }

  // ---------- above water ----------
  float marchDown(vec3 ro, vec3 rd, out vec3 hit){
    // intersect the slab [-WAVE_H, 0]
    float tTop = (0.0 - ro.y) / rd.y;
    float tBot = (-WAVE_H - ro.y) / rd.y;
    vec3 pos = ro + rd * max(tTop, 0.0);
    vec3 end = ro + rd * tBot;
    for (int i = 0; i < 110; i++){
      float h = surfaceY(pos.xz, uMarchIt);
      if (pos.y - h < 0.002 * (1.0 + distance(pos, ro) * 0.02)){ hit = pos; return distance(pos, ro); }
      pos += rd * (pos.y - h);
      if (dot(pos - end, rd) > 0.0) break;
    }
    hit = end;
    return distance(end, ro);
  }

  vec3 shadeAbove(vec3 ro, vec3 rd){
    if (rd.y >= 0.0) return sky(rd);
    vec3 hit;
    float t = marchDown(ro, rd, hit);
    vec3 n = surfNormal(hit.xz, 0.012, uNormIt);
    // tame high-frequency normals with distance to avoid shimmer
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0), 0.85 * min(1.0, sqrt(t * 0.008) * 1.1)));
    float ndv = max(dot(n, -rd), 0.0);
    float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 r = reflect(rd, n); r.y = abs(r.y);
    vec3 refl = sky(r);
    // light that enters the water and scatters back out
    float crest = clamp((hit.y + WAVE_H) / WAVE_H, 0.0, 1.0);
    vec3 deep = vec3(0.002, 0.012, 0.020);
    float back = pow(max(dot(normalize(vec3(rd.x, 0.0, rd.z)), uSun), 0.0), 2.0);
    vec3 sss = vec3(0.03, 0.20, 0.19) * pow(crest, 3.0) * (0.25 + 1.1 * back) * (0.6 + 0.4 * max(dot(n, uSun), 0.0));
    vec3 body = deep + sss + vec3(0.0, 0.03, 0.04) * max(dot(n, uSun), 0.0);
    vec3 col = mix(body, refl, F);
    // sun glitter
    float sp = max(dot(r, uSun), 0.0);
    col += vec3(1.0, 0.82, 0.60) * (pow(sp, 900.0) * 55.0 + pow(sp, 120.0) * 1.6) * F * 4.0;
    // wind-blown whitecaps on the sharpest crests
    float foam = smoothstep(0.86, 1.0, crest) * smoothstep(0.35, 0.75, fbm(hit.xz * 1.8 + uTime * 0.3));
    col = mix(col, vec3(0.75, 0.78, 0.8) * (0.6 + 0.6 * max(dot(n, uSun), 0.0)), foam * 0.35 * exp(-t * 0.02));
    // aerial perspective
    float fog = 1.0 - exp(-t * 0.0038);
    vec3 hz = sky(normalize(vec3(rd.x, 0.012, rd.z)));
    return mix(col, hz, fog);
  }

  // ---------- below water ----------
  const vec3 ABSORB = vec3(0.40, 0.065, 0.040);   // per metre, red goes first
  vec3 sunUnder(){ return refract(-uSun, vec3(0.0, 1.0, 0.0), 1.0 / 1.333); }

  // scattered light we would see looking along rd from a depth d (metres, positive)
  vec3 volumeColor(vec3 rd, float d){
    float light = exp(-d * 0.017);
    vec3 su = sunUnder();
    float up = rd.y * 0.5 + 0.5;
    vec3 base = mix(vec3(0.000, 0.018, 0.030), vec3(0.010, 0.120, 0.150), pow(up, 1.6));
    base += vec3(0.04, 0.20, 0.20) * pow(max(dot(rd, -su), 0.0), 6.0) * 0.6;
    // colour shifts towards blue with depth as reds are absorbed
    vec3 tint = exp(-ABSORB * d * 0.35);
    return base * light * mix(vec3(0.35, 0.8, 1.0), vec3(1.0), tint);
  }

  float caustic(vec2 p){
    float t = uTime * 0.6;
    vec2 q = p * 0.55;
    float c = 0.0;
    c += abs(sin(q.x * 1.7 + sin(q.y * 1.3 + t) * 1.4 + t * 0.7));
    c += abs(sin(q.y * 1.9 + sin(q.x * 1.1 - t * 0.8) * 1.6 - t * 0.5));
    c += abs(sin((q.x + q.y) * 1.3 + sin(q.x * 0.7 + t) * 1.2));
    return pow(1.0 - c / 3.0, 6.0) * 6.0 + noise(q * 2.0 + t) * 0.15;
  }

  vec3 shadeBelow(vec3 ro, vec3 rd){
    float d0 = max(-ro.y, 0.0);
    vec3 su = sunUnder();
    vec3 col;
    float tEnd = 60.0;
    bool sawSurface = false;
    if (rd.y > 0.0 && d0 < 40.0){
      // march up to the surface
      float tb = max((-WAVE_H - ro.y) / rd.y, 0.0);
      vec3 pos = ro + rd * tb;
      float t = tb;
      for (int i = 0; i < 70; i++){
        float h = surfaceY(pos.xz, uMarchIt);
        float g = h - pos.y;
        if (g < 0.003) break;
        pos += rd * g; t += g / max(rd.y, 0.05) * rd.y;
      }
      t = distance(pos, ro);
      vec3 n = surfNormal(pos.xz, 0.03, min(uNormIt, 26.0));
      n = normalize(mix(n, vec3(0.0, 1.0, 0.0), min(0.8, t * 0.01)));
      // water -> air. Fresnel on the transmitted angle so the edge of
      // Snell's window fades smoothly into total internal reflection.
      float cosI = max(dot(rd, n), 0.0);
      float sinT2 = 1.777 * (1.0 - cosI * cosI);
      vec3 mirror = volumeColor(reflect(rd, n), 0.0) * 0.85;
      vec3 surf = mirror;
      if (sinT2 < 1.0){
        float cosT = sqrt(1.0 - sinT2);
        float R = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
        vec3 tr = refract(rd, -n, 1.333);
        vec3 through = sky(tr) * 0.9 + vec3(1.0, 0.85, 0.6) * pow(max(dot(tr, uSun), 0.0), 60.0) * 2.5;
        surf = mix(through, mirror, R);
      }
      vec3 att = exp(-ABSORB * t);
      col = surf * att + volumeColor(rd, d0) * (1.0 - exp(-t * 0.06));
      tEnd = t;
      sawSurface = true;
    } else {
      col = volumeColor(rd, d0);
    }

    // light shafts: integrate a caustic pattern projected along the refracted sun
    float shafts = 0.0;
    float steps = 22.0;
    float tMax = min(tEnd, 38.0);
    float jitter = hash12(gl_FragCoord.xy + fract(uTime) * 61.0);
    for (int i = 0; i < 22; i++){
      float tt = (float(i) + jitter) / steps * tMax;
      vec3 p = ro + rd * tt;
      float depth = max(-p.y, 0.0);
      vec2 s = p.xz - su.xz * (p.y / su.y);
      float c = caustic(s * 0.22);
      shafts += c * exp(-depth * 0.06) * exp(-tt * 0.05);
    }
    shafts /= steps;
    float facing = 0.35 + 0.65 * pow(max(dot(rd, -su), 0.0), 2.0);
    col += vec3(0.20, 0.55, 0.55) * shafts * facing * exp(-d0 * 0.012) * 0.55;

    // marine snow: three parallax layers in view space, drifting upward as we sink
    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    float snow = 0.0;
    for (int L = 0; L < 3; L++){
      float fl = float(L);
      float scale = 9.0 + fl * 9.0;
      vec2 g = uv * scale + vec2(uLook.x * scale * 0.6, uCam.y * (0.9 - fl * 0.25) + uLook.y * scale * 0.6) + vec2(sin(uTime * 0.07 + fl) * 0.6, uTime * (0.03 + fl * 0.015));
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float rnd = hash12(id + fl * 17.0);
      vec2 off = vec2(hash12(id + 3.1), hash12(id + 7.7)) - 0.5;
      float r = length(f - off * 0.7);
      float size = (0.025 + 0.03 * rnd) * (1.0 - fl * 0.2);
      snow += smoothstep(size, 0.0, r) * step(0.72, rnd) * (0.55 - fl * 0.12);
    }
    float snowLight = 0.18 * exp(-d0 * 0.012) + 0.03;
    col += vec3(0.65, 0.8, 0.85) * snow * snowLight;

    // bioluminescence in the dark: sparse cyan sparks that wake up near the cursor
    if (d0 > 120.0){
      float dark = smoothstep(120.0, 400.0, d0);
      vec2 g = uv * 26.0 + vec2(0.0, uCam.y * 1.3) + uTime * vec2(0.05, 0.11);
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float rnd = hash12(id * 1.37 + 9.0);
      float flick = 0.5 + 0.5 * sin(uTime * (1.0 + rnd * 3.0) + rnd * 40.0);
      vec2 m = vec2(uMouse.x * uRes.x / uRes.y * 0.5, uMouse.y * 0.5);
      float near = exp(-length(uv - m) * 3.2);
      float spark = smoothstep(0.06, 0.0, length(f)) * step(0.93 - near * 0.25, rnd) * flick;
      col += vec3(0.25, 0.85, 1.0) * spark * dark * (0.12 + near * 1.2);
    }
    return col;
  }

  vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

  void main(){
    vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
    float yaw = uLook.x, pitch = uLook.y;
    vec3 fwd = normalize(vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch)));
    vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
    vec3 up = cross(fwd, right);
    vec3 rd = normalize(fwd * 1.55 + right * uv.x + up * uv.y);
    vec3 ro = uCam;

    // per-pixel waterline: is the near-plane point above or below the local surface?
    vec3 np = ro + rd * 0.12;
    float sh = (ro.y > -WAVE_H - 0.2 && ro.y < 0.4) ? surfaceY(np.xz, 10.0) : (ro.y > 0.0 ? -10.0 : 10.0);
    float side = np.y - sh;
    vec3 col = side > 0.0 ? shadeAbove(ro, rd) : shadeBelow(ro, rd);
    // meniscus: a thin dark line with a bright edge where the lens cuts the water
    float m = abs(side);
    col *= 1.0 - 0.75 * smoothstep(0.012, 0.0, m);
    col += vec3(0.5, 0.7, 0.75) * smoothstep(0.02, 0.006, m) * smoothstep(0.004, 0.012, m) * 0.3 * step(0.0, side);

    col *= uExposure;
    col = aces(col);
    col = pow(col, vec3(1.0 / 2.2));
    // vignette + film grain / dithering
    vec2 q = gl_FragCoord.xy / uRes;
    col *= 0.55 + 0.45 * pow(16.0 * q.x * q.y * (1.0 - q.x) * (1.0 - q.y), 0.18);
    col += (hash12(gl_FragCoord.xy + fract(uTime * 13.0) * 100.0) - 0.5) / 128.0;
    outColor = vec4(col, 1.0);
  }`;

  function compile(gl, type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
    }
    return s;
  }

  function create(canvas, opts = {}) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: !!opts.preserve });
    if (!gl) return null;

    let prog;
    try {
      prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    } catch (e) {
      console.warn('[ocean]', e);
      return null;
    }
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    const U = {};
    ['uRes', 'uTime', 'uCam', 'uLook', 'uSun', 'uMouse', 'uMarchIt', 'uNormIt', 'uExposure'].forEach(n => (U[n] = gl.getUniformLocation(prog, n)));

    const sunEl = 0.085, sunAz = 0.32; // ~5° above the horizon, a little right of centre
    const sun = [Math.sin(sunAz) * Math.cos(sunEl), Math.sin(sunEl), Math.cos(sunAz) * Math.cos(sunEl)];
    gl.uniform3fv(U.uSun, sun);

    // Quality adapts to the frame budget. `scale` is the internal resolution
    // relative to CSS pixels; the canvas is upscaled by the browser.
    const q = { scale: opts.scale || (matchMedia('(max-width: 700px)').matches ? 0.55 : 0.7), min: 0.35, max: 1.0, march: 11, norm: 34 };
    const state = { cam: [0, 1.6, 0], look: [0, -0.06], mouse: [0, 0], exposure: 0.8 };
    let w = 0, h = 0;

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = canvas.clientWidth || window.innerWidth, ch = canvas.clientHeight || window.innerHeight;
      const nw = Math.max(2, Math.round(cw * dpr * q.scale));
      const nh = Math.max(2, Math.round(ch * dpr * q.scale));
      if (nw !== w || nh !== h) {
        w = canvas.width = nw; h = canvas.height = nh;
        gl.viewport(0, 0, w, h);
      }
    }

    let frames = 0, acc = 0, last = performance.now();
    function adapt(dt) {
      if (opts.fixedQuality) return;
      acc += dt; frames++;
      if (frames < 24) return;
      const avg = acc / frames; frames = 0; acc = 0;
      if (avg > 24 && q.scale > q.min) { q.scale = Math.max(q.min, q.scale - 0.1); q.norm = Math.max(18, q.norm - 6); resize(); }
      else if (avg < 12 && q.scale < q.max) { q.scale = Math.min(q.max, q.scale + 0.05); q.norm = Math.min(36, q.norm + 2); resize(); }
    }

    function render(t) {
      const now = performance.now();
      adapt(now - last); last = now;
      resize();
      gl.uniform2f(U.uRes, w, h);
      gl.uniform1f(U.uTime, t);
      gl.uniform3fv(U.uCam, state.cam);
      gl.uniform2fv(U.uLook, state.look);
      gl.uniform2fv(U.uMouse, state.mouse);
      gl.uniform1f(U.uMarchIt, q.march);
      gl.uniform1f(U.uNormIt, q.norm);
      gl.uniform1f(U.uExposure, state.exposure);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    window.addEventListener('resize', resize);
    resize();
    return { state, render, quality: q };
  }

  window.Ocean = { create };
})();
