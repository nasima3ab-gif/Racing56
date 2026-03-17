import * as THREE from "https://unpkg.com/three@0.159.0/build/three.module.js";
import { GLTFLoader } from "https://unpkg.com/three@0.159.0/examples/jsm/loaders/GLTFLoader.js";
import { EXRLoader } from "https://unpkg.com/three@0.159.0/examples/jsm/loaders/EXRLoader.js";
import { EffectComposer } from "https://unpkg.com/three@0.159.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://unpkg.com/three@0.159.0/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "https://unpkg.com/three@0.159.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { SSAOPass } from "https://unpkg.com/three@0.159.0/examples/jsm/postprocessing/SSAOPass.js";

const canvas = document.getElementById("game");
const statusText = document.getElementById("statusText");
const countdownText = document.getElementById("countdownText");
const speedText = document.getElementById("speedText");
const lapText = document.getElementById("lapText");
const timeText = document.getElementById("timeText");
const leaderList = document.getElementById("leaderList");
const menu = document.getElementById("menu");
const menuStatus = document.getElementById("menuStatus");
const playerNameInput = document.getElementById("playerName");
const findMatchBtn = document.getElementById("findMatchBtn");
const leaveQueueBtn = document.getElementById("leaveQueueBtn");
const readyBtn = document.getElementById("readyBtn");
const backendUrlInput = document.getElementById("backendUrlInput");
const saveBackendBtn = document.getElementById("saveBackendBtn");

function normalizeBackendUrl(value) {
  if (!value) return "";
  let trimmed = String(value).trim();
  if (!trimmed || trimmed.includes("YOUR_BACKEND_URL")) return "";
  if (!/^https?:\/\//i.test(trimmed)) {
    const isLocal = trimmed.startsWith("localhost") || trimmed.startsWith("127.0.0.1");
    trimmed = `${isLocal ? "http" : "https"}://${trimmed}`;
  }
  return trimmed.replace(/\/+$/, "");
}

const backendMeta = document.querySelector('meta[name="backend-url"]');
const configuredBackendUrl = backendMeta ? backendMeta.content.trim() : "";
const queryBackend = normalizeBackendUrl(new URLSearchParams(window.location.search).get("backend"));
const storedBackend = normalizeBackendUrl(localStorage.getItem("racing56_backend_url"));
const metaBackend = normalizeBackendUrl(configuredBackendUrl);
const localFallback =
  window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"
    ? "http://localhost:3000"
    : "";
const backendUrl = queryBackend || storedBackend || metaBackend || localFallback;
const backendReady = Boolean(backendUrl);

if (backendUrlInput) {
  backendUrlInput.value = backendUrl || "";
}

if (saveBackendBtn) {
  saveBackendBtn.addEventListener("click", () => {
    const candidate = normalizeBackendUrl(backendUrlInput?.value);
    if (!candidate) {
      setMenuStatus("Enter a valid server URL (https://...)", "danger");
      return;
    }
    localStorage.setItem("racing56_backend_url", candidate);
    setMenuStatus("Server URL saved. Reloading...", "success");
    window.location.reload();
  });
}

const socket = backendReady
  ? io(backendUrl, { transports: ["websocket", "polling"] })
  : { on: () => {}, emit: () => {}, id: null };
let socketConnected = false;

function updateConnectionState(connected, message, mode) {
  socketConnected = connected;
  if (connected) {
    findMatchBtn.disabled = false;
    leaveQueueBtn.disabled = false;
    setStatus("Connected");
  } else {
    findMatchBtn.disabled = true;
    leaveQueueBtn.disabled = true;
    readyBtn.disabled = true;
    setStatus("Offline");
  }
  if (message) setMenuStatus(message, mode);
}

if (backendReady && socket?.on) {
  updateConnectionState(false, `Connecting to ${backendUrl}...`);
  socket.on("connect", () => {
    updateConnectionState(true, "Connected. Find a match.", "success");
  });
  socket.on("connect_error", (err) => {
    updateConnectionState(false, `Connection error: ${err?.message || "unknown"}`, "danger");
  });
  socket.on("disconnect", (reason) => {
    updateConnectionState(false, `Disconnected: ${reason}`, "danger");
  });
}

const DEFAULT_TRACK = {
  tileSize: 2,
  tileScale: 5,
  tilesX: 18,
  tilesZ: 12,
  width: 10,
};

const state = {
  playerName: "Driver",
  roomId: null,
  players: [],
  ready: [],
  matchStarted: false,
  startTime: 0,
  raceStartTime: 0,
  finished: false,
  finishTime: 0,
  remoteFinish: null,
  maxLaps: 3,
  track: { ...DEFAULT_TRACK },
};

const input = {
  throttle: false,
  brake: false,
  left: false,
  right: false,
  handbrake: false,
};

const net = {
  localBuffer: [],
  remoteBuffer: [],
  local: null,
  remote: null,
};

let lastFrame = performance.now();
let inputAccumulator = 0;

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0d12, 0.002);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1200);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const ssaoPass = new SSAOPass(scene, camera, window.innerWidth, window.innerHeight);
ssaoPass.kernelRadius = 16;
ssaoPass.minDistance = 0.002;
ssaoPass.maxDistance = 0.12;
composer.addPass(ssaoPass);
const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.6, 0.4, 0.85);
composer.addPass(bloomPass);

const hemi = new THREE.HemisphereLight(0xffffff, 0x2b3d52, 0.5);
scene.add(hemi);

const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
sun.position.set(140, 220, -30);
sun.castShadow = true;
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.left = -240;
sun.shadow.camera.right = 240;
sun.shadow.camera.top = 240;
sun.shadow.camera.bottom = -240;
scene.add(sun);

const fill = new THREE.DirectionalLight(0x6bd1ff, 0.5);
fill.position.set(-180, 120, 120);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(1600, 1600, 10, 10),
  new THREE.MeshStandardMaterial({
    color: 0x252b33,
    roughness: 0.9,
    metalness: 0.05,
  })
);

ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const trackGroup = new THREE.Group();
scene.add(trackGroup);

const loader = new GLTFLoader();
let straightAsset = null;
let curveAsset = null;
let carAsset = null;
let playerCar = null;
let remoteCar = null;
let trackLayout = null;

function setMeshShadows(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material && child.material.isMeshStandardMaterial) {
        child.material.roughness = Math.min(0.9, child.material.roughness + 0.1);
        child.material.metalness = Math.min(0.6, child.material.metalness + 0.1);
      }
    }
  });
}

function applyCarTint(object, color) {
  object.traverse((child) => {
    if (child.isMesh && child.material && child.material.isMeshStandardMaterial) {
      child.material = child.material.clone();
      child.material.color = new THREE.Color(color);
      child.material.metalness = 0.6;
      child.material.roughness = 0.35;
    }
  });
}

function computeUniformScale(object, targetLength) {
  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  const length = Math.max(size.x, size.z, 0.001);
  return targetLength / length;
}

const ASSET_HEADING_OFFSET = 0;
const CURVE_CENTER_OFFSET = new THREE.Vector3(1, 0, 1);

function buildTrackLayout(config) {
  const tileSize = config.tileSize || 2;
  const tileScale = config.tileScale || 5;
  const tilesX = config.tilesX || 18;
  const tilesZ = config.tilesZ || 12;
  const tileLength = tileSize * tileScale;
  const radius = tileLength / 2;
  const halfW = (tilesX * tileLength) / 2;
  const halfH = (tilesZ * tileLength) / 2;

  let pos = { x: -halfW + radius, z: halfH - radius };
  let heading = 0;
  const segments = [];

  const addStraight = (length) => {
    const start = { x: pos.x, z: pos.z };
    const dir = { x: Math.cos(heading), z: Math.sin(heading) };
    pos = {
      x: pos.x + dir.x * length,
      z: pos.z + dir.z * length,
    };
    segments.push({
      type: "straight",
      start,
      end: { x: pos.x, z: pos.z },
      length,
      dir,
      heading,
    });
  };

  const addTurnRight = () => {
    const right = { x: Math.sin(heading), z: -Math.cos(heading) };
    const center = {
      x: pos.x + right.x * radius,
      z: pos.z + right.z * radius,
    };
    const startAngle = Math.atan2(pos.z - center.z, pos.x - center.x);
    const endAngle = startAngle - Math.PI / 2;
    segments.push({
      type: "arc",
      center,
      radius,
      startAngle,
      endAngle,
      clockwise: true,
      length: (Math.PI / 2) * radius,
      heading,
    });
    heading -= Math.PI / 2;
    pos = {
      x: center.x + Math.cos(endAngle) * radius,
      z: center.z + Math.sin(endAngle) * radius,
    };
  };

  const straightX = tilesX * tileLength - 2 * radius;
  const straightZ = tilesZ * tileLength - 2 * radius;

  addStraight(straightX);
  addTurnRight();
  addStraight(straightZ);
  addTurnRight();
  addStraight(straightX);
  addTurnRight();
  addStraight(straightZ);
  addTurnRight();

  return {
    segments,
    tileLength,
    tileScale,
    tileSize,
    tilesX,
    tilesZ,
    radius,
    start: { x: -halfW + radius, z: halfH - radius },
  };
}

function buildTrack() {
  if (!straightAsset || !curveAsset) return;
  trackGroup.clear();

  trackLayout = buildTrackLayout(state.track);
  const scale = state.track.tileScale || 5;
  const tileLength = trackLayout.tileLength;

  trackLayout.segments.forEach((segment) => {
    if (segment.type === "straight") {
      const count = Math.max(1, Math.round(segment.length / tileLength));
      for (let i = 0; i < count; i += 1) {
        const distance = tileLength * (i + 0.5);
        const pos = {
          x: segment.start.x + segment.dir.x * distance,
          z: segment.start.z + segment.dir.z * distance,
        };
        const road = straightAsset.clone(true);
        road.scale.set(scale, scale, scale);
        road.position.set(pos.x, 0.02, pos.z);
        road.rotation.y = segment.heading + ASSET_HEADING_OFFSET;
        setMeshShadows(road);
        trackGroup.add(road);
      }
    } else {
      const curve = curveAsset.clone(true);
      curve.scale.set(scale, scale, scale);
      const rotation = segment.heading + ASSET_HEADING_OFFSET;
      const offset = CURVE_CENTER_OFFSET.clone().multiplyScalar(scale);
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), rotation);
      curve.position.set(segment.center.x - offset.x, 0.02, segment.center.z - offset.z);
      curve.rotation.y = rotation;
      setMeshShadows(curve);
      trackGroup.add(curve);
    }
  });
}

function setupCars() {
  if (!carAsset) return;

  const scale = computeUniformScale(carAsset, 4.6);

  playerCar = carAsset.clone(true);
  playerCar.scale.setScalar(scale);
  applyCarTint(playerCar, 0xff6b1a);
  setMeshShadows(playerCar);

  remoteCar = carAsset.clone(true);
  remoteCar.scale.setScalar(scale);
  applyCarTint(remoteCar, 0x4af2ff);
  setMeshShadows(remoteCar);
  remoteCar.visible = false;

  scene.add(playerCar);
  scene.add(remoteCar);
}

new EXRLoader().load("assets/harties_4k.exr", (texture) => {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envMap = pmrem.fromEquirectangular(texture).texture;
  scene.environment = envMap;
  scene.background = envMap;
  texture.dispose();
  pmrem.dispose();
});

loader.load("assets/road_straight.glb", (gltf) => {
  straightAsset = gltf.scene;
  setMeshShadows(straightAsset);
  buildTrack();
});

loader.load("assets/road_curve.glb", (gltf) => {
  curveAsset = gltf.scene;
  setMeshShadows(curveAsset);
  buildTrack();
});

loader.load("assets/car.glb", (gltf) => {
  carAsset = gltf.scene;
  setupCars();
});

const keyMap = {
  KeyW: "throttle",
  KeyS: "brake",
  KeyA: "left",
  KeyD: "right",
  Space: "handbrake",
};

window.addEventListener("keydown", (event) => {
  const key = keyMap[event.code];
  if (key) input[key] = true;
});

window.addEventListener("keyup", (event) => {
  const key = keyMap[event.code];
  if (key) input[key] = false;
});

function lerpAngle(a, b, t) {
  let delta = b - a;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return a + delta * t;
}

function applyBuffer(buffer, target) {
  if (!buffer.length || !target) return null;
  if (buffer.length === 1) {
    target.position.copy(buffer[0].position);
    target.rotation.y = buffer[0].heading;
    return buffer[0];
  }

  const now = performance.now() - 120;
  while (buffer.length >= 2 && buffer[1].time <= now) {
    buffer.shift();
  }

  const [a, b] = buffer;
  if (!a || !b) return a || null;
  const t = THREE.MathUtils.clamp((now - a.time) / (b.time - a.time), 0, 1);
  target.position.lerpVectors(a.position, b.position, t);
  target.rotation.y = lerpAngle(a.heading, b.heading, t);
  return t < 1 ? a : b;
}

function updateCamera(dt) {
  if (!playerCar || !net.local) return;
  const heading = net.local.heading || 0;
  const forward = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
  const targetPos = playerCar.position
    .clone()
    .addScaledVector(forward, -16)
    .add(new THREE.Vector3(0, 7, 0));
  camera.position.lerp(targetPos, 1 - Math.exp(-dt * 4));
  camera.lookAt(playerCar.position.clone().add(new THREE.Vector3(0, 1.5, 0)));
}

function updateHud() {
  const local = net.local;
  const speed = local ? Math.abs(local.speed) * 3.6 : 0;
  speedText.textContent = `${speed.toFixed(0)} km/h`;
  const lap = local ? Math.min(local.lap, state.maxLaps) : 1;
  lapText.textContent = `${lap} / ${state.maxLaps}`;

  if (state.matchStarted) {
    const now = performance.now();
    const elapsed = state.finished ? state.finishTime : Math.max(0, now - state.raceStartTime);
    timeText.textContent = formatTime(elapsed);
  } else {
    timeText.textContent = "0:00.000";
  }

  leaderList.innerHTML = "";
  state.players.forEach((player) => {
    const isMe = player.id === socket.id;
    const data = isMe ? net.local : net.remote;
    const li = document.createElement("div");
    li.className = "leader-item";
    const progress = data ? Math.round(data.progress * 100) : 0;
    const playerLap = data ? Math.min(data.lap, state.maxLaps) : 1;
    li.innerHTML = `<strong>${player.name}</strong><span>Lap ${playerLap} • ${progress}%</span>`;
    leaderList.appendChild(li);
  });
}

function formatTime(ms) {
  const total = Math.max(0, ms);
  const minutes = Math.floor(total / 60000);
  const seconds = Math.floor((total % 60000) / 1000);
  const millis = Math.floor(total % 1000);
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

function render() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;

  if (state.matchStarted) {
    inputAccumulator += dt;
    if (inputAccumulator > 0.05) {
      inputAccumulator = 0;
      socket.emit("input:update", { ...input });
    }
  }

  net.local = applyBuffer(net.localBuffer, playerCar) || net.local;
  net.remote = applyBuffer(net.remoteBuffer, remoteCar) || net.remote;

  updateCamera(dt);
  updateHud();

  if (state.matchStarted && !state.finished) {
    const remaining = state.startTime - Date.now();
    if (remaining > 0) {
      countdownText.textContent = (remaining / 1000).toFixed(1);
    } else {
      countdownText.textContent = "";
    }
  }

  composer.render();
  requestAnimationFrame(render);
}

function setStatus(text) {
  statusText.textContent = text;
}

function showMenu() {
  menu.classList.remove("hidden");
}

function hideMenu() {
  menu.classList.add("hidden");
}

function setMenuStatus(text, mode) {
  menuStatus.textContent = text;
  menuStatus.classList.remove("success", "danger");
  if (mode) menuStatus.classList.add(mode);
}

function setReadyVisible(visible) {
  readyBtn.classList.toggle("hidden", !visible);
}

findMatchBtn.addEventListener("click", () => {
  if (!socketConnected) {
    setMenuStatus("Not connected to the server yet.", "danger");
    return;
  }
  state.playerName = playerNameInput.value.trim() || "Driver";
  socket.emit("queue:join", { name: state.playerName });
  setMenuStatus("Searching for opponent...", "success");
});

leaveQueueBtn.addEventListener("click", () => {
  if (!socketConnected) {
    setMenuStatus("Not connected to the server yet.", "danger");
    return;
  }
  socket.emit("queue:leave");
  setMenuStatus("Queue left. Ready when you are.");
});

readyBtn.addEventListener("click", () => {
  if (!socketConnected) {
    setMenuStatus("Not connected to the server yet.", "danger");
    return;
  }
  socket.emit("player:ready");
  setMenuStatus("Ready! Waiting for opponent...", "success");
  readyBtn.disabled = true;
});

socket.on("queue:status", ({ status }) => {
  if (status === "waiting") {
    setMenuStatus("Waiting in queue...", "success");
  } else {
    setMenuStatus("Queue idle.");
  }
});

socket.on("match:found", ({ roomId, players }) => {
  state.roomId = roomId;
  state.players = players;
  state.matchStarted = false;
  state.finished = false;
  state.remoteFinish = null;
  readyBtn.disabled = false;
  setReadyVisible(true);
  setMenuStatus("Opponent found. Hit Ready to lock in.", "success");
  setStatus("Match found");
  if (remoteCar) remoteCar.visible = true;
});

socket.on("match:ready", ({ ready }) => {
  state.ready = ready;
});

socket.on("match:start", ({ startTime, track, maxLaps }) => {
  state.matchStarted = true;
  state.startTime = startTime;
  state.raceStartTime = performance.now() + (startTime - Date.now());
  state.finished = false;
  state.maxLaps = maxLaps || state.maxLaps;
  state.track = { ...state.track, ...(track || {}) };
  buildTrack();
  hideMenu();
  setStatus("Race live");
  setMenuStatus("Race started!", "success");
});

socket.on("state:update", ({ players }) => {
  const stamp = performance.now();
  players.forEach((player) => {
    const entry = {
      time: stamp,
      position: new THREE.Vector3(player.position.x, player.position.y, player.position.z),
      heading: player.heading,
      speed: player.speed,
      lap: player.lap,
      progress: player.progress,
      finished: player.finished,
    };
    if (player.id === socket.id) {
      net.localBuffer.push(entry);
      if (net.localBuffer.length > 30) net.localBuffer.shift();
    } else {
      net.remoteBuffer.push(entry);
      if (net.remoteBuffer.length > 30) net.remoteBuffer.shift();
    }
  });
});

socket.on("race:finish", ({ id, name, time }) => {
  if (id === socket.id) {
    state.finished = true;
    state.finishTime = time;
    setStatus("Finished!");
  } else {
    state.remoteFinish = { name, time };
  }
});

socket.on("match:ended", ({ reason }) => {
  setStatus("Idle");
  state.matchStarted = false;
  state.finished = false;
  state.players = [];
  state.roomId = null;
  state.ready = [];
  net.localBuffer = [];
  net.remoteBuffer = [];
  setMenuStatus(reason === "opponent-left" ? "Opponent left the race." : "Match ended.", "danger");
  setReadyVisible(false);
  showMenu();
  if (remoteCar) remoteCar.visible = false;
});

window.addEventListener("resize", () => {
  const { innerWidth, innerHeight } = window;
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  ssaoPass.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

render();
setStatus(backendReady ? "Connecting" : "Idle");
showMenu();

if (!backendReady) {
  setMenuStatus("Set server URL above to enable multiplayer.", "danger");
  findMatchBtn.disabled = true;
  leaveQueueBtn.disabled = true;
  readyBtn.disabled = true;
}
