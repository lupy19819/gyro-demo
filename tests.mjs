import assert from 'node:assert/strict';
import {qDevice,qFromView,viewFromQuat,relativeView,wrapPi} from './gyro-math.mjs';
const near=(actual,expected,eps=1e-7)=>assert.ok(Math.abs(actual-expected)<eps,`expected ${actual} ~ ${expected}`);
const angleNear=(actual,expected,eps=1e-7)=>near(wrapPi(actual-expected),0,eps);
// View quaternion agrees with existing WebGL ray convention.
for (const [yaw,pitch] of [[0,0],[.15,.12],[1.5,.6],[-2,-.7]]) {
  const v=viewFromQuat(qFromView(yaw,pitch));
  angleNear(v.yaw,yaw); near(v.pitch,pitch);
}
const camera={yaw:0.15,pitch:0.12};
// A device that starts tilted/pointed downward must NOT move the scene at press.
for (const [a,b,g,s] of [[0,90,0,0],[133,25,38,0],[270,155,-20,90],[37,-110,40,-90],[200,0,-20,0]]) {
  const start=qDevice(a,b,g,s);
  const v=relativeView(camera,start,start);
  angleNear(v.yaw,camera.yaw); near(v.pitch,camera.pitch);
}
// Turning a held upright phone 30 deg to the right shifts its view right.
const start=qDevice(0,90,0);
const right=qDevice(30,90,0);
const moved=relativeView({yaw:0,pitch:0},start,right);
assert.ok(moved.yaw>.4 && moved.yaw<.65,`Yaw increment wrong: ${moved.yaw}`);
near(moved.pitch,0,1e-6);
// Tilt should map to pitch (not a jump to 90 deg or 180 deg).
const up=qDevice(0,110,0);
const elevated=relativeView({yaw:0,pitch:0},start,up);
assert.ok(Math.abs(elevated.pitch)>.2 && Math.abs(elevated.pitch)<.4,`Pitch change wrong: ${elevated.pitch}`);
// Reanchoring with the view reached at release never jumps.
const afterRelease={yaw:1.8,pitch:-.25};
const nextStart=qDevice(239,22,-30,0);
const resumed=relativeView(afterRelease,nextStart,nextStart);
angleNear(resumed.yaw,afterRelease.yaw);near(resumed.pitch,afterRelease.pitch);
// Angular wraps retain shortest motion.
near(wrapPi(-Math.PI+.05-(Math.PI-.05)),.10,1e-6);
// Phone landscape q orientation should not lead to nonfinite angles.
for(const s of [-90,0,90,180]) {
  const d=qDevice(175,-25,31,s),v=relativeView(camera,d,d);
  assert.ok(Number.isFinite(v.yaw)&&Number.isFinite(v.pitch));
}
console.log('PASS: 视角四元数、低头初始校准、左右转向、俯仰、松开重锚、角度跨界、横竖屏姿态');
