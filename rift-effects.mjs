// Presentation effects are independent of the gyroscope reference coordinate system.
export class RiftEffects {
  constructor({openMs=620,freezeMs=520}={}) {
    this.openMs=openMs;this.freezeMs=freezeMs;this.from=0;this.to=0;
    this.start=0;this.duration=1;this.direction=0;this.running=false;
  }
  sample(now) {
    const t=this.running?Math.max(0,Math.min(1,(now-this.start)/this.duration)):1;
    const ease=t*t*(3-2*t);
    const freeze=this.from+(this.to-this.from)*ease;
    return {freeze,progress:t,direction:this.running?this.direction:0,
      pulse:this.running?Math.sin(Math.PI*t):0,running:this.running&&t<1};
  }
  setFrozen(frozen,now) {
    const next=frozen?1:0;
    const current=this.sample(now).freeze;
    if(this.to===next&&(this.running||Math.abs(current-next)<1e-6))return this.sample(now);
    this.from=current;this.to=next;this.start=now;
    this.duration=Math.max(100,(frozen?this.freezeMs:this.openMs)*Math.max(.18,Math.abs(next-current)));
    this.direction=frozen?-1:1;this.running=true;
    return this.sample(now);
  }
  tick(now) {
    const sampled=this.sample(now);
    if(!sampled.running) {
      this.running=false;this.from=this.to;
      return {...sampled,freeze:this.to,direction:0,pulse:0,progress:1,running:false};
    }
    return sampled;
  }
}
