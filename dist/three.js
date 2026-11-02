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

export function renderThreeView(canvas, documentData, quarterTurn = 0) {
  canvas.replaceChildren();
  if (!documentData?.plan) return { rendered: false };
  const { plan } = documentData;
  const bounds = plan.bounds;
  const projectedBounds = [
    { x: bounds.x, y: bounds.y }, { x: bounds.x + bounds.width, y: bounds.y },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height }, { x: bounds.x, y: bounds.y + bounds.height },
  ].map((point) => projectThreePoint(point, bounds, quarterTurn));
  const rawWidth = Math.max(...projectedBounds.map((point) => point.x)) - Math.min(...projectedBounds.map((point) => point.x));
  const rawHeight = Math.max(...projectedBounds.map((point) => point.y)) - Math.min(...projectedBounds.map((point) => point.y)) + 150;
  const scale = Math.min(760 / rawWidth, 500 / rawHeight);
  const project = (point, z = 0) => {
    const value = projectThreePoint(point, bounds, quarterTurn, z);
    return { x: 450 + value.x * scale, y: 390 + value.y * scale };
  };
  const floorLayer = svg("g", { class: "three-floor-layer" });
  const objectLayer = svg("g", { class: "three-object-layer" });
  const wallLayer = svg("g", { class: "three-wall-layer" });
  for (const room of plan.rooms ?? []) {
    floorLayer.append(svg("polygon", { class: "three-floor", points: pointsValue(room.points.map((point) => project(point))), fill: room.color ?? "#e9e4d8" }));
    const labelPoint = project(room.label ?? room.points[0]);
    floorLayer.append(svg("text", { class: "three-room-label", x: labelPoint.x, y: labelPoint.y }, room.name));
    room.points.forEach((from, index) => {
      if (room.nonWallEdges?.includes(index)) return;
      const to = room.points[(index + 1) % room.points.length];
      const bottomA = project(from); const bottomB = project(to);
      const topA = project(from, 95); const topB = project(to, 95);
      wallLayer.append(svg("polygon", { class: "three-wall", points: pointsValue([bottomA, bottomB, topB, topA]) }));
    });
  }
  const boxes = [
    ...(plan.features ?? []).map((item) => ({ ...item, depth: item.height, displayHeight: item.worktopHeightCm ?? 55, type: "feature" })),
    ...(plan.furniture ?? []).map((item) => ({ ...item, width: item.widthCm, depth: item.depthCm, displayHeight: item.heightCm ?? 35, type: "furniture" })),
  ].filter((item) => [item.x, item.y, item.width, item.depth].every(Number.isFinite));
  boxes.sort((a, b) => (a.x + a.y) - (b.x + b.y));
  for (const item of boxes) {
    const base = [{x:item.x,y:item.y},{x:item.x+item.width,y:item.y},{x:item.x+item.width,y:item.y+item.depth},{x:item.x,y:item.y+item.depth}];
    const top = base.map((point) => project(point, item.displayHeight));
    const bottom = base.map((point) => project(point));
    const className = `three-box three-box-${item.type}`;
    for (const index of visibleBoxSideIndexes(bottom)) {
      const next = (index + 1) % bottom.length;
      objectLayer.append(svg("polygon", {
        class: `${className} three-box-side`,
        points: pointsValue([bottom[index], bottom[next], top[next], top[index]]),
      }));
    }
    objectLayer.append(svg("polygon", { class: `${className} three-box-top`, points: pointsValue(top) }));
    const center = project({ x: item.x + item.width / 2, y: item.y + item.depth / 2 }, item.displayHeight + 8);
    objectLayer.append(svg("text", { class: "three-object-label", x: center.x, y: center.y }, item.name));
  }
  canvas.append(floorLayer, wallLayer, objectLayer);
  return { rendered: true, furnitureWithoutHeight: (plan.furniture ?? []).filter((item) => !Number.isFinite(item.heightCm)).length };
}
