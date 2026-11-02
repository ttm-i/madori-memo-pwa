export const FORMAT = "floorplan-pwa/v1";

export const QUALITY_LABELS = {
  measured: "実測",
  derived: "算出",
  approximate: "概算",
  unmeasured: "未測定",
};

export const DIMENSION_GROUP_LABELS = {
  wet: "水回り",
  hall: "玄関・廊下",
  ldk: "LDK",
  bedroom: "洋室",
  balcony: "バルコニー",
  other: "その他",
};

export function getDimensionGroup(dimension) {
  if (dimension.group) return dimension.group;
  const id = dimension.id ?? "";
  if (id === "hall-top" || id.startsWith("hall-left")) return "wet";
  if (id.startsWith("hall-right")) return "hall";
  if (id.startsWith("ldk") || id.startsWith("kitchen") || id.startsWith("counter")) return "ldk";
  if (id.startsWith("bedroom")) return "bedroom";
  if (id.startsWith("balcony")) return "balcony";
  return "other";
}

export function validatePlan(input) {
  if (!input || typeof input !== "object") throw new Error("JSONの内容が空です");
  if (input.format !== FORMAT) throw new Error(`未対応のデータ形式です（${input.format ?? "形式なし"}）`);
  if (!input.plan || typeof input.plan !== "object") throw new Error("planがありません");
  if (!Array.isArray(input.plan.rooms)) throw new Error("roomsが配列ではありません");
  if (!Array.isArray(input.plan.dimensions)) throw new Error("dimensionsが配列ではありません");
  input.plan.walls ??= [];
  input.plan.openings ??= [];
  input.plan.features ??= [];
  input.plan.features = input.plan.features.filter((feature) => feature.kind !== "column");
  input.plan.furniture ??= [];
  for (const room of input.plan.rooms) {
    if (!room.id || !room.name || !Array.isArray(room.points) || room.points.length < 3) {
      throw new Error("部屋データに必須項目がありません");
    }
    for (const point of room.points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error(`${room.name}の座標が不正です`);
    }
  }
  return structuredClone(input);
}

export function findSupportItem(plan, supportId) {
  if (!supportId) return null;
  return (plan?.features ?? []).find((item) => item.kind !== "column" && item.id === supportId)
    ?? (plan?.furniture ?? []).find((item) => item.id === supportId)
    ?? null;
}

export function featureSupportRange(feature) {
  if (feature?.kind === "washer-pan") return { bottomCm: 0, topCm: 4, schematic: true };
  if (Number.isFinite(feature?.bottomHeightCm) && Number.isFinite(feature?.topHeightCm)) {
    return { bottomCm: feature.bottomHeightCm, topCm: feature.topHeightCm, schematic: false };
  }
  if (Number.isFinite(feature?.undersideHeightCm) && Number.isFinite(feature?.derivedTopHeightCm)) {
    return { bottomCm: feature.undersideHeightCm, topCm: feature.derivedTopHeightCm, schematic: false };
  }
  const topCm = feature?.worktopHeightCm ?? feature?.derivedInteriorHeightCm ?? feature?.topHeightCm;
  if (Number.isFinite(topCm)) return { bottomCm: 0, topCm, schematic: false };
  return { bottomCm: 0, topCm: 55, schematic: true };
}

export function buildKitchenComponentRects(feature) {
  const segments = feature?.horizontalSegmentsCm;
  const depths = feature?.depthDetailsCm;
  const required = [feature?.x, feature?.y, feature?.width, segments?.stoveToLeftEdge, segments?.stoveWidth,
    segments?.sinkWidth, segments?.rightEdgeToSink, depths?.stoveDepth, depths?.stoveToWall,
    depths?.sinkDepth, depths?.sinkToWall];
  if (!required.every(Number.isFinite)) return [];
  return [
    {
      kind: "stove",
      label: "コンロ",
      x: feature.x + segments.stoveToLeftEdge,
      y: feature.y + depths.stoveToWall,
      width: segments.stoveWidth,
      height: depths.stoveDepth,
    },
    {
      kind: "sink",
      label: "シンク",
      x: feature.x + feature.width - segments.rightEdgeToSink - segments.sinkWidth,
      y: feature.y + depths.sinkToWall,
      width: segments.sinkWidth,
      height: depths.sinkDepth,
    },
  ];
}

export function resolveFurnitureVerticalRange(plan, furniture, visited = new Set()) {
  const ownHeight = Number.isFinite(furniture?.heightCm) ? furniture.heightCm : 35;
  if (!furniture?.supportId || visited.has(furniture.id)) {
    return { bottomCm: 0, topCm: ownHeight, schematic: !Number.isFinite(furniture?.heightCm), support: null };
  }
  const nextVisited = new Set(visited).add(furniture.id);
  const support = findSupportItem(plan, furniture.supportId);
  if (!support) return { bottomCm: 0, topCm: ownHeight, schematic: true, support: null };
  const supportIsFurniture = Number.isFinite(support.widthCm);
  const supportRange = supportIsFurniture
    ? resolveFurnitureVerticalRange(plan, support, nextVisited)
    : featureSupportRange(support);
  return {
    bottomCm: supportRange.topCm,
    topCm: supportRange.topCm + ownHeight,
    schematic: supportRange.schematic || !Number.isFinite(furniture.heightCm),
    support,
  };
}

export function alignFurnitureToSupport(plan, furniture) {
  const support = findSupportItem(plan, furniture?.supportId);
  if (!support || support.id === furniture.id) return furniture;
  const width = support.widthCm ?? support.width;
  const depth = support.depthCm ?? support.height;
  if (![support.x, support.y, width, depth].every(Number.isFinite)) return furniture;
  const availableX = width - furniture.widthCm;
  const availableY = depth - furniture.depthCm;
  const defaultX = availableX / 2;
  const defaultY = availableY / 2;
  const offsetX = availableX >= 0
    ? Math.max(0, Math.min(availableX, Number.isFinite(furniture.supportOffsetX) ? furniture.supportOffsetX : defaultX))
    : defaultX;
  const offsetY = availableY >= 0
    ? Math.max(0, Math.min(availableY, Number.isFinite(furniture.supportOffsetY) ? furniture.supportOffsetY : defaultY))
    : defaultY;
  furniture.supportOffsetX = offsetX;
  furniture.supportOffsetY = offsetY;
  furniture.x = support.x + offsetX;
  furniture.y = support.y + offsetY;
  if (support.roomId) furniture.roomId = support.roomId;
  return furniture;
}

export function alignSupportedFurniture(plan) {
  const furnitureItems = plan?.furniture ?? [];
  for (let pass = 0; pass < furnitureItems.length; pass += 1) {
    for (const furniture of furnitureItems) alignFurnitureToSupport(plan, furniture);
  }
  return furnitureItems;
}

export function resolveFurnitureElevationPlacement(plan, furniture, visited = new Set()) {
  if (!furniture || visited.has(furniture.id)) return null;
  if (furniture.elevationWallId) {
    return { wallId: furniture.elevationWallId, offsetCm: furniture.elevationOffsetCm ?? 0, widthCm: furniture.elevationWidthCm ?? furniture.widthCm };
  }
  const support = findSupportItem(plan, furniture.supportId);
  if (!support) return null;
  let base = null;
  if (Number.isFinite(support.widthCm)) {
    base = resolveFurnitureElevationPlacement(plan, support, new Set(visited).add(furniture.id));
  } else if (support.elevationWallId) {
    base = { wallId: support.elevationWallId, offsetCm: support.elevationOffsetCm ?? 0, widthCm: support.elevationWidthCm ?? support.internalWidthCm ?? support.overallWidthCm ?? support.width };
  }
  if (!base) return null;
  const widthCm = furniture.elevationWidthCm ?? furniture.widthCm;
  return { wallId: base.wallId, offsetCm: base.offsetCm + (base.widthCm - widthCm) / 2, widthCm };
}

export function countQualities(plan) {
  const items = [
    ...(plan.plan.rooms ?? []),
    ...(plan.plan.dimensions ?? []),
    ...(plan.plan.features ?? []).filter((item) => item.kind !== "column"),
    ...(plan.plan.openings ?? []),
    ...(plan.plan.walls ?? []),
    ...(plan.plan.electrical?.outlets ?? []),
    ...(plan.plan.electrical?.switches ?? []),
  ];
  return {
    measured: items.filter((item) => item.quality === "measured").length,
    uncertain: items.filter((item) => item.uncertain || ["approximate", "unmeasured"].includes(item.quality)).length,
  };
}

function belongsToRoom(item, roomId) {
  return item.roomId === roomId || item.roomIds?.includes(roomId);
}

export function buildElevationItems(documentData, roomId) {
  if (!documentData?.plan || !roomId) return [];
  const items = [];
  const addRange = (id, name, category, bottomCm, topCm, detail = "") => {
    if (![bottomCm, topCm].every(Number.isFinite) || topCm < bottomCm) return;
    items.push({ id, name, category, bottomCm, topCm, detail });
  };
  const addMarker = (id, name, category, heightCm, detail = "") => {
    if (!Number.isFinite(heightCm)) return;
    items.push({ id, name, category, bottomCm: heightCm, topCm: heightCm, detail, marker: true });
  };

  for (const opening of documentData.plan.openings ?? []) {
    if (!belongsToRoom(opening, roomId) || !Number.isFinite(opening.heightCm)) continue;
    const isWindow = String(opening.kind ?? "").includes("window");
    const bottomCm = isWindow ? opening.sillHeightCm ?? 0 : 0;
    addRange(opening.id, opening.name, isWindow ? "window" : "door", bottomCm, bottomCm + opening.heightCm,
      Number.isFinite(opening.widthCm) ? `幅 ${opening.widthCm} cm` : "");
  }

  for (const feature of documentData.plan.features ?? []) {
    if (feature.kind === "column") continue;
    if (!belongsToRoom(feature, roomId)) continue;
    if (Number.isFinite(feature.bottomHeightCm) && Number.isFinite(feature.topHeightCm)) {
      addRange(feature.id, feature.name, "equipment", feature.bottomHeightCm, feature.topHeightCm);
    }
    if (Number.isFinite(feature.derivedInteriorHeightCm)) {
      addRange(feature.id, feature.name, "equipment", 0, feature.derivedInteriorHeightCm,
        Number.isFinite(feature.depthCm) ? `奥行 ${feature.depthCm} cm` : "");
    }
    if (Number.isFinite(feature.shelfUndersideHeightCm)) {
      addMarker(`${feature.id}-shelf`, `${feature.name} 棚下面`, "equipment", feature.shelfUndersideHeightCm);
    }
    if (Number.isFinite(feature.faucetHeightCm)) {
      addMarker(`${feature.id}-faucet`, `${feature.name} 蛇口`, "equipment", feature.faucetHeightCm);
    }
    if (Number.isFinite(feature.worktopHeightCm)) {
      addMarker(`${feature.id}-worktop`, `${feature.name} 天板`, "equipment", feature.worktopHeightCm);
      addMarker(`${feature.id}-cabinet`, `${feature.name} 吊戸棚下面`, "equipment", feature.worktopHeightCm + feature.overheadCabinetClearanceCm);
      addMarker(`${feature.id}-hood`, `${feature.name} レンジフード下面`, "equipment", feature.worktopHeightCm + feature.rangeHoodClearanceCm);
    }
    if (Number.isFinite(feature.undersideHeightCm) && Number.isFinite(feature.derivedTopHeightCm)) {
      addRange(feature.id, feature.name, "equipment", feature.undersideHeightCm, feature.derivedTopHeightCm,
        Number.isFinite(feature.depthCm) ? `奥行 ${feature.depthCm} cm` : "");
    }
  }

  for (const furniture of documentData.plan.furniture ?? []) {
    if (!belongsToRoom(furniture, roomId)) continue;
    const range = resolveFurnitureVerticalRange(documentData.plan, furniture);
    const supportDetail = range.support ? `${range.support.name}の上` : "床置き";
    addRange(furniture.id, furniture.name, "furniture", range.bottomCm, range.topCm, supportDetail);
  }

  for (const outlet of documentData.plan.electrical?.outlets ?? []) {
    if (!belongsToRoom(outlet, roomId)) continue;
    const heightCm = outlet.verticalPosition?.centerHeightCm ?? outlet.verticalPosition?.derivedCenterHeightCm;
    addMarker(outlet.id, outlet.name, "outlet", heightCm, `${outlet.receptacleCount}口・プレート中心`);
  }
  for (const wallSwitch of documentData.plan.electrical?.switches ?? []) {
    if (!belongsToRoom(wallSwitch, roomId)) continue;
    addMarker(wallSwitch.id, wallSwitch.name, "switch", wallSwitch.verticalPosition?.centerHeightCm, "プレート中心");
  }
  return items;
}

function pointDistanceFromSegmentLine(point, wall) {
  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  const length = wall.lengthCm || 1;
  return Math.abs((point.x - wall.from.x) * dy - (point.y - wall.from.y) * dx) / length;
}

function projectOnWall(point, wall) {
  const dx = wall.to.x - wall.from.x;
  const dy = wall.to.y - wall.from.y;
  return ((point.x - wall.from.x) * dx + (point.y - wall.from.y) * dy) / (wall.lengthCm || 1);
}

export function buildRoomWalls(documentData, roomId) {
  const room = documentData?.plan?.rooms?.find((item) => item.id === roomId);
  if (!room?.points?.length) return [];
  const xs = room.points.map((point) => point.x);
  const ys = room.points.map((point) => point.y);
  const bounds = { left: Math.min(...xs), right: Math.max(...xs), top: Math.min(...ys), bottom: Math.max(...ys) };
  const same = (first, second) => Math.abs(first - second) < 0.01;
  const automaticWalls = room.points.map((from, index) => {
    const to = room.points[(index + 1) % room.points.length];
    const horizontal = Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
    const lengthCm = Math.hypot(to.x - from.x, to.y - from.y);
    let baseLabel = horizontal ? "内側の横壁" : "内側の縦壁";
    if (horizontal && same(from.y, bounds.top)) baseLabel = "上側の壁";
    else if (horizontal && same(from.y, bounds.bottom)) baseLabel = "下側の壁";
    else if (!horizontal && same(from.x, bounds.left)) baseLabel = "左側の壁";
    else if (!horizontal && same(from.x, bounds.right)) baseLabel = "右側の壁";
    return { id: `${roomId}-wall-${index}`, roomId, index, from, to, lengthCm, horizontal, baseLabel };
  }).filter((wall) => wall.lengthCm >= 5 && !room.nonWallEdges?.includes(wall.index));
  const totals = automaticWalls.reduce((counts, wall) => counts.set(wall.baseLabel, (counts.get(wall.baseLabel) ?? 0) + 1), new Map());
  const seen = new Map();
  const namedAutomaticWalls = automaticWalls.map((wall) => {
    const sequence = (seen.get(wall.baseLabel) ?? 0) + 1;
    seen.set(wall.baseLabel, sequence);
    return { ...wall, label: totals.get(wall.baseLabel) > 1 ? `${wall.baseLabel} ${sequence}` : wall.baseLabel };
  });
  const hidden = new Set(documentData.plan.hiddenElevationWallIds ?? []);
  const customWalls = (documentData.plan.elevationWalls ?? [])
    .filter((wall) => wall.roomId === roomId)
    .map((wall, index) => ({
      ...wall,
      index: room.points.length + index,
      lengthCm: wall.lengthCm ?? Math.hypot(wall.to.x - wall.from.x, wall.to.y - wall.from.y),
      horizontal: Math.abs(wall.to.x - wall.from.x) >= Math.abs(wall.to.y - wall.from.y),
      baseLabel: wall.label,
    }));
  const combined = [...namedAutomaticWalls.filter((wall) => !hidden.has(wall.id)), ...customWalls];
  const order = documentData.plan.elevationWallOrderByRoom?.[roomId];
  if (!Array.isArray(order)) return combined;
  const rank = new Map(order.map((id, index) => [id, index]));
  return combined.sort((first, second) => (rank.get(first.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(second.id) ?? Number.MAX_SAFE_INTEGER));
}

export function getElectricalPlanPosition(documentData, electrical) {
  if (!electrical) return null;
  const point = electrical.planPoint;
  let anchor = point && [point.x, point.y].every(Number.isFinite) ? { ...point } : null;
  if (!anchor && electrical.roomId && electrical.elevationWallId && Number.isFinite(electrical.elevationCenterCm)) {
    const wall = buildRoomWalls(documentData, electrical.roomId).find((item) => item.id === electrical.elevationWallId);
    if (wall?.lengthCm > 0) {
      const ratio = Math.min(1, Math.max(0, electrical.elevationCenterCm / wall.lengthCm));
      anchor = {
        x: wall.from.x + (wall.to.x - wall.from.x) * ratio,
        y: wall.from.y + (wall.to.y - wall.from.y) * ratio,
      };
    }
  }
  if (!anchor) return null;
  const offset = electrical.planDisplayOffset ?? {};
  return {
    anchor,
    display: {
      x: anchor.x + (Number.isFinite(offset.x) ? offset.x : 0),
      y: anchor.y + (Number.isFinite(offset.y) ? offset.y : 0),
    },
  };
}

export function buildWallDiagram(documentData, roomId, wallId) {
  const wall = buildRoomWalls(documentData, roomId).find((item) => item.id === wallId);
  if (!wall) return null;
  const items = [];
  for (const opening of documentData.plan.openings ?? []) {
    if (!belongsToRoom(opening, roomId) || !opening.from || !opening.to || !Number.isFinite(opening.heightCm)) continue;
    if (pointDistanceFromSegmentLine(opening.from, wall) > 12 || pointDistanceFromSegmentLine(opening.to, wall) > 12) continue;
    const first = projectOnWall(opening.from, wall);
    const second = projectOnWall(opening.to, wall);
    const offsetCm = Math.min(first, second);
    const widthCm = Math.abs(second - first);
    if (offsetCm < -12 || offsetCm + widthCm > wall.lengthCm + 12 || widthCm < 1) continue;
    const isWindow = String(opening.kind ?? "").includes("window");
    const bottomCm = isWindow ? opening.sillHeightCm ?? 0 : 0;
    items.push({
      id: opening.id,
      name: opening.name,
      category: isWindow ? "window" : "door",
      offsetCm: Math.max(0, offsetCm),
      widthCm: Math.min(widthCm, wall.lengthCm),
      bottomCm,
      topCm: bottomCm + opening.heightCm,
      detail: `幅 ${opening.widthCm ?? Math.round(widthCm * 10) / 10} cm`,
    });
  }

  const verticalItems = buildElevationItems(documentData, roomId);
  for (const feature of documentData.plan.features ?? []) {
    if (feature.elevationWallId !== wall.id) continue;
    const related = verticalItems.filter((item) => item.id === feature.id || item.id.startsWith(`${feature.id}-`));
    for (const item of related) {
      items.push({
        ...item,
        offsetCm: feature.elevationOffsetCm ?? 0,
        widthCm: feature.elevationWidthCm ?? feature.internalWidthCm ?? feature.overallWidthCm ?? feature.width ?? 20,
      });
    }
  }
  for (const furniture of documentData.plan.furniture ?? []) {
    const placement = resolveFurnitureElevationPlacement(documentData.plan, furniture);
    if (placement?.wallId !== wall.id) continue;
    const related = verticalItems.find((item) => item.id === furniture.id);
    if (related) items.push({ ...related, offsetCm: placement.offsetCm, widthCm: placement.widthCm });
  }
  const electricalItems = [
    ...(documentData.plan.electrical?.outlets ?? []),
    ...(documentData.plan.electrical?.switches ?? []),
  ];
  for (const electrical of electricalItems) {
    if (electrical.elevationWallId !== wall.id) continue;
    const related = verticalItems.find((item) => item.id === electrical.id);
    if (!related) continue;
    const widthCm = electrical.elevationWidthCm ?? 8;
    const offsetCm = electrical.elevationCenterCm != null
      ? electrical.elevationCenterCm - widthCm / 2
      : electrical.elevationOffsetCm ?? 0;
    items.push({ ...related, offsetCm, widthCm });
  }
  return { ...wall, items };
}

export function wallDisplayWidth(lengthCm, referenceLengthCm, maximumWidth = 840) {
  if (![lengthCm, referenceLengthCm, maximumWidth].every(Number.isFinite) || lengthCm < 0 || referenceLengthCm <= 0 || maximumWidth <= 0) return 0;
  return lengthCm / referenceLengthCm * maximumWidth;
}

export function rotateFurniture(furniture) {
  const centerX = furniture.x + furniture.widthCm / 2;
  const centerY = furniture.y + furniture.depthCm / 2;
  [furniture.widthCm, furniture.depthCm] = [furniture.depthCm, furniture.widthCm];
  furniture.x = centerX - furniture.widthCm / 2;
  furniture.y = centerY - furniture.depthCm / 2;
  return furniture;
}

export function duplicateFurniture(furniture, id) {
  return {
    ...structuredClone(furniture),
    id,
    name: `${furniture.name} コピー`,
    x: furniture.x + 15,
    y: furniture.y + 15,
  };
}

export function updateFurniture(furniture, values) {
  const centerX = furniture.x + furniture.widthCm / 2;
  const centerY = furniture.y + furniture.depthCm / 2;
  furniture.name = values.name;
  furniture.roomId = values.roomId;
  furniture.widthCm = values.widthCm;
  furniture.depthCm = values.depthCm;
  if (Number.isFinite(values.heightCm)) furniture.heightCm = values.heightCm;
  else delete furniture.heightCm;
  const supportChanged = furniture.supportId !== values.supportId;
  if (values.supportId) furniture.supportId = values.supportId;
  else delete furniture.supportId;
  if (supportChanged || !values.supportId) {
    delete furniture.supportOffsetX;
    delete furniture.supportOffsetY;
  }
  furniture.x = centerX - furniture.widthCm / 2;
  furniture.y = centerY - furniture.depthCm / 2;
  return furniture;
}

export function fitsRectangle(sides, widthCm, heightCm) {
  if (!Array.isArray(sides) || sides.length !== 3 || !sides.every((value) => Number.isFinite(value) && value > 0)
    || !Number.isFinite(widthCm) || !Number.isFinite(heightCm)) return null;
  for (let first = 0; first < sides.length; first += 1) {
    for (let second = first + 1; second < sides.length; second += 1) {
      if ((sides[first] <= widthCm && sides[second] <= heightCm)
        || (sides[second] <= widthCm && sides[first] <= heightCm)) return true;
    }
  }
  return false;
}

export function findDeliveryDoorPath(documentData, destinationRoomId) {
  const route = documentData?.plan?.accessRoute;
  const startRoomId = route?.entryRoomId ?? "hall";
  if (!destinationRoomId || destinationRoomId === startRoomId) return [];
  const doors = (documentData?.plan?.openings ?? []).filter((opening) => String(opening.kind ?? "").includes("door") && opening.roomIds?.length === 2);
  const queue = [{ roomId: startRoomId, path: [] }];
  const visited = new Set([startRoomId]);
  while (queue.length) {
    const current = queue.shift();
    for (const door of doors) {
      if (!door.roomIds.includes(current.roomId)) continue;
      const nextRoomId = door.roomIds.find((roomId) => roomId !== current.roomId);
      if (!nextRoomId || visited.has(nextRoomId)) continue;
      const path = [...current.path, door];
      if (nextRoomId === destinationRoomId) return path;
      visited.add(nextRoomId);
      queue.push({ roomId: nextRoomId, path });
    }
  }
  return null;
}

export function analyzeDeliveryRoute(furniture, documentData) {
  const route = documentData?.plan?.accessRoute;
  const dimensions = furniture?.deliveryDimensions;
  const sides = [dimensions?.sideACm, dimensions?.sideBCm, dimensions?.sideCCm];
  if (!route || !sides.every((value) => Number.isFinite(value) && value > 0)) {
    return { status: "missing", sides: null, checks: [], limitations: route?.limitations ?? [] };
  }
  const checks = [];
  const addCheck = (id, label, result, detail) => checks.push({ id, label, status: result == null ? "unknown" : result ? "pass" : "review", detail });
  const corridorWidth = route.commonCorridor?.widthCm;
  addCheck("corridor", "共用廊下", Number.isFinite(corridorWidth) ? Math.min(...sides) <= corridorWidth : null,
    Number.isFinite(corridorWidth) ? `幅 ${corridorWidth} cm（曲がり角は未判定）` : "幅未登録");
  const elevator = route.elevator ?? {};
  addCheck("elevator-opening", "エレベーター入口", fitsRectangle(sides, elevator.openingWidthCm, elevator.openingHeightCm),
    Number.isFinite(elevator.openingWidthCm) && Number.isFinite(elevator.openingHeightCm) ? `${elevator.openingWidthCm} × ${elevator.openingHeightCm} cm` : "寸法未登録");
  addCheck("elevator-cabin", "エレベーター庫内", fitsRectangle(sides, elevator.cabinWidthCm, elevator.cabinDepthCm),
    Number.isFinite(elevator.cabinWidthCm) && Number.isFinite(elevator.cabinDepthCm) ? `床面 ${elevator.cabinWidthCm} × ${elevator.cabinDepthCm} cm（庫内高さは未測定）` : "寸法未登録");
  const entranceOpening = documentData.plan.openings?.find((opening) => opening.id === route.dwellingEntranceOpeningId);
  const entranceWidth = route.dwellingEntrance?.openingWidthCm ?? entranceOpening?.clearOpeningWidthCm ?? entranceOpening?.widthCm;
  const entranceHeight = route.dwellingEntrance?.openingHeightCm ?? entranceOpening?.heightCm;
  addCheck("entrance", "住戸玄関", fitsRectangle(sides, entranceWidth, entranceHeight),
    Number.isFinite(entranceWidth) && Number.isFinite(entranceHeight) ? `${entranceWidth} × ${entranceHeight} cm` : "寸法未登録");
  const doorPath = findDeliveryDoorPath(documentData, furniture.roomId);
  if (doorPath == null) {
    addCheck("internal-route", "室内経路", null, "玄関・廊下から設置先までのドア経路を特定できません");
  } else {
    for (const door of doorPath) {
      const clearWidth = door.clearOpeningWidthCm ?? door.widthCm;
      addCheck(`internal-${door.id}`, door.name, fitsRectangle(sides, clearWidth, door.heightCm),
        Number.isFinite(clearWidth) && Number.isFinite(door.heightCm) ? `${clearWidth} × ${door.heightCm} cm（有効幅 × 開口高さ）` : "寸法未登録");
    }
  }
  return {
    status: checks.every((check) => check.status === "pass") ? "candidate" : "review",
    sides,
    checks,
    limitations: route.limitations ?? [],
  };
}

export function snapToGrid(value, gridCm = 5) {
  return Math.round(value / gridCm) * gridCm;
}

export function moveDimensionGuide(dimension, offsetCm) {
  const horizontal = Math.abs(dimension.to.x - dimension.from.x) >= Math.abs(dimension.to.y - dimension.from.y);
  if (horizontal) {
    dimension.from.y += offsetCm;
    dimension.to.y += offsetCm;
  } else {
    dimension.from.x += offsetCm;
    dimension.to.x += offsetCm;
  }
  return dimension;
}

function pointOnSegment(point, a, b, epsilon = 0.001) {
  const cross = (point.y - a.y) * (b.x - a.x) - (point.x - a.x) * (b.y - a.y);
  if (Math.abs(cross) > epsilon) return false;
  return point.x >= Math.min(a.x, b.x) - epsilon && point.x <= Math.max(a.x, b.x) + epsilon
    && point.y >= Math.min(a.y, b.y) - epsilon && point.y <= Math.max(a.y, b.y) + epsilon;
}

export function pointInPolygon(point, points) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index++) {
    const a = points[previous];
    const b = points[index];
    if (pointOnSegment(point, a, b)) return true;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function analyzeFurniturePlacement(furniture, room) {
  if (!room?.points?.length) return { inside: false, clearances: null, boundaries: null };
  const left = furniture.x;
  const right = furniture.x + furniture.widthCm;
  const top = furniture.y;
  const bottom = furniture.y + furniture.depthCm;
  const centerX = (left + right) / 2;
  const centerY = (top + bottom) / 2;
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  const inside = corners.every((corner) => pointInPolygon(corner, room.points));
  const xs = [];
  const ys = [];
  for (let index = 0; index < room.points.length; index += 1) {
    const a = room.points[index];
    const b = room.points[(index + 1) % room.points.length];
    if (Math.abs(a.x - b.x) < 0.001 && centerY >= Math.min(a.y, b.y) && centerY <= Math.max(a.y, b.y)) xs.push(a.x);
    if (Math.abs(a.y - b.y) < 0.001 && centerX >= Math.min(a.x, b.x) && centerX <= Math.max(a.x, b.x)) ys.push(a.y);
  }
  const boundaries = {
    left: xs.filter((value) => value <= left).sort((a, b) => b - a)[0] ?? null,
    right: xs.filter((value) => value >= right).sort((a, b) => a - b)[0] ?? null,
    top: ys.filter((value) => value <= top).sort((a, b) => b - a)[0] ?? null,
    bottom: ys.filter((value) => value >= bottom).sort((a, b) => a - b)[0] ?? null,
  };
  const clearances = inside ? {
    left: boundaries.left == null ? null : left - boundaries.left,
    right: boundaries.right == null ? null : boundaries.right - right,
    top: boundaries.top == null ? null : top - boundaries.top,
    bottom: boundaries.bottom == null ? null : boundaries.bottom - bottom,
  } : null;
  return { inside, clearances, boundaries };
}

export function rectanglesOverlap(first, second, epsilon = 0.001) {
  const firstRight = first.x + (first.widthCm ?? first.width);
  const firstBottom = first.y + (first.depthCm ?? first.height);
  const secondRight = second.x + (second.widthCm ?? second.width);
  const secondBottom = second.y + (second.depthCm ?? second.height);
  return first.x < secondRight - epsilon && firstRight > second.x + epsilon
    && first.y < secondBottom - epsilon && firstBottom > second.y + epsilon;
}

export function rectangleIntersectsPolygon(rectangle, points, epsilon = 0.001) {
  if (!Array.isArray(points) || points.length < 3) return false;
  const left = rectangle.x + epsilon;
  const right = rectangle.x + (rectangle.widthCm ?? rectangle.width) - epsilon;
  const top = rectangle.y + epsilon;
  const bottom = rectangle.y + (rectangle.depthCm ?? rectangle.height) - epsilon;
  if (!(right > left && bottom > top)) return false;
  const corners = [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
  if (corners.some((corner) => pointInPolygon(corner, points))) return true;
  if (points.some((point) => point.x > left && point.x < right && point.y > top && point.y < bottom)) return true;
  const rectangleEdges = corners.map((point, index) => [point, corners[(index + 1) % corners.length]]);
  const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const crosses = (a, b, c, d) => orientation(a, b, c) * orientation(a, b, d) < -epsilon
    && orientation(c, d, a) * orientation(c, d, b) < -epsilon;
  return points.some((from, index) => {
    const to = points[(index + 1) % points.length];
    return rectangleEdges.some(([a, b]) => crosses(from, to, a, b));
  });
}

function wallBounds(wall) {
  const thickness = wall.thicknessCm ?? 10;
  return {
    x: Math.min(wall.from.x, wall.to.x) - thickness / 2,
    y: Math.min(wall.from.y, wall.to.y) - thickness / 2,
    width: Math.abs(wall.to.x - wall.from.x) + thickness,
    height: Math.abs(wall.to.y - wall.from.y) + thickness,
  };
}

export function analyzeFurnitureConflicts(furniture, plan) {
  const conflicts = [];
  const furnitureRange = resolveFurnitureVerticalRange(plan, furniture);
  const overlapsVertically = (range) => furnitureRange.bottomCm < range.topCm - .001 && furnitureRange.topCm > range.bottomCm + .001;
  for (const other of plan.furniture ?? []) {
    if (other.id !== furniture.id && overlapsVertically(resolveFurnitureVerticalRange(plan, other)) && rectanglesOverlap(furniture, other)) conflicts.push({ type: "furniture", id: other.id, name: other.name });
  }
  for (const feature of plan.features ?? []) {
    if (feature.kind === "column") continue;
    if (overlapsVertically(featureSupportRange(feature)) && rectanglesOverlap(furniture, feature)) conflicts.push({ type: "feature", id: feature.id, name: feature.name });
  }
  for (const wall of plan.walls ?? []) {
    const overlaps = wall.points?.length >= 3
      ? rectangleIntersectsPolygon(furniture, wall.points)
      : wall.from && wall.to && rectanglesOverlap(furniture, wallBounds(wall));
    if (overlaps) conflicts.push({ type: "wall", id: wall.id, name: wall.name });
  }
  return conflicts;
}

export function createSamplePlan() {
  return {
    format: FORMAT,
    meta: {
      title: "架空サンプル住戸",
      units: "cm",
      private: false,
      sampleVersion: 3,
      updatedAt: new Date().toISOString(),
      note: "操作確認用の架空データです。実在の住戸ではありません。",
    },
    plan: {
      bounds: { x: 0, y: 0, width: 620, height: 880 },
      rooms: [
        { id: "sample-ldk", name: "LDK", color: "#f1dfad", points: [{x:60,y:60},{x:560,y:60},{x:560,y:430},{x:330,y:430},{x:330,y:520},{x:60,y:520}], label: {x:300,y:280}, areaLabel: "12.0帖" },
        { id: "sample-room", name: "洋室", color: "#eadfea", points: [{x:60,y:540},{x:560,y:540},{x:560,y:820},{x:60,y:820}], label: {x:310,y:680}, areaLabel: "6.0帖" },
      ],
      openings: [
        { id: "sample-window", name: "掃き出し窓", kind: "window", roomId: "sample-room", from: {x:350,y:820}, to: {x:520,y:820}, widthCm: 170, heightCm: 180, sillHeightCm: 0, quality: "measured" },
        { id: "sample-door", name: "洋室引き戸", kind: "door", roomIds: ["sample-ldk", "sample-room"], from: {x:180,y:530}, to: {x:320,y:530}, widthCm: 140, heightCm: 200, quality: "measured" },
      ],
      features: [
        { id: "sample-closet", name: "収納（仮）", kind: "closet", roomId: "sample-ldk", elevationWallId: "sample-ldk-wall-0", elevationOffsetCm: 360, elevationWidthCm: 140, x:420, y:80, width:140, height:70, derivedInteriorHeightCm: 220, shelfUndersideHeightCm: 165, quality: "approximate", placementQuality: "approximate", uncertain: true },
        { id: "sample-kitchen", name: "サンプルキッチン", kind: "kitchen", roomId: "sample-ldk", x:70, y:450, width:200, height:55, overallWidthCm:200, overallDepthCm:55, worktopHeightCm:85, horizontalSegmentsCm:{stoveToLeftEdge:10,stoveWidth:50,sinkToStove:40,sinkWidth:80,rightEdgeToSink:20,total:200}, depthDetailsCm:{stoveDepth:45,stoveToWall:3,sinkDepth:44,sinkToWall:4}, quality:"measured", placementQuality:"confirmed" },
      ],
      accessRoute: {
        purpose: "delivery-feasibility",
        entryRoomId: "sample-ldk",
        commonCorridor: { widthCm: 125, quality: "measured" },
        elevator: { openingWidthCm: 85, openingHeightCm: 200, cabinWidthCm: 100, cabinDepthCm: 150, quality: "measured" },
        dwellingEntrance: { openingWidthCm: 90, openingHeightCm: 195, quality: "measured" },
        limitations: ["曲がり角とエレベーター前の余地は未測定", "数値上の比較であり搬入可否を保証しない"],
      },
      walls: [],
      electrical: {
        measurementPoint: "plate-center",
        outlets: [
          { id: "sample-outlet", sourceLabel: "①", roomId: "sample-ldk", name: "サンプルコンセント", receptacleCount: 2, mountingSurface: "wall", elevationWallId: "sample-ldk-wall-1", elevationCenterCm: 90, elevationWidthCm: 8, planDisplayOffset: { x: -16, y: 0 }, horizontalPosition: { reference: "wall-start", offsetCm: 90 }, verticalPosition: { reference: "floor", centerHeightCm: 25 }, quality: "measured" },
        ],
        switches: [
          { id: "sample-switch", sourceLabel: "A", roomId: "sample-ldk", name: "サンプルスイッチ", mountingSurface: "wall", elevationWallId: "sample-ldk-wall-1", elevationCenterCm: 130, elevationWidthCm: 8, planDisplayOffset: { x: -16, y: 0 }, horizontalPosition: { reference: "wall-start", offsetCm: 130 }, verticalPosition: { reference: "floor", centerHeightCm: 120 }, quality: "measured" },
        ],
        omittedFromDrawing: [],
      },
      furniture: [
        { id:"sample-sofa", name:"サンプルソファ", roomId:"sample-room", x:250, y:630, widthCm:180, depthCm:85, deliveryDimensions:{sideACm:80,sideBCm:45,sideCCm:190,basis:"packed"}, quality:"measured" },
      ],
      dimensions: [
        { id: "sample-d1", label: "500", valueCm: 500, from: {x:60,y:35}, to: {x:560,y:35}, offset: 0, quality: "measured" },
        { id: "sample-d2", label: "280（仮）", valueCm: 280, from: {x:590,y:540}, to: {x:590,y:820}, offset: 0, quality: "approximate", uncertain: true },
      ],
    },
  };
}

