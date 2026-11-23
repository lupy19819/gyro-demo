import assert from 'node:assert/strict';
import {qDevice,qFromView,viewFromQuat,relativeView,wrapPi} from './gyro-math.mjs';
import {makeGyroController} from './gyro.mjs';
import {RiftEffects} from './rift-effects.mjs';
const near=(a,b,e=1e-6)=>assert.ok(Math.abs(a-b)<e,`expected ${a} ~ ${b}`);
const angleNear=(a,b,e=1e-6)=>near(wrapPi(a-b),0,e);

// Quaternion -> panorama camera conversion: an arbitrary initial handset pose
// must map onto the same image view, with no tilt/heading jump.
for(const [yaw,pitch] of [[0,0],[.15,.12],[1.5,.6],[-2,-.7]]) {
  const v=viewFromQuat(qFromView(yaw,pitch));angleNear(v.yaw,yaw);near(v.pitch,pitch);
}
for(const [a,b,g,s] of [[0,90,0,0],[133,25,38,0],[270,155,-20,90],[37,-110,40,-90]]) {
  const start=qDevice(a,b,g,s), v=relativeView({yaw:.15,pitch:.12},start,start);
  angleNear(v.yaw,.15);near(v.pitch,.12);
}
const origin=qDevice(0,90,0), right=qDevice(30,90,0), left=qDevice(-30,90,0);
const rightView=relativeView({yaw:0,pitch:0},origin,right);
const leftView=relativeView({yaw:0,pitch:0},origin,left);
assert.ok(rightView.yaw>.4 && rightView.yaw<.65);
assert.ok(leftView.yaw<-.4 && leftView.yaw>-.65);
assert.ok(Math.abs(relativeView({yaw:0,pitch:0},origin,qDevice(0,110,0)).pitch)>.2);

// Run the controller against simulated device events, not only pure maths.
const listeners=new Map();
globalThis.window={isSecureContext:true,orientation:0,addEventListener:(name,fn)=>listeners.set(name,fn)};
globalThis.document={hidden:false,addEventListener:(name,fn)=>listeners.set(name,fn)};
globalThis.screen={orientation:{angle:0}};
globalThis.DeviceOrientationEvent=class {};
let view={yaw:.15,pitch:.12};
let status='';
const controller=makeGyroController({getView:()=>({...view}),setView:(yaw,pitch)=>{view={yaw,pitch};},onStatus:s=>{status=s;},homeView:{yaw:.15,pitch:.12}});
await controller.enable();
// Initial phone points downward: no initial scene jump.
controller.debugFeed(0,90,0);assert.equal(controller.begin(),true);
angleNear(view.yaw,.15);near(view.pitch,.12);
// Move right while pressing and let rendering smooth over several sensor samples.
for(let n=0;n<12;n++){
  // Debug feed may occur within same ms; immediate capture at press is tested separately.
  controller.debugFeed(30,90,0);
  await new Promise(resolve=>setTimeout(resolve,9));
}
assert.ok(view.yaw>.25,`held phone should rotate view: ${view.yaw}`);
controller.end();
const frozen={...view};
controller.debugFeed(-30,90,0); // Physical movement during release.
angleNear(view.yaw,frozen.yaw);near(view.pitch,frozen.pitch);
const nextTarget=relativeView({yaw:.15,pitch:.12},origin,left);
assert.equal(controller.begin(),true);
angleNear(view.yaw,nextTarget.yaw,1e-5); // Must snap to new physical location!
controller.end();
controller.debugFeed(0,90,0);
const beforePress={...view};
angleNear(view.yaw,beforePress.yaw);
controller.begin();angleNear(view.yaw,.15,1e-5);near(view.pitch,.12,1e-5);
controller.end();
// Pressing repeatedly with no physical movement should never drift.
for(let i=0;i<5;i++){controller.begin();angleNear(view.yaw,.15,1e-5);controller.end();}
// User manually resets forward direction at a new (previously tilted) pose.
controller.debugFeed(141,49,28);
controller.resetReference();view={yaw:.15,pitch:.12};
controller.begin();angleNear(view.yaw,.15);near(view.pitch,.12);controller.end();
controller.debugFeed(155,49,28);
controller.begin();assert.ok(Math.abs(view.yaw-.15)>.02);controller.end();
// Screen rotation must retain current visual orientation, not count as phone motion.
const preRotation={...view};
controller.debugFeed(155,49,28,90);
angleNear(view.yaw,preRotation.yaw);near(view.pitch,preRotation.pitch);
controller.begin();angleNear(view.yaw,preRotation.yaw);near(view.pitch,preRotation.pitch);
controller.end();
assert.equal(controller.hasOrigin,true);
console.log('PASS v0.3: 长期姿态基准、低头校准、释放仍跟踪、重按接管新位置、回位、反复按放不累积、手动重设、横竖屏切换');

const fx=new RiftEffects({openMs:600,freezeMs:500});
near(fx.sample(0).freeze,0);
fx.setFrozen(true,1000);
assert.equal(fx.sample(1020).direction,-1);
assert.ok(fx.sample(1300).freeze>0.5);
near(fx.tick(2000).freeze,1);
fx.setFrozen(false,2100);
assert.equal(fx.sample(2150).direction,1);
assert.ok(fx.sample(2400).pulse>0);
near(fx.tick(2900).freeze,0);
fx.setFrozen(true,3000);
const mid=fx.sample(3180).freeze;
fx.setFrozen(false,3180);
near(fx.sample(3180).freeze,mid);
const midAgain=fx.sample(3220).freeze;
fx.setFrozen(true,3220);
near(fx.sample(3220).freeze,midAgain);
near(fx.tick(4000).freeze,1);
console.log('PASS v0.4: seal/unseal transition and interrupted-state continuity');
