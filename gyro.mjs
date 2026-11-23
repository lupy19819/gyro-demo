import {qDevice, relativeView, clamp, wrapPi} from './gyro-math.mjs';

// v0.3: one persistent reference for the whole observing session.
// Unlike v0.1/v0.2, pressing again MUST NOT re-anchor the current pose to the
// frozen view. The next press catches up to the phone's actual tracked pose.
export function makeGyroController({getView,setView,onStatus=()=>{},onDebug=()=>{},homeView={yaw:0,pitch:0}}) {
  let enabled=false, holding=false, latest=null;
  let origin=null, originView=null, originScreenAngle=null;
  let prevT=0,lastDebugT=0,sampleCount=0;
  const now=()=>performance.now();
  const screenAngle=()=>Number(screen.orientation?.angle ?? window.orientation ?? 0)||0;
  const stale=()=>!latest || now()-latest.t>2500;
  const deg=rad=>(rad*180/Math.PI).toFixed(1);

  function desiredView(){
    if(!origin || !latest || !originView) return null;
    const v=relativeView(originView, origin, latest.q);
    return {yaw:v.yaw, pitch:clamp(v.pitch,-1.40,1.40)};
  }
  function applyView(v, gain=1){
    if(!v)return;
    const current=getView();
    setView(current.yaw+wrapPi(v.yaw-current.yaw)*gain,
      clamp(current.pitch+(v.pitch-current.pitch)*gain,-1.40,1.40));
  }
  function begin(){
    if(!enabled){onStatus('请先启用方向感应','error');return false;}
    if(stale()){onStatus('尚未收到新鲜姿态数据，请移动手机后重试','error');return false;}
    if(!origin){
      // This is the ONLY automatic calibration of the persistent orientation.
      // A tilted initial handset simply maps to the current scene viewpoint.
      origin=latest.q;
      originView={...getView()};
      originScreenAngle=latest.screenAngle;
    }
    holding=true;
    prevT=latest.t;
    // Catch up immediately: movement performed while released is NOT discarded.
    applyView(desiredView());
    onStatus('观察中：手机当前朝向决定画面，松开只冻结显示','ok');
    return true;
  }
  function end(){
    if(!holding)return;
    holding=false;
    onStatus('显示已冻结；手机仍在跟踪，移动后再按住会跳到新的朝向','ok');
  }
  function processSample(a,b,g,angle,t=now()){
    if(![a,b,g,angle,t].every(Number.isFinite))return;
    latest={q:qDevice(a,b,g,angle),t,screenAngle:angle};
    sampleCount++;
    if(sampleCount===1)onStatus('传感器就绪；首次按住将当前手机姿态设为观察原点','ok');
    if(origin && originScreenAngle!==angle){
      // Preserve the current view on orientation changes. Otherwise the
      // screen-coordinate jump could look like a large physical rotation.
      origin=latest.q;
      originView={...getView()};
      originScreenAngle=angle;
      prevT=t;
      onStatus('横竖屏切换：按当前姿态重新校准，画面保持连续','ok');
    }
    if(holding){
      const target=desiredView();
      const dt=Math.max(0,Math.min(200,t-prevT));
      prevT=t;
      const gain=clamp(1-Math.exp(-dt/50),.01,1);
      applyView(target,gain);
    }
    // Not holding: update latest pose ONLY. Don't alter the displayed scene.
    if(t-lastDebugT>=120){
      lastDebugT=t;
      const v=getView(), track=desiredView();
      const tracked=track?`手机对应水平 ${deg(track.yaw)}°`:'等待首次基准';
      onDebug(`${holding?'观察中':'显示冻结 · 姿态仍跟踪'} · ${tracked} | 画面水平 ${deg(v.yaw)}° · 垂直 ${deg(v.pitch)}°`);
    }
  }
  function onOrientation(e){
    if(!enabled||e.alpha==null||e.beta==null||e.gamma==null)return;
    processSample(e.alpha,e.beta,e.gamma,screenAngle());
  }
  function resetReference(){
    if(latest && !stale()){
      origin=latest.q;
      originView={...homeView};
      originScreenAngle=latest.screenAngle;
      prevT=latest.t;
    }else{
      origin=null;originView=null;originScreenAngle=null;
    }
    onStatus('已将当前手机姿态设为新的正前方基准','ok');
  }
  async function enable(){
    if(enabled)return;
    if(!window.isSecureContext)throw new Error('手机传感器需要 HTTPS；局域网 HTTP 通常无效');
    if(typeof DeviceOrientationEvent==='undefined')throw new Error('浏览器不提供 DeviceOrientationEvent；仍可触屏拖拽');
    if(typeof DeviceOrientationEvent.requestPermission==='function'){
      const permission=await DeviceOrientationEvent.requestPermission();
      if(permission!=='granted')throw new Error('方向传感器权限被拒绝');
    }
    enabled=true;
    window.addEventListener('deviceorientation',onOrientation,true);
    onStatus('权限已通过，正在等待姿态数据…');
    setTimeout(()=>{if(enabled&&!latest)onStatus('未收到姿态数据，请检查手机和浏览器权限','error');},3500);
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)end();});
  return {
    get ready(){return enabled;},get holding(){return holding;},
    get hasSample(){return latest!==null;},get hasOrigin(){return origin!==null;},
    get trackingView(){return desiredView();},
    begin,end,enable,resetReference,
    debugFeed:(a,b,g,s=0)=>{enabled=true;processSample(a,b,g,s,now());}
  };
}
