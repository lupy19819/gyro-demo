import {qDevice, relativeView, clamp, wrapPi} from './gyro-math.mjs';

export function makeGyroController({getView,setView,onStatus=()=>{},onDebug=()=>{}}) {
  let enabled=false, holding=false, latest=null, baseline=null, anchorView=null;
  let prevT=0, lastDebugT=0, sampleCount=0, angleAtAnchor=null;
  const now=()=>performance.now();
  const currentScreenAngle=()=> Number(screen.orientation?.angle ?? window.orientation ?? 0) || 0;
  const fmt=v=>Number(v).toFixed(1);
  const tooOld=()=> !latest || now()-latest.t>2500;

  function reanchor() {
    if (!latest) return false;
    baseline=latest.q;
    angleAtAnchor=latest.screenAngle;
    anchorView={...getView()};
    prevT=latest.t;
    return true;
  }
  function begin() {
    if (!enabled) {onStatus('请先点击「启用方向感应」授权','error');return false;}
    if (tooOld()) {onStatus('还没收到有效姿态数据，请将手机稍微转动后重试','error');return false;}
    holding=true;
    reanchor();
    onStatus('观察中：当前手持姿态已定为观察起点','ok');
    return true;
  }
  function end() {
    if(!holding)return;
    holding=false;
    baseline=null;
    anchorView=null;
    onStatus('视角已固定；下次按住从这里继续','ok');
  }
  function processSample(a,b,g,screenAngle,t=now()) {
    if (![a,b,g,screenAngle].every(Number.isFinite)) return;
    latest={q:qDevice(a,b,g,screenAngle),t,screenAngle,raw:[a,b,g]};
    sampleCount++;
    if (sampleCount===1) onStatus('传感器已就绪，按住下方按钮开始观察','ok');
    if (holding) {
      if (!baseline || angleAtAnchor!==screenAngle) {
        // A portrait/landscape switch must not suddenly rotate the scene.
        reanchor();
      } else {
        const desired=relativeView(anchorView,baseline,latest.q);
        const current=getView();
        const dt=Math.max(0,Math.min(200,t-prevT));
        prevT=t;
        // ~50 ms low-pass; deal with 180/-180 angle wrapping explicitly.
        const gain=clamp(1-Math.exp(-dt/50),0.01,1);
        const y=current.yaw + wrapPi(desired.yaw-current.yaw)*gain;
        const p=clamp(current.pitch+(desired.pitch-current.pitch)*gain,-1.40,1.40);
        setView(y,p);
      }
    }
    if(t-lastDebugT>=120) {
      lastDebugT=t;
      const v=getView();
      onDebug(`设备 α ${fmt(a)}° · β ${fmt(b)}° · γ ${fmt(g)}°  |  场景水平 ${fmt(v.yaw*180/Math.PI)}° · 垂直 ${fmt(v.pitch*180/Math.PI)}°`);
    }
  }
  function onOrientation(e) {
    if(!enabled)return;
    // Some Android browsers provide null alpha before their sensor activates.
    if(e.alpha == null || e.beta == null || e.gamma == null) return;
    processSample(e.alpha,e.beta,e.gamma,currentScreenAngle());
  }
  async function enable() {
    if (enabled)return;
    if(!window.isSecureContext)throw new Error('手机传感器需要 HTTPS 页面；局域网 HTTP 地址通常无效');
    if(typeof DeviceOrientationEvent==='undefined') throw new Error('此浏览器不提供 DeviceOrientationEvent；可使用触屏拖拽');
    if(typeof DeviceOrientationEvent.requestPermission==='function') {
      // Called immediately on the click, never from a timer or effect.
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
    if(document.hidden)end();
  });
  return {
    get ready(){return enabled;},
    get holding(){return holding;},
    get hasSample(){return latest!==null;},
    begin,end,reanchor,enable,
    debugFeed:(a,b,g,s=0)=>{
      // Only for scripted browser tests. Does not bypass phone permission UI.
      enabled=true;
      processSample(a,b,g,s,now());
    }
  };
}
