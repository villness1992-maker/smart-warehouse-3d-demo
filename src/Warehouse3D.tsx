"use client";
import {useEffect,useRef,useState} from "react";
import * as THREE from "three";
import {OrbitControls} from "three/addons/controls/OrbitControls.js";

export type SceneBin={id:string;rack:string;level:number;column:number;capacity:number;total:number;status:"empty"|"normal"|"low"|"over"};
type Props={bins:SceneBin[];selected:string|null;resetToken:number;onSelect:(id:string)=>void;onHover:(id:string|null)=>void};
type BinMeshes={cargo:THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>;back:THREE.Mesh<THREE.BoxGeometry,THREE.MeshStandardMaterial>;led:THREE.Mesh<THREE.BoxGeometry,THREE.MeshBasicMaterial>};
const colors={empty:0x334d5d,normal:0x36d8bb,low:0xffba55,over:0xff6b72};
const rackCenters:Record<string,[number,number]>={A1:[-6.2,4.3],A2:[6.2,4.3],B1:[-6.2,-4.3],B2:[6.2,-4.3]};
const initialCamera=new THREE.Vector3(21,15.5,24);
const initialTarget=new THREE.Vector3(0,2,0);

function labelTexture(label:string){
 const canvas=document.createElement("canvas");canvas.width=256;canvas.height=96;
 const context=canvas.getContext("2d")!;context.fillStyle="#183949";context.fillRect(0,0,256,96);
 context.strokeStyle="#55d8c7";context.lineWidth=5;context.strokeRect(3,3,250,90);
 context.fillStyle="#b8fff2";context.font="bold 56px sans-serif";context.textAlign="center";context.textBaseline="middle";context.fillText(label,128,50);
 const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;return texture;
}
export default function Warehouse3D({bins,selected,resetToken,onSelect,onHover}:Props){
 const hostRef=useRef<HTMLDivElement>(null);
 const updateRef=useRef<((rows:SceneBin[])=>void)|null>(null);
 const resetRef=useRef<(()=>void)|null>(null);
 const selectRef=useRef<((id:string|null)=>void)|null>(null);
 const onSelectRef=useRef(onSelect),onHoverRef=useRef(onHover);
 const [unavailable,setUnavailable]=useState(false);
 onSelectRef.current=onSelect;onHoverRef.current=onHover;
 useEffect(()=>{
  const host=hostRef.current;if(!host)return;
  let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"high-performance"});}
  catch{setUnavailable(true);return}
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.75));
  renderer.setSize(Math.max(1,host.clientWidth),Math.max(1,host.clientHeight));
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.45;
  renderer.setClearColor(0x0c1e2b,1);
  renderer.domElement.setAttribute("aria-label","真实三维仓库：拖动旋转，滚轮缩放，点击库位查看详情");
  renderer.domElement.style.display="block";
  host.appendChild(renderer.domElement);

  const scene=new THREE.Scene();scene.background=new THREE.Color(0x0c1e2b);scene.fog=new THREE.Fog(0x0c1e2b,45,90);
  const camera=new THREE.PerspectiveCamera(47,host.clientWidth/Math.max(1,host.clientHeight),.1,120);
  camera.position.copy(initialCamera);camera.lookAt(initialTarget);
  const controls=new OrbitControls(camera,renderer.domElement);
  controls.target.copy(initialTarget);controls.enableDamping=true;controls.dampingFactor=.08;
  controls.minDistance=11;controls.maxDistance=52;controls.maxPolarAngle=Math.PI/2.1;controls.minPolarAngle=.25;
  controls.screenSpacePanning=false;controls.update();
  scene.add(new THREE.HemisphereLight(0xb9efff,0x19313b,3.1));
  const sun=new THREE.DirectionalLight(0xffffff,2.6);sun.position.set(-9,18,13);scene.add(sun);
  const fill=new THREE.DirectionalLight(0x58cfff,1.55);fill.position.set(12,8,-10);scene.add(fill);

  const floor=new THREE.Mesh(new THREE.PlaneGeometry(31,23),new THREE.MeshStandardMaterial({color:0x142a35,roughness:.9,metalness:.07}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-.06;scene.add(floor);
  const grid=new THREE.GridHelper(31,31,0x2b5965,0x23424e);grid.position.y=-.052;scene.add(grid);
  const borderMat=new THREE.MeshStandardMaterial({color:0x326273,metalness:.55,roughness:.4});
  const rackMat=new THREE.MeshStandardMaterial({color:0x597685,metalness:.78,roughness:.32});
  const shelfMat=new THREE.MeshStandardMaterial({color:0x304f5e,metalness:.72,roughness:.38});
  const laneMat=new THREE.MeshBasicMaterial({color:0x5c9a9d});
  const box=(parent:THREE.Object3D,w:number,h:number,d:number,x:number,y:number,z:number,material:THREE.Material)=>{
   const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),material);mesh.position.set(x,y,z);parent.add(mesh);return mesh;
  };
  // Two parallel aisles and a loading strip provide world-space depth cues.
  for(const x of [-12.1,0,12.1])box(scene,.055,.012,20,x,-.035,0,laneMat);
  for(const z of [-.1,9.45])box(scene,27,.012,.055,0,-.033,z,laneMat);
  box(scene,29,.035,.65,0,-.025,10.65,new THREE.MeshStandardMaterial({color:0x755d35,roughness:.75}));
  for(const z of [1.1,-7.5])for(const x of [-12.7,12.7])box(scene,.32,5.8,.32,x,2.85,z,borderMat);
  box(scene,26,.22,.24,0,5.75,-9.4,borderMat);

  const hitGeometry=new THREE.BoxGeometry(.94,.76,1.43);
  const cargoGeometry=new THREE.BoxGeometry(.77,1,1.03);
  const backGeometry=new THREE.BoxGeometry(.87,.70,.04);
  const ledGeometry=new THREE.BoxGeometry(.74,.045,.06);
  const invisible=new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,color:0xffffff});
  const hits:THREE.Object3D[]=[];
  const binMeshes=new Map<string,BinMeshes>();
  const binPositions=new Map<string,THREE.Vector3>();

  for(const [rack,[cx,cz]] of Object.entries(rackCenters)){
   const root=new THREE.Group();root.position.set(cx,0,cz);scene.add(root);
   box(root,10.65,.16,1.9,0,.015,0,shelfMat);
   for(let c=0;c<=10;c++)for(const z of [-.85,.85])box(root,.075,4.56,.075,-5.1+c*1.02,2.28,z,rackMat);
   for(let level=1;level<=5;level++){
    const y=(level-1)*.86+.86;
    box(root,10.45,.08,1.88,0,y,0,shelfMat);
    box(root,10.45,.08,.09,0,y,.91,rackMat);
   }
   for(const z of [-.85,.85])box(root,10.65,.10,.08,0,4.57,z,rackMat);
   const sign=new THREE.Mesh(new THREE.PlaneGeometry(1.15,.43),new THREE.MeshBasicMaterial({map:labelTexture(rack),transparent:false,side:THREE.DoubleSide}));
   sign.position.set(-4.38,4.83,.91);root.add(sign);
   for(let level=1;level<=5;level++)for(let col=1;col<=10;col++){
    const id=`${rack}-${String(level).padStart(2,"0")}-${String(col).padStart(2,"0")}`;
    const x=-4.59+(col-1)*1.02,base=(level-1)*.86+.115;
    const back=new THREE.Mesh(backGeometry,new THREE.MeshStandardMaterial({color:0x334d5d,emissive:0x12232e,emissiveIntensity:.4,transparent:true,opacity:.55,metalness:.4,roughness:.55}));
    back.position.set(x,base+.35,-.68);root.add(back);
    const cargo=new THREE.Mesh(cargoGeometry,new THREE.MeshStandardMaterial({color:0x36d8bb,emissive:0x0e433d,emissiveIntensity:.25,metalness:.12,roughness:.55}));
    cargo.position.set(x,base+.1,0);root.add(cargo);
    const led=new THREE.Mesh(ledGeometry,new THREE.MeshBasicMaterial({color:0x36d8bb}));
    led.position.set(x,base+.69,.75);root.add(led);
    const hit=new THREE.Mesh(hitGeometry,invisible);hit.position.set(x,base+.36,0);hit.userData.binId=id;root.add(hit);hits.push(hit);
    binMeshes.set(id,{cargo,back,led});
    binPositions.set(id,new THREE.Vector3(cx+x,base+.36,cz));
   }
  }

  const edgeGeometry=new THREE.EdgesGeometry(new THREE.BoxGeometry(.96,.77,1.46));
  const hoverBox=new THREE.LineSegments(edgeGeometry,new THREE.LineBasicMaterial({color:0xffffff,transparent:true,opacity:.98}));
  const selectedBox=new THREE.LineSegments(edgeGeometry,new THREE.LineBasicMaterial({color:0xffdf8a,transparent:true,opacity:.98}));
  hoverBox.visible=false;selectedBox.visible=false;scene.add(hoverBox,selectedBox);
  selectRef.current=(id)=>{const pos=id?binPositions.get(id):undefined;selectedBox.visible=!!pos;if(pos)selectedBox.position.copy(pos)};
  updateRef.current=(rows)=>{
   for(const b of rows){
    const meshes=binMeshes.get(b.id);if(!meshes)continue;
    const color=colors[b.status],height=Math.max(.055,Math.min(.66,b.total/Math.max(1,b.capacity)*.66));
    meshes.cargo.visible=b.total>0;meshes.cargo.scale.y=height;
    meshes.cargo.position.y=(b.level-1)*.86+.115+height/2;
    meshes.cargo.material.color.setHex(color);
    meshes.cargo.material.emissive.setHex(color).multiplyScalar(b.status==="empty"?.08:.13);
    meshes.back.material.color.setHex(color);
    meshes.back.material.emissive.setHex(color).multiplyScalar(.15);
    meshes.back.material.opacity=b.status==="empty"?.31:.52;
    meshes.led.material.color.setHex(color);
   }
  };
  updateRef.current(bins);
  selectRef.current(selected);

  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let hovering:string|null=null,pointerDown:[number,number]|null=null;
  const pick=(event:PointerEvent)=>{
   const rect=renderer.domElement.getBoundingClientRect();
   pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
   raycaster.setFromCamera(pointer,camera);
   return raycaster.intersectObjects(hits,false)[0]?.object.userData.binId as string|undefined;
  };
  const onMove=(event:PointerEvent)=>{
   const id=pick(event)||null;
   if(id!==hovering){hovering=id;onHoverRef.current(id);hoverBox.visible=!!id;if(id){const pos=binPositions.get(id);if(pos)hoverBox.position.copy(pos)}}
   renderer.domElement.style.cursor=id?"pointer":"grab";
  };
  const onDown=(event:PointerEvent)=>{pointerDown=[event.clientX,event.clientY]};
  const onUp=(event:PointerEvent)=>{
   if(pointerDown&&Math.hypot(event.clientX-pointerDown[0],event.clientY-pointerDown[1])<6){const id=pick(event);if(id)onSelectRef.current(id)}
   pointerDown=null;
  };
  const onLeave=()=>{hovering=null;hoverBox.visible=false;onHoverRef.current(null);pointerDown=null};
  renderer.domElement.addEventListener("pointermove",onMove);
  renderer.domElement.addEventListener("pointerdown",onDown);
  renderer.domElement.addEventListener("pointerup",onUp);
  renderer.domElement.addEventListener("pointerleave",onLeave);
  const observer=new ResizeObserver(()=>{
   const width=Math.max(1,host.clientWidth),height=Math.max(1,host.clientHeight);
   camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height);
  });observer.observe(host);
  resetRef.current=()=>{camera.position.copy(initialCamera);controls.target.copy(initialTarget);controls.update()};
  let frame=0,active=true;
  const render=()=>{if(!active)return;frame=requestAnimationFrame(render);controls.update();renderer.render(scene,camera)};
  render();
  return ()=>{
   active=false;cancelAnimationFrame(frame);observer.disconnect();controls.dispose();
   renderer.domElement.removeEventListener("pointermove",onMove);renderer.domElement.removeEventListener("pointerdown",onDown);
   renderer.domElement.removeEventListener("pointerup",onUp);renderer.domElement.removeEventListener("pointerleave",onLeave);
   const geometries=new Set<THREE.BufferGeometry>(),materials=new Set<THREE.Material>();
   scene.traverse(object=>{if(object instanceof THREE.Mesh||object instanceof THREE.LineSegments){geometries.add(object.geometry);const list=Array.isArray(object.material)?object.material:[object.material];list.forEach(m=>materials.add(m))}});
   geometries.forEach(g=>g.dispose());materials.forEach(m=>{if(m instanceof THREE.MeshBasicMaterial&&m.map)m.map.dispose();m.dispose()});
   renderer.dispose();renderer.domElement.remove();updateRef.current=null;resetRef.current=null;selectRef.current=null;
  };
 // The geometry is stable; polling updates materials and box heights through updateRef.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[]);
 useEffect(()=>{updateRef.current?.(bins)},[bins]);
 useEffect(()=>{selectRef.current?.(selected)},[selected]);
 useEffect(()=>{if(resetToken>0)resetRef.current?.()},[resetToken]);
 return <div className="warehouse-3d" ref={hostRef}>{unavailable&&<div className="webgl-unavailable">当前浏览器无法启动 WebGL，请换用支持硬件加速的浏览器查看三维仓库。</div>}</div>;
}
