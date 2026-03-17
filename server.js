const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const AmmoLoader = require("ammojs3");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => {
  res.status(200).json({ ok: true, service: "racing56" });
});

const TRACK_CONFIG = {
  tileSize: 2,
  tileScale: 5,
  tilesX: 18,
  tilesZ: 12,
  width: 10,
  maxLaps: 3,
};

const CAR = {
  halfExtents: { x: 1.1, y: 0.5, z: 2.3 },
  mass: 1200,
  engineForce: 1600,
  brakeForce: 1200,
  steerTorque: 320,
  maxSpeed: 48,
};

function buildTrackLayout(config) {
  const tileSize = config.tileSize || 2;
  const tileScale = config.tileScale || 5;
  const tilesX = config.tilesX || 18;
  const tilesZ = config.tilesZ || 12;
  const tileLength = tileSize * tileScale;
  const radius = tileLength / 2;
  const width = config.width || tileLength * 0.9;
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

  const totalLength = segments.reduce((sum, seg) => sum + seg.length, 0);

  return {
    segments,
    totalLength,
    tileSize,
    tileScale,
    tilesX,
    tilesZ,
    tileLength,
    radius,
    width,
    start: { x: -halfW + radius, z: halfH - radius },
    startHeading: 0,
  };
}

function normalizeAngle(angle) {
  const tau = Math.PI * 2;
  let a = angle % tau;
  if (a < 0) a += tau;
  return a;
}

function clampAngleCW(start, end, angle) {
  const tau = Math.PI * 2;
  let s = normalizeAngle(start);
  let e = normalizeAngle(end);
  let a = normalizeAngle(angle);
  if (s < e) s += tau;
  if (a < e) a += tau;
  if (a > s) a = s;
  if (a < e) a = e;
  return a;
}

function clampAngleCCW(start, end, angle) {
  const tau = Math.PI * 2;
  let s = normalizeAngle(start);
  let e = normalizeAngle(end);
  let a = normalizeAngle(angle);
  if (e < s) e += tau;
  if (a < s) a += tau;
  if (a > e) a = e;
  if (a < s) a = s;
  return a;
}

function angleDeltaCW(start, end) {
  const tau = Math.PI * 2;
  let delta = start - end;
  if (delta < 0) delta += tau;
  return delta;
}

function angleDeltaCCW(start, end) {
  const tau = Math.PI * 2;
  let delta = end - start;
  if (delta < 0) delta += tau;
  return delta;
}

function closestPointOnTrack(layout, x, z) {
  let best = {
    dist2: Infinity,
    point: { x: 0, z: 0 },
    progress: 0,
    tangent: { x: 1, z: 0 },
  };
  let accum = 0;

  for (const segment of layout.segments) {
    if (segment.type === "straight") {
      const dx = x - segment.start.x;
      const dz = z - segment.start.z;
      const proj = dx * segment.dir.x + dz * segment.dir.z;
      const t = Math.max(0, Math.min(1, proj / segment.length));
      const cx = segment.start.x + segment.dir.x * segment.length * t;
      const cz = segment.start.z + segment.dir.z * segment.length * t;
      const dist2 = (x - cx) ** 2 + (z - cz) ** 2;
      if (dist2 < best.dist2) {
        best = {
          dist2,
          point: { x: cx, z: cz },
          progress: accum + segment.length * t,
          tangent: { x: segment.dir.x, z: segment.dir.z },
        };
      }
    } else {
      const angle = Math.atan2(z - segment.center.z, x - segment.center.x);
      let clampedAngle = angle;
      if (segment.clockwise) {
        clampedAngle = clampAngleCW(segment.startAngle, segment.endAngle, angle);
      } else {
        clampedAngle = clampAngleCCW(segment.startAngle, segment.endAngle, angle);
      }
      const cx = segment.center.x + Math.cos(clampedAngle) * segment.radius;
      const cz = segment.center.z + Math.sin(clampedAngle) * segment.radius;
      const dist2 = (x - cx) ** 2 + (z - cz) ** 2;
      const delta = segment.clockwise
        ? angleDeltaCW(segment.startAngle, clampedAngle)
        : angleDeltaCCW(segment.startAngle, clampedAngle);
      const tangent = segment.clockwise
        ? { x: Math.sin(clampedAngle), z: -Math.cos(clampedAngle) }
        : { x: -Math.sin(clampedAngle), z: Math.cos(clampedAngle) };
      if (dist2 < best.dist2) {
        best = {
          dist2,
          point: { x: cx, z: cz },
          progress: accum + segment.radius * delta,
          tangent,
        };
      }
    }
    accum += segment.length;
  }

  return best;
}

const TRACK_LAYOUT = buildTrackLayout(TRACK_CONFIG);

const waitingQueue = [];
const rooms = new Map();
const socketToRoom = new Map();

function makeRoomId() {
  return `room_${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeName(input) {
  if (typeof input !== "string") return "Driver";
  const name = input.trim().slice(0, 16);
  if (!name) return "Driver";
  if (!/^[a-zA-Z0-9_\- ]+$/.test(name)) return "Driver";
  return name;
}

function removeFromQueue(socketId) {
  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) waitingQueue.splice(idx, 1);
}

function createWorld(Ammo) {
  const config = new Ammo.btDefaultCollisionConfiguration();
  const dispatcher = new Ammo.btCollisionDispatcher(config);
  const broadphase = new Ammo.btDbvtBroadphase();
  const solver = new Ammo.btSequentialImpulseConstraintSolver();
  const world = new Ammo.btDiscreteDynamicsWorld(dispatcher, broadphase, solver, config);
  world.setGravity(new Ammo.btVector3(0, -9.8, 0));

  const groundShape = new Ammo.btStaticPlaneShape(new Ammo.btVector3(0, 1, 0), 0);
  const groundTransform = new Ammo.btTransform();
  groundTransform.setIdentity();
  groundTransform.setOrigin(new Ammo.btVector3(0, 0, 0));
  const groundMotion = new Ammo.btDefaultMotionState(groundTransform);
  const groundInfo = new Ammo.btRigidBodyConstructionInfo(0, groundMotion, groundShape, new Ammo.btVector3(0, 0, 0));
  const groundBody = new Ammo.btRigidBody(groundInfo);
  world.addRigidBody(groundBody);

  return { world, config, dispatcher, broadphase, solver, groundBody };
}

function createRigidBody(Ammo, world, shape, mass, position, yaw) {
  const transform = new Ammo.btTransform();
  transform.setIdentity();
  transform.setOrigin(new Ammo.btVector3(position.x, position.y, position.z));
  const quat = new Ammo.btQuaternion(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  transform.setRotation(quat);

  const motionState = new Ammo.btDefaultMotionState(transform);
  const localInertia = new Ammo.btVector3(0, 0, 0);
  if (mass > 0) {
    shape.calculateLocalInertia(mass, localInertia);
  }
  const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
  const body = new Ammo.btRigidBody(rbInfo);
  body.setFriction(1.0);
  body.setDamping(0.2, 0.6);
  body.setActivationState(4);
  world.addRigidBody(body);
  return body;
}

function createRoomPhysics(Ammo, room) {
  const physics = createWorld(Ammo);
  const boxShape = new Ammo.btBoxShape(new Ammo.btVector3(CAR.halfExtents.x, CAR.halfExtents.y, CAR.halfExtents.z));
  const offset = TRACK_LAYOUT.width * 0.35;
  const heading = TRACK_LAYOUT.startHeading;
  const right = { x: Math.sin(heading), z: -Math.cos(heading) };
  const start = TRACK_LAYOUT.start;

  const startPositions = [
    { x: start.x + right.x * offset, y: 1, z: start.z + right.z * offset },
    { x: start.x - right.x * offset, y: 1, z: start.z - right.z * offset },
  ];

  room.physics = {
    ...physics,
    shape: boxShape,
  };

  room.playersState = new Map();
  room.players.forEach((id, index) => {
    const body = createRigidBody(Ammo, physics.world, boxShape, CAR.mass, startPositions[index], heading);
    room.playersState.set(id, {
      id,
      name: room.names.get(id) || "Driver",
      body,
      input: { throttle: false, brake: false, left: false, right: false, handbrake: false },
      lap: 1,
      progress: 0,
      lastProgress: 0,
      finished: false,
      finishTime: 0,
      startPos: startPositions[index],
      startHeading: heading,
    });
  });
}

function resetPlayer(Ammo, player) {
  const transform = new Ammo.btTransform();
  transform.setIdentity();
  const origin = new Ammo.btVector3(player.startPos.x, player.startPos.y, player.startPos.z);
  transform.setOrigin(origin);
  const yaw = player.startHeading || 0;
  const quat = new Ammo.btQuaternion(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
  transform.setRotation(quat);
  player.body.setWorldTransform(transform);
  player.body.getMotionState().setWorldTransform(transform);
  const zero = new Ammo.btVector3(0, 0, 0);
  player.body.setLinearVelocity(zero);
  player.body.setAngularVelocity(zero);

  Ammo.destroy(origin);
  Ammo.destroy(quat);
  Ammo.destroy(zero);
  Ammo.destroy(transform);
}

function stepRoom(Ammo, room, dt) {
  if (!room.physics) return;

  const now = Date.now();
  if (room.startTime && now < room.startTime) {
    room.playersState.forEach((player) => {
      resetPlayer(Ammo, player);
    });
    return;
  }

  const world = room.physics.world;
  const layout = TRACK_LAYOUT;

  room.playersState.forEach((player) => {
    if (player.finished) return;

    const input = player.input;
    const steer = (input.left ? 1 : 0) + (input.right ? -1 : 0);

    const transform = player.body.getWorldTransform();
    const basis = transform.getBasis();
    const forward = basis.getRow(2);

    const force = (input.throttle ? CAR.engineForce : 0) - (input.brake ? CAR.brakeForce : 0);
    const forceVec = new Ammo.btVector3(forward.x() * force, 0, forward.z() * force);
    player.body.applyCentralForce(forceVec);

    const velocity = player.body.getLinearVelocity();
    const speed = Math.sqrt(velocity.x() * velocity.x() + velocity.z() * velocity.z());
    const steerStrength = speed > 2 ? 1 : 0;
    const torqueVec = new Ammo.btVector3(0, steer * CAR.steerTorque * steerStrength, 0);
    player.body.applyTorque(torqueVec);

    if (input.handbrake) {
      const damped = new Ammo.btVector3(velocity.x() * 0.88, velocity.y(), velocity.z() * 0.88);
      player.body.setLinearVelocity(damped);
      Ammo.destroy(damped);
    }

    Ammo.destroy(forceVec);
    Ammo.destroy(torqueVec);
  });

  world.stepSimulation(dt, 2);

  room.playersState.forEach((player) => {
    const transform = player.body.getWorldTransform();
    const pos = transform.getOrigin();
    const x = pos.x();
    const z = pos.z();
    const closest = closestPointOnTrack(layout, x, z);
    const distance = Math.sqrt(closest.dist2);
    const safeDistance = layout.width / 2;

    if (distance > safeDistance) {
      const nx = distance > 0 ? (x - closest.point.x) / distance : 0;
      const nz = distance > 0 ? (z - closest.point.z) / distance : 0;
      pos.setValue(closest.point.x + nx * safeDistance, pos.y(), closest.point.z + nz * safeDistance);
      transform.setOrigin(pos);
      player.body.setWorldTransform(transform);
      player.body.getMotionState().setWorldTransform(transform);

      const velocity = player.body.getLinearVelocity();
      const tangent = closest.tangent || { x: 1, z: 0 };
      const vTang = velocity.x() * tangent.x + velocity.z() * tangent.z;
      const clampedVel = new Ammo.btVector3(tangent.x * vTang, velocity.y(), tangent.z * vTang);
      player.body.setLinearVelocity(clampedVel);
      Ammo.destroy(clampedVel);
    }

    const velocity = player.body.getLinearVelocity();
    const speed = Math.sqrt(velocity.x() * velocity.x() + velocity.z() * velocity.z());
    if (speed > CAR.maxSpeed) {
      const scale = CAR.maxSpeed / speed;
      const limitedVel = new Ammo.btVector3(velocity.x() * scale, velocity.y(), velocity.z() * scale);
      player.body.setLinearVelocity(limitedVel);
      Ammo.destroy(limitedVel);
    }

    const progress = closest.progress / layout.totalLength;
    player.progress = progress;

    if (!player.finished && player.lastProgress > 0.9 && progress < 0.1 && speed > 3) {
      player.lap += 1;
      if (player.lap > TRACK_CONFIG.maxLaps) {
        player.finished = true;
        player.finishTime = now - room.raceStartTime;
        io.to(room.id).emit("race:finish", { id: player.id, name: player.name, time: player.finishTime });
      }
    }
    player.lastProgress = progress;
  });

  room.broadcastAccumulator += dt;
  if (room.broadcastAccumulator >= 0.05) {
    room.broadcastAccumulator = 0;
    const payload = [];

    room.playersState.forEach((player) => {
      const transform = player.body.getWorldTransform();
      const pos = transform.getOrigin();
      const basis = transform.getBasis();
      const forward = basis.getRow(2);
      const heading = Math.atan2(forward.x(), forward.z());
      const velocity = player.body.getLinearVelocity();
      const speed = Math.sqrt(velocity.x() * velocity.x() + velocity.z() * velocity.z());

      payload.push({
        id: player.id,
        name: player.name,
        position: { x: pos.x(), y: pos.y(), z: pos.z() },
        heading,
        speed,
        lap: player.lap,
        progress: player.progress,
        finished: player.finished,
      });
    });

    io.to(room.id).emit("state:update", { players: payload, serverTime: now });
  }
}

function teardownRoom(roomId, reason = "ended") {
  const room = rooms.get(roomId);
  if (!room) return;

  io.to(roomId).emit("match:ended", { reason });
  room.players.forEach((id) => {
    socketToRoom.delete(id);
    const sock = io.sockets.sockets.get(id);
    if (sock) sock.leave(roomId);
  });

  rooms.delete(roomId);
}

function startLoop(Ammo) {
  const dt = 1 / 60;
  setInterval(() => {
    rooms.forEach((room) => {
      if (!room.physics) return;
      stepRoom(Ammo, room, dt);
    });
  }, 1000 / 60);
}

function setupSockets(Ammo) {
  io.on("connection", (socket) => {
    socket.on("queue:join", ({ name }) => {
      if (socketToRoom.has(socket.id)) return;
      if (waitingQueue.includes(socket.id)) return;

      socket.data.name = sanitizeName(name);

      if (waitingQueue.length > 0) {
        const opponentId = waitingQueue.shift();
        const opponent = io.sockets.sockets.get(opponentId);
        if (!opponent) {
          waitingQueue.unshift(socket.id);
          return;
        }

        const roomId = makeRoomId();
        const room = {
          id: roomId,
          players: [opponentId, socket.id],
          ready: new Set(),
          names: new Map([
            [opponentId, opponent.data.name || "Driver"],
            [socket.id, socket.data.name || "Driver"],
          ]),
          startTime: 0,
          raceStartTime: 0,
          broadcastAccumulator: 0,
          physics: null,
          playersState: null,
        };
        rooms.set(roomId, room);
        socketToRoom.set(socket.id, roomId);
        socketToRoom.set(opponentId, roomId);
        socket.join(roomId);
        opponent.join(roomId);

        const payload = {
          roomId,
          players: room.players.map((id) => {
            const s = io.sockets.sockets.get(id);
            return { id, name: s?.data?.name || "Driver" };
          }),
        };

        io.to(roomId).emit("match:found", payload);
        return;
      }

      waitingQueue.push(socket.id);
      socket.emit("queue:status", { status: "waiting" });
    });

    socket.on("queue:leave", () => {
      removeFromQueue(socket.id);
      socket.emit("queue:status", { status: "idle" });
    });

    socket.on("player:ready", () => {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room) return;

      room.ready.add(socket.id);
      io.to(roomId).emit("match:ready", {
        ready: Array.from(room.ready),
      });

      if (room.ready.size === room.players.length) {
        room.startTime = Date.now() + 3000;
        room.raceStartTime = room.startTime;
        createRoomPhysics(Ammo, room);
        io.to(roomId).emit("match:start", {
          startTime: room.startTime,
          track: {
            tileSize: TRACK_CONFIG.tileSize,
            tileScale: TRACK_CONFIG.tileScale,
            tilesX: TRACK_CONFIG.tilesX,
            tilesZ: TRACK_CONFIG.tilesZ,
            width: TRACK_LAYOUT.width,
          },
          maxLaps: TRACK_CONFIG.maxLaps,
        });
      }
    });

    socket.on("input:update", (input) => {
      const roomId = socketToRoom.get(socket.id);
      if (!roomId) return;
      const room = rooms.get(roomId);
      if (!room || !room.playersState) return;
      const player = room.playersState.get(socket.id);
      if (!player) return;

      player.input = {
        throttle: Boolean(input?.throttle),
        brake: Boolean(input?.brake),
        left: Boolean(input?.left),
        right: Boolean(input?.right),
        handbrake: Boolean(input?.handbrake),
      };
    });

    socket.on("disconnect", () => {
      removeFromQueue(socket.id);
      const roomId = socketToRoom.get(socket.id);
      if (roomId) {
        teardownRoom(roomId, "opponent-left");
      }
    });
  });
}

async function main() {
  const Ammo = await AmmoLoader();
  setupSockets(Ammo);
  startLoop(Ammo);

  server.listen(PORT, () => {
    console.log(`Racing56 server running at http://localhost:${PORT}`);
  });
}

main();
