// The header's gradient mesh: a few colors drifting through each other, drawn
// by a tiny fragment shader at a third of the size and scaled up (a gradient
// loses nothing). It pauses when scrolled away or in a background tab, holds
// still with reduced motion, and falls back to the CSS gradient without WebGL.

const VERTEX = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAGMENT = `
precision mediump float;
uniform vec2 res;
uniform float time;

// Value noise with smooth interpolation: soft blobs, no grid artifacts at this scale.
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / res;           // 0..1, y up
  vec2 p = vec2(uv.x * res.x / res.y * 0.16, uv.y * 0.9);
  float t = time * 0.035;
  vec2 warp = vec2(noise(p * 1.7 + vec2(t, -t)), noise(p * 1.7 + vec2(4.2 - t, 1.3 + t)));
  vec2 q = p + 0.55 * warp;

  vec3 indigo = vec3(0.157, 0.110, 0.588);   // #281C96
  vec3 violet = vec3(0.435, 0.290, 0.965);   // #6F4AF6
  vec3 pink   = vec3(0.945, 0.318, 0.576);   // #F15193
  vec3 orange = vec3(1.000, 0.600, 0.325);   // #FF9953
  vec3 cyan   = vec3(0.216, 0.800, 0.910);   // #37CCE8

  vec3 col = mix(indigo, violet, smoothstep(0.25, 0.75, noise(q * 1.3 + vec2(t * 0.8, 0.0))));
  float right = smoothstep(0.25, 0.85, uv.x);
  col = mix(col, pink, smoothstep(0.42, 0.82, noise(q * 1.6 + vec2(-t, t * 0.6) + 7.0)) * (0.35 + 0.65 * right));
  col = mix(col, orange, smoothstep(0.55, 0.9, noise(q * 1.9 + vec2(t * 0.7, -t * 0.4) + 13.0)) * right);
  col = mix(col, cyan, smoothstep(0.58, 0.92, noise(q * 1.5 + vec2(-t * 0.5, -t) + 21.0)) * (1.0 - uv.y) * (0.4 + 0.6 * right));
  // The logo lives on the left: keep it deep there, so white stays readable.
  col = mix(indigo * 0.92, col, smoothstep(0.02, 0.34, uv.x) * 0.85 + 0.15);
  gl_FragColor = vec4(col, 1.0);
}`;

export function startMesh(host) {
  const canvas = host?.querySelector('canvas');
  if (!canvas) return;
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: true, powerPreference: 'low-power' });
  if (!gl) return; // The CSS gradient behind it stays.

  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return;
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  const uRes = gl.getUniformLocation(program, 'res');
  const uTime = gl.getUniformLocation(program, 'time');

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const start = performance.now() - 40000; // Begin mid-drift, not at a symmetric first frame.
  let visible = true;
  let frame = 0;
  let last = 0;

  const size = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth / 3));
    const h = Math.max(1, Math.round(canvas.clientHeight / 3));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      gl.viewport(0, 0, w, h);
    }
  };
  const draw = (now) => {
    size();
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (still.matches ? 52000 : now - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  const loop = (now) => {
    frame = 0;
    if (!visible || document.hidden || still.matches) return;
    if (now - last > 33) { // 30 frames a second is plenty for a slow drift.
      last = now;
      draw(now);
    }
    frame = requestAnimationFrame(loop);
  };
  const wake = () => {
    if (!frame && visible && !document.hidden && !still.matches) frame = requestAnimationFrame(loop);
  };

  draw(performance.now());
  host.classList.add('is-live');
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    wake();
  }).observe(host);
  document.addEventListener('visibilitychange', wake);
  still.addEventListener('change', () => (still.matches ? draw(performance.now()) : wake()));
  new ResizeObserver(() => draw(performance.now())).observe(canvas);
  wake();
}
