// 3D Mixamo Viewer & Room Explorer with Custom Splash Screen, Full Persistence (IndexedDB), Collision Engine & Advanced HUD Customization
// Full Three.js engine with Touch Controls, Mixamo FBX Loader, Procedural Female Avatar Rig & Russian Localization

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// =========================================================================
// 1. INDEXEDDB ХРАНИЛИЩЕ РЕСУРСОВ (PERSISTENCE ENGINE)
// =========================================================================
const DB_NAME = 'MixamoExplorerStorage';
const DB_VERSION = 1;
const STORE_NAME = 'saved_assets';

function getDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveAssetToDB(key, data, meta = {}) {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const item = { key, data, ...meta, timestamp: Date.now() };
    await new Promise((resolve, reject) => {
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Ошибка сохранения в IndexedDB:', key, err);
  }
}

async function getAssetFromDB(key) {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Ошибка чтения из IndexedDB:', key, err);
    return null;
  }
}

async function deleteAssetFromDB(key) {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Ошибка удаления из IndexedDB:', key, err);
  }
}

async function clearAllDBStorage() {
  try {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    localStorage.removeItem('mixamo_hud_layout');
  } catch (err) {
    console.warn('Ошибка очистки хранилища:', err);
  }
}

// =========================================================================
// 2. ГЛОБАЛЬНОЕ СОСТОЯНИЕ ПРИЛОЖЕНИЯ
// =========================================================================
const appState = {
  cameraMode: 'TPV', // 'TPV' (3-е лицо) или 'FPV' (1-е лицо)
  character: null,
  femaleAvatar: null,
  hideTestCharacter: false,
  mixer: null,
  animations: {},
  currentAction: null,
  isCustomFBX: false,
  roomObject: null,
  defaultSceneGroup: null,
  showDefaultEnvironment: true,
  roomCollisionMeshes: [],

  // Состояния персонажа (Позы и Действия)
  posture: 'stand', // 'stand', 'crouch', 'prone'
  isSprinting: false,
  isJumping: false,
  verticalVelocity: 0,
  gravity: 18.0,
  jumpStrength: 6.5,
  groundY: 0,
  collisionRadius: 0.35,

  // Управление движением (Левый джойстик)
  moveVector: { x: 0, y: 0 },
  playerPos: null, // THREE.Vector3
  playerRotation: 0,
  targetRotation: 0,
  playerSpeed: 0,

  // Правый свайп поворота экрана (Free Look / Aim)
  turnTouchId: null,
  lastTurnX: 0,
  lastTurnY: 0,

  // Джойстик-Глаз (Орбита в TPV с плавным возвратом Lerp)
  eyeVector: { x: 0, y: 0 },
  orbitYaw: 0,
  orbitPitch: 0.25,
  isOrbitingWithEye: false,

  // Процедурные кости девушки
  bones: {},

  // Кастомные скриптовые кнопки
  customButtons: [],

  // Коллизии сцены
  staticColliders: []
};

// Загрузка CDN-библиотек Three.js
const CDN_SCRIPTS = [
  'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js',
  'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/FBXLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js',
  'https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/OBJLoader.js'
];

async function loadScriptCached(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.onload = () => resolve();
    script.onerror = (e) => reject(new Error(`Не удалось загрузить ${url}`));
    document.head.appendChild(script);
  });
}

// =========================================================================
// 3. МЕНЕДЖЕР ЗАСТАВКИ (SPLASH SCREEN & MEDIA LOADER)
// =========================================================================
async function initSplashScreen() {
  const splashScreen = document.getElementById('splash-screen');
  const splashVideo = document.getElementById('splash-video');
  const splashImage = document.getElementById('splash-image');
  const splashSavedName = document.getElementById('splash-saved-name');
  const btnDeleteSplash = document.getElementById('btn-delete-splash');

  const savedMedia = await getAssetFromDB('splash_media');
  if (savedMedia && savedMedia.data) {
    try {
      const blob = new Blob([savedMedia.data], { type: savedMedia.mimeType });
      const mediaUrl = URL.createObjectURL(blob);

      if (savedMedia.type === 'video') {
        splashVideo.src = mediaUrl;
        splashVideo.style.display = 'block';
        splashImage.style.display = 'none';
        splashVideo.play().catch(e => console.log('Video autoplay:', e));
      } else {
        splashImage.src = mediaUrl;
        splashImage.style.display = 'block';
        splashVideo.style.display = 'none';
      }

      if (splashSavedName) splashSavedName.textContent = savedMedia.name || 'Кастомная заставка';
      if (btnDeleteSplash) btnDeleteSplash.style.display = 'inline-block';
    } catch (e) {
      console.warn('Ошибка показа заставки:', e);
    }
  } else {
    if (splashSavedName) splashSavedName.textContent = 'Стандартная заставка';
    if (btnDeleteSplash) btnDeleteSplash.style.display = 'none';
  }
}

function updateSplashProgress(percent, text) {
  const bar = document.getElementById('splash-loading-bar');
  const statusText = document.getElementById('splash-status-text');
  if (bar) bar.style.width = percent + '%';
  if (statusText) statusText.textContent = text;
}

function hideSplashScreen() {
  const splashScreen = document.getElementById('splash-screen');
  if (!splashScreen) return;
  splashScreen.classList.add('fade-out');
  setTimeout(() => {
    splashScreen.style.display = 'none';
  }, 500);
}

// =========================================================================
// 4. ИНИЦИАЛИЗАЦИЯ И ВОССТАНОВЛЕНИЕ ВСЕХ РЕСУРСОВ ПРИ СТАРТЕ
// =========================================================================
async function bootstrap() {
  await initSplashScreen();

  updateSplashProgress(15, 'Загрузка Three.js и 3D библиотек...');

  for (let i = 0; i < CDN_SCRIPTS.length; i++) {
    const url = CDN_SCRIPTS[i];
    const progress = 15 + Math.round(((i + 1) / CDN_SCRIPTS.length) * 55);
    updateSplashProgress(progress, `Загрузка модулей Three.js (${i + 1}/${CDN_SCRIPTS.length})...`);
    try {
      await loadScriptCached(url);
    } catch (e) {
      console.warn('Резервная загрузка скрипта...', e);
      await loadScriptCached(url.replace('cdnjs.cloudflare.com/ajax/libs/three.js/r128', 'unpkg.com/three@0.128.0/build'));
    }
  }

  updateSplashProgress(80, 'Инициализация 3D мира и окружения...');
  init3DApp();

  updateSplashProgress(90, 'Проверка сохраненных моделей и комнат...');
  await restoreSavedAssets();

  updateSplashProgress(100, 'Готово!');
  setTimeout(() => {
    hideSplashScreen();
  }, 400);
}

// =========================================================================
// 5. ОСНОВНОЕ 3D ПРИЛОЖЕНИЕ (THREE.JS ENGINE)
// =========================================================================
let scene, camera, renderer, raycaster, floorRaycaster;

function init3DApp() {
  const container = document.getElementById('canvas-container');
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb); // Небесный фон
  scene.fog = new THREE.FogExp2(0xb0d8f5, 0.015);

  appState.playerPos = new THREE.Vector3(0, 0, 0);
  raycaster = new THREE.Raycaster();
  floorRaycaster = new THREE.Raycaster();

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
  
  try {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
      precision: 'mediump'
    });
  } catch (e) {
    renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false
    });
  }

  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;

  if (renderer.domElement) {
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      console.warn('WebGL context lost.');
    }, false);
    renderer.domElement.addEventListener('webglcontextrestored', () => {
      console.info('WebGL context restored.');
      renderer.setSize(window.innerWidth, window.innerHeight);
    }, false);
  }

  container.appendChild(renderer.domElement);

  // Освещение (Солнечный свет + окружение)
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x556b2f, 0.85);
  hemiLight.position.set(0, 50, 0);
  scene.add(hemiLight);

  const dirLight = new THREE.DirectionalLight(0xfff5e6, 1.3);
  dirLight.position.set(25, 40, 20);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 0.5;
  dirLight.shadow.camera.far = 120;
  dirLight.shadow.camera.left = -30;
  dirLight.shadow.camera.right = 30;
  dirLight.shadow.camera.top = 30;
  dirLight.shadow.camera.bottom = -30;
  scene.add(dirLight);

  // -------------------------------------------------------------
  // ПОСТРОЕНИЕ 3D КОМНАТЫ С МЕБЕЛЬЮ И ВЫХОДОМ В САД
  // -------------------------------------------------------------
  const envGroup = new THREE.Group();
  appState.defaultSceneGroup = envGroup;

  function buildRoomAndOutdoorScene() {
    // 1. УЛИЦА / ТРАВЯНОЙ ГАЗОН
    const grassGeo = new THREE.PlaneGeometry(160, 160);
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x4d8c38,
      roughness: 0.9,
      metalness: 0.05
    });
    const grass = new THREE.Mesh(grassGeo, grassMat);
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    envGroup.add(grass);

    // 2. ДОМ / КОМНАТА
    const roomWidth = 10;
    const roomDepth = 8;
    const roomHeight = 3.6;
    const roomZOffset = -4; // Комната в зоне z < 0, выход в z > 0

    // Пол комнаты (Паркет)
    const floorGeo = new THREE.PlaneGeometry(roomWidth, roomDepth);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x8b5a2b,
      roughness: 0.6,
      metalness: 0.1
    });
    const roomFloor = new THREE.Mesh(floorGeo, floorMat);
    roomFloor.rotation.x = -Math.PI / 2;
    roomFloor.position.set(0, 0.02, roomZOffset);
    roomFloor.receiveShadow = true;
    envGroup.add(roomFloor);

    // Веранда / Терраса
    const patioGeo = new THREE.PlaneGeometry(roomWidth + 2, 4);
    const patioMat = new THREE.MeshStandardMaterial({
      color: 0xa07855,
      roughness: 0.7,
      metalness: 0.1
    });
    const patio = new THREE.Mesh(patioGeo, patioMat);
    patio.rotation.x = -Math.PI / 2;
    patio.position.set(0, 0.015, 2);
    patio.receiveShadow = true;
    envGroup.add(patio);

    // Каменная дорожка в сад
    const pathGeo = new THREE.PlaneGeometry(2.4, 18);
    const pathMat = new THREE.MeshStandardMaterial({
      color: 0x9ca3af,
      roughness: 0.8,
      metalness: 0.15
    });
    const stonePath = new THREE.Mesh(pathGeo, pathMat);
    stonePath.rotation.x = -Math.PI / 2;
    stonePath.position.set(0, 0.018, 12);
    stonePath.receiveShadow = true;
    envGroup.add(stonePath);

    // Стены комнаты
    const wallMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8 });
    const wallAccentMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.7 });

    // Задняя стена (z = -8)
    const backWall = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, roomHeight, 0.3), wallAccentMat);
    backWall.position.set(0, roomHeight / 2, roomZOffset - roomDepth / 2);
    backWall.castShadow = true;
    backWall.receiveShadow = true;
    envGroup.add(backWall);

    // Левая стена (x = -5)
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, roomHeight, roomDepth), wallMat);
    leftWall.position.set(-roomWidth / 2, roomHeight / 2, roomZOffset);
    leftWall.castShadow = true;
    leftWall.receiveShadow = true;
    envGroup.add(leftWall);

    // Правая стена (x = +5)
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.3, roomHeight, roomDepth), wallMat);
    rightWall.position.set(roomWidth / 2, roomHeight / 2, roomZOffset);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    envGroup.add(rightWall);

    // Передняя стена с широким выходом в сад по центру (|x| <= 1.3)
    const frontWallLeft = new THREE.Mesh(new THREE.BoxGeometry(3.7, roomHeight, 0.3), wallMat);
    frontWallLeft.position.set(-3.15, roomHeight / 2, roomZOffset + roomDepth / 2);
    frontWallLeft.castShadow = true;
    frontWallLeft.receiveShadow = true;
    envGroup.add(frontWallLeft);

    const frontWallRight = new THREE.Mesh(new THREE.BoxGeometry(3.7, roomHeight, 0.3), wallMat);
    frontWallRight.position.set(3.15, roomHeight / 2, roomZOffset + roomDepth / 2);
    frontWallRight.castShadow = true;
    frontWallRight.receiveShadow = true;
    envGroup.add(frontWallRight);

    // Дверная перемычка сверху
    const doorLintel = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.8, 0.3), wallMat);
    doorLintel.position.set(0, roomHeight - 0.4, roomZOffset + roomDepth / 2);
    doorLintel.castShadow = true;
    envGroup.add(doorLintel);

    // Потолок
    const ceilingGeo = new THREE.PlaneGeometry(roomWidth, roomDepth);
    const ceilingMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.9 });
    const ceiling = new THREE.Mesh(ceilingGeo, ceilingMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, roomHeight, roomZOffset);
    envGroup.add(ceiling);

    // 3. МЕБЕЛЬ И ИНТЕРЬЕР ВНУТРИ
    // Ковер в центре комнаты
    const carpet = new THREE.Mesh(
      new THREE.PlaneGeometry(3.8, 3.2),
      new THREE.MeshStandardMaterial({ color: 0xc084fc, roughness: 0.95 })
    );
    carpet.rotation.x = -Math.PI / 2;
    carpet.position.set(-1.8, 0.025, -4.5);
    carpet.receiveShadow = true;
    envGroup.add(carpet);

    // Угловой мягкий диван
    const sofaMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8 });
    const cushionMat = new THREE.MeshStandardMaterial({ color: 0xf43f5e, roughness: 0.7 });

    const sofaBase = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.45, 1.1), sofaMat);
    sofaBase.position.set(-3.2, 0.225, -4.5);
    sofaBase.castShadow = true;
    sofaBase.receiveShadow = true;
    envGroup.add(sofaBase);

    const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.55, 1.1), sofaMat);
    sofaBack.position.set(-4.35, 0.6, -4.5);
    sofaBack.castShadow = true;
    envGroup.add(sofaBack);

    // Подушка на диване
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.15), cushionMat);
    cushion.position.set(-4.1, 0.5, -4.3);
    cushion.rotation.y = 0.2;
    cushion.castShadow = true;
    envGroup.add(cushion);

    // Журнальный столик
    const tableMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.4 });
    const tableTop = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24), tableMat);
    tableTop.position.set(-1.6, 0.4, -4.5);
    tableTop.castShadow = true;
    tableTop.receiveShadow = true;
    envGroup.add(tableTop);

    const tableLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.38, 12), tableMat);
    tableLeg.position.set(-1.6, 0.19, -4.5);
    tableLeg.castShadow = true;
    envGroup.add(tableLeg);

    // Книжный шкаф-стеллаж
    const shelfMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
    const bookshelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4, 0.45), shelfMat);
    bookshelf.position.set(4.2, 1.2, -6.0);
    bookshelf.castShadow = true;
    bookshelf.receiveShadow = true;
    envGroup.add(bookshelf);

    // ТВ-тумба и телевизор на стене
    const tvStandMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
    const tvStand = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.5, 0.6), tvStandMat);
    tvStand.position.set(0, 0.25, -7.5);
    tvStand.castShadow = true;
    tvStand.receiveShadow = true;
    envGroup.add(tvStand);

    const tvScreenMat = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 0.1, metalness: 0.8 });
    const tvScreen = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.08), tvScreenMat);
    tvScreen.position.set(0, 1.6, -7.7);
    tvScreen.castShadow = true;
    envGroup.add(tvScreen);

    // Торшер с теплым светом
    const lampPost = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.0, 12), tableMat);
    lampPost.position.set(-4.2, 1.0, -7.2);
    lampPost.castShadow = true;
    envGroup.add(lampPost);

    const lampShade = new THREE.Mesh(
      new THREE.ConeGeometry(0.35, 0.4, 16),
      new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.5, emissive: 0xfef08a, emissiveIntensity: 0.4 })
    );
    lampShade.position.set(-4.2, 2.0, -7.2);
    envGroup.add(lampShade);

    const lampLight = new THREE.PointLight(0xffedd5, 1.0, 8);
    lampLight.position.set(-4.2, 1.9, -7.2);
    envGroup.add(lampLight);

    // 4. УЛИЧНЫЙ САД (ДЕРЕВЬЯ, ФОНАРИ, ЗАБОР)
    function createTree(x, z) {
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c3a21, roughness: 0.9 });
      const foliageMat = new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.8 });

      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, 2.2, 10), trunkMat);
      trunk.position.set(x, 1.1, z);
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      envGroup.add(trunk);

      const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 12), foliageMat);
      foliage.position.set(x, 2.8, z);
      foliage.scale.set(1.1, 1.3, 1.1);
      foliage.castShadow = true;
      envGroup.add(foliage);
    }

    createTree(-6.5, 8.0);
    createTree(6.5, 9.5);
    createTree(-7.5, 16.0);
    createTree(7.5, 18.0);
    createTree(0, 23.0);

    scene.add(envGroup);

    // Инициализируем список статических коллайдеров для стандартной комнаты
    initStandardColliders();
  }

  buildRoomAndOutdoorScene();

  // -------------------------------------------------------------
  // СИСТЕМА КОЛЛИЗИЙ (COLLISION ENGINE)
  // -------------------------------------------------------------
  function initStandardColliders() {
    appState.staticColliders = [
      // Задняя стена комнаты (z = -8.0, толщина 0.3)
      { type: 'box', minX: -5.1, maxX: 5.1, minZ: -8.2, maxZ: -7.7 },
      // Левая стена комнаты (x = -5.0, толщина 0.3)
      { type: 'box', minX: -5.2, maxX: -4.7, minZ: -8.1, maxZ: 0.1 },
      // Правая стена комнаты (x = +5.0, толщина 0.3)
      { type: 'box', minX: 4.7, maxX: 5.2, minZ: -8.1, maxZ: 0.1 },
      // Передняя стена слева от двери (x: -5.0 до -1.25, z: -0.2 до 0.2)
      { type: 'box', minX: -5.1, maxX: -1.25, minZ: -0.2, maxZ: 0.2 },
      // Передняя стена справа от двери (x: 1.25 до 5.0, z: -0.2 до 0.2)
      { type: 'box', minX: 1.25, maxX: 5.1, minZ: -0.2, maxZ: 0.2 },
      // Диван
      { type: 'box', minX: -4.7, maxX: -1.8, minZ: -5.3, maxZ: -3.8 },
      // Журнальный столик
      { type: 'cylinder', x: -1.6, z: -4.5, radius: 0.65 },
      // Книжный шкаф
      { type: 'box', minX: 3.5, maxX: 4.9, minZ: -6.4, maxZ: -5.5 },
      // ТВ-тумба
      { type: 'box', minX: -1.4, maxX: 1.4, minZ: -7.9, maxZ: -7.0 },
      // Деревья на улице
      { type: 'cylinder', x: -6.5, z: 8.0, radius: 0.5 },
      { type: 'cylinder', x: 6.5, z: 9.5, radius: 0.5 },
      { type: 'cylinder', x: -7.5, z: 16.0, radius: 0.5 },
      { type: 'cylinder', x: 7.5, z: 18.0, radius: 0.5 },
      { type: 'cylinder', x: 0, z: 23.0, radius: 0.5 }
    ];
  }

  // Проверка и корректировка перемещения персонажа с учетом коллизий (Sliding Collision)
  function resolvePlayerCollisions(targetPos) {
    const r = appState.collisionRadius;

    // 1. Коллизии со стандартной сценой (если она включена)
    if (appState.showDefaultEnvironment && envGroup.visible) {
      for (const col of appState.staticColliders) {
        if (col.type === 'box') {
          // Расширяем AABB на радиус персонажа r
          const expandedMinX = col.minX - r;
          const expandedMaxX = col.maxX + r;
          const expandedMinZ = col.minZ - r;
          const expandedMaxZ = col.maxZ + r;

          if (
            targetPos.x > expandedMinX && targetPos.x < expandedMaxX &&
            targetPos.z > expandedMinZ && targetPos.z < expandedMaxZ
          ) {
            // Выталкиваем в ближайшую сторону (sliding)
            const dLeft = Math.abs(targetPos.x - expandedMinX);
            const dRight = Math.abs(targetPos.x - expandedMaxX);
            const dBack = Math.abs(targetPos.z - expandedMinZ);
            const dFront = Math.abs(targetPos.z - expandedMaxZ);

            const minD = Math.min(dLeft, dRight, dBack, dFront);
            if (minD === dLeft) targetPos.x = expandedMinX;
            else if (minD === dRight) targetPos.x = expandedMaxX;
            else if (minD === dBack) targetPos.z = expandedMinZ;
            else if (minD === dFront) targetPos.z = expandedMaxZ;
          }
        } else if (col.type === 'cylinder') {
          const dx = targetPos.x - col.x;
          const dz = targetPos.z - col.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          const minDist = col.radius + r;
          if (dist < minDist && dist > 0.001) {
            targetPos.x = col.x + (dx / dist) * minDist;
            targetPos.z = col.z + (dz / dist) * minDist;
          }
        }
      }
    }

    // 2. Коллизии с загруженной 3D комнатой (Raycast Wall Collision)
    if (appState.roomObject && appState.roomCollisionMeshes.length > 0) {
      const checkHeights = [0.4, 0.9, 1.4];
      const rayDirections = [
        new THREE.Vector3(1, 0, 0),
        new THREE.Vector3(-1, 0, 0),
        new THREE.Vector3(0, 0, 1),
        new THREE.Vector3(0, 0, -1),
        new THREE.Vector3(0.707, 0, 0.707),
        new THREE.Vector3(-0.707, 0, 0.707),
        new THREE.Vector3(0.707, 0, -0.707),
        new THREE.Vector3(-0.707, 0, -0.707)
      ];

      for (const h of checkHeights) {
        const origin = new THREE.Vector3(targetPos.x, targetPos.y + h, targetPos.z);
        for (const dir of rayDirections) {
          raycaster.set(origin, dir);
          raycaster.near = 0.05;
          raycaster.far = 0.55;
          const intersects = raycaster.intersectObjects(appState.roomCollisionMeshes, true);
          if (intersects.length > 0) {
            const hit = intersects[0];
            const dist = hit.distance;
            const requiredDist = 0.42;
            if (dist < requiredDist) {
              const pushBackDist = (requiredDist - dist);
              targetPos.x -= dir.x * pushBackDist;
              targetPos.z -= dir.z * pushBackDist;
            }
          }
        }
      }

      // Определение высоты пола в загруженной комнате (Floor Raycast)
      const floorOrigin = new THREE.Vector3(targetPos.x, targetPos.y + 1.8, targetPos.z);
      floorRaycaster.set(floorOrigin, new THREE.Vector3(0, -1, 0));
      floorRaycaster.near = 0.1;
      floorRaycaster.far = 10.0;
      const floorHits = floorRaycaster.intersectObjects(appState.roomCollisionMeshes, true);
      if (floorHits.length > 0) {
        const groundHitY = floorHits[0].point.y;
        appState.groundY = groundHitY;
        if (!appState.isJumping) {
          targetPos.y = groundHitY;
        }
      } else {
        appState.groundY = 0;
      }
    } else {
      appState.groundY = 0;
    }

    return targetPos;
  }

  // -------------------------------------------------------------
  // СОЗДАНИЕ ДЕВУШКИ-ПЕРСОНАЖА (MIXAMO STYLE FEMALE AVATAR RIG)
  // -------------------------------------------------------------
  function createFemaleCharacter() {
    const root = new THREE.Group();
    root.position.copy(appState.playerPos);

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xf6d7b0, roughness: 0.65 });
    const topMat = new THREE.MeshStandardMaterial({ color: 0xec4899, roughness: 0.5 });
    const shortsMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.7 });
    const shoeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 });
    const hairMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.8 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });

    const hips = new THREE.Group();
    hips.position.y = 0.92;
    root.add(hips);

    const pelvis = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.18, 16), shortsMat);
    pelvis.position.y = 0;
    pelvis.castShadow = true;
    hips.add(pelvis);

    const spine = new THREE.Group();
    spine.position.y = 0.1;
    hips.add(spine);

    const waist = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, 0.16, 16), skinMat);
    waist.position.y = 0.08;
    waist.castShadow = true;
    spine.add(waist);

    const chest = new THREE.Group();
    chest.position.y = 0.16;
    spine.add(chest);

    const chestMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.20, 16), topMat);
    chestMesh.position.y = 0.10;
    chestMesh.castShadow = true;
    chest.add(chestMesh);

    const bustL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), topMat);
    bustL.position.set(-0.065, 0.10, 0.12);
    bustL.castShadow = true;
    chest.add(bustL);

    const bustR = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), topMat);
    bustR.position.set(0.065, 0.10, 0.12);
    bustR.castShadow = true;
    chest.add(bustR);

    // ШЕЯ И ГОЛОВА
    const neck = new THREE.Group();
    neck.position.y = 0.26;
    chest.add(neck);

    const neckMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.1, 12), skinMat);
    neckMesh.position.y = 0.05;
    neckMesh.castShadow = true;
    neck.add(neckMesh);

    const head = new THREE.Group();
    head.position.y = 0.1;
    neck.add(head);

    const headMesh = new THREE.Mesh(new THREE.SphereGeometry(0.13, 20, 20), skinMat);
    headMesh.position.y = 0.12;
    headMesh.scale.set(0.9, 1.05, 0.95);
    headMesh.castShadow = true;
    head.add(headMesh);

    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), eyeMat);
    eyeL.position.set(-0.045, 0.13, 0.11);
    head.add(eyeL);
    const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), eyeMat);
    eyeR.position.set(0.045, 0.13, 0.11);
    head.add(eyeR);

    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), hairMat);
    hairCap.position.set(0, 0.14, -0.02);
    hairCap.scale.set(1.02, 1.05, 1.06);
    hairCap.castShadow = true;
    head.add(hairCap);

    const ponytail = new THREE.Group();
    ponytail.position.set(0, 0.22, -0.12);
    head.add(ponytail);

    const ponytailMesh = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.45, 12), hairMat);
    ponytailMesh.rotation.x = -Math.PI / 3;
    ponytailMesh.position.set(0, -0.16, -0.1);
    ponytailMesh.castShadow = true;
    ponytail.add(ponytailMesh);

    // РУКИ И НОГИ
    function createLimb(isLeft, isLeg) {
      const side = isLeft ? -1 : 1;
      const rootLimb = new THREE.Group();

      if (isLeg) {
        rootLimb.position.set(side * 0.10, -0.05, 0);
        hips.add(rootLimb);
      } else {
        rootLimb.position.set(side * 0.20, 0.22, 0);
        chest.add(rootLimb);
      }

      const upper = new THREE.Group();
      rootLimb.add(upper);

      const upperMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(isLeg ? 0.07 : 0.045, isLeg ? 0.055 : 0.04, isLeg ? 0.44 : 0.32, 12),
        skinMat
      );
      upperMesh.position.y = isLeg ? -0.22 : -0.16;
      upperMesh.castShadow = true;
      upper.add(upperMesh);

      const lower = new THREE.Group();
      lower.position.y = isLeg ? -0.44 : -0.32;
      upper.add(lower);

      const lowerMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(isLeg ? 0.05 : 0.038, isLeg ? 0.045 : 0.032, isLeg ? 0.42 : 0.30, 12),
        skinMat
      );
      lowerMesh.position.y = isLeg ? -0.21 : -0.15;
      lowerMesh.castShadow = true;
      lower.add(lowerMesh);

      if (isLeg) {
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.09, 0.18), shoeMat);
        foot.position.set(0, -0.42, 0.04);
        foot.castShadow = true;
        lower.add(foot);
      } else {
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.038, 8, 8), skinMat);
        hand.position.set(0, -0.32, 0);
        hand.castShadow = true;
        lower.add(hand);
      }

      return { root: rootLimb, upper, lower };
    }

    const leftLeg = createLimb(true, true);
    const rightLeg = createLimb(false, true);
    const leftArm = createLimb(true, false);
    const rightArm = createLimb(false, false);

    appState.bones = {
      hips, spine, chest, neck, head, ponytail,
      leftLeg, rightLeg, leftArm, rightArm
    };

    scene.add(root);
    appState.femaleAvatar = root;
    appState.character = root;
    appState.isCustomFBX = false;
    document.getElementById('model-status').textContent = 'Девушка-Аватар';
  }

  createFemaleCharacter();

  // -------------------------------------------------------------
  // ПРОЦЕДУРНАЯ АНИМАЦИЯ ДЕВУШКИ
  // -------------------------------------------------------------
  let animClock = 0;

  function updateFemaleAnimations(delta) {
    if (appState.isCustomFBX || !appState.femaleAvatar || !appState.femaleAvatar.visible) return;
    animClock += delta;

    const b = appState.bones;
    if (!b.hips) return;

    const speed = appState.playerSpeed;
    const isMoving = speed > 0.01;
    const isSprinting = appState.isSprinting && isMoving;
    const posture = appState.posture;

    if (posture === 'prone') {
      b.hips.position.y = 0.16;
      b.spine.rotation.x = Math.PI / 2.2;
      b.chest.rotation.x = -0.2;
      b.head.rotation.x = -Math.PI / 3;

      if (isMoving) {
        const cycle = Math.sin(animClock * 6);
        b.leftArm.upper.rotation.x = -Math.PI / 2 + cycle * 0.5;
        b.rightArm.upper.rotation.x = -Math.PI / 2 - cycle * 0.5;
        b.leftLeg.upper.rotation.x = cycle * 0.4;
        b.rightLeg.upper.rotation.x = -cycle * 0.4;
        b.spine.rotation.y = cycle * 0.2;
      } else {
        b.leftArm.upper.rotation.x = -Math.PI / 2.4;
        b.rightArm.upper.rotation.x = -Math.PI / 2.4;
        b.leftLeg.upper.rotation.x = 0;
        b.rightLeg.upper.rotation.x = 0;
      }
      return;
    }

    if (posture === 'crouch') {
      b.hips.position.y = 0.55;
      b.spine.rotation.x = 0.35;
      b.chest.rotation.x = -0.15;
      b.head.rotation.x = -0.2;

      b.leftLeg.upper.rotation.x = -1.1;
      b.leftLeg.lower.rotation.x = 1.3;
      b.rightLeg.upper.rotation.x = -1.1;
      b.rightLeg.lower.rotation.x = 1.3;

      if (isMoving) {
        const cycle = Math.sin(animClock * 6);
        b.leftLeg.upper.rotation.x = -1.1 + cycle * 0.4;
        b.rightLeg.upper.rotation.x = -1.1 - cycle * 0.4;
        b.leftArm.upper.rotation.x = cycle * 0.4;
        b.rightArm.upper.rotation.x = -cycle * 0.4;
      }
      return;
    }

    if (appState.isJumping) {
      b.hips.position.y = 0.95;
      b.spine.rotation.x = 0.1;
      b.leftLeg.upper.rotation.x = -0.6;
      b.leftLeg.lower.rotation.x = 0.8;
      b.rightLeg.upper.rotation.x = -0.3;
      b.rightLeg.lower.rotation.x = 0.5;

      b.leftArm.upper.rotation.x = -1.2;
      b.rightArm.upper.rotation.x = -1.2;
      b.leftArm.upper.rotation.z = 0.5;
      b.rightArm.upper.rotation.z = -0.5;
      return;
    }

    if (isMoving) {
      const strideSpeed = isSprinting ? 14 : 8;
      const strideAmount = isSprinting ? 0.95 : 0.65;
      const cycle = Math.sin(animClock * strideSpeed);

      b.leftLeg.upper.rotation.x = cycle * strideAmount;
      b.rightLeg.upper.rotation.x = -cycle * strideAmount;
      b.leftLeg.lower.rotation.x = Math.max(0, -cycle * strideAmount * 1.3);
      b.rightLeg.lower.rotation.x = Math.max(0, cycle * strideAmount * 1.3);

      b.leftArm.upper.rotation.x = -cycle * strideAmount * 0.9;
      b.rightArm.upper.rotation.x = cycle * strideAmount * 0.9;
      b.leftArm.lower.rotation.x = isSprinting ? -0.8 : -0.3;
      b.rightArm.lower.rotation.x = isSprinting ? -0.8 : -0.3;

      b.hips.position.y = 0.92 + Math.abs(Math.sin(animClock * strideSpeed * 2)) * (isSprinting ? 0.09 : 0.05);
      b.spine.rotation.x = isSprinting ? 0.28 : 0.08;
      b.spine.rotation.y = cycle * 0.12;
      b.spine.rotation.z = Math.sin(animClock * strideSpeed) * 0.05;

      b.ponytail.rotation.x = Math.sin(animClock * strideSpeed * 2) * 0.25;
      b.ponytail.rotation.z = Math.cos(animClock * strideSpeed) * 0.15;
    } else {
      const breathe = Math.sin(animClock * 2.2) * 0.035;
      b.hips.position.y = 0.92 + breathe * 0.15;
      b.spine.rotation.x = breathe * 0.3;
      b.spine.rotation.y = 0;
      b.spine.rotation.z = 0;

      b.leftLeg.upper.rotation.x = THREE.MathUtils.lerp(b.leftLeg.upper.rotation.x, 0, 0.12);
      b.rightLeg.upper.rotation.x = THREE.MathUtils.lerp(b.rightLeg.upper.rotation.x, 0, 0.12);
      b.leftLeg.lower.rotation.x = THREE.MathUtils.lerp(b.leftLeg.lower.rotation.x, 0, 0.12);
      b.rightLeg.lower.rotation.x = THREE.MathUtils.lerp(b.rightLeg.lower.rotation.x, 0, 0.12);

      b.leftArm.upper.rotation.x = THREE.MathUtils.lerp(b.leftArm.upper.rotation.x, 0.05, 0.12);
      b.rightArm.upper.rotation.x = THREE.MathUtils.lerp(b.rightArm.upper.rotation.x, 0.05, 0.12);
      b.leftArm.upper.rotation.z = 0.18 + breathe * 0.15;
      b.rightArm.upper.rotation.z = -0.18 - breathe * 0.15;

      b.ponytail.rotation.x = breathe * 0.3;
    }
  }

  // -------------------------------------------------------------
  // ЗАГРУЗЧИК MIXAMO FBX С АВТОСОХРАНЕНИЕМ В INDEXEDDB
  // -------------------------------------------------------------
  const fbxLoader = new THREE.FBXLoader();

  function parseAndApplyFBX(arrayBuffer, fileName = 'mixamo.fbx', saveToDB = true) {
    try {
      const object = fbxLoader.parse(arrayBuffer, '');

      if (appState.femaleAvatar) {
        appState.femaleAvatar.visible = false;
        const hideToggle = document.getElementById('toggle-hide-test');
        if (hideToggle) hideToggle.checked = true;
        appState.hideTestCharacter = true;
      }

      if (appState.isCustomFBX && appState.character) {
        scene.remove(appState.character);
      }

      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      const targetHeight = 1.75;
      let scaleFactor = 1;
      if (size.y > 0) {
        scaleFactor = targetHeight / size.y;
        object.scale.set(scaleFactor, scaleFactor, scaleFactor);
      }

      object.position.x = -center.x * scaleFactor;
      object.position.y = -box.min.y * scaleFactor;
      object.position.z = -center.z * scaleFactor;

      const playerGroup = new THREE.Group();
      playerGroup.position.copy(appState.playerPos);
      playerGroup.add(object);

      object.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          if (child.material) child.material.side = THREE.DoubleSide;
        }
      });

      scene.add(playerGroup);
      appState.character = playerGroup;
      appState.isCustomFBX = true;

      appState.mixer = new THREE.AnimationMixer(object);
      appState.animations = {};

      if (object.animations && object.animations.length > 0) {
        object.animations.forEach((clip, idx) => {
          const name = clip.name || `clip_${idx}`;
          const action = appState.mixer.clipAction(clip);
          appState.animations[name] = action;
          if (idx === 0) {
            action.play();
            appState.currentAction = action;
          }
        });
        showToast(`FBX загружен (${object.animations.length} аним.)`);
      } else {
        showToast('Mixamo FBX размещен и сохранен в памяти');
      }

      document.getElementById('model-status').textContent = 'Mixamo FBX';
      const badge = document.getElementById('char-saved-badge');
      if (badge) badge.style.display = 'block';

      if (saveToDB) {
        saveAssetToDB('saved_character_fbx', arrayBuffer, { name: fileName });
      }
    } catch (err) {
      console.error('Ошибка FBX:', err);
      showToast('Ошибка разбора FBX: ' + err.message);
    }
  }

  // -------------------------------------------------------------
  // ЗАГРУЗЧИК 3D КОМНАТЫ С АВТОСОХРАНЕНИЕМ И СБОРОМ КОЛЛАЙДЕРОВ
  // -------------------------------------------------------------
  const gltfLoader = new THREE.GLTFLoader();
  const objLoader = new THREE.OBJLoader();

  function parseAndApplyRoom(data, fileName, saveToDB = true) {
    const fn = fileName.toLowerCase();
    appState.roomCollisionMeshes = [];

    const onRoomLoaded = (room) => {
      if (appState.roomObject) {
        scene.remove(appState.roomObject);
        appState.roomObject = null;
      }

      room.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          appState.roomCollisionMeshes.push(child);
        }
      });

      scene.add(room);
      appState.roomObject = room;

      appState.showDefaultEnvironment = false;
      envGroup.visible = false;
      const gridBtn = document.getElementById('btn-toggle-grid');
      if (gridBtn) gridBtn.classList.remove('active');

      const badge = document.getElementById('room-saved-badge');
      if (badge) badge.style.display = 'block';

      showToast('3D комната загружена с поддержкой коллизий!');

      if (saveToDB) {
        saveAssetToDB('saved_room_model', data, { name: fileName });
      }
    };

    try {
      if (fn.endsWith('.gltf') || fn.endsWith('.glb')) {
        gltfLoader.parse(data, '', (gltf) => {
          onRoomLoaded(gltf.scene);
        }, (err) => showToast('Ошибка GLTF: ' + err.message));
      } else if (fn.endsWith('.fbx')) {
        const room = fbxLoader.parse(data, '');
        onRoomLoaded(room);
      } else if (fn.endsWith('.obj')) {
        const text = typeof data === 'string' ? data : new TextDecoder().decode(data);
        const room = objLoader.parse(text);
        onRoomLoaded(room);
      }
    } catch (err) {
      console.error('Ошибка загрузки комнаты:', err);
      showToast('Ошибка комнаты: ' + err.message);
    }
  }

  // -------------------------------------------------------------
  // ВОССТАНОВЛЕНИЕ СОХРАНЕННЫХ ДАННЫХ ИЗ INDEXEDDB
  // -------------------------------------------------------------
  window.restoreSavedAssets = async function() {
    // 1. Восстановление персонажа FBX
    const savedChar = await getAssetFromDB('saved_character_fbx');
    if (savedChar && savedChar.data) {
      parseAndApplyFBX(savedChar.data, savedChar.name, false);
      const badge = document.getElementById('char-saved-badge');
      if (badge) badge.style.display = 'block';
    }

    // 2. Восстановление 3D комнаты
    const savedRoom = await getAssetFromDB('saved_room_model');
    if (savedRoom && savedRoom.data) {
      parseAndApplyRoom(savedRoom.data, savedRoom.name, false);
      const badge = document.getElementById('room-saved-badge');
      if (badge) badge.style.display = 'block';
    }

    // 3. Восстановление JS скрипта
    const savedScript = await getAssetFromDB('saved_custom_script');
    if (savedScript && savedScript.data) {
      try {
        const scriptFn = new Function('THREE', 'mixer', 'character', 'state', 'showToast', 'registerActionButton', savedScript.data);
        scriptFn(THREE, appState.mixer, appState.character, appState, showToast, window.registerActionButton);
        const badge = document.getElementById('script-saved-badge');
        if (badge) badge.style.display = 'block';
      } catch (err) {
        console.warn('Ошибка выполнения сохраненного скрипта:', err);
      }
    }
  };

  // -------------------------------------------------------------
  // API РЕГИСТРАЦИИ КАСТОМНЫХ КНОПОК
  // -------------------------------------------------------------
  window.registerActionButton = function({ id, icon, label, onClick }) {
    const cluster = document.getElementById('custom-buttons-cluster');
    if (!cluster) return;

    let existingBtn = document.getElementById(`btn-custom-${id}`);
    if (existingBtn) existingBtn.remove();

    const btn = document.createElement('button');
    btn.id = `btn-custom-${id}`;
    btn.className = 'hud-element action-btn';
    btn.setAttribute('data-hud-id', `custom-${id}`);
    btn.style.width = '52px';
    btn.style.height = '52px';
    btn.style.background = 'radial-gradient(circle, rgba(139, 92, 246, 0.4) 0%, rgba(18, 22, 36, 0.85) 75%)';
    btn.style.borderColor = 'rgba(167, 139, 250, 0.6)';

    btn.innerHTML = `
      <span class="btn-icon-text">${icon || '⚡'}</span>
      <span class="btn-label-text">${label || 'Действие'}</span>
    `;

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (document.body.classList.contains('hud-edit-mode')) {
        selectHudElement(btn);
        return;
      }
      if (typeof onClick === 'function') onClick(appState);
    });

    cluster.appendChild(btn);
    bindHudDragEvents(btn);
    showToast(`Кнопка "${label || id}" добавлена!`);
  };

  // -------------------------------------------------------------
  // СЕНСОРНОЕ УПРАВЛЕНИЕ (JOYSTICKS & TOUCH TURN)
  // -------------------------------------------------------------
  const leftZone = document.getElementById('left-joystick-zone');
  const leftThumb = document.getElementById('left-stick-thumb');
  let leftTouchId = null;
  let leftCenter = { x: 0, y: 0 };
  let leftMaxRadius = 45;

  function recalculateLeftJoystickCenter() {
    if (!leftZone) return;
    const rect = leftZone.getBoundingClientRect();
    leftCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    leftMaxRadius = rect.width * 0.35;
  }
  recalculateLeftJoystickCenter();

  leftZone.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('hud-edit-mode')) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    leftTouchId = touch.identifier;
    recalculateLeftJoystickCenter();
    handleLeftJoystick(touch.clientX, touch.clientY);
  }, { passive: false });

  // Джойстик-Глаз
  const eyeZone = document.getElementById('right-eye-joystick-zone');
  const eyeThumb = document.getElementById('eye-stick-thumb');
  let eyeTouchId = null;
  let eyeCenter = { x: 0, y: 0 };
  let eyeMaxRadius = 30;

  function recalculateEyeJoystickCenter() {
    if (!eyeZone) return;
    const rect = eyeZone.getBoundingClientRect();
    eyeCenter = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    eyeMaxRadius = rect.width * 0.35;
  }
  recalculateEyeJoystickCenter();

  eyeZone.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('hud-edit-mode')) return;
    e.preventDefault();
    const touch = e.changedTouches[0];
    eyeTouchId = touch.identifier;
    appState.isOrbitingWithEye = true;
    recalculateEyeJoystickCenter();
    handleEyeJoystick(touch.clientX, touch.clientY);
  }, { passive: false });

  function handleLeftJoystick(clientX, clientY) {
    const dx = clientX - leftCenter.x;
    const dy = clientY - leftCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, leftMaxRadius);

    const nx = clampedDist * Math.cos(angle);
    const ny = clampedDist * Math.sin(angle);

    leftThumb.style.transform = `translate(${nx}px, ${ny}px)`;

    appState.moveVector = {
      x: nx / leftMaxRadius,
      y: -ny / leftMaxRadius
    };
  }

  function handleEyeJoystick(clientX, clientY) {
    const dx = clientX - eyeCenter.x;
    const dy = clientY - eyeCenter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx);
    const clampedDist = Math.min(dist, eyeMaxRadius);

    const nx = clampedDist * Math.cos(angle);
    const ny = clampedDist * Math.sin(angle);

    eyeThumb.style.transform = `translate(${nx}px, ${ny}px)`;

    appState.eyeVector = {
      x: nx / eyeMaxRadius,
      y: ny / eyeMaxRadius
    };
  }

  // Правая половина экрана: Сенсорный поворот
  const rightTouchLayer = document.getElementById('touch-layer-right');
  rightTouchLayer.addEventListener('touchstart', (e) => {
    if (document.body.classList.contains('hud-edit-mode')) return;
    const touch = e.changedTouches[0];
    const eyeRect = eyeZone.getBoundingClientRect();
    if (
      touch.clientX >= eyeRect.left - 20 &&
      touch.clientX <= eyeRect.right + 20 &&
      touch.clientY >= eyeRect.top - 20 &&
      touch.clientY <= eyeRect.bottom + 20
    ) {
      return;
    }

    if (appState.turnTouchId === null) {
      appState.turnTouchId = touch.identifier;
      appState.lastTurnX = touch.clientX;
      appState.lastTurnY = touch.clientY;
    }
  }, { passive: false });

  function handleRightTouchTurn(clientX, clientY) {
    const dx = clientX - appState.lastTurnX;
    const dy = clientY - appState.lastTurnY;
    appState.lastTurnX = clientX;
    appState.lastTurnY = clientY;

    const turnSensitivity = 0.0055;
    appState.playerRotation -= dx * turnSensitivity;
    appState.targetRotation = appState.playerRotation;

    if (appState.cameraMode === 'FPV') {
      appState.orbitPitch = Math.max(-0.85, Math.min(0.85, appState.orbitPitch - dy * turnSensitivity));
    }
  }

  window.addEventListener('touchmove', (e) => {
    if (document.body.classList.contains('hud-edit-mode')) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === leftTouchId) {
        handleLeftJoystick(touch.clientX, touch.clientY);
      } else if (touch.identifier === eyeTouchId) {
        handleEyeJoystick(touch.clientX, touch.clientY);
      } else if (touch.identifier === appState.turnTouchId) {
        handleRightTouchTurn(touch.clientX, touch.clientY);
      }
    }
  }, { passive: false });

  const endTouchHandler = (e) => {
    if (document.body.classList.contains('hud-edit-mode')) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const touch = e.changedTouches[i];
      if (touch.identifier === leftTouchId) {
        leftTouchId = null;
        appState.moveVector = { x: 0, y: 0 };
        leftThumb.style.transform = 'translate(0px, 0px)';
      } else if (touch.identifier === eyeTouchId) {
        eyeTouchId = null;
        appState.isOrbitingWithEye = false;
        appState.eyeVector = { x: 0, y: 0 };
        eyeThumb.style.transform = 'translate(0px, 0px)';
      } else if (touch.identifier === appState.turnTouchId) {
        appState.turnTouchId = null;
      }
    }
  };

  window.addEventListener('touchend', endTouchHandler);
  window.addEventListener('touchcancel', endTouchHandler);

  // -------------------------------------------------------------
  // ОБРАБОТКА ДЕЙСТВИЙ
  // -------------------------------------------------------------
  function performJump() {
    if (!appState.isJumping) {
      appState.isJumping = true;
      appState.verticalVelocity = appState.jumpStrength;
      if (appState.posture !== 'stand') {
        appState.posture = 'stand';
        updatePostureUI();
      }
      showToast('Прыжок! 🦘');
    }
  }

  function toggleSprint() {
    appState.isSprinting = !appState.isSprinting;
    const btn = document.getElementById('btn-action-sprint');
    if (btn) btn.classList.toggle('active', appState.isSprinting);
    showToast(appState.isSprinting ? 'Спринт включен ⚡' : 'Обычный шаг');
  }

  function toggleCrouch() {
    appState.posture = appState.posture === 'crouch' ? 'stand' : 'crouch';
    updatePostureUI();
    showToast(appState.posture === 'crouch' ? 'Положение: Присед 🧘' : 'Положение: Стоя');
  }

  function toggleProne() {
    appState.posture = appState.posture === 'prone' ? 'stand' : 'prone';
    updatePostureUI();
    showToast(appState.posture === 'prone' ? 'Положение: Лежа 🛌' : 'Положение: Стоя');
  }

  function updatePostureUI() {
    const crouchBtn = document.getElementById('btn-action-crouch');
    const proneBtn = document.getElementById('btn-action-prone');
    if (crouchBtn) crouchBtn.classList.toggle('active', appState.posture === 'crouch');
    if (proneBtn) proneBtn.classList.toggle('active', appState.posture === 'prone');
  }

  document.getElementById('btn-action-jump').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!document.body.classList.contains('hud-edit-mode')) performJump();
    else selectHudElement(e.currentTarget);
  });
  document.getElementById('btn-action-sprint').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!document.body.classList.contains('hud-edit-mode')) toggleSprint();
    else selectHudElement(e.currentTarget);
  });
  document.getElementById('btn-action-crouch').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!document.body.classList.contains('hud-edit-mode')) toggleCrouch();
    else selectHudElement(e.currentTarget);
  });
  document.getElementById('btn-action-prone').addEventListener('click', (e) => {
    e.stopPropagation();
    if (!document.body.classList.contains('hud-edit-mode')) toggleProne();
    else selectHudElement(e.currentTarget);
  });

  // -------------------------------------------------------------
  // РАСШИРЕННАЯ КАСТОМИЗАЦИЯ HUD (ПОЗИЦИЯ, РАЗМЕР, ПРОЗРАЧНОСТЬ)
  // -------------------------------------------------------------
  const hudBanner = document.getElementById('hud-editor-banner');
  const scaleSlider = document.getElementById('hud-scale-slider');
  const scaleVal = document.getElementById('hud-scale-val');
  const opacitySlider = document.getElementById('hud-opacity-slider');
  const opacityVal = document.getElementById('hud-opacity-val');
  const selectedLabel = document.getElementById('hud-selected-label');

  let selectedHudEl = null;
  let hudLayoutData = {};

  function loadHudSettings() {
    try {
      const saved = localStorage.getItem('mixamo_hud_layout');
      if (saved) {
        hudLayoutData = JSON.parse(saved);
        document.querySelectorAll('.hud-element').forEach(el => {
          const id = el.getAttribute('data-hud-id');
          if (hudLayoutData[id]) {
            const data = hudLayoutData[id];
            if (data.left) el.style.left = data.left;
            if (data.top) el.style.top = data.top;
            if (data.left || data.top) {
              el.style.right = 'auto';
              el.style.bottom = 'auto';
            }
            if (data.scale) {
              el.style.transform = `scale(${data.scale})`;
            }
            if (data.opacity !== undefined) {
              el.style.opacity = data.opacity;
            }
          }
        });
      }
    } catch (e) {
      console.warn('HUD load error:', e);
    }
  }
  loadHudSettings();

  function selectHudElement(el) {
    document.querySelectorAll('.hud-element').forEach(h => h.classList.remove('hud-selected'));
    selectedHudEl = el;
    el.classList.add('hud-selected');

    const id = el.getAttribute('data-hud-id') || 'Элемент';
    const label = el.querySelector('.btn-label-text')?.textContent || el.title || id;
    selectedLabel.textContent = `Выбрано: ${label}`;

    const curData = hudLayoutData[id] || {};
    const curScale = curData.scale ? Math.round(curData.scale * 100) : 100;
    const curOpacity = curData.opacity !== undefined ? Math.round(curData.opacity * 100) : (el.style.opacity ? Math.round(parseFloat(el.style.opacity) * 100) : 100);

    scaleSlider.value = curScale;
    scaleVal.textContent = `${curScale}%`;
    opacitySlider.value = curOpacity;
    opacityVal.textContent = `${curOpacity}%`;
  }

  scaleSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    scaleVal.textContent = `${val}%`;
    if (selectedHudEl) {
      const scale = val / 100;
      selectedHudEl.style.transform = `scale(${scale})`;
      const id = selectedHudEl.getAttribute('data-hud-id');
      if (!hudLayoutData[id]) hudLayoutData[id] = {};
      hudLayoutData[id].scale = scale;
      recalculateLeftJoystickCenter();
      recalculateEyeJoystickCenter();
    }
  });

  opacitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    opacityVal.textContent = `${val}%`;
    if (selectedHudEl) {
      const opacity = val / 100;
      selectedHudEl.style.opacity = opacity;
      const id = selectedHudEl.getAttribute('data-hud-id');
      if (!hudLayoutData[id]) hudLayoutData[id] = {};
      hudLayoutData[id].opacity = opacity;
    }
  });

  function startHudEditMode() {
    document.body.classList.add('hud-edit-mode');
    hudBanner.style.display = 'flex';
    document.getElementById('menu-drawer').style.display = 'none';
    const firstEl = document.querySelector('.hud-element');
    if (firstEl) selectHudElement(firstEl);
    showToast('Режим кастомизации: двигайте, меняйте размер и прозрачность!');
  }

  function saveHudSettings() {
    document.querySelectorAll('.hud-element').forEach(el => {
      const id = el.getAttribute('data-hud-id');
      const rect = el.getBoundingClientRect();
      if (!hudLayoutData[id]) hudLayoutData[id] = {};
      hudLayoutData[id].left = rect.left + 'px';
      hudLayoutData[id].top = rect.top + 'px';
    });

    localStorage.setItem('mixamo_hud_layout', JSON.stringify(hudLayoutData));
    document.body.classList.remove('hud-edit-mode');
    document.querySelectorAll('.hud-element').forEach(h => h.classList.remove('hud-selected'));
    hudBanner.style.display = 'none';
    recalculateLeftJoystickCenter();
    recalculateEyeJoystickCenter();
    showToast('Раскладка, размеры и прозрачность кнопок сохранены! 💾');
  }

  function resetHudSettings() {
    localStorage.removeItem('mixamo_hud_layout');
    hudLayoutData = {};
    document.querySelectorAll('.hud-element').forEach(el => {
      el.style.left = '';
      el.style.top = '';
      el.style.right = '';
      el.style.bottom = '';
      el.style.transform = '';
      el.style.opacity = '';
      el.classList.remove('hud-selected');
    });
    document.body.classList.remove('hud-edit-mode');
    hudBanner.style.display = 'none';
    recalculateLeftJoystickCenter();
    recalculateEyeJoystickCenter();
    showToast('Настройки кнопок сброшены по умолчанию');
  }

  document.getElementById('btn-start-hud-edit').addEventListener('click', startHudEditMode);
  document.getElementById('btn-save-hud').addEventListener('click', saveHudSettings);
  document.getElementById('btn-reset-hud').addEventListener('click', resetHudSettings);

  // Drag-and-Drop для элементов HUD
  let draggingHudEl = null;
  let dragOffset = { x: 0, y: 0 };

  function bindHudDragEvents(el) {
    const onStart = (clientX, clientY) => {
      if (!document.body.classList.contains('hud-edit-mode')) return;
      selectHudElement(el);
      draggingHudEl = el;
      const rect = el.getBoundingClientRect();
      dragOffset = { x: clientX - rect.left, y: clientY - rect.top };
    };

    el.addEventListener('mousedown', (e) => onStart(e.clientX, e.clientY));
    el.addEventListener('touchstart', (e) => {
      if (document.body.classList.contains('hud-edit-mode')) {
        const t = e.touches[0];
        onStart(t.clientX, t.clientY);
      }
    });
  }

  document.querySelectorAll('.hud-element').forEach(bindHudDragEvents);

  window.addEventListener('mousemove', (e) => {
    if (draggingHudEl && document.body.classList.contains('hud-edit-mode')) {
      const nx = Math.max(10, Math.min(window.innerWidth - draggingHudEl.offsetWidth - 10, e.clientX - dragOffset.x));
      const ny = Math.max(10, Math.min(window.innerHeight - draggingHudEl.offsetHeight - 10, e.clientY - dragOffset.y));
      draggingHudEl.style.left = nx + 'px';
      draggingHudEl.style.top = ny + 'px';
      draggingHudEl.style.right = 'auto';
      draggingHudEl.style.bottom = 'auto';
    }
  });

  window.addEventListener('touchmove', (e) => {
    if (draggingHudEl && document.body.classList.contains('hud-edit-mode')) {
      const t = e.touches[0];
      const nx = Math.max(10, Math.min(window.innerWidth - draggingHudEl.offsetWidth - 10, t.clientX - dragOffset.x));
      const ny = Math.max(10, Math.min(window.innerHeight - draggingHudEl.offsetHeight - 10, t.clientY - dragOffset.y));
      draggingHudEl.style.left = nx + 'px';
      draggingHudEl.style.top = ny + 'px';
      draggingHudEl.style.right = 'auto';
      draggingHudEl.style.bottom = 'auto';
    }
  });

  const onDragEnd = () => { draggingHudEl = null; };
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('touchend', onDragEnd);

  // -------------------------------------------------------------
  // ДИАЛОГ СОЗДАНИЯ КАСТОМНОЙ КНОПКИ
  // -------------------------------------------------------------
  document.getElementById('btn-open-custom-btn-dialog').addEventListener('click', () => {
    const label = prompt('Введите название кнопки:', 'Эффект');
    if (!label) return;
    const icon = prompt('Введите эмодзи/иконку кнопки:', '✨') || '⚡';
    const script = prompt('Введите JS код при нажатии (например: showToast("Привет!");):', 'showToast("Кнопка ' + label + ' нажата!");');

    window.registerActionButton({
      id: 'btn_' + Date.now(),
      icon: icon,
      label: label,
      onClick: () => {
        try {
          new Function('state', 'showToast', script)(appState, showToast);
        } catch (err) {
          showToast('Ошибка: ' + err.message);
        }
      }
    });
  });

  // -------------------------------------------------------------
  // ОСНОВНОЙ ЦИКЛ РЕНДЕРИНГА И ФИЗИКИ (RENDER & PHYSICS LOOP)
  // -------------------------------------------------------------
  const clock = new THREE.Clock();

  function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (appState.mixer) {
      appState.mixer.update(delta);
    }

    // Гравитация и прыжок
    if (appState.isJumping) {
      appState.playerPos.y += appState.verticalVelocity * delta;
      appState.verticalVelocity -= appState.gravity * delta;

      if (appState.playerPos.y <= appState.groundY) {
        appState.playerPos.y = appState.groundY;
        appState.isJumping = false;
        appState.verticalVelocity = 0;
      }
    } else {
      appState.playerPos.y = appState.groundY;
    }

    // Движение персонажа с вычислением коллизий
    const mx = appState.moveVector.x;
    const my = appState.moveVector.y;
    const inputMag = Math.sqrt(mx * mx + my * my);

    if (inputMag > 0.08) {
      const inputAngle = Math.atan2(mx, my);

      let baseSpeed = 2.4;
      if (appState.isSprinting) baseSpeed = 5.6;
      if (appState.posture === 'crouch') baseSpeed = 1.6;
      if (appState.posture === 'prone') baseSpeed = 0.9;

      const targetPos = appState.playerPos.clone();

      if (my < -0.35 && Math.abs(mx) < 0.35) {
        // Назад спиной
        const moveSpeed = (baseSpeed * 0.85) * inputMag;
        appState.playerSpeed = moveSpeed;

        const forwardVec = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), appState.playerRotation);
        targetPos.addScaledVector(forwardVec, -moveSpeed * delta);
      } else {
        // Вперед / Поворот
        const moveSpeed = baseSpeed * inputMag;
        appState.playerSpeed = moveSpeed;

        appState.targetRotation = appState.playerRotation + inputAngle;

        const moveDir = new THREE.Vector3(
          Math.sin(appState.playerRotation + inputAngle),
          0,
          Math.cos(appState.playerRotation + inputAngle)
        );
        targetPos.addScaledVector(moveDir, moveSpeed * delta);
      }

      // ПРИМЕНЕНИЕ КОЛЛИЗИЙ (персонаж не проходит сквозь стены и мебель)
      const resolvedPos = resolvePlayerCollisions(targetPos);
      appState.playerPos.copy(resolvedPos);
    } else {
      appState.playerSpeed = 0;
    }

    // Позиция активного персонажа
    const activeChar = appState.isCustomFBX ? appState.character : (appState.hideTestCharacter ? null : appState.character);
    if (activeChar) {
      activeChar.position.copy(appState.playerPos);
      activeChar.rotation.y = THREE.MathUtils.lerp(activeChar.rotation.y, appState.targetRotation, 0.18);
    }

    // Процедурные движения девушки
    updateFemaleAnimations(delta);

    // Управление камерой от джойстика-глаза
    if (appState.cameraMode === 'TPV') {
      if (appState.isOrbitingWithEye) {
        if (Math.abs(appState.eyeVector.x) > 0.04) {
          appState.orbitYaw += appState.eyeVector.x * delta * 2.8;
        }
        if (Math.abs(appState.eyeVector.y) > 0.04) {
          appState.orbitPitch = Math.max(-0.35, Math.min(1.1, appState.orbitPitch + appState.eyeVector.y * delta * 2.0));
        }
      } else {
        appState.orbitYaw = THREE.MathUtils.lerp(appState.orbitYaw, 0, 0.08);
        appState.orbitPitch = THREE.MathUtils.lerp(appState.orbitPitch, 0.25, 0.08);
      }
    }

    updateCamera();
    renderer.render(scene, camera);
  }

  function updateCamera() {
    const charRot = appState.character ? appState.character.rotation.y : appState.playerRotation;

    let targetHeight = 1.25;
    if (appState.posture === 'crouch') targetHeight = 0.85;
    if (appState.posture === 'prone') targetHeight = 0.35;

    if (appState.cameraMode === 'TPV') {
      const camDistance = appState.posture === 'prone' ? 2.8 : 3.6;
      const camHeight = appState.posture === 'prone' ? 0.9 : 1.75;
      const totalYaw = charRot + Math.PI + appState.orbitYaw;

      const cx = appState.playerPos.x + Math.sin(totalYaw) * camDistance * Math.cos(appState.orbitPitch);
      const cz = appState.playerPos.z + Math.cos(totalYaw) * camDistance * Math.cos(appState.orbitPitch);
      const cy = appState.playerPos.y + camHeight + Math.sin(appState.orbitPitch) * (camDistance * 0.75);

      camera.position.set(cx, cy, cz);
      camera.lookAt(appState.playerPos.x, appState.playerPos.y + targetHeight, appState.playerPos.z);

      if (appState.character && !appState.hideTestCharacter) {
        appState.character.visible = true;
      }
    } else {
      const eyeHeight = appState.posture === 'crouch' ? 0.95 : (appState.posture === 'prone' ? 0.35 : 1.62);
      camera.position.set(appState.playerPos.x, appState.playerPos.y + eyeHeight, appState.playerPos.z);

      const lookDir = new THREE.Vector3(
        Math.sin(charRot),
        Math.sin(appState.orbitPitch),
        Math.cos(charRot)
      ).normalize();

      camera.lookAt(
        camera.position.x + lookDir.x,
        camera.position.y + lookDir.y,
        camera.position.z + lookDir.z
      );

      if (appState.character) {
        appState.character.visible = false;
      }
    }
  }

  animate();

  // -------------------------------------------------------------
  // КНОПКИ ВЕРХНЕЙ ПАНЕЛИ И НАСТРОЕК
  // -------------------------------------------------------------
  const drawer = document.getElementById('menu-drawer');
  document.getElementById('btn-toggle-menu').addEventListener('click', () => {
    drawer.style.display = drawer.style.display === 'flex' ? 'none' : 'flex';
  });
  document.getElementById('btn-close-menu').addEventListener('click', () => {
    drawer.style.display = 'none';
  });

  const hideToggle = document.getElementById('toggle-hide-test');
  hideToggle.addEventListener('change', (e) => {
    appState.hideTestCharacter = e.target.checked;
    if (appState.femaleAvatar && !appState.isCustomFBX) {
      appState.femaleAvatar.visible = !appState.hideTestCharacter;
    }
    showToast(appState.hideTestCharacter ? 'Персонаж скрыт' : 'Персонаж отображается');
  });

  const camBtn = document.getElementById('btn-camera-mode');
  const crosshair = document.getElementById('fpv-crosshair');

  camBtn.addEventListener('click', () => {
    if (appState.cameraMode === 'TPV') {
      appState.cameraMode = 'FPV';
      camBtn.innerHTML = '👁️ 1-е';
      crosshair.style.display = 'block';
      eyeZone.style.opacity = '0.25';
      eyeZone.style.pointerEvents = 'none';
      showToast('Режим: От 1-го лица (FPV)');
    } else {
      appState.cameraMode = 'TPV';
      camBtn.innerHTML = '🎥 3-е';
      crosshair.style.display = 'none';
      eyeZone.style.opacity = '1';
      eyeZone.style.pointerEvents = 'auto';
      showToast('Режим: От 3-го лица (TPV)');
    }
  });

  const gridBtn = document.getElementById('btn-toggle-grid');
  gridBtn.addEventListener('click', () => {
    appState.showDefaultEnvironment = !appState.showDefaultEnvironment;
    envGroup.visible = appState.showDefaultEnvironment;
    gridBtn.classList.toggle('active', appState.showDefaultEnvironment);
    showToast(appState.showDefaultEnvironment ? 'Комната и улица включены' : 'Комната и улица скрыты');
  });

  document.getElementById('btn-reset-pos').addEventListener('click', () => {
    appState.playerPos.set(0, appState.groundY, 0);
    appState.playerRotation = 0;
    appState.targetRotation = 0;
    appState.orbitYaw = 0;
    appState.orbitPitch = 0.25;
    appState.posture = 'stand';
    appState.isSprinting = false;
    updatePostureUI();
    if (appState.character) {
      appState.character.position.set(0, appState.groundY, 0);
      appState.character.rotation.set(0, 0, 0);
    }
    showToast('Позиция сброшена в (0, 0, 0)');
  });

  // -------------------------------------------------------------
  // ОБРАБОТЧИКИ ЗАГРУЗКИ ФАЙЛОВ С СОХРАНЕНИЕМ В INDEXEDDB
  // -------------------------------------------------------------
  // 1. Загрузка заставки (Splash Screen Media)
  document.getElementById('input-splash-media').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    showToast('Сохранение заставки...');
    const isVideo = file.type.startsWith('video/');
    const reader = new FileReader();
    reader.onload = async function(evt) {
      const buffer = evt.target.result;
      await saveAssetToDB('splash_media', buffer, {
        type: isVideo ? 'video' : 'image',
        mimeType: file.type,
        name: file.name
      });
      await initSplashScreen();
      showToast('Заставка успешно сохранена! Будет показываться при каждом входе 🎬');
      drawer.style.display = 'none';
    };
    reader.readAsArrayBuffer(file);
  });

  document.getElementById('btn-delete-splash').addEventListener('click', async () => {
    await deleteAssetFromDB('splash_media');
    await initSplashScreen();
    showToast('Кастомная заставка удалена');
  });

  // 2. Загрузка FBX персонажа
  document.getElementById('input-fbx-character').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('Загрузка и сохранение FBX...');
    const reader = new FileReader();
    reader.onload = (evt) => {
      parseAndApplyFBX(evt.target.result, file.name, true);
      drawer.style.display = 'none';
    };
    reader.readAsArrayBuffer(file);
  });

  // 3. Загрузка 3D комнаты
  document.getElementById('input-room-model').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('Загрузка и сохранение 3D комнаты...');
    const reader = new FileReader();
    reader.onload = (evt) => {
      parseAndApplyRoom(evt.target.result, file.name, true);
      drawer.style.display = 'none';
    };
    reader.readAsArrayBuffer(file);
  });

  // 4. Загрузка JS-скрипта
  document.getElementById('input-js-script').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    showToast('Выполнение и сохранение JS-скрипта...');
    const reader = new FileReader();
    reader.onload = async (evt) => {
      const scriptText = evt.target.result;
      try {
        const scriptFn = new Function('THREE', 'mixer', 'character', 'state', 'showToast', 'registerActionButton', scriptText);
        scriptFn(THREE, appState.mixer, appState.character, appState, showToast, window.registerActionButton);
        await saveAssetToDB('saved_custom_script', scriptText, { name: file.name });
        const badge = document.getElementById('script-saved-badge');
        if (badge) badge.style.display = 'block';
        showToast('JS-скрипт выполнен и сохранен в память!');
        drawer.style.display = 'none';
      } catch (err) {
        console.error('Ошибка JS скрипта:', err);
        showToast('Ошибка скрипта: ' + err.message);
      }
    };
    reader.readAsText(file);
  });

  // 5. ПОЛНЫЙ СБРОС ВСЕХ СОХРАНЕННЫХ ДАННЫХ
  document.getElementById('btn-reset-all-storage').addEventListener('click', async () => {
    if (!confirm('Вы действительно хотите полностью сбросить все сохраненные файлы (заставку, персонажа, комнату, скрипты) и настройки кнопок?')) {
      return;
    }
    await clearAllDBStorage();
    resetHudSettings();

    // Сбрасываем бейджи
    document.getElementById('char-saved-badge').style.display = 'none';
    document.getElementById('room-saved-badge').style.display = 'none';
    document.getElementById('script-saved-badge').style.display = 'none';
    document.getElementById('splash-saved-name').textContent = 'Стандартная заставка';
    document.getElementById('btn-delete-splash').style.display = 'none';

    // Удаляем кастомную комнату и возвращаем стандартную
    if (appState.roomObject) {
      scene.remove(appState.roomObject);
      appState.roomObject = null;
    }
    appState.showDefaultEnvironment = true;
    envGroup.visible = true;
    gridBtn.classList.add('active');

    // Удаляем FBX и возвращаем девушку-аватара
    if (appState.isCustomFBX && appState.character) {
      scene.remove(appState.character);
    }
    if (appState.femaleAvatar) {
      appState.femaleAvatar.visible = true;
      appState.character = appState.femaleAvatar;
      appState.isCustomFBX = false;
      document.getElementById('model-status').textContent = 'Девушка-Аватар';
    }
    hideToggle.checked = false;
    appState.hideTestCharacter = false;

    drawer.style.display = 'none';
    showToast('Все сохраненные ресурсы и настройки сброшены!');
  });

  const chips = document.querySelectorAll('.anim-chip');
  chips.forEach(chip => {
    chip.addEventListener('click', () => {
      chips.forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      const animName = chip.getAttribute('data-anim');

      if (animName === 'jump') performJump();
      else if (animName === 'sprint') { appState.isSprinting = true; updatePostureUI(); }
      else if (animName === 'crouch') { appState.posture = 'crouch'; updatePostureUI(); }
      else if (animName === 'prone') { appState.posture = 'prone'; updatePostureUI(); }
      else if (animName === 'idle' || animName === 'walk') { appState.posture = 'stand'; appState.isSprinting = false; updatePostureUI(); }

      if (appState.animations && appState.animations[animName]) {
        if (appState.currentAction) appState.currentAction.fadeOut(0.2);
        appState.animations[animName].reset().fadeIn(0.2).play();
        appState.currentAction = appState.animations[animName];
      }
      showToast(`Поза: ${chip.textContent}`);
    });
  });

  function handleResizeAndOrientation() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    recalculateLeftJoystickCenter();
    recalculateEyeJoystickCenter();
  }

  window.addEventListener('resize', handleResizeAndOrientation);
  window.addEventListener('orientationchange', () => {
    setTimeout(handleResizeAndOrientation, 200);
  });
}

// Запуск инициализации приложения
window.addEventListener('DOMContentLoaded', () => {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW error:', err);
    });
  }
  bootstrap();
});
