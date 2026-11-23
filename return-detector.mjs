import {clamp, qNorm} from './gyro-math.mjs';

// Long-lived reference is independent of each button press's clutch anchor.
// A return is recognized only after meaningful movement WHILE observing,
// followed by a stable dwell near the original handset orientation.
export function quaternionDistanceDeg(a, b) {
  if (!a || !b) return Infinity;
  const A = qNorm(a), B = qNorm(b);
  const dot = Math.abs(A.reduce((sum, value, i) => sum + value * B[i], 0));
  return (360 / Math.PI) * Math.acos(clamp(dot, 0, 1));
}

export class PoseReturnDetector {
  constructor({enterDeg=9, exitDeg=17, dwellMs=420, stillnessDeg=2.8, maxGapMs=700}={}) {
    this.enterDeg=enterDeg;
    this.exitDeg=exitDeg;
    this.dwellMs=dwellMs;
    this.stillnessDeg=stillnessDeg;
    this.maxGapMs=maxGapMs;
    this.clear();
  }
  clear() {
    this.origin=null;
    this.armed=false;
    this.candidateTime=null;
    this.candidatePose=null;
    this.lastTime=null;
  }
  setOrigin(q) {
    this.clear();
    this.origin=qNorm(q);
  }
  disarm() {
    this.armed=false;
    this.cancelCandidate();
  }
  cancelCandidate() {
    this.candidateTime=null;
    this.candidatePose=null;
  }
  sample(q, time, {holding=false, eligible=true}={}) {
    if(!this.origin || !q || !Number.isFinite(time))
      return {triggered:false, distanceDeg:null, armed:false};
    const distanceDeg=quaternionDistanceDeg(this.origin,q);
    if(holding && distanceDeg>=this.exitDeg) this.armed=true;
    const result=triggered=>({triggered,distanceDeg,armed:this.armed});
    // Never recenter while the user is observing, or on stale/hidden frames.
    if(!this.armed || holding || !eligible) {
      this.cancelCandidate();
      this.lastTime=time;
      return result(false);
    }
    if(distanceDeg>this.enterDeg) {
      this.cancelCandidate();
      this.lastTime=time;
      return result(false);
    }
    // Require a continuous dwell without significantly changing orientation;
    // simply passing through the origin is not enough.
    if(this.candidateTime===null || this.lastTime===null ||
      time<this.lastTime || time-this.lastTime>this.maxGapMs ||
      quaternionDistanceDeg(this.candidatePose,q)>this.stillnessDeg) {
      this.candidateTime=time;
      this.candidatePose=qNorm(q);
    }
    this.lastTime=time;
    if(time-this.candidateTime<this.dwellMs) return result(false);
    this.armed=false;
    this.cancelCandidate();
    return result(true);
  }
}
