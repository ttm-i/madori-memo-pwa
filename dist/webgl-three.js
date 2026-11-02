import * as THREE from "./vendor/three/three.module.js";
import { buildKitchenComponentRects, resolveFurnitureVerticalRange } from "./model.js?v=63";
import { featureVerticalRange, isCutawayEdge, openingVerticalRange, splitWallFace, threeItemBelongsToRoom, threeRoomBounds, threeWallBelongsToRoom } from "./three.js?v=63";

const WALL_THICKNESS = 6;
const DEFAULT_WALL_HEIGHT = 220;

function disposeObject(object) {
  object.traverse((child) => {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
    child.material?.map?.dispose?.();
  });
}

function material(color, { opacity = 1, roughness = .82, metalness = 0 } = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    opacity,
    transparent: opacity < 1,
    roughness,
    metalness,
    side: THREE.DoubleSide,
  });
}

function addOutline(mesh, color = 0x6f766f, opacity = .65) {
  const lines = new THREE.LineSegments(
    new THREE.EdgesGeometry(mesh.geometry),
    new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity }),
  );
  lines.renderOrder = 4;
  mesh.add(lines);
}

function markSelectable(mesh, type, item) {
  mesh.userData.selection = { type, item };
  return mesh;
}

function segmentBox(from, to, bottomCm, topCm, thickness, meshMaterial) {
  const dx = to.x - from.x;
  const dz = to.y - from.y;
  const length = Math.hypot(dx, dz);
  const height = Math.max(.5, topCm - bottomCm);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(length, height, thickness), meshMaterial);
  mesh.position.set((from.x + to.x) / 2, bottomCm + height / 2, (from.y + to.y) / 2);
  mesh.rotation.y = -Math.atan2(dz, dx);
  return mesh;
}

function pointAt(from, to, distanceCm, lengthCm) {
  const ratio = lengthCm ? distanceCm / lengthCm : 0;
  return { x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio };
}

function pointToSegmentDistance(point, from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

function openingCutOnEdge(opening, room, edgeIndex, wallHeight) {
  const roomIds = opening.roomIds ?? [opening.roomId];
  if (!roomIds.includes(room.id)) return null;
  const range = openingVerticalRange(opening);
  if (!range) return null;
  const from = room.points[edgeIndex];
  const to = room.points[(edgeIndex + 1) % room.points.length];
  const tolerance = 16;
  if (pointToSegmentDistance(opening.from, from, to) > tolerance || pointToSegmentDistance(opening.to, from, to) > tolerance) return null;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return null;
  const coordinate = (point) => ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
  const first = coordinate(opening.from);
  const second = coordinate(opening.to);
  return {
    opening,
    u1: Math.max(0, Math.min(first, second)),
    u2: Math.min(length, Math.max(first, second)),
    z1: Math.max(0, range.bottomCm),
    z2: Math.min(wallHeight, range.topCm),
  };
}

function roomFloor(room) {
  const shape = new THREE.Shape();
  room.points.forEach((point, index) => {
    if (index === 0) shape.moveTo(point.x, point.y);
    else shape.lineTo(point.x, point.y);
  });
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    material(room.color ?? "#e9e4d8", { opacity: .9, roughness: 1 }),
  );
  mesh.rotation.x = Math.PI / 2;
  mesh.position.y = -.8;
  mesh.receiveShadow = true;
  return mesh;
}

function boxObject(item, vertical, color, type) {
  const width = item.width ?? item.widthCm;
  const depth = item.depth ?? item.depthCm ?? item.height;
  if (![item.x, item.y, width, depth, vertical.bottomCm, vertical.topCm].every(Number.isFinite)) return null;
  const height = Math.max(1.5, vertical.topCm - vertical.bottomCm);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color, { opacity: vertical.schematic ? .62 : .88 }));
  mesh.position.set(item.x + width / 2, vertical.bottomCm + height / 2, item.y + depth / 2);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  addOutline(mesh, type === "furniture" ? 0x815c45 : 0x326b5e, .72);
  return markSelectable(mesh, type, item);
}

function textSprite(text, position) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  context.font = `700 ${14 * ratio}px system-ui, sans-serif`;
  const width = Math.ceil(context.measureText(text).width + 18 * ratio);
  canvas.width = width;
  canvas.height = 30 * ratio;
  context.scale(ratio, ratio);
  context.fillStyle = "rgba(255,255,255,.88)";
  context.beginPath();
  context.roundRect(0, 0, width / ratio, 24, 6);
  context.fill();
  context.fillStyle = "#41514b";
  context.font = "700 14px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, width / ratio / 2, 12);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false, transparent: true }));
  sprite.position.copy(position);
  sprite.scale.set(width / ratio * 1.25, 37.5, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function layerEnabled(layer, options) { return options[layer] !== false; }

function buildScene(root, documentData, options) {
  const { plan } = documentData;
  const selectedRoom = options.roomId ? (plan.rooms ?? []).find((room) => room.id === options.roomId) : null;
  const rooms = selectedRoom ? [selectedRoom] : (plan.rooms ?? []);
  const bounds = selectedRoom ? threeRoomBounds(rooms, plan.bounds) : plan.bounds;
  const openings = (plan.openings ?? [])
    .filter((opening) => threeItemBelongsToRoom(opening, selectedRoom?.id))
    .map((opening) => ({ opening, range: openingVerticalRange(opening) }))
    .filter((entry) => entry.range);
  const features = (plan.features ?? [])
    .filter((item) => item.kind !== "column" && threeItemBelongsToRoom(item, selectedRoom?.id));
  const furniture = (plan.furniture ?? []).filter((item) => threeItemBelongsToRoom(item, selectedRoom?.id));
  const partitionWalls = (plan.walls ?? []).filter((wall) => threeWallBelongsToRoom(wall, selectedRoom));
  const wallHeight = Math.max(
    DEFAULT_WALL_HEIGHT,
    ...openings.map(({ range }) => range.topCm + 20),
    ...features.map((item) => featureVerticalRange(item).topCm + 10),
  );
  const hiddenOpeningIds = new Set();
  const cutOpeningIds = new Set();
  let hiddenWallCount = 0;
  let kitchenComponentCount = 0;

  for (const room of rooms) {
    root.add(roomFloor(room));
    room.points.forEach((from, edgeIndex) => {
      if (room.nonWallEdges?.includes(edgeIndex)) return;
      const to = room.points[(edgeIndex + 1) % room.points.length];
      const cuts = openings.map(({ opening }) => openingCutOnEdge(opening, room, edgeIndex, wallHeight)).filter(Boolean);
      if (options.cutaway !== false && isCutawayEdge(room.points, edgeIndex, options.quarterTurn ?? 0)) {
        hiddenWallCount += 1;
        cuts.forEach((cut) => hiddenOpeningIds.add(cut.opening.id));
        return;
      }
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      cuts.forEach((cut) => cutOpeningIds.add(cut.opening.id));
      const rectangles = cuts.length ? splitWallFace(length, wallHeight, cuts) : [{ u1: 0, u2: length, z1: 0, z2: wallHeight }];
      if (!layerEnabled("walls", options)) return;
      for (const rectangle of rectangles) {
        const segmentFrom = pointAt(from, to, rectangle.u1, length);
        const segmentTo = pointAt(from, to, rectangle.u2, length);
        const wall = segmentBox(
          segmentFrom,
          segmentTo,
          rectangle.z1,
          rectangle.z2,
          WALL_THICKNESS,
          material(0xdedbd1, { opacity: .78, roughness: 1 }),
        );
        wall.receiveShadow = true;
        addOutline(wall, 0x7c817b, .42);
        root.add(wall);
      }
    });
  }

  if (layerEnabled("walls", options)) {
    for (const wall of partitionWalls) {
      const points = wall.points?.length >= 2 ? wall.points : [wall.from, wall.to].filter(Boolean);
      for (let index = 0; index < points.length - (wall.points?.length >= 3 ? 0 : 1); index += 1) {
        const from = points[index];
        const to = points[(index + 1) % points.length];
        const mesh = segmentBox(from, to, 0, wallHeight, WALL_THICKNESS, material(0xd6d3ca, { opacity: .84 }));
        mesh.receiveShadow = true;
        addOutline(mesh, 0x70766f, .5);
        root.add(mesh);
      }
    }
  }

  if (layerEnabled("openings", options)) {
    for (const { opening, range } of openings) {
      if (hiddenOpeningIds.has(opening.id)) continue;
      const pane = segmentBox(
        opening.from,
        opening.to,
        range.bottomCm,
        range.topCm,
        2.5,
        material(range.isWindow ? 0x69b7d3 : 0xf8f3e9, { opacity: range.isWindow ? .56 : .94, roughness: .45 }),
      );
      addOutline(pane, range.isWindow ? 0x26718d : 0x805936, .9);
      root.add(markSelectable(pane, "opening", opening));
    }
  }

  if (layerEnabled("features", options)) {
    for (const item of features) {
      const vertical = featureVerticalRange(item);
      const mesh = boxObject(item, vertical, 0x5fa38f, "feature");
      if (!mesh) continue;
      root.add(mesh);
      if (item.kind === "kitchen") {
        for (const component of buildKitchenComponentRects(item)) {
          const componentItem = { ...component, name: item.name };
          const componentMesh = boxObject(componentItem, { bottomCm: vertical.topCm + .5, topCm: vertical.topCm + 2.5 }, component.kind === "sink" ? 0x6f9faf : 0x303331, "feature");
          if (componentMesh) root.add(componentMesh);
          kitchenComponentCount += 1;
        }
      }
      if (options.showLabels) root.add(textSprite(item.name, new THREE.Vector3(item.x + item.width / 2, vertical.topCm + 22, item.y + item.height / 2)));
    }
  }

  if (layerEnabled("furniture", options)) {
    for (const item of furniture) {
      const vertical = resolveFurnitureVerticalRange(plan, item);
      const mesh = boxObject(item, vertical, 0xc48d68, "furniture");
      if (!mesh) continue;
      root.add(mesh);
      if (options.showLabels) root.add(textSprite(item.name, new THREE.Vector3(item.x + item.widthCm / 2, vertical.topCm + 22, item.y + item.depthCm / 2)));
    }
  }

  return {
    rendered: true,
    bounds,
    wallHeight,
    openingCount: openings.length,
    cutOpeningCount: cutOpeningIds.size,
    hiddenWallCount,
    partitionWallCount: partitionWalls.length,
    furnitureWithoutHeight: furniture.filter((item) => !Number.isFinite(item.heightCm)).length,
    selectedRoomName: selectedRoom?.name ?? null,
    kitchenComponentCount,
  };
}

export function createWebGLThreeView(canvas, onSelect = null) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0xf3efe6, 1);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf3efe6, 900, 2300);
  const camera = new THREE.OrthographicCamera(-500, 500, 350, -350, 1, 4000);
  const root = new THREE.Group();
  scene.add(root);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb6b1a7, 2.25));
  const sunlight = new THREE.DirectionalLight(0xffffff, 2.2);
  sunlight.position.set(-450, 900, -350);
  scene.add(sunlight);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pointers = new Map();
  const view = { yaw: -Math.PI / 4, pitch: .72, zoom: 1, quarterTurn: 0 };
  let sceneInfo = { bounds: { x: 0, y: 0, width: 1, height: 1 }, wallHeight: DEFAULT_WALL_HEIGHT };
  let frameRequested = false;
  let pinchStart = null;
  let usedMultiplePointers = false;

  function requestRender() {
    if (frameRequested) return;
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      resize();
      renderer.render(scene, camera);
    });
  }

  function resize() {
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    const pixelRatio = renderer.getPixelRatio();
    if (canvas.width !== Math.round(width * pixelRatio) || canvas.height !== Math.round(height * pixelRatio)) renderer.setSize(width, height, false);
    const aspect = width / height;
    const span = Math.max(sceneInfo.bounds.width, sceneInfo.bounds.height, sceneInfo.wallHeight * 2.2) * 1.28 / view.zoom;
    camera.left = -span * aspect / 2;
    camera.right = span * aspect / 2;
    camera.top = span / 2;
    camera.bottom = -span / 2;
    camera.updateProjectionMatrix();
    const center = new THREE.Vector3(
      sceneInfo.bounds.x + sceneInfo.bounds.width / 2,
      sceneInfo.wallHeight * .28,
      sceneInfo.bounds.y + sceneInfo.bounds.height / 2,
    );
    const distance = Math.max(sceneInfo.bounds.width, sceneInfo.bounds.height, 500) * 1.65;
    const horizontal = Math.cos(view.pitch) * distance;
    camera.position.set(
      center.x + Math.sin(view.yaw) * horizontal,
      center.y + Math.sin(view.pitch) * distance,
      center.z + Math.cos(view.yaw) * horizontal,
    );
    camera.lookAt(center);
  }

  function setZoom(value) {
    view.zoom = Math.max(1, Math.min(3, value));
    requestRender();
    return view.zoom;
  }

  function resetView(quarterTurn = view.quarterTurn) {
    view.quarterTurn = quarterTurn;
    view.yaw = -Math.PI / 4 + quarterTurn * Math.PI / 2;
    view.pitch = .72;
    view.zoom = 1;
    requestRender();
  }

  function pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(root.children, true);
    const selected = hits.map((hit) => {
      let object = hit.object;
      while (object && !object.userData.selection) object = object.parent;
      return object?.userData.selection;
    }).find(Boolean);
    if (selected) onSelect?.(selected.type, selected.item);
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false });
    if (pointers.size === 2) {
      usedMultiplePointers = true;
      const values = [...pointers.values()];
      pinchStart = { distance: Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y), zoom: view.zoom };
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    const current = pointers.get(event.pointerId);
    if (!current) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    current.x = event.clientX;
    current.y = event.clientY;
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 5) current.moved = true;
    if (pointers.size === 1) {
      view.yaw -= dx * .009;
      view.pitch = Math.max(.25, Math.min(1.3, view.pitch + dy * .006));
      requestRender();
    } else if (pointers.size === 2 && pinchStart) {
      const values = [...pointers.values()];
      const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      if (pinchStart.distance > 0) setZoom(pinchStart.zoom * distance / pinchStart.distance);
    }
    event.preventDefault();
  });

  function endPointer(event) {
    const current = pointers.get(event.pointerId);
    const shouldPick = pointers.size === 1 && current && !current.moved && !usedMultiplePointers;
    pointers.delete(event.pointerId);
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      pinchStart = null;
      usedMultiplePointers = false;
    }
    if (shouldPick) pick(event.clientX, event.clientY);
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("wheel", (event) => {
    setZoom(view.zoom + (event.deltaY < 0 ? .15 : -.15));
    event.preventDefault();
  }, { passive: false });

  const observer = new ResizeObserver(requestRender);
  observer.observe(canvas);

  return {
    render(documentData, options = {}) {
      if (options.quarterTurn !== view.quarterTurn) {
        const difference = ((options.quarterTurn ?? 0) - view.quarterTurn + 4) % 4;
        view.yaw += (difference === 3 ? -1 : difference) * Math.PI / 2;
        view.quarterTurn = options.quarterTurn ?? 0;
      }
      disposeObject(root);
      root.clear();
      sceneInfo = buildScene(root, documentData, options);
      requestRender();
      return sceneInfo;
    },
    getZoom: () => view.zoom,
    setZoom,
    resetView,
    requestRender,
  };
}
