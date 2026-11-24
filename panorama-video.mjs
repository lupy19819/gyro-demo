// Video advances only while the rift is open. The last uploaded frame stays
// on the sphere when paused; the static image remains a loading/error fallback.
export function makePanoramaVideo({video, gl, onError=()=>{}}) {
  let active=false, texture=null, width=0, height=0, lastTime=-1;
  let dirty=true, failed=false, generation=0, frameCallback=null;
  const hasFrameCallback=typeof video.requestVideoFrameCallback==='function';
  function schedule(){
    if(!hasFrameCallback || frameCallback!==null || !active || failed)return;
    frameCallback=video.requestVideoFrameCallback(()=>{
      frameCallback=null;
      if(active){dirty=true;schedule();}
    });
  }
  function stopCallback(){
    if(frameCallback!==null){video.cancelVideoFrameCallback?.(frameCallback);frameCallback=null;}
  }
  function fail(error){
    if(failed)return;
    failed=true;active=false;generation++;stopCallback();video.pause();
    if(texture){gl.deleteTexture(texture);texture=null;}
    onError(error);
  }
  video.addEventListener('error',()=>fail(video.error||new Error('Video load failed')));
  function setActive(next){
    if(failed)return;
    if(active===next)return;
    active=next;
    const ticket=++generation;
    if(!active){stopCallback();video.pause();return;}
    dirty=true;
    try{
      Promise.resolve(video.play()).catch(e=>{
        if(active && ticket===generation)onError(e);
      });
      schedule();
    }catch(e){if(active && ticket===generation)onError(e);}
  }
  function update(){
    if(failed||video.readyState<2||!video.videoWidth||!video.videoHeight)return texture;
    // A first decoded frame is allowed while paused; subsequent updates require an open rift.
    if(texture&&!active)return texture;
    if(texture && (hasFrameCallback?!dirty:video.currentTime===lastTime))return texture;
    try {
      if(!texture){
        texture=gl.createTexture();
        if(!texture)throw new Error('Video texture allocation failed');
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      }else gl.bindTexture(gl.TEXTURE_2D,texture);
      if(width!==video.videoWidth||height!==video.videoHeight){
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,video);
        width=video.videoWidth;height=video.videoHeight;
      }else gl.texSubImage2D(gl.TEXTURE_2D,0,0,0,gl.RGBA,gl.UNSIGNED_BYTE,video);
      dirty=false;lastTime=video.currentTime;
    }catch(e){fail(e);}
    return texture;
  }
  return {setActive,update,get active(){return active;},get failed(){return failed;},get time(){return video.currentTime;},get paused(){return video.paused;}};
}
