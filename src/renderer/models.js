// 加载主机模型（PS5：glTF；Switch：FBX），统一成"Y 朝上、单位是米"的大小。
import * as THREE from './vendor/three/build/three.module.js';
import { GLTFLoader } from './vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from './vendor/three/examples/jsm/loaders/FBXLoader.js';

const cache = new Map();

async function loadRaw(kind) {
  if (kind === 'ps5') {
    const gltf = await new GLTFLoader().loadAsync('models/ps5.glb');
    return gltf.scene;
  }
  return new FBXLoader().loadAsync('models/switch.fbx');
}

export function loadModel(kind) {
  if (!cache.has(kind)) cache.set(kind, loadRaw(kind));
  return cache.get(kind).then((obj) => obj.clone(true));
}
