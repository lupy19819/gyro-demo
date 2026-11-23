import {qDevice, relativeView, clamp, wrapPi} from './gyro-math.mjs';
import {PoseReturnDetector} from './return-detector.mjs';

export function makeGyroController({getView,setView,onStatus=()=>{},onDebug=()=>{},homeView={yaw:0,pitch:0}}) {
  let enabled=false, holding=false, latest=null, baseline=null, anchorView=null;
  let prevT=0, lastDebugT=0, sampleCount=0, angleAtAnchor=null;
  let originScreenAngle=null, returnAnimation=null, autoReturn=true;
  const detector=new PoseReturnDetector();
  const now=()=>performance.now();
  const currentScreenAngle=()=>Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
  const fmt=v=>Number(v).toFixed(1);
  const tooOld=()=>!latest || now()-latest.t>2500;

  function reanchor() {
    if (!latest) return false;
    baseline=latest.q;
    angleAtAnchor=latest.screenAngle;
    anchorView={...getView()};
    prevT=latest.t;
    return true;
  }
  function stopAnimation() { returnAnimation=null; }
  function begin() {
    if(!enabled) {onStatus('请先点击「启用方向感应」授权','error');return false;}
    if(tooOld()) {onStatus('尚未收到新鲜姿态数据，请移动手机后重试','error');return false;}
    stopAnimation(); // Pressing during an automatic return begins from the CURRENT rendered angle.
    holding=true;
    if(!detector.origin) {
      detector.setOrigin(latest.q);
      originScreenAngle=latest.screenAngle;
    }
    reanchor();
    onStatus('观察中：松开后把手机转回首次握持方向，可自动回正','ok');
    return true;
  }
  function end() {
    if(!holding)return;
    holding=false;
    baseline=null;
    anchorView=null;
    detector.cancelCandidate();
    onStatus(autoReturn
      ? '视角已固定；回到首次握持姿态并稍作停留即可回正'
      : '视角已固定；自动回位已关闭', 'ok');
  }
  function triggerReturn(t) {
    if(!autoReturn || holding) return;
    const start=getView();
    returnAnimation={start:{...start},at:t,duration:650};
    onStatus('检测到手机回到原始姿态，正在平滑回正…','ok');
  }
  function tick(t=now()) {
    if(!returnAnimation || holding) return;
    const a=returnAnimation;
    const p=clamp((t-a.at)/a.duration,0,1);
    const smooth=p*p*(3-2*p);
    setView(a.start.yaw+wrapPi(homeView.yaw-a.start.yaw)*smooth,
      clamp(a.start.pitch+(homeView.pitch-a.start.pitch)*smooth,-1.4,1.4));
    if(p>=1) {
      setView(homeView.yaw,homeView.pitch);
      stopAnimation();
      onStatus('已自动回到场景正前方','ok');
    }
  }
  function interruptReturn() {
    stopAnimation();
    detector.disarm();
  }
  function resetReference() {
    stopAnimation();
    if(latest && !tooOld()) {
      detector.setOrigin(latest.q);
      originScreenAngle=latest.screenAngle;
    } else {
      detector.clear();
      originScreenAngle=null;
    }
    if(holding) reanchor();
    onStatus('已回正，并将当前手机姿态设为新的回位基准','ok');
  }
  function setAutoReturn(on) {
    autoReturn=!!on;
    if(!autoReturn) {detector.disarm();stopAnimation();}
    onStatus(autoReturn?'自动回位已开启：松开后转回初始握持方向':'自动回位已关闭；仍可手动回正','ok');
  }
  function processSample(a,b,g,screenAngle,t=now()) {
    if (![a,b,g,screenAngle,t].every(Number.isFinite)) return;
    latest={q:qDevice(a,b,g,screenAngle),t,screenAngle,raw:[a,b,g]};
    sampleCount++;
    if(sampleCount===1) onStatus('传感器已就绪，按住下方按钮开始观察','ok');

    // Rebase the long-term physical reference after a screen orientation change.
    // Cross-orientation quaternions should never be mistaken for a return gesture.
    if(detector.origin && originScreenAngle!==screenAngle) {
      stopAnimation();
      detector.setOrigin(latest.q);
      originScreenAngle=screenAngle;
      if(holding) reanchor();
      onStatus('屏幕方向改变：已按当前握持方向重新校准','ok');
    }
    if(holding) {
      if(!baseline || angleAtAnchor!==screenAngle) reanchor();
      else {
        const desired=relativeView(anchorView,baseline,latest.q);
        const current=getView();
        const dt=Math.max(0,Math.min(200,t-prevT));
        prevT=t;
        const gain=clamp(1-Math.exp(-dt/50),0.01,1);
        const y=current.yaw+wrapPi(desired.yaw-current.yaw)*gain;
        const p=clamp(current.pitch+(desired.pitch-current.pitch)*gain,-1.40,1.40);
        setView(y,p);
      }
    }
    const rec=detector.sample(latest.q,t,{
      holding:holding && autoReturn,
      eligible:enabled && autoReturn && !document.hidden && !returnAnimation
    });
    if(rec.triggered) triggerReturn(t);
    if(t-lastDebugT>=120) {
      lastDebugT=t;
      const v=getView();
      const offset=rec.distanceDeg===null?'未设置':`${fmt(rec.distanceDeg)}°`;
      onDebug(`手机离基准 ${offset} · ${rec.armed?'待回位':'观察可建立回位'} | 水平 ${fmt(v.yaw*180/Math.PI)}° · 垂直 ${fmt(v.pitch*180/Math.PI)}°`);
    }
  }
  function onOrientation(e) {
    if(!enabled)return;
    if(e.alpha==null || e.beta==null || e.gamma==null)return;
    processSample(e.alpha,e.beta,e.gamma,currentScreenAngle());
  }
  async function enable() {
    if(enabled)return;
    if(!window.isSecureContext)throw new Error('手机传感器需要 HTTPS 页面；局域网 HTTP 地址通常无效');
    if(typeof DeviceOrientationEvent==='undefined')throw new Error('此浏览器不提供 DeviceOrientationEvent；可使用触屏拖拽');
    if(typeof DeviceOrientationEvent.requestPermission==='function') {
      const permission=await DeviceOrientationEvent.requestPermission();
      if(permission!=='granted')throw new Error('方向传感器权限被拒绝；请检查浏览器设置');
    }
    enabled=true;
    window.addEventListener('deviceorientation',onOrientation,true);
    onStatus('授权已通过，正在等待手机姿态数据…');
    setTimeout(()=>{
      if(enabled && !latest)onStatus('未收到姿态事件：请确认是手机、HTTPS 和受支持的浏览器','error');
    },3500);
  }
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden) {end();detector.cancelCandidate();stopAnimation();}
  });
  return {
    get ready(){return enabled;},
    get holding(){return holding;},
    get hasSample(){return latest!==null;},
    get hasOrigin(){return detector.origin!==null;},
    get returnArmed(){return detector.armed;},
    get autoReturn(){return autoReturn;},
    begin,end,reanchor,enable,tick,resetReference,setAutoReturn,interruptReturn,
    debugFeed:(a,b,g,s=0)=>{
      // Scripted browser QA only. Does not bypass phone permission UI.
      enabled=true;
      processSample(a,b,g,s,now());
    }
  };
}
