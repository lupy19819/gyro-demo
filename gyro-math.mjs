// Pure, dependency-free quaternion maths. Coordinates follow Three.js
// DeviceOrientationControls conventions; the existing renderer uses yaw / pitch.
const DEG = Math.PI / 180;
export const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
export const wrapPi = v => Math.atan2(Math.sin(v),Math.cos(v));
export const qIdentity = () => [0,0,0,1];
export function qAxis(axis,rad) {
  const s=Math.sin(rad/2),c=Math.cos(rad/2);
  return axis==='x'?[s,0,0,c]:axis==='y'?[0,s,0,c]:[0,0,s,c];
}
export function qMul(a,b) {
  const [x,y,z,w]=a,[X,Y,Z,W]=b;
  return [w*X+x*W+y*Z-z*Y,
          w*Y-x*Z+y*W+z*X,
          w*Z+x*Y-y*X+z*W,
          w*W-x*X-y*Y-z*Z];
}
export const qConjugate = q => [-q[0],-q[1],-q[2],q[3]];
export function qNorm(q) {
  const l=Math.hypot(...q);
  return l>1e-10?q.map(v=>v/l):qIdentity();
}
export function qRotate(q,v) {
  const t=qMul(qMul(q,[...v,0]),qConjugate(q));
  return t.slice(0,3);
}
export function qDevice(alpha,beta,gamma,screenAngle=0) {
  // DeviceOrientationEvent: alpha around world Z, beta device X,
  // gamma device Y. The equivalent intrinsic Euler sequence for WebGL is YXZ
  // with rotation (beta, alpha, -gamma), followed by a -90 degree camera axis
  // correction and screen orientation compensation.
  const a=alpha*DEG,b=beta*DEG,g=gamma*DEG,s=screenAngle*DEG;
  const e=qMul(qMul(qAxis('y',a),qAxis('x',b)),qAxis('z',-g));
  return qNorm(qMul(qMul(e,qAxis('x',-Math.PI/2)),qAxis('z',-s)));
}
export function qFromView(yaw,pitch) {
  // Renderer: forward=(cos(pitch)*sin(yaw),sin(pitch),cos(pitch)*cos(yaw))
  // Three.js look vector is local -Z. Turn it to +Z at yaw=0.
  return qNorm(qMul(qAxis('y',Math.PI+yaw),qAxis('x',pitch)));
}
export function viewFromQuat(q) {
  const dir=qRotate(q,[0,0,-1]);
  return {yaw:Math.atan2(dir[0],dir[2]), pitch:Math.asin(clamp(dir[1],-1,1))};
}
export function relativeView(anchorView,anchorDevice,currentDevice) {
  // Clutch calibration: current camera = camera-at-press * local device delta.
  // Crucially, when currentDevice === anchorDevice, the result is anchorView.
  const localDelta=qMul(qConjugate(anchorDevice),currentDevice);
  return viewFromQuat(qNorm(qMul(qFromView(anchorView.yaw,anchorView.pitch),localDelta)));
}
