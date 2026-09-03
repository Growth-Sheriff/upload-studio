  (function initGLTFLoader() {
    function defineGLTFLoader() {
      if (typeof THREE === 'undefined' || typeof THREE.Loader === 'undefined') {
        setTimeout(defineGLTFLoader, 50);
        return;
      }
      if (THREE.GLTFLoader) return;
    THREE.GLTFLoader = function(manager) {
      THREE.Loader.call(this, manager);
    };
    THREE.GLTFLoader.prototype = Object.assign(Object.create(THREE.Loader.prototype), {
      constructor: THREE.GLTFLoader,
      load: function(url, onLoad, onProgress, onError) {
        const loader = new THREE.FileLoader(this.manager);
        loader.setResponseType('arraybuffer');
        loader.setRequestHeader(this.requestHeader);
        loader.setPath(this.path);
        loader.setWithCredentials(this.withCredentials);
        loader.load(url, (data) => {
          try {
            this.parse(data, this.resourcePath || url.substring(0, url.lastIndexOf('/') + 1), onLoad, onError);
          } catch (e) {
            if (onError) onError(e);
            console.error('THREE.GLTFLoader: Unable to parse model', e);
          }
        }, onProgress, onError);
      },
      parse: function(data, path, onLoad, onError) {
        const magic = new Uint32Array(data.slice(0, 4))[0];
        if (magic !== 0x46546C67) { // 'glTF' in ASCII
          if (onError) onError(new Error('Not a valid GLB file'));
          return;
        }
        const dataView = new DataView(data);
        const version = dataView.getUint32(4, true);
        const length = dataView.getUint32(8, true);
        let chunkOffset = 12;
        let jsonContent = null;
        let binBuffer = null;
        while (chunkOffset < length) {
          const chunkLength = dataView.getUint32(chunkOffset, true);
          const chunkType = dataView.getUint32(chunkOffset + 4, true);
          if (chunkType === 0x4E4F534A) { // JSON
            const jsonSlice = new Uint8Array(data, chunkOffset + 8, chunkLength);
            jsonContent = JSON.parse(new TextDecoder().decode(jsonSlice));
          } else if (chunkType === 0x004E4942) { // BIN
            binBuffer = data.slice(chunkOffset + 8, chunkOffset + 8 + chunkLength);
          }
          chunkOffset += chunkLength + 8;
        }
        if (!jsonContent) {
          if (onError) onError(new Error('Invalid GLB: no JSON chunk'));
          return;
        }
        const scene = new THREE.Scene();
        if (jsonContent.meshes && jsonContent.meshes.length > 0) {
          jsonContent.meshes.forEach((meshData) => {
            meshData.primitives.forEach((primitive) => {
              const geometry = new THREE.BufferGeometry();
              const posAccessor = jsonContent.accessors[primitive.attributes.POSITION];
              const posBufferView = jsonContent.bufferViews[posAccessor.bufferView];
              const posData = new Float32Array(binBuffer, posBufferView.byteOffset || 0, posAccessor.count * 3);
              geometry.setAttribute('position', new THREE.BufferAttribute(posData.slice(), 3));
              if (primitive.attributes.NORMAL !== undefined) {
                const normAccessor = jsonContent.accessors[primitive.attributes.NORMAL];
                const normBufferView = jsonContent.bufferViews[normAccessor.bufferView];
                const normData = new Float32Array(binBuffer, normBufferView.byteOffset || 0, normAccessor.count * 3);
                geometry.setAttribute('normal', new THREE.BufferAttribute(normData.slice(), 3));
              }
              if (primitive.attributes.TEXCOORD_0 !== undefined) {
                const uvAccessor = jsonContent.accessors[primitive.attributes.TEXCOORD_0];
                const uvBufferView = jsonContent.bufferViews[uvAccessor.bufferView];
                const uvData = new Float32Array(binBuffer, uvBufferView.byteOffset || 0, uvAccessor.count * 2);
                geometry.setAttribute('uv', new THREE.BufferAttribute(uvData.slice(), 2));
              }
              if (primitive.indices !== undefined) {
                const indAccessor = jsonContent.accessors[primitive.indices];
                const indBufferView = jsonContent.bufferViews[indAccessor.bufferView];
                const IndArrayType = indAccessor.componentType === 5123 ? Uint16Array : Uint32Array;
                const indData = new IndArrayType(binBuffer, indBufferView.byteOffset || 0, indAccessor.count);
                geometry.setIndex(new THREE.BufferAttribute(indData.slice(), 1));
              }
              geometry.computeBoundingSphere();
              const material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: 0.7,
                metalness: 0.0,
                side: THREE.DoubleSide
              });
              const mesh = new THREE.Mesh(geometry, material);
              scene.add(mesh);
            });
          });
        }
        if (onLoad) onLoad({ scene: scene, scenes: [scene] });
      }
    });
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', defineGLTFLoader);
    } else {
      defineGLTFLoader();
    }
  })();


  (function initOrbitControls() {
    function defineOrbitControls() {
      if (typeof THREE === 'undefined') {
        setTimeout(defineOrbitControls, 50);
        return;
      }
      if (THREE.OrbitControls) return;
    THREE.OrbitControls = function(camera, domElement) {
      this.camera = camera;
      this.domElement = domElement;
      this.enableDamping = true;
      this.dampingFactor = 0.05;
      this.enableZoom = true;
      this.enablePan = false;
      this.minDistance = 2;
      this.maxDistance = 10;
      this.autoRotate = false;
      this.autoRotateSpeed = 2.0;
      var scope = this;
      var spherical = { theta: 0, phi: Math.PI / 2, radius: camera.position.length() };
      var target = new THREE.Vector3(0, 0, 0);
      var isMouseDown = false;
      var previousMouse = { x: 0, y: 0 };
      function onMouseDown(e) {
        isMouseDown = true;
        previousMouse.x = e.clientX;
        previousMouse.y = e.clientY;
      }
      function onMouseMove(e) {
        if (!isMouseDown) return;
        var deltaX = e.clientX - previousMouse.x;
        var deltaY = e.clientY - previousMouse.y;
        spherical.theta -= deltaX * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + deltaY * 0.005));
        previousMouse.x = e.clientX;
        previousMouse.y = e.clientY;
      }
      function onMouseUp() { isMouseDown = false; }
      function onWheel(e) {
        spherical.radius = Math.max(scope.minDistance, Math.min(scope.maxDistance, spherical.radius + e.deltaY * 0.01));
      }
      function onTouchStart(e) {
        if (e.touches.length === 1) {
          isMouseDown = true;
          previousMouse.x = e.touches[0].clientX;
          previousMouse.y = e.touches[0].clientY;
        }
      }
      function onTouchMove(e) {
        if (!isMouseDown || e.touches.length !== 1) return;
        var deltaX = e.touches[0].clientX - previousMouse.x;
        var deltaY = e.touches[0].clientY - previousMouse.y;
        spherical.theta -= deltaX * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi + deltaY * 0.005));
        previousMouse.x = e.touches[0].clientX;
        previousMouse.y = e.touches[0].clientY;
      }
      function onTouchEnd() { isMouseDown = false; }
      domElement.addEventListener('mousedown', onMouseDown);
      domElement.addEventListener('mousemove', onMouseMove);
      domElement.addEventListener('mouseup', onMouseUp);
      domElement.addEventListener('mouseleave', onMouseUp);
      domElement.addEventListener('wheel', onWheel, { passive: true });
      domElement.addEventListener('touchstart', onTouchStart, { passive: true });
      domElement.addEventListener('touchmove', onTouchMove, { passive: true });
      domElement.addEventListener('touchend', onTouchEnd);
      this.update = function() {
        camera.position.x = target.x + spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
        camera.position.y = target.y + spherical.radius * Math.cos(spherical.phi);
        camera.position.z = target.z + spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
        camera.lookAt(target);
      };
      this.dispose = function() {
        domElement.removeEventListener('mousedown', onMouseDown);
        domElement.removeEventListener('mousemove', onMouseMove);
        domElement.removeEventListener('mouseup', onMouseUp);
        domElement.removeEventListener('mouseleave', onMouseUp);
        domElement.removeEventListener('wheel', onWheel);
        domElement.removeEventListener('touchstart', onTouchStart);
        domElement.removeEventListener('touchmove', onTouchMove);
        domElement.removeEventListener('touchend', onTouchEnd);
      };
    };
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', defineOrbitControls);
    } else {
      defineOrbitControls();
    }
  })();
