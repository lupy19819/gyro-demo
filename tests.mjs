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

// v0.2: background pose samples, stable physical return detection, rearm rules.
const {PoseReturnDetector,quaternionDistanceDeg}=await import('./return-detector.mjs');
const {qAxis, qMul}=await import('./gyro-math.mjs');
const q0=qDevice(80,45,13,0);
const qRight=qMul(q0,qAxis('y',35*Math.PI/180));
const qNear=qMul(q0,qAxis('x',4*Math.PI/180));
const qPassing=qMul(q0,qAxis('y',7*Math.PI/180));
const qOther=qMul(q0,qAxis('y',45*Math.PI/180));
near(quaternionDistanceDeg(q0,q0),0,1e-5);
near(quaternionDistanceDeg(q0,qRight),35,1e-5);
near(quaternionDistanceDeg(q0,q0.map(x=>-x)),0,1e-5); // q and -q represent the same pose.
const hit=new PoseReturnDetector();
let t=0;
hit.setOrigin(q0);
// No correction at rest, including a period longer than dwell.
assert.equal(hit.sample(q0,t,{holding:false}).triggered,false);
assert.equal(hit.sample(q0,t+=1000,{holding:false}).triggered,false);
// Background movement alone does not arm the auto-return gesture.
assert.equal(hit.sample(qOther,t+=100,{holding:false}).armed,false);
assert.equal(hit.sample(q0,t+=100,{holding:false}).triggered,false);
// The same 35 degree movement while observing DOES arm the detector.
assert.equal(hit.sample(qRight,t+=100,{holding:true}).armed,true);
assert.equal(hit.sample(qRight,t+=100,{holding:false}).triggered,false);
// Passing through the center without dwelling must not trigger.
assert.equal(hit.sample(qPassing,t+=100,{holding:false}).triggered,false);
assert.equal(hit.sample(qNear,t+=100,{holding:false}).triggered,false);
assert.equal(hit.sample(q0,t+=120,{holding:false}).triggered,false);
assert.equal(hit.sample(q0,t+=120,{holding:false}).triggered,false);
assert.equal(hit.sample(q0,t+=120,{holding:false}).triggered,false);
assert.equal(hit.sample(q0,t+=120,{holding:false}).triggered,false);
assert.equal(hit.sample(q0,t+=120,{holding:false}).triggered,true);
// Auto-return triggers once per explicit observation, never repeatedly at rest.
assert.equal(hit.sample(q0,t+=600,{holding:false}).triggered,false);
// Large movement near origin resets stillness, so fly-bys do not trigger.
const passing=new PoseReturnDetector();
passing.setOrigin(q0);
passing.sample(qRight,0,{holding:true});
passing.sample(q0,10,{holding:false});
passing.sample(qPassing,150,{holding:false});
passing.sample(q0,250,{holding:false});
assert.equal(passing.sample(q0,500,{holding:false}).triggered,false);
assert.equal(passing.sample(q0,700,{holding:false}).triggered,true);
// Hidden/paused sampling cannot count toward dwell.
const paused=new PoseReturnDetector();
paused.setOrigin(q0);paused.sample(qRight,0,{holding:true});
paused.sample(q0,100,{holding:false,eligible:false});
assert.equal(paused.sample(q0,1100,{holding:false,eligible:true}).triggered,false);
assert.equal(paused.sample(q0,1550,{holding:false,eligible:true}).triggered,true);
// Re-reference while tilted clears previous arm and establishes new handset 'home'.
hit.sample(qOther,t+=20,{holding:true});hit.setOrigin(qOther);
assert.equal(hit.armed,false);
assert.equal(hit.sample(qOther,t+=1000,{holding:false}).triggered,false);
console.log('PASS v0.2: 长期姿态基准、观察后置待回位、静止窗口、经过不误触、不可见禁止、重复去抖、重设基准');
