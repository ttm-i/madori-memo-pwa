import { featureSupportRange, resolveFurnitureVerticalRange } from "./model.js?v=50";

const NS = "http://www.w3.org/2000/svg";

function svg(name, attributes = {}, text = "") {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}

export function projectThreePoint(point, bounds, quarterTurn = 0, z = 0) {
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;
  let x = point.x - cx;
  let y = point.y - cy;
  for (let index = 0; index < ((quarterTurn % 4) + 4) % 4; index += 1) [x, y] = [-y, x];
  return { x: (x - y) * .72, y: (x + y) * .36 - z * .62 };
}

function pointsValue(points) { return points.map((point) => `${point.x},${point.y}`).join(" "); }

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

export function renderThreeView(canvas, documentData, options = {}, onOpeningSelect = null) {
  canvas.replaceChildren();
  if (!documentData?.plan) return { rendered: false };
  const quarterTurn = options.quarterTurn ?? 0;
  const cutaway = options.cutaway !== false;
  const showLabels = options.showLabels === true;
  const { plan } = documentData;
  const bounds = plan.bounds;
  const drawableOpenings = (plan.openings ?? []).map((opening) => ({ opening, range: openingVerticalRange(opening) })).filter((item) => item.range);
  const featureItems = (plan.features ?? []).filter((item) => item.kind !== "column").map((item) => ({ ...item, depth: item.height, vertical: featureVerticalRange(item), type: "feature" }));
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
  const floorLayer = svg("g", { class: "three-floor-layer" });
  const sceneLayer = svg("g", { class: "three-scene-layer" });
  const labelLayer = svg("g", { class: "three-label-layer" });
  const surfaces = [];
  let hiddenWallCount = 0;
  const cutOpeningIds = new Set();
  for (const room of plan.rooms ?? []) {
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
      for (const rectangle of splitWallFace(length, wallDisplayHeight, cuts)) {
        const bottomA = project(pointAt(rectangle.u1), rectangle.z1);
        const bottomB = project(pointAt(rectangle.u2), rectangle.z1);
        const topB = project(pointAt(rectangle.u2), rectangle.z2);
        const topA = project(pointAt(rectangle.u1), rectangle.z2);
        const depthA = project(pointAt(rectangle.u1)).y; const depthB = project(pointAt(rectangle.u2)).y;
        surfaces.push({ depth: (depthA + depthB) / 2, order: 0, element: svg("polygon", { class: "three-wall", points: pointsValue([bottomA, bottomB, topB, topA]) }) });
      }
    });
  }
  for (const wall of plan.walls ?? []) {
    if (!wall.from || !wall.to) continue;
    const bottomA = project(wall.from); const bottomB = project(wall.to);
    const topA = project(wall.from, wallDisplayHeight); const topB = project(wall.to, wallDisplayHeight);
    surfaces.push({
      depth: (bottomA.y + bottomB.y) / 2,
      order: .5,
      element: svg("polygon", {
        class: "three-wall three-partition-wall",
        points: pointsValue([bottomA, bottomB, topB, topA]),
        "data-wall-id": wall.id ?? "",
      }),
    });
  }
  for (const { opening, range } of drawableOpenings) {
    if (cutaway && openingIsOnCutawayEdge(opening, plan.rooms ?? [], quarterTurn)) continue;
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
    const select = () => onOpeningSelect?.(opening);
    panel.addEventListener("click", select);
    panel.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) select(); });
    surfaces.push({ depth: (bottomFrom.y + bottomTo.y) / 2, order: 1, element: panel });
  }
  const boxes = [
    ...featureItems,
    ...(plan.furniture ?? []).map((item) => ({ ...item, width: item.widthCm, depth: item.depthCm, vertical: resolveFurnitureVerticalRange(plan, item), type: "furniture" })),
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
      surfaces.push({ depth: (depthBase[index].y + depthBase[next].y) / 2, order: 2, element: svg("polygon", {
        class: `${className} three-box-side`,
        points: pointsValue([bottom[index], bottom[next], top[next], top[index]]),
      }) });
    }
    const baseDepth = depthBase.reduce((sum, point) => sum + point.y, 0) / depthBase.length;
    surfaces.push({ depth: baseDepth, order: 3, element: svg("polygon", { class: `${className} three-box-top`, points: pointsValue(top) }) });
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
    partitionWallCount: (plan.walls ?? []).filter((wall) => wall.from && wall.to).length,
    furnitureWithoutHeight: (plan.furniture ?? []).filter((item) => !Number.isFinite(item.heightCm)).length,
  };
}
