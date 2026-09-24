import * as THREE from './ts-three.module.js';
import { GLTFLoader } from './ts-GLTFLoader.js';
import { modelBase64 } from './ts-flakon-model.js';
import { createLiquid } from './ts-flakon-liquid.js';

export async function createFlakonScene(host) {
  const stage=host.querySelector('.ts-flakon-viewer__stage');
  const renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=.9;
  renderer.setClearColor(0x000000,0);
  renderer.domElement.setAttribute('aria-hidden','true');
  const scene=new THREE.Scene();
  scene.background=new THREE.Color(getComputedStyle(host).backgroundColor);
  const camera=new THREE.PerspectiveCamera(32,1,1,1500);
  camera.position.set(0,14,245); camera.lookAt(0,0,0);
  const pivot=new THREE.Group(); scene.add(pivot);

  // Studio reflections, generated locally: no external HDR downloads.
  const studio=new THREE.Scene(); studio.background=new THREE.Color(0x25282d);
  const panels=[];
  for(const [x,y,z,w,h,power] of [[-90,30,35,35,180,7],[100,50,-20,45,160,5],[0,140,0,130,20,4],[0,20,-110,100,140,2]]) {
    const panel=new THREE.Mesh(new THREE.BoxGeometry(w,h,4),new THREE.MeshBasicMaterial({color:new THREE.Color().setScalar(power)}));
    panel.position.set(x,y,z);panel.lookAt(0,20,0);studio.add(panel);panels.push(panel);
  }
  const pmrem=new THREE.PMREMGenerator(renderer);
  const env=pmrem.fromScene(studio,.04,.1,1000);
  scene.environment=env.texture;
  pmrem.dispose(); panels.forEach(p=>{p.geometry.dispose();p.material.dispose();});
  scene.add(new THREE.HemisphereLight(0xffffff,0x897759,.5));
  const light=new THREE.DirectionalLight(0xfff3da,1.5);light.position.set(70,110,120);scene.add(light);

  let model;
  try {
    const bytes=Uint8Array.from(atob(modelBase64),c=>c.charCodeAt(0));
    model=(await new GLTFLoader().parseAsync(bytes.buffer,'')).scene;
  } catch(error) {env.dispose();renderer.dispose();throw error;}
  model.scale.setScalar(1000);model.position.y=-54;
  pivot.add(model);
  const liquid=createLiquid(THREE.MathUtils.clamp(Number(host.dataset.fill)||.7,.1,.9));
  pivot.add(liquid.mesh);
  model.traverse(obj=>{
    if(!obj.isMesh) return;
    if(obj.material.name==='Clear glass') {
      // Fresnel-weighted reflective shell keeps nested liquid readable on mobile.
      // This is a real-time optical approximation, not path-traced glass.
      obj.material.transmission=0;obj.material.transparent=true;obj.material.opacity=.85;
      obj.material.depthWrite=false;obj.material.side=THREE.DoubleSide;
      obj.material.color.set(0xc2cbd2);obj.material.metalness=1;
      obj.material.roughness=.045;obj.material.envMapIntensity=1;
      obj.material.clearcoat=0;obj.renderOrder=3;
      obj.material.onBeforeCompile=shader=>{
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',
          'diffuseColor.a *= 0.055 + 0.945 * pow(1.0 - abs(dot(normal, normalize(vViewPosition))), 2.5);\n#include <opaque_fragment>');
      };
      obj.material.customProgramCacheKey=()=> 'ts-glass-fresnel-v1';
    }
  });
  stage.append(renderer.domElement);
  const touchTarget=document.createElement('div');
  touchTarget.className='ts-flakon-viewer__touch';
  stage.append(touchTarget);
  const abort=new AbortController(), signal=abort.signal;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const ray=new THREE.Raycaster(), pointer=new THREE.Vector2();
  let dragging=false, pointerId=null, lastX=0,lastY=0,disposed=false,visible=true,raf=0,lastTime=0;
  let energy=0;
  const wobble=new THREE.Vector2(), speed=new THREE.Vector2();
  const lastNormal=new THREE.Vector3(0,1,0);
  function hit(event) {
    const rect=stage.getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    pivot.updateMatrixWorld(true);ray.setFromCamera(pointer,camera);
    return ray.intersectObjects(model.children,true).length>0;
  }
  function rotate(dx,dy) {
    const q=new THREE.Quaternion().setFromEuler(new THREE.Euler(dy*.009,dx*.009,0,'XYZ'));
    pivot.quaternion.premultiply(q).normalize();
    if(!reduced.matches) {speed.x=THREE.MathUtils.clamp(speed.x+dx*.003,-1,1);speed.y=THREE.MathUtils.clamp(speed.y+dy*.003,-1,1);energy=2;}
    wake();
  }
  stage.addEventListener('pointerdown',event=>{
    if(event.button!==0||dragging||!hit(event)) return;
    event.preventDefault();stage.focus({preventScroll:true});
    dragging=true;pointerId=event.pointerId;lastX=event.clientX;lastY=event.clientY;
    stage.setPointerCapture(pointerId);stage.style.cursor='grabbing';
  },{signal});
  stage.addEventListener('pointermove',event=>{
    if(dragging&&event.pointerId===pointerId) {
      rotate(event.clientX-lastX,event.clientY-lastY);lastX=event.clientX;lastY=event.clientY;
    } else if(!dragging) stage.style.cursor=hit(event)?'grab':'auto';
  },{signal});
  const release=event=>{if(event.pointerId===pointerId){dragging=false;pointerId=null;stage.style.cursor='grab';}};
  for(const name of ['pointerup','pointercancel','lostpointercapture']) stage.addEventListener(name,release,{signal});
  stage.addEventListener('keydown',event=>{
    const moves={ArrowLeft:[-8,0],ArrowRight:[8,0],ArrowUp:[0,-8],ArrowDown:[0,8]};
    if(moves[event.key]){event.preventDefault();rotate(...moves[event.key]);}
    else if(event.key==='Home'){event.preventDefault();pivot.quaternion.identity();speed.set(0,0);wobble.set(0,0);wake();}
  },{signal});
  stage.addEventListener('dblclick',()=>{pivot.quaternion.identity();wake();},{signal});
  function frame(time) {
    raf=0;if(disposed||!visible||document.hidden)return;
    const dt=Math.min((time-lastTime)/1000||.016,.033);lastTime=time;
    if(reduced.matches){speed.set(0,0);wobble.set(0,0);energy=0;}
    else {
      speed.addScaledVector(wobble,-35*dt).multiplyScalar(Math.exp(-5*dt));
      wobble.addScaledVector(speed,dt);energy=Math.max(0,energy-dt);
    }
    const normal=new THREE.Vector3(wobble.x,1,wobble.y).normalize().applyQuaternion(pivot.quaternion.clone().invert());
    if(normal.distanceToSquared(lastNormal)>1e-9){liquid.update(normal);lastNormal.copy(normal);}
    renderer.render(scene,camera);
    if(energy>0)raf=requestAnimationFrame(frame);
  }
  function wake(){if(!raf&&!disposed&&visible&&!document.hidden)raf=requestAnimationFrame(frame);}
  const resize=new ResizeObserver(()=>{
    const width=stage.clientWidth,height=stage.clientHeight;
    if(!width||!height)return;
    camera.aspect=width/height;
    camera.position.z=Math.max(245,140/camera.aspect);
    camera.lookAt(0,0,0);camera.updateProjectionMatrix();
    renderer.setSize(width,height);wake();
  });resize.observe(stage);
  const visibility=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(visible)wake();});visibility.observe(host);
  document.addEventListener('visibilitychange',wake,{signal});
  renderer.domElement.addEventListener('webglcontextlost',event=>{
    event.preventDefault();cancelAnimationFrame(raf);raf=0;host.removeAttribute('data-ready');
    host.querySelector('[role="status"]').textContent='Die 3D-Ansicht wurde unterbrochen. Bitte lade die Seite neu.';
  },{signal});
  host.setAttribute('data-ready','');wake();
  return {pivot,liquid,renderer,scene,camera,dispose(){
    disposed=true;cancelAnimationFrame(raf);abort.abort();resize.disconnect();visibility.disconnect();
    scene.traverse(obj=>{if(obj.isMesh){obj.geometry.dispose();for(const m of [].concat(obj.material))m.dispose();}});
    env.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();touchTarget.remove();host.removeAttribute('data-ready');
  }};
}
