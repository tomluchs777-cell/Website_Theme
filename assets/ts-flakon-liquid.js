import * as THREE from './ts-three.module.js';

// A closed, clipped inner volume. Local coordinates are millimetres, Y up.
// A deterministic volume sample keeps the fill approximately constant at every tilt.
const profile = [[0,21.4],[21.8,21.4],[26.6,22.5],[28.4,24.5],[29.1,27],
  [29.3,68.8],[28.9,71.6],[27.4,73.1],[9.7,74.6],[5.6,76.6],[4.2,79.8],[4.2,84.8],[0,84.8]];
const shell = new THREE.LatheGeometry(profile.map(([r,y]) => new THREE.Vector2(r,y)), 48).toNonIndexed();
const source = shell.getAttribute('position');
const sourceNormals = shell.getAttribute('normal');
const triangles = [];
for (let i=0;i<source.count;i+=3) {
  triangles.push([0,1,2].map(k => ({ p:new THREE.Vector3().fromBufferAttribute(source,i+k), n:new THREE.Vector3().fromBufferAttribute(sourceNormals,i+k) })));
}
shell.dispose();
function halton(index,base) {
  let result=0, f=1;
  while(index>0) { f/=base; result+=f*(index%base); index=Math.floor(index/base); }
  return result;
}
const samples=[];
for(let i=1;samples.length<2048;i++) {
  const y=21.4+halton(i,2)*63.4;
  let radius=0;
  for(let j=1;j<profile.length;j++) {
    const [a,ay]=profile[j-1], [b,by]=profile[j];
    if(by>ay && y>=ay && y<=by) radius=a+(b-a)*(y-ay)/(by-ay);
  }
  const x=(halton(i,3)*2-1)*29.3, z=(halton(i,5)*2-1)*29.3;
  if(x*x+z*z<radius*radius) samples.push(new THREE.Vector3(x,y,z));
}

export function createLiquid(fill) {
  const geometry=new THREE.BufferGeometry();
  const positions=new Float32Array(90000), normals=new Float32Array(90000);
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3).setUsage(THREE.DynamicDrawUsage));
  const material=new THREE.MeshPhysicalMaterial({color:0xffe9b0,metalness:0,roughness:.12,
    transmission:.88,thickness:35,ior:1.36,attenuationColor:0xf3cf7e,attenuationDistance:120,
    clearcoat:1,clearcoatRoughness:.06,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='Animated perfume';
  mesh.frustumCulled=false;
  mesh.position.y=-54;
  let cursor=0;
  const emit=(a,b,c) => {
    for(const v of [a,b,c]) {
      positions.set(v.p.toArray(),cursor); normals.set(v.n.toArray(),cursor); cursor+=3;
    }
  };
  function update(normal) {
    const projections=samples.map(p=>p.dot(normal)).sort((a,b)=>a-b);
    const height=projections[Math.floor((projections.length-1)*fill)];
    const cuts=[];
    cursor=0;
    for(const triangle of triangles) {
      const clipped=[];
      for(let i=0;i<3;i++) {
        const a=triangle[i], b=triangle[(i+1)%3];
        const da=a.p.dot(normal)-height, db=b.p.dot(normal)-height;
        if(da<=0) clipped.push(a);
        if((da<0&&db>0)||(da>0&&db<0)) {
          const t=da/(da-db);
          const vertex={p:a.p.clone().lerp(b.p,t),n:a.n.clone().lerp(b.n,t).normalize()};
          clipped.push(vertex); cuts.push(vertex.p);
        }
      }
      for(let i=1;i<clipped.length-1;i++) emit(clipped[0],clipped[i],clipped[i+1]);
    }
    if(cuts.length>=3) {
      const center=new THREE.Vector3();
      for(const p of cuts) center.add(p);
      center.divideScalar(cuts.length);
      const u=new THREE.Vector3(Math.abs(normal.y)<.9?0:1,Math.abs(normal.y)<.9?1:0,0).cross(normal).normalize();
      const v=new THREE.Vector3().crossVectors(normal,u);
      cuts.sort((a,b)=>Math.atan2(a.clone().sub(center).dot(v),a.clone().sub(center).dot(u))-Math.atan2(b.clone().sub(center).dot(v),b.clone().sub(center).dot(u)));
      for(let i=0;i<cuts.length;i++) emit({p:center,n:normal},{p:cuts[i],n:normal},{p:cuts[(i+1)%cuts.length],n:normal});
    }
    geometry.setDrawRange(0,cursor/3);
    geometry.attributes.position.needsUpdate=true;
    geometry.attributes.normal.needsUpdate=true;
    mesh.userData.surfaceNormal=normal.toArray();
    mesh.userData.surfaceHeight=height;
  }
  update(new THREE.Vector3(0,1,0));
  return {mesh,update};
}
