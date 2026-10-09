// Module dependencies finish before the existing modal can initialize. The
// old mix of UMD/deferred/module scripts did not guarantee that ordering.
import * as Three from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

window.THREE = { ...Three, DecalGeometry, GLTFLoader, OrbitControls };
const runtime = document.querySelector('script[data-ul-tshirt-runtime]');
if (runtime?.dataset.modalScript) await import(runtime.dataset.modalScript);
