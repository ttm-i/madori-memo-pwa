import { buildKitchenComponentRects, featureSupportRange, pointInPolygon, resolveFurnitureVerticalRange } from "./model.js?v=60";

const NS = "http://www.w3.org/2000/svg";

function svg(name, attributes = {}, text = "") {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}

function rotatedThreeCoordinates(point, bounds, quarterTurn = 0) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  let x = point.x - cx;
  let y = point.y - cy;
  for (let index = 0; index < ((quarterTurn % 4) + 4) % 4; index += 1) [x, y] = [-y, x];
  return { x, y };
}

export function projectThreePoint(point, bounds, quarterTurn = 0, z = 0) {
  const { x, y } = rotatedThreeCoordinates(point, bounds, quarterTurn);
  return { x: (x - y) * .72, y: (x + y) * .36 - z * .62 };
}

export function projectThreeDepth(point, bounds, quarterTurn = 0, z = 0) {
  const { x, y } = rotatedThreeCoordinates(point, bounds, quarterTurn);
  return (x + y) * .4464 + z * .5184;
}

export function threeViewportBox({ scale = 1, panX = 0, panY = 0 } = {}) {
  const safeScale = Math.max(1, Math.min(3, Number.isFinite(scale) ? scale : 1));
  const width = 900 / safeScale;
  const height = 620 / safeScale;
  const maxPanX = (900 - width) / 2;
  const maxPanY = (620 - height) / 2;
  const safePanX = Math.max(-maxPanX, Math.min(maxPanX, Number.isFinite(panX) ? panX : 0));
  const safePanY = Math.max(-maxPanY, Math.min(maxPanY, Number.isFinite(panY) ? panY : 0));
  return { x: 450 + safePanX - width / 2, y: 310 + safePanY - height / 2, width, height, scale: safeScale, panX: safePanX, panY: safePanY };
}

function pointsValue(points) { return points.map((point) => `${point.x},${point.y}`).join(" "); }

function wallStripElement(points, { first = true, last = true, bottomEdge = true, topEdge = true, partition = false, wallId = "" } = {}) {
  const group = svg("g", { class: "three-wall-surface", "data-wall-id": wallId });
  const variant = partition ? " three-partition-wall" : "";
  group.append(svg("polygon", { class: `three-wall three-wall-fill${variant}`, points: pointsValue(points) }));
  const edgeClass = `three-wall-edge${partition ? " three-partition-wall-edge" : ""}`;
  if (bottomEdge) group.append(svg("polyline", { class: edgeClass, points: pointsValue([points[0], points[1]]) }));
  if (topEdge) group.append(svg("polyline", { class: edgeClass, points: pointsValue([points[3], points[2]]) }));
  if (first) group.append(svg("polyline", { class: edgeClass, points: pointsValue([points[0], points[3]]) }));
  if (last) group.append(svg("polyline", { class: edgeClass, points: pointsValue([points[1], points[2]]) }));
  return group;
}

export function threeLayerEnabled(layer, options = {}) { return options[layer] !== false; }

export function threeSelectableType(item) {
  return item?.type === "feature" || item?.type === "furniture" ? item.type : null;
}

function makeBoxSurfaceInteractive(element, item, onSelect, keyboard = false) {
  const type = threeSelectableType(item);
  if (!type || !onSelect) return element;
  element.classList.add("is-interactive");
  element.setAttribute("data-item-id", item.id ?? "");
  if (keyboard) {
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
    element.setAttribute("aria-label", `${item.name}の詳細を表示`);
  }
  const select = (event) => { event.stopPropagation(); onSelect(type, item); };
  element.addEventListener("click", select);
  if (keyboard) element.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) select(event); });
  return element;
}

function kitchenComponentElement(component, heightCm, project) {
  const corners = [
    { x: component.x, y: component.y },
    { x: component.x + component.width, y: component.y },
    { x: component.x + component.width, y: component.y + component.height },
    { x: component.x, y: component.y + component.height },
  ];
  const group = svg("g", { class: `three-kitchen-component three-kitchen-${component.kind}` });
  group.append(svg("polygon", { class: "three-kitchen-component-outer", points: pointsValue(corners.map((point) => project(point, heightCm))) }));
  if (component.kind === "sink") {
    const inset = Math.min(5, component.width / 6, component.height / 6);
    const inner = [
      { x: component.x + inset, y: component.y + inset },
      { x: component.x + component.width - inset, y: component.y + inset },
      { x: component.x + component.width - inset, y: component.y + component.height - inset },
      { x: component.x + inset, y: component.y + component.height - inset },
    ];
    group.append(svg("polygon", { class: "three-kitchen-sink-inner", points: pointsValue(inner.map((point) => project(point, heightCm + .2))) }));
  } else {
    const burnerCenters = [[.3, .3], [.7, .3], [.3, .7], [.7, .7]];
    for (const [xRatio, yRatio] of burnerCenters) {
      const center = project({ x: component.x + component.width * xRatio, y: component.y + component.height * yRatio }, heightCm + .2);
      group.append(svg("circle", { class: "three-kitchen-burner", cx: center.x, cy: center.y, r: 3.2 }));
    }
  }
  return group;
}

export function threeItemBelongsToRoom(item, roomId) {
  if (!roomId) return true;
  return item?.roomId === roomId || item?.roomIds?.includes(roomId) === true;
}

export function threeRoomBounds(rooms, fallback = { x: 0, y: 0, width: 1, height: 1 }) {
  const points = rooms.flatMap((room) => room.points ?? []).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (!points.length) return fallback;
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export function threeWallBelongsToRoom(wall, room) {
  if (!room) return true;
  if (wall?.roomId || wall?.roomIds) return threeItemBelongsToRoom(wall, room.id);
  if (wall?.points?.length >= 3) return wall.points.some((point) => pointInPolygon(point, room.points));
  if (!wall?.from || !wall?.to) return false;
  const midpoint = { x: (wall.from.x + wall.to.x) / 2, y: (wall.from.y + wall.to.y) / 2 };
  return [wall.from, midpoint, wall.to].some((point) => pointInPolygon(point, room.points));
}

export function visibleBoxSideIndexes(projectedBase) {
  return projectedBase
    .map((point, index) => ({ index, depth: (point.y + projectedBase[(index + 1) % projectedBase.length].y) / 2 }))
    .sort((a, b) => b.depth - a.depth)
    .slice(0, 2)
    .map((item) => item.index);
}

export function openingVerticalRange(opening) {
  if (!opening?.from || !opening?.to || !Number.isFinite(opening.heightCm) || opening.heightCm <= 0) return null;
  const isWindow = String(opening.kind ?? "").includes("window");
  const bottomCm = isWindow && Number.isFinite(opening.sillHeightCm) ? opening.sillHeightCm : 0;
  return { bottomCm, topCm: bottomCm + opening.heightCm, isWindow };
}

export function featureVerticalRange(feature) {
  return featureSupportRange(feature);
}

function polygonArea(points) {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

export function isCutawayEdge(points, index, quarterTurn = 0) {
  const from = points[index];
  const to = points[(index + 1) % points.length];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const clockwise = polygonArea(points) > 0;
  const outward = clockwise ? { x: dy, y: -dx } : { x: -dy, y: dx };
  const nearDirections = [{ x: 1, y: 1 }, { x: 1, y: -1 }, { x: -1, y: -1 }, { x: -1, y: 1 }];
  const near = nearDirections[((quarterTurn % 4) + 4) % 4];
  return outward.x * near.x + outward.y * near.y > .001;
}

function pointToSegmentDistance(point, from, to) {
  const dx = to.x - from.x; const dy = to.y - from.y;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator ? Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / denominator)) : 0;
  return Math.hypot(point.x - (from.x + dx * ratio), point.y - (from.y + dy * ratio));
}

export function splitWallFace(width, height, cuts) {
  let rectangles = [{ u1: 0, u2: width, z1: 0, z2: height }];
  for (const raw of cuts) {
    const cut = {
      u1: Math.max(0, Math.min(width, Math.min(raw.u1, raw.u2))),
      u2: Math.max(0, Math.min(width, Math.max(raw.u1, raw.u2))),
      z1: Math.max(0, Math.min(height, Math.min(raw.z1, raw.z2))),
      z2: Math.max(0, Math.min(height, Math.max(raw.z1, raw.z2))),
    };
    if (cut.u2 - cut.u1 < .1 || cut.z2 - cut.z1 < .1) continue;
    rectangles = rectangles.flatMap((rectangle) => {
      const u1 = Math.max(rectangle.u1, cut.u1); const u2 = Math.min(rectangle.u2, cut.u2);
      const z1 = Math.max(rectangle.z1, cut.z1); const z2 = Math.min(rectangle.z2, cut.z2);
      if (u2 <= u1 || z2 <= z1) return [rectangle];
      return [
        { u1: rectangle.u1, u2: u1, z1: rectangle.z1, z2: rectangle.z2 },
        { u1: u2, u2: rectangle.u2, z1: rectangle.z1, z2: rectangle.z2 },
        { u1, u2, z1: rectangle.z1, z2: z1 },
        { u1, u2, z1: z2, z2: rectangle.z2 },
      ].filter((item) => item.u2 - item.u1 > .1 && item.z2 - item.z1 > .1);
    });
  }
  return rectangles;
}

export function subdivideWallRectangle(rectangle, maxWidth = 35) {
  const width = rectangle.u2 - rectangle.u1;
  const count = Math.max(1, Math.ceil(width / maxWidth));
  const overlap = Math.min(.2, width / count / 10);
  return Array.from({ length: count }, (_, index) => ({
    ...rectangle,
    u1: rectangle.u1 + width * index / count - (index ? overlap : 0),
    u2: rectangle.u1 + width * (index + 1) / count + (index < count - 1 ? overlap : 0),
    stripIndex: index,
    stripCount: count,
  }));
}

export function subdivideVerticalRange(bottomCm, topCm, maxHeight = 55, overlapCm = .2) {
  const height = topCm - bottomCm;
  const count = Math.max(1, Math.ceil(height / maxHeight));
  const overlap = Math.min(overlapCm, height / count / 10);
  return Array.from({ length: count }, (_, index) => ({
    z1: bottomCm + height * index / count - (index ? overlap : 0),
    z2: bottomCm + height * (index + 1) / count + (index < count - 1 ? overlap : 0),
    rowIndex: index,
    rowCount: count,
  }));
}

export function subdivideWallRectangleTiles(rectangle, maxWidth = 35, maxHeight = 55) {
  return subdivideWallRectangle(rectangle, maxWidth).flatMap((strip) =>
    subdivideVerticalRange(rectangle.z1, rectangle.z2, maxHeight).map((row) => ({ ...strip, ...row })));
}

export function subdivideWallSegment(from, to, maxLength = 35, overlapCm = .2) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const count = Math.max(1, Math.ceil(length / maxLength));
  const pointAt = (ratio) => ({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio });
  const overlapRatio = length ? Math.min(overlapCm, length / count / 10) / length : 0;
  return Array.from({ length: count }, (_, index) => ({
    from: pointAt(index / count - (index ? overlapRatio : 0)),
    to: pointAt((index + 1) / count + (index < count - 1 ? overlapRatio : 0)),
    stripIndex: index,
    stripCount: count,
  }));
}

function openingCutForEdge(opening, room, edgeIndex, wallHeight) {
  const roomIds = opening.roomIds ?? [opening.roomId];
  if (!roomIds.includes(room.id)) return null;
  const range = openingVerticalRange(opening);
  if (!range) return null;
  const from = room.points[edgeIndex]; const to = room.points[(edgeIndex + 1) % room.points.length];
  const dx = to.x - from.x; const dy = to.y - from.y; const length = Math.hypot(dx, dy);
  const openingDx = opening.to.x - opening.from.x; const openingDy = opening.to.y - opening.from.y;
  const openingLength = Math.hypot(openingDx, openingDy);
  if (!length || !openingLength || Math.abs(dx * openingDy - dy * openingDx) / (length * openingLength) > .08) return null;
  const midpoint = { x: (opening.from.x + opening.to.x) / 2, y: (opening.from.y + opening.to.y) / 2 };
  if (pointToSegmentDistance(midpoint, from, to) > 25) return null;
  const position = (point) => ((point.x - from.x) * dx + (point.y - from.y) * dy) / length;
  const u1 = Math.max(0, Math.min(length, Math.min(position(opening.from), position(opening.to))));
  const u2 = Math.max(0, Math.min(length, Math.max(position(opening.from), position(opening.to))));
  if (u2 - u1 < 1) return null;
  return { u1, u2, z1: range.bottomCm, z2: Math.min(wallHeight, range.topCm), opening };
}

function openingIsOnCutawayEdge(opening, rooms, quarterTurn) {
  const roomIds = opening.roomIds ?? [opening.roomId];
  const room = rooms.find((candidate) => roomIds.includes(candidate.id));
  if (!room) return false;
  const midpoint = { x: (opening.from.x + opening.to.x) / 2, y: (opening.from.y + opening.to.y) / 2 };
  let closest = { index: -1, distance: Infinity };
  room.points.forEach((from, index) => {
    const distance = pointToSegmentDistance(midpoint, from, room.points[(index + 1) % room.points.length]);
    if (distance < closest.distance) closest = { index, distance };
  });
  return closest.index >= 0 && isCutawayEdge(room.points, closest.index, quarterTurn);
}

export function renderThreeView(canvas, documentData, options = {}, onSelect = null) {
  canvas.replaceChildren();
  if (!documentData?.plan) return { rendered: false };
  const quarterTurn = options.quarterTurn ?? 0;
  const cutaway = options.cutaway !== false;
  const showLabels = options.showLabels === true;
  const showWalls = threeLayerEnabled("walls", options);
  const showOpenings = threeLayerEnabled("openings", options);
  const showFeatures = threeLayerEnabled("features", options);
  const showFurniture = threeLayerEnabled("furniture", options);
  const { plan } = documentData;
  const selectedRoom = options.roomId ? (plan.rooms ?? []).find((room) => room.id === options.roomId) : null;
  const displayRooms = selectedRoom ? [selectedRoom] : (plan.rooms ?? []);
  const bounds = selectedRoom ? threeRoomBounds(displayRooms, plan.bounds) : plan.bounds;
  const drawableOpenings = (plan.openings ?? [])
    .filter((opening) => threeItemBelongsToRoom(opening, selectedRoom?.id))
    .map((opening) => ({ opening, range: openingVerticalRange(opening) }))
    .filter((item) => item.range);
  const featureItems = (plan.features ?? [])
    .filter((item) => item.kind !== "column" && threeItemBelongsToRoom(item, selectedRoom?.id))
    .map((item) => ({ ...item, depth: item.height, vertical: featureVerticalRange(item), type: "feature" }));
  const furnitureItems = (plan.furniture ?? []).filter((item) => threeItemBelongsToRoom(item, selectedRoom?.id));
  const partitionWalls = (plan.walls ?? []).filter((wall) => (wall.points?.length >= 3 || (wall.from && wall.to)) && threeWallBelongsToRoom(wall, selectedRoom));
  const wallDisplayHeight = Math.max(220, ...drawableOpenings.map((item) => item.range.topCm + 20), ...featureItems.map((item) => item.vertical.topCm + 10));
  const projectedBounds = [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => projectThreePoint(point, bounds, quarterTurn));
  const rawWidth = Math.max(...projectedBounds.map((point) => point.x)) - Math.min(...projectedBounds.map((point) => point.x));
  const rawHeight = Math.max(...projectedBounds.map((point) => point.y)) - Math.min(...projectedBounds.map((point) => point.y)) + wallDisplayHeight * .62;
  const scale = Math.min(760 / rawWidth, 500 / rawHeight);
  const project = (point, z = 0) => {
    const value = projectThreePoint(point, bounds, quarterTurn, z);
    return { x: 450 + value.x * scale, y: 390 + value.y * scale };
  };
  const depthAt = (point, z = 0) => projectThreeDepth(point, bounds, quarterTurn, z);
  const averageDepth = (vertices) => vertices.reduce((sum, vertex) => sum + depthAt(vertex.point, vertex.z), 0) / vertices.length;
  const floorLayer = svg("g", { class: "three-floor-layer" });
  const sceneLayer = svg("g", { class: "three-scene-layer" });
  const labelLayer = svg("g", { class: "three-label-layer" });
  const surfaces = [];
  let kitchenComponentCount = 0;
  let hiddenWallCount = 0;
  const cutOpeningIds = new Set();
  for (const room of displayRooms) {
    floorLayer.append(svg("polygon", { class: "three-floor", points: pointsValue(room.points.map((point) => project(point))), fill: room.color ?? "#e9e4d8" }));
    const labelPoint = project(room.label ?? room.points[0]);
    labelLayer.append(svg("text", { class: "three-room-label", x: labelPoint.x, y: labelPoint.y }, room.name));
    room.points.forEach((from, index) => {
      if (room.nonWallEdges?.includes(index)) return;
      if (cutaway && isCutawayEdge(room.points, index, quarterTurn)) { hiddenWallCount += 1; return; }
      const to = room.points[(index + 1) % room.points.length];
      const length = Math.hypot(to.x - from.x, to.y - from.y);
      if (!length) return;
      const cuts = drawableOpenings.map(({ opening }) => openingCutForEdge(opening, room, index, wallDisplayHeight)).filter(Boolean);
      cuts.forEach((cut) => cutOpeningIds.add(cut.opening.id));
      const pointAt = (u) => ({ x: from.x + (to.x - from.x) * u / length, y: from.y + (to.y - from.y) * u / length });
      for (const rectangle of splitWallFace(length, wallDisplayHeight, cuts).flatMap((item) => subdivideWallRectangleTiles(item))) {
        const pointA = pointAt(rectangle.u1); const pointB = pointAt(rectangle.u2);
        const bottomA = project(pointAt(rectangle.u1), rectangle.z1);
        const bottomB = project(pointAt(rectangle.u2), rectangle.z1);
        const topB = project(pointAt(rectangle.u2), rectangle.z2);
        const topA = project(pointAt(rectangle.u1), rectangle.z2);
        if (showWalls) surfaces.push({
          depth: averageDepth([
            { point: pointA, z: rectangle.z1 }, { point: pointB, z: rectangle.z1 },
            { point: pointB, z: rectangle.z2 }, { point: pointA, z: rectangle.z2 },
          ]),
          order: 0,
          element: wallStripElement([bottomA, bottomB, topB, topA], {
            first: rectangle.stripIndex === 0,
            last: rectangle.stripIndex === rectangle.stripCount - 1,
            bottomEdge: rectangle.rowIndex === 0,
            topEdge: rectangle.rowIndex === rectangle.rowCount - 1,
          }),
        });
      }
    });
  }
  for (const wall of partitionWalls) {
    if (!showWalls) break;
    if (wall.points?.length >= 3) {
      wall.points.forEach((from, index) => {
        const to = wall.points[(index + 1) % wall.points.length];
        for (const segment of subdivideWallSegment(from, to)) {
          for (const row of subdivideVerticalRange(0, wallDisplayHeight)) {
            const bottomA = project(segment.from, row.z1); const bottomB = project(segment.to, row.z1);
            const topA = project(segment.from, row.z2); const topB = project(segment.to, row.z2);
            surfaces.push({
              depth: averageDepth([
                { point: segment.from, z: row.z1 }, { point: segment.to, z: row.z1 },
                { point: segment.to, z: row.z2 }, { point: segment.from, z: row.z2 },
              ]),
              order: .5,
              element: wallStripElement([bottomA, bottomB, topB, topA], {
                first: segment.stripIndex === 0,
                last: segment.stripIndex === segment.stripCount - 1,
                bottomEdge: row.rowIndex === 0,
                topEdge: row.rowIndex === row.rowCount - 1,
                partition: true,
                wallId: wall.id ?? "",
              }),
            });
          }
        }
      });
      const top = wall.points.map((point) => project(point, wallDisplayHeight));
      surfaces.push({
        depth: wall.points.reduce((sum, point) => sum + depthAt(point, wallDisplayHeight), 0) / wall.points.length,
        order: .75,
        element: svg("polygon", { class: "three-wall three-partition-wall three-wall-volume-top", points: pointsValue(top), "data-wall-id": wall.id ?? "" }),
      });
      continue;
    }
    if (!wall.from || !wall.to) continue;
    for (const segment of subdivideWallSegment(wall.from, wall.to)) {
      for (const row of subdivideVerticalRange(0, wallDisplayHeight)) {
        const bottomA = project(segment.from, row.z1); const bottomB = project(segment.to, row.z1);
        const topA = project(segment.from, row.z2); const topB = project(segment.to, row.z2);
        surfaces.push({
          depth: averageDepth([
            { point: segment.from, z: row.z1 }, { point: segment.to, z: row.z1 },
            { point: segment.to, z: row.z2 }, { point: segment.from, z: row.z2 },
          ]),
          order: .5,
          element: wallStripElement([bottomA, bottomB, topB, topA], {
            first: segment.stripIndex === 0,
            last: segment.stripIndex === segment.stripCount - 1,
            bottomEdge: row.rowIndex === 0,
            topEdge: row.rowIndex === row.rowCount - 1,
            partition: true,
            wallId: wall.id ?? "",
          }),
        });
      }
    }
  }
  for (const { opening, range } of drawableOpenings) {
    if (!showOpenings) break;
    if (showWalls && cutaway && openingIsOnCutawayEdge(opening, displayRooms, quarterTurn)) continue;
    const bottomFrom = project(opening.from, range.bottomCm);
    const bottomTo = project(opening.to, range.bottomCm);
    const panel = svg("polygon", {
      class: `three-opening three-opening-${range.isWindow ? "window" : "door"}`,
      points: pointsValue([
        bottomFrom, bottomTo,
        project(opening.to, range.topCm), project(opening.from, range.topCm),
      ]),
      role: "button",
      tabindex: 0,
      "aria-label": `${opening.name}の詳細を表示`,
    });
    const select = () => onSelect?.("opening", opening);
    panel.addEventListener("click", select);
    panel.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) select(); });
    surfaces.push({
      depth: averageDepth([
        { point: opening.from, z: range.bottomCm }, { point: opening.to, z: range.bottomCm },
        { point: opening.to, z: range.topCm }, { point: opening.from, z: range.topCm },
      ]),
      order: 1,
      element: panel,
    });
  }
  const boxes = [
    ...(showFeatures ? featureItems : []),
    ...(showFurniture ? furnitureItems.map((item) => ({ ...item, width: item.widthCm, depth: item.depthCm, vertical: resolveFurnitureVerticalRange(plan, item), type: "furniture" })) : []),
  ].filter((item) => [item.x, item.y, item.width, item.depth].every(Number.isFinite));
  boxes.sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const item of boxes) {
    const base = [{x:item.x,y:item.y},{x:item.x+item.width,y:item.y},{x:item.x+item.width,y:item.y+item.depth},{x:item.x,y:item.y+item.depth}];
    const top = base.map((point) => project(point, item.vertical.topCm));
    const bottom = base.map((point) => project(point, item.vertical.bottomCm));
    const depthBase = base.map((point) => project(point));
    const kindClass = item.kind ? ` three-box-kind-${String(item.kind).replace(/[^a-z0-9-]/gi, "-")}` : "";
    const className = `three-box three-box-${item.type}${kindClass}${item.vertical.schematic ? " is-schematic" : ""}`;
    for (const index of visibleBoxSideIndexes(depthBase)) {
      const next = (index + 1) % bottom.length;
      const side = svg("polygon", {
        class: `${className} three-box-side`,
        points: pointsValue([bottom[index], bottom[next], top[next], top[index]]),
      });
      surfaces.push({
        depth: averageDepth([
          { point: base[index], z: item.vertical.bottomCm }, { point: base[next], z: item.vertical.bottomCm },
          { point: base[next], z: item.vertical.topCm }, { point: base[index], z: item.vertical.topCm },
        ]),
        order: 2,
        element: makeBoxSurfaceInteractive(side, item, onSelect),
      });
    }
    const topDepth = base.reduce((sum, point) => sum + depthAt(point, item.vertical.topCm), 0) / base.length;
    const topSurface = svg("polygon", { class: `${className} three-box-top`, points: pointsValue(top) });
    surfaces.push({ depth: topDepth, order: 3, element: makeBoxSurfaceInteractive(topSurface, item, onSelect, true) });
    if (item.type === "feature" && item.kind === "kitchen") {
      for (const component of buildKitchenComponentRects(item)) {
        const element = kitchenComponentElement(component, item.vertical.topCm + .8, project);
        const componentCenter = { x: component.x + component.width / 2, y: component.y + component.height / 2 };
        surfaces.push({ depth: depthAt(componentCenter, item.vertical.topCm + .8), order: 4, element: makeBoxSurfaceInteractive(element, item, onSelect) });
        kitchenComponentCount += 1;
      }
    }
    if (showLabels) {
      const center = project({ x: item.x + item.width / 2, y: item.y + item.depth / 2 }, item.vertical.topCm + 8);
      labelLayer.append(svg("text", { class: "three-object-label", x: center.x, y: center.y }, item.name));
    }
  }
  surfaces.sort((first, second) => first.depth - second.depth || first.order - second.order);
  sceneLayer.append(...surfaces.map((surface) => surface.element));
  canvas.append(floorLayer, sceneLayer, labelLayer);
  return {
    rendered: true,
    openingCount: drawableOpenings.length,
    cutOpeningCount: cutOpeningIds.size,
    wallDisplayHeight,
    hiddenWallCount,
    partitionWallCount: partitionWalls.length,
    furnitureWithoutHeight: furnitureItems.filter((item) => !Number.isFinite(item.heightCm)).length,
    selectedRoomName: selectedRoom?.name ?? null,
    kitchenComponentCount,
  };
}
