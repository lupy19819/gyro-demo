import { makeGyroController } from './gyro.mjs';

const canvas = document.querySelector('#panorama');
const statusEl = document.querySelector('#sensor-status');
const detailEl = document.querySelector('#sensor-detail');
const holdButton = document.querySelector('#observe');
const enableButton = document.querySelector('#enable');
const state = { yaw: 0.15, pitch: 0.12, fov: 1.12, elapsedTime: 0, drift: false,
  dragging: false, lastX: 0, lastY: 0, gyroHolding: false };
const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
if (!gl) {
  statusEl.textContent = '当前浏览器不支持 WebGL 2';
  throw new Error('WebGL2 unavailable');
}
const vertexSource = `#version 300 es
in vec2 a_position;
out vec2 v_uv;
void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;
const fragmentSource = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_yaw;
uniform float u_pitch;
uniform float u_fov;
uniform float u_clouds;
uniform float u_water;
uniform sampler2D u_sky_texture;

#define PI 3.14159265359

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 13.17; a *= 0.5; }
  return v;
}

vec3 cameraRay(vec2 p) {
  float aspect = u_resolution.x / u_resolution.y;
  float f = tan(u_fov * 0.5);
  vec3 forward = normalize(vec3(cos(u_pitch) * sin(u_yaw), sin(u_pitch), cos(u_pitch) * cos(u_yaw)));
  vec3 worldUp = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(forward, worldUp));
  vec3 up = normalize(cross(right, forward));
  return normalize(forward + right * p.x * aspect * f + up * p.y * f);
}

vec2 equirect(vec3 ray) {
  return vec2(atan(ray.x, ray.z) / (2.0 * PI) + 0.5, asin(clamp(ray.y, -1.0, 1.0)) / PI + 0.5);
}

vec3 skyBase(vec2 uv, vec3 ray) {
  // The original M_Skybox00 uses a 2:1 authored sky texture on a dome.
  // Equirectangular V is inverted here so the texture's dark-blue top stays zenith-up.
  vec3 col = texture(u_sky_texture, vec2(fract(uv.x), 1.0 - uv.y)).rgb;
  float horizonGlow = pow(max(0.0, 1.0 - abs(ray.y)), 5.0);
  return col + vec3(0.015, 0.032, 0.028) * horizonGlow;
}

void main() {
  vec2 p = v_uv * 2.0 - 1.0;
  vec3 ray = cameraRay(p);
  vec2 uv = equirect(ray);
  vec3 col = skyBase(uv, ray);

  float cloudNoise = fbm(vec2(uv.x * 7.0 + u_time * 0.012, uv.y * 4.2 - u_time * 0.004));
  float cloudBand = smoothstep(0.30, 0.60, uv.y) * (1.0 - smoothstep(0.56, 0.76, uv.y));
  float cloud = smoothstep(0.47, 0.72, cloudNoise) * cloudBand;
  float cloudLight = fbm(vec2(uv.x * 13.0 - u_time * 0.021, uv.y * 7.0 + u_time * 0.008));
  col = mix(col, col + vec3(0.20, 0.22, 0.17), cloud * 0.64 * u_clouds);
  col += vec3(0.16, 0.21, 0.18) * cloudLight * cloud * 0.25 * u_clouds;

  float sea = smoothstep(0.46, 0.56, 0.5 - uv.y);
  float waveA = sin((uv.x * 170.0 + uv.y * 34.0) + u_time * 0.95) * 0.5 + 0.5;
  float waveB = sin((uv.x * 390.0 - uv.y * 81.0) - u_time * 1.35) * 0.5 + 0.5;
  float waves = pow(waveA * 0.62 + waveB * 0.38, 5.5);
  vec3 seaTint = vec3(0.015, 0.22, 0.27) + vec3(0.03, 0.15, 0.11) * waves;
  col = mix(col, seaTint + col * 0.24, sea * 0.82 * u_water);
  col += vec3(0.12, 0.34, 0.28) * waves * sea * 0.33 * u_water;

  float edge = 1.0 - smoothstep(0.44, 1.02, length(p));
  col *= 0.84 + edge * 0.18;
  col = pow(max(col, 0.0), vec3(0.92));
  outColor = vec4(col, 1.0);
}`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}
const program = gl.createProgram();
gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
gl.linkProgram(program);
if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
gl.useProgram(program);
const quad = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, quad);
gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
const position = gl.getAttribLocation(program, 'a_position');
gl.enableVertexAttribArray(position);
gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
const uniformNames = ['u_resolution','u_time','u_yaw','u_pitch','u_fov','u_clouds','u_water','u_sky_texture'];
const uniforms = Object.fromEntries(uniformNames.map(n => [n, gl.getUniformLocation(program,n)]));
let skyTexture = null;
function resize() {
  const dpr = Math.min(window.devicePixelRatio||1, 1.8);
  const w = Math.max(1, Math.floor(canvas.clientWidth*dpr));
  const h = Math.max(1, Math.floor(canvas.clientHeight*dpr));
  if (canvas.width!==w || canvas.height!==h) {
    canvas.width=w; canvas.height=h; gl.viewport(0,0,w,h);
  }
}
function render() {
  resize();
  gl.useProgram(program);
  gl.uniform2f(uniforms.u_resolution, canvas.width, canvas.height);
  gl.uniform1f(uniforms.u_time, state.elapsedTime);
  gl.uniform1f(uniforms.u_yaw, state.yaw);
  gl.uniform1f(uniforms.u_pitch, state.pitch);
  gl.uniform1f(uniforms.u_fov, state.fov);
  gl.uniform1f(uniforms.u_clouds, 0);
  gl.uniform1f(uniforms.u_water, 0);
  if (skyTexture) {
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, skyTexture);
    gl.uniform1i(uniforms.u_sky_texture, 0);
  }
  gl.drawArrays(gl.TRIANGLES,0,6);
}
function loadPanorama(url) {
  const image = new Image();
  image.onload = () => {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D,tex);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    skyTexture=tex;
  };
  image.onerror=()=>setStatus('全景图片加载失败，请通过 HTTP(S) 服务打开项目', 'error');
  image.src=url;
}
loadPanorama('assets/bg08_d.png');

function setStatus(message, type='info') {
  statusEl.textContent = message;
  statusEl.dataset.kind = type;
}
function setDetail(message) { detailEl.textContent=message; }
const gyro = makeGyroController({
  getView: () => ({ yaw: state.yaw, pitch: state.pitch }),
  setView: (yaw,pitch) => { state.yaw=yaw; state.pitch=pitch; },
  onStatus: setStatus,
  onDebug: setDetail,
  homeView: {yaw: 0.15, pitch: 0.12}
});

async function requestSensor() {
  enableButton.disabled=true;
  try {
    await gyro.enable();
    enableButton.hidden=true;
    holdButton.disabled=false;
  } catch(e) {
    setStatus(e.message || '传感器授权失败', 'error');
  } finally {
    enableButton.disabled=false;
  }
}
enableButton.addEventListener('click', requestSensor);

let activePointer = null;
function startObserve(event) {
  if (!gyro.ready || activePointer !== null) return;
  event.preventDefault();
  activePointer=event.pointerId;
  holdButton.setPointerCapture(event.pointerId);
  // Re-press resumes the persistent sensor coordinate system (no fresh clutch anchor).
  if (!gyro.begin()) { activePointer=null; return; }
  state.gyroHolding=true;
  state.drift=false;
  holdButton.classList.add('holding');
  holdButton.textContent='观察中 · 松开固定视角';
}
function endObserve(event) {
  if (activePointer === null || event.pointerId!==activePointer) return;
  activePointer=null;
  state.gyroHolding=false;
  gyro.end();
  holdButton.classList.remove('holding');
  holdButton.textContent='按住 · 观察异世界';
}
holdButton.addEventListener('pointerdown', startObserve);
for(const n of ['pointerup','pointercancel','lostpointercapture'])
  holdButton.addEventListener(n,endObserve);
window.addEventListener('blur', () => {
  if(activePointer!==null) {
    const p=activePointer; endObserve({pointerId:p});
  }
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden && activePointer!==null)endObserve({pointerId:activePointer});
});

// Touch-drag fallback. The button is a separate surface, so there is no gesture conflict.
canvas.addEventListener('pointerdown',(e)=>{
  if (state.gyroHolding) return;
  state.dragging=true; state.lastX=e.clientX; state.lastY=e.clientY;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove',(e)=>{
  if(!state.dragging || state.gyroHolding) return;
  const dx=e.clientX-state.lastX, dy=e.clientY-state.lastY;
  state.yaw-=dx*0.004;
  state.pitch=Math.max(-1.40,Math.min(1.40,state.pitch+dy*0.003));
  state.lastX=e.clientX;state.lastY=e.clientY;
});
for(const type of ['pointerup','pointercancel','lostpointercapture'])
  canvas.addEventListener(type,()=>{state.dragging=false;});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();state.fov=Math.max(0.62,Math.min(1.65,state.fov+e.deltaY*0.0008));
},{passive:false});
window.addEventListener('keydown',(e)=>{
  if(e.key==='ArrowLeft')state.yaw-=0.035;
  if(e.key==='ArrowRight')state.yaw+=0.035;
  if(e.key==='ArrowUp')state.pitch=Math.min(1.40,state.pitch+0.035);
  if(e.key==='ArrowDown')state.pitch=Math.max(-1.40,state.pitch-0.035);
});

// Explicit recalibration: the current phone pose becomes the new world forward.
document.querySelector('#recenter').addEventListener('click',()=>{
  state.yaw=0.15; state.pitch=0.12; state.fov=1.12;
  gyro.resetReference();
});
document.querySelector('#fullscreen').addEventListener('click',async()=>{
  try {
    if(!document.fullscreenElement) await document.documentElement.requestFullscreen?.();
    else await document.exitFullscreen?.();
  } catch { setStatus('当前浏览器不支持全屏，仍可继续体验'); }
});

let prev = performance.now();
function frame(now) {
  const dt=Math.min(0.05,(now-prev)/1000);prev=now;
  state.elapsedTime+=dt;
  if(state.drift && !state.gyroHolding && !state.dragging)state.yaw+=dt*0.018;
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.render_game_to_text=()=>JSON.stringify({
  scene:'kameshima-watchtower-roof', source:'original bg08_d.png',
  view:{yaw:+state.yaw.toFixed(4),pitch:+state.pitch.toFixed(4),fov:+state.fov.toFixed(4)},
  gyro:{enabled:gyro.ready,holding:gyro.holding,hasSample:gyro.hasSample,hasOrigin:gyro.hasOrigin,trackingView:gyro.trackingView},
  projection:'fixed-point 3DoF panorama'
});
window.gyroDemo={
  // For browser QA only. Real devices use DeviceOrientationEvent.
  debugFeed:(alpha,beta,gamma,screenAngle=0)=>gyro.debugFeed(alpha,beta,gamma,screenAngle),
  debugBegin:()=>gyro.begin(), debugEnd:()=>gyro.end(),
  debugRecenter:()=>{state.yaw=0.15;state.pitch=0.12;gyro.resetReference();},
  getState:()=>({...state})
};
