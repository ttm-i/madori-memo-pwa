import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alignFurnitureToSupport, analyzeDeliveryRoute, analyzeFurnitureConflicts, analyzeFurniturePlacement, buildElevationItems, buildKitchenComponentRects, buildRoomWalls, buildWallDiagram, countQualities, createSamplePlan, duplicateFurniture, findDeliveryDoorPath, fitsRectangle, FORMAT, getDimensionGroup, getElectricalPlanPosition, moveDimensionGuide, pointInPolygon, rectangleIntersectsPolygon, rectanglesOverlap, resolveFurnitureElevationPlacement, resolveFurnitureVerticalRange, rotateFurniture, snapToGrid, updateFurniture, validatePlan, wallDisplayWidth } from "../dist/model.js";
import { detailMarkup, gestureExceedsTapThreshold, measurementMetrics, PlanRenderer, snapMeasurementPoint, zoomTransformAround } from "../dist/renderer.js";
import { featureVerticalRange, isCutawayEdge, openingVerticalRange, projectThreeDepth, projectThreePoint, splitWallFace, subdivideVerticalRange, subdivideWallRectangle, subdivideWallRectangleTiles, subdivideWallSegment, threeItemBelongsToRoom, threeLayerEnabled, threeRoomBounds, threeSelectableType, threeViewportBox, threeWallBelongsToRoom, visibleBoxSideIndexes } from "../dist/three.js";

test("sample plan conforms to the public schema", () => {
  const sample = createSamplePlan();
  assert.equal(sample.format, FORMAT);
  assert.doesNotThrow(() => validatePlan(sample));
  assert.equal(sample.plan.rooms.length, 2);
});

test("invalid coordinates are rejected", () => {
  const sample = createSamplePlan();
  sample.plan.rooms[0].points[0].x = "not-a-number";
  assert.throws(() => validatePlan(sample), /座標が不正/);
});

test("structural columns represented by the room outline are removed from equipment", () => {
  const sample = createSamplePlan();
  sample.plan.features.push({ id: "structural-column", name: "柱型", kind: "column", roomId: "sample-room", x: 0, y: 0, width: 20, height: 20 });
  const validated = validatePlan(sample);
  assert.equal(validated.plan.features.some((feature) => feature.kind === "column"), false);
});

test("quality counts include uncertain room geometry", () => {
  const sample = createSamplePlan();
  sample.plan.rooms[0].uncertain = true;
  const counts = countQualities(sample);
  assert.equal(counts.measured, 6);
  assert.equal(counts.uncertain, 3);
});

test("wall elevation items preserve measured heights without inventing a ceiling", () => {
  const sample = createSamplePlan();
  const items = buildElevationItems(sample, "sample-room");
  assert.deepEqual(items.map(({ name, bottomCm, topCm }) => ({ name, bottomCm, topCm })), [
    { name: "掃き出し窓", bottomCm: 0, topCm: 180 },
    { name: "洋室引き戸", bottomCm: 0, topCm: 200 },
    { name: "サンプルソファ", bottomCm: 0, topCm: 35 },
  ]);
  assert.equal(items.some((item) => item.name.includes("天井")), false);
});

test("room walls retain plan direction and place openings at measured horizontal offsets", () => {
  const sample = createSamplePlan();
  const walls = buildRoomWalls(sample, "sample-room");
  assert.deepEqual(walls.map(({ id, label, lengthCm }) => ({ id, label, lengthCm })), [
    { id: "sample-room-wall-0", label: "上側の壁", lengthCm: 500 },
    { id: "sample-room-wall-1", label: "右側の壁", lengthCm: 280 },
    { id: "sample-room-wall-2", label: "下側の壁", lengthCm: 500 },
    { id: "sample-room-wall-3", label: "左側の壁", lengthCm: 280 },
  ]);
  const top = buildWallDiagram(sample, "sample-room", "sample-room-wall-0");
  const bottom = buildWallDiagram(sample, "sample-room", "sample-room-wall-2");
  assert.deepEqual(top.items.map(({ name, offsetCm, widthCm, topCm }) => ({ name, offsetCm, widthCm, topCm })), [
    { name: "洋室引き戸", offsetCm: 120, widthCm: 140, topCm: 200 },
  ]);
  assert.deepEqual(bottom.items.map(({ name, offsetCm, widthCm, topCm }) => ({ name, offsetCm, widthCm, topCm })), [
    { name: "掃き出し窓", offsetCm: 40, widthCm: 170, topCm: 180 },
  ]);
});

test("wall elevations use a common room scale instead of stretching every wall", () => {
  assert.equal(wallDisplayWidth(500, 500), 840);
  assert.equal(wallDisplayWidth(280, 500), 470.40000000000003);
  assert.equal(wallDisplayWidth(90, 500), 151.2);
});

test("electrical markers share wall coordinates between plan and elevation", () => {
  const sample = createSamplePlan();
  const outlet = sample.plan.electrical.outlets[0];
  const position = getElectricalPlanPosition(sample, outlet);
  assert.deepEqual(position, {
    anchor: { x: 560, y: 150 },
    display: { x: 544, y: 150 },
  });
  const diagram = buildWallDiagram(sample, "sample-ldk", "sample-ldk-wall-1");
  assert(diagram.items.some((item) => item.id === "sample-outlet" && item.offsetCm === 86 && item.widthCm === 8 && item.topCm === 25));
  assert(diagram.items.some((item) => item.id === "sample-switch" && item.offsetCm === 126 && item.widthCm === 8 && item.topCm === 120));
});

test("electrical detail uses outlet-specific fields", () => {
  const sample = createSamplePlan();
  const markup = detailMarkup("outlet", { ...sample.plan.electrical.outlets[0], roomName: "LDK" });
  assert.match(markup, /コンセント/);
  assert.match(markup, /2口/);
  assert.match(markup, /床から 25 cm/);
  assert.match(markup, /プレート中心/);
});

test("feature detail separates dimension quality from placement quality", () => {
  const markup = detailMarkup("feature", {
    name: "収納",
    widthCm: 120,
    quality: "measured",
    placementQuality: "approximate",
  });
  assert.match(markup, /寸法: 実測/);
  assert.match(markup, /配置: 要確認/);
});

test("kitchen components are positioned from the measured edge segments", () => {
  const kitchen = {
    x: 10, y: 20, width: 200, kind: "kitchen",
    horizontalSegmentsCm: { stoveToLeftEdge: 10, stoveWidth: 50, sinkToStove: 40, sinkWidth: 80, rightEdgeToSink: 20 },
    depthDetailsCm: { stoveDepth: 45, stoveToWall: 3, sinkDepth: 44, sinkToWall: 4 },
  };
  assert.deepEqual(buildKitchenComponentRects(kitchen), [
    { kind: "stove", label: "コンロ", x: 20, y: 23, width: 50, height: 45 },
    { kind: "sink", label: "シンク", x: 110, y: 24, width: 80, height: 44 },
  ]);
  const markup = detailMarkup("feature", { ...kitchen, overallWidthCm: 200, overallDepthCm: 60, worktopHeightCm: 85, quality: "measured", placementQuality: "confirmed" });
  assert.match(markup, /キッチン全体/);
  assert.match(markup, /シンク/);
  assert.match(markup, /コンロ/);
});

test("delivery checks consider every orientation without promising access", () => {
  assert.equal(fitsRectangle([80, 45, 190], 85, 200), true);
  assert.equal(fitsRectangle([210, 220, 230], 85, 200), false);
  const sample = createSamplePlan();
  const sofa = sample.plan.furniture[0];
  assert.deepEqual(findDeliveryDoorPath(sample, "sample-room").map((door) => door.id), ["sample-door"]);
  const candidate = analyzeDeliveryRoute(sofa, sample);
  assert.equal(candidate.status, "candidate");
  assert.equal(candidate.checks.length, 5);
  assert(candidate.checks.some((check) => check.id === "internal-sample-door"));
  assert(candidate.checks.every((check) => check.status === "pass"));
  const oversized = { ...sofa, deliveryDimensions: { sideACm: 210, sideBCm: 220, sideCCm: 230, basis: "packed" } };
  assert.equal(analyzeDeliveryRoute(oversized, sample).status, "review");
  assert.equal(analyzeDeliveryRoute({ ...sofa, deliveryDimensions: undefined }, sample).status, "missing");
});

test("plan styles can independently hide each display layer", () => {
  const css = readFileSync(new URL("../dist/styles.css", import.meta.url), "utf8");
  assert.match(css, /room-labels-hidden/);
  assert.match(css, /dimensions-hidden/);
  assert.match(css, /features-hidden/);
  assert.match(css, /furniture-hidden/);
  assert.match(css, /electrical-hidden/);
  assert.match(css, /\.field-label input, \.field-label select[^}]*font-size:\s*16px/);
});

test("custom elevations can replace a room edge and omit a non-wall opening", () => {
  const sample = createSamplePlan();
  const room = sample.plan.rooms.find((item) => item.id === "sample-room");
  room.nonWallEdges = [1];
  sample.plan.hiddenElevationWallIds = ["sample-room-wall-2"];
  sample.plan.elevationWalls = [{
    id: "sample-custom-wall",
    roomId: "sample-room",
    label: "折れ壁",
    from: { x: 500, y: 280 },
    to: { x: 382.5, y: 280 },
    lengthCm: 117.5,
  }];
  sample.plan.elevationWallOrderByRoom = { "sample-room": ["sample-custom-wall", "sample-room-wall-0"] };
  assert.deepEqual(buildRoomWalls(sample, "sample-room").map((wall) => wall.id), [
    "sample-custom-wall",
    "sample-room-wall-0",
    "sample-room-wall-3",
  ]);
});

test("furniture rotates around its center", () => {
  const furniture = { id: "f1", name: "テーブル", x: 100, y: 200, widthCm: 140, depthCm: 80 };
  rotateFurniture(furniture);
  assert.deepEqual(furniture, { id: "f1", name: "テーブル", x: 130, y: 170, widthCm: 80, depthCm: 140 });
});

test("furniture duplication preserves size and offsets position", () => {
  const original = { id: "f1", name: "ソファ", x: 20, y: 30, widthCm: 180, depthCm: 85 };
  const copy = duplicateFurniture(original, "f2");
  assert.deepEqual(copy, { id: "f2", name: "ソファ コピー", x: 35, y: 45, widthCm: 180, depthCm: 85 });
  assert.equal(original.name, "ソファ");
});

test("furniture positions snap to a 5cm grid", () => {
  assert.equal(snapToGrid(102.4), 100);
  assert.equal(snapToGrid(102.6), 105);
});

test("dimension guides move only perpendicular to their measured edge", () => {
  const horizontal = { from: { x: 10, y: 20 }, to: { x: 110, y: 20 } };
  const vertical = { from: { x: 30, y: 40 }, to: { x: 30, y: 140 } };
  moveDimensionGuide(horizontal, 12.5);
  moveDimensionGuide(vertical, -8);
  assert.deepEqual(horizontal, { from: { x: 10, y: 32.5 }, to: { x: 110, y: 32.5 } });
  assert.deepEqual(vertical, { from: { x: 22, y: 40 }, to: { x: 22, y: 140 } });
});

test("temporary measurement reports direct and axis distances and snaps to plan edges", () => {
  assert.deepEqual(measurementMetrics({ x: 10, y: 20 }, { x: 40, y: 60 }), { distance: 50, horizontal: 30, vertical: 40 });
  const sample = createSamplePlan();
  assert.deepEqual(snapMeasurementPoint({ x: 100, y: 64 }, sample, 10), { x: 100, y: 60 });
  assert.deepEqual(snapMeasurementPoint({ x: 400, y: 400 }, sample, 5), { x: 400, y: 400 });
});

test("a second pointer cancels measurement input and becomes a pinch gesture", () => {
  const renderer = Object.create(PlanRenderer.prototype);
  const previousMeasurement = { from: { x: 10, y: 20 }, to: { x: 30, y: 40 } };
  renderer.measurement = { from: { x: 90, y: 100 }, to: null };
  renderer.measurementPointer = {
    pointerId: 1,
    clientX: 100,
    clientY: 120,
    lastClientX: 105,
    lastClientY: 125,
    measurementBefore: previousMeasurement,
  };
  renderer.draggingMeasurement = null;
  renderer.pointers = new Map();
  let overlayUpdates = 0;
  renderer.updateMeasurementOverlay = () => { overlayUpdates += 1; };
  let prevented = false;
  let captured = null;
  const promoted = renderer.promoteMeasurementGestureToPinch({
    pointerId: 2,
    clientX: 220,
    clientY: 240,
    preventDefault: () => { prevented = true; },
    currentTarget: { setPointerCapture: (pointerId) => { captured = pointerId; } },
  });
  assert.equal(promoted, true);
  assert.equal(prevented, true);
  assert.equal(captured, 2);
  assert.deepEqual(renderer.measurement, previousMeasurement);
  assert.deepEqual([...renderer.pointers.entries()], [
    [1, { x: 105, y: 125, startX: 100, startY: 120, moved: false }],
    [2, { x: 220, y: 240, startX: 220, startY: 240, moved: false }],
  ]);
  assert.equal(renderer.measurementPointer, null);
  assert.equal(overlayUpdates, 1);
});

test("furniture placement reports wall clearances inside a room", () => {
  const room = { points: [{ x: 0, y: 0 }, { x: 500, y: 0 }, { x: 500, y: 400 }, { x: 0, y: 400 }] };
  const furniture = { x: 100, y: 50, widthCm: 140, depthCm: 80 };
  assert.equal(pointInPolygon({ x: 0, y: 200 }, room.points), true);
  assert.deepEqual(analyzeFurniturePlacement(furniture, room), {
    inside: true,
    clearances: { left: 100, right: 260, top: 50, bottom: 270 },
    boundaries: { left: 0, right: 500, top: 0, bottom: 400 },
  });
});

test("furniture placement warns when a corner is outside the room", () => {
  const room = { points: [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 200 }, { x: 0, y: 200 }] };
  const result = analyzeFurniturePlacement({ x: 250, y: 40, widthCm: 100, depthCm: 80 }, room);
  assert.equal(result.inside, false);
  assert.equal(result.clearances, null);
});

test("furniture conflicts detect furniture, fixed features and partition walls", () => {
  const target = { id: "target", name: "テーブル", x: 100, y: 100, widthCm: 100, depthCm: 60 };
  const plan = {
    furniture: [target, { id: "other", name: "椅子", x: 180, y: 120, widthCm: 40, depthCm: 40 }],
    features: [{ id: "cabinet", name: "収納", x: 90, y: 80, width: 30, height: 40 }],
    walls: [{ id: "wall", name: "仕切り壁", from: { x: 150, y: 140 }, to: { x: 150, y: 220 }, thicknessCm: 10 }],
  };
  assert.equal(rectanglesOverlap(target, plan.furniture[1]), true);
  assert.deepEqual(analyzeFurnitureConflicts(target, plan).map((item) => item.name), ["椅子", "収納", "仕切り壁"]);
});

test("touching furniture edges are not treated as overlap", () => {
  assert.equal(rectanglesOverlap(
    { x: 0, y: 0, widthCm: 100, depthCm: 50 },
    { x: 100, y: 0, widthCm: 40, depthCm: 40 },
  ), false);
});

test("polygon walls preserve a recessed counter niche in conflict checks", () => {
  const wall = [{ x: 164.5, y: 621 }, { x: 203, y: 621 }, { x: 203, y: 656 }, { x: 171.5, y: 656 }, { x: 171.5, y: 738.5 }, { x: 164.5, y: 738.5 }];
  assert.equal(rectangleIntersectsPolygon({ x: 180, y: 670, widthCm: 10, depthCm: 10 }, wall), false);
  assert.equal(rectangleIntersectsPolygon({ x: 165, y: 670, widthCm: 4, depthCm: 10 }, wall), true);
  assert.equal(rectangleIntersectsPolygon({ x: 180, y: 630, widthCm: 10, depthCm: 10 }, wall), true);
  assert.equal(rectangleIntersectsPolygon({ x: 171.5, y: 670, widthCm: 8, depthCm: 10 }, wall), false);
});

test("dimension groups are inferred from stable ids and allow explicit overrides", () => {
  assert.equal(getDimensionGroup({ id: "hall-left-2" }), "wet");
  assert.equal(getDimensionGroup({ id: "hall-right-1" }), "hall");
  assert.equal(getDimensionGroup({ id: "counter-depth" }), "ldk");
  assert.equal(getDimensionGroup({ id: "bedroom-side-window" }), "bedroom");
  assert.equal(getDimensionGroup({ id: "balcony-depth" }), "balcony");
  assert.equal(getDimensionGroup({ id: "custom", group: "ldk" }), "ldk");
});

test("furniture editing preserves its center while changing size", () => {
  const furniture = { id: "f1", name: "家具", roomId: "ldk", x: 100, y: 200, widthCm: 100, depthCm: 50 };
  updateFurniture(furniture, { name: "テーブル", roomId: "bedroom", widthCm: 140, depthCm: 80, heightCm: 72 });
  assert.deepEqual(furniture, { id: "f1", name: "テーブル", roomId: "bedroom", x: 80, y: 185, widthCm: 140, depthCm: 80, heightCm: 72 });
  updateFurniture(furniture, { name: "テーブル", roomId: "bedroom", widthCm: 140, depthCm: 80, heightCm: null });
  assert.equal("heightCm" in furniture, false);
});

test("supported furniture aligns to its base and stacks measured heights", () => {
  const plan = {
    features: [{ id: "pan", name: "洗濯機パン", kind: "washer-pan", roomId: "washroom", x: 10, y: 20, width: 64, height: 64 }],
    furniture: [
      { id: "washer", name: "洗濯機", roomId: "washroom", supportId: "pan", x: 0, y: 0, widthCm: 60, depthCm: 60, heightCm: 105 },
      { id: "rack", name: "上置き棚", roomId: "washroom", supportId: "washer", x: 0, y: 0, widthCm: 55, depthCm: 45, heightCm: 30 },
    ],
  };
  alignFurnitureToSupport(plan, plan.furniture[0]);
  alignFurnitureToSupport(plan, plan.furniture[1]);
  assert.deepEqual({ x: plan.furniture[0].x, y: plan.furniture[0].y }, { x: 12, y: 22 });
  assert.deepEqual({ x: plan.furniture[0].supportOffsetX, y: plan.furniture[0].supportOffsetY }, { x: 2, y: 2 });
  plan.furniture[0].supportOffsetX = 99;
  plan.furniture[0].supportOffsetY = -10;
  alignFurnitureToSupport(plan, plan.furniture[0]);
  assert.deepEqual({ x: plan.furniture[0].x, y: plan.furniture[0].y }, { x: 14, y: 20 });
  assert.deepEqual(resolveFurnitureVerticalRange(plan, plan.furniture[0]), { bottomCm: 4, topCm: 109, schematic: true, support: plan.features[0] });
  assert.equal(resolveFurnitureVerticalRange(plan, plan.furniture[1]).bottomCm, 109);
  assert.deepEqual(analyzeFurnitureConflicts(plan.furniture[0], plan), []);
});

test("supported furniture inherits a fixed feature's elevation wall", () => {
  const plan = {
    features: [{ id: "counter", name: "カウンター", roomId: "ldk", elevationWallId: "wall-a", elevationOffsetCm: 10, elevationWidthCm: 80 }],
    furniture: [{ id: "appliance", name: "家電", roomId: "ldk", supportId: "counter", widthCm: 50, depthCm: 40, heightCm: 30 }],
  };
  assert.deepEqual(resolveFurnitureElevationPlacement(plan, plan.furniture[0]), { wallId: "wall-a", offsetCm: 25, widthCm: 50 });
});

test("zoom keeps the content under the pinch midpoint fixed", () => {
  const transform = { x: 70, y: 50, scale: 0.5 };
  const previousAnchor = { x: 300, y: 400 };
  const nextAnchor = { x: 320, y: 410 };
  const contentPoint = {
    x: (previousAnchor.x - transform.x) / transform.scale,
    y: (previousAnchor.y - transform.y) / transform.scale,
  };
  const zoomed = zoomTransformAround(transform, previousAnchor, nextAnchor, 2);
  assert.equal(zoomed.scale, 1);
  assert.equal(zoomed.x + contentPoint.x * zoomed.scale, nextAnchor.x);
  assert.equal(zoomed.y + contentPoint.y * zoomed.scale, nextAnchor.y);
});

test("gesture movement distinguishes a pan from a tap", () => {
  assert.equal(gestureExceedsTapThreshold({ x: 10, y: 10 }, { x: 13, y: 13 }), false);
  assert.equal(gestureExceedsTapThreshold({ x: 10, y: 10 }, { x: 14, y: 13 }), true);
});

test("3D overview projection rotates the plan without changing its scale", () => {
  const bounds = { x: 0, y: 0, width: 400, height: 300 };
  const original = projectThreePoint({ x: 300, y: 150 }, bounds, 0, 0);
  const rotated = projectThreePoint({ x: 300, y: 150 }, bounds, 1, 0);
  assert.deepEqual(original, { x: 72, y: 36 });
  assert.deepEqual(rotated, { x: -72, y: 36 });
  assert.equal(projectThreePoint({ x: 300, y: 150 }, bounds, 0, 100).y, -26);
  assert.ok(projectThreeDepth({ x: 300, y: 150 }, bounds, 0, 100) > projectThreeDepth({ x: 300, y: 150 }, bounds, 0, 0));
});

test("3D viewport zoom stays inside the rendered scene", () => {
  assert.deepEqual(threeViewportBox(), { x: 0, y: 0, width: 900, height: 620, scale: 1, panX: 0, panY: 0 });
  assert.deepEqual(threeViewportBox({ scale: 2, panX: 999, panY: -999 }), { x: 450, y: 0, width: 450, height: 310, scale: 2, panX: 225, panY: -155 });
  assert.equal(threeViewportBox({ scale: 9 }).scale, 3);
});

test("3D layers default to visible and can be independently hidden", () => {
  assert.equal(threeLayerEnabled("walls", {}), true);
  assert.equal(threeLayerEnabled("walls", { walls: false, furniture: true }), false);
  assert.equal(threeLayerEnabled("furniture", { walls: false, furniture: true }), true);
});

test("3D equipment and furniture expose their matching detail types", () => {
  assert.equal(threeSelectableType({ type: "feature" }), "feature");
  assert.equal(threeSelectableType({ type: "furniture" }), "furniture");
  assert.equal(threeSelectableType({ type: "wall" }), null);
});

test("3D room focus filters room-owned items and recalculates its bounds", () => {
  assert.equal(threeItemBelongsToRoom({ roomId: "ldk" }, "ldk"), true);
  assert.equal(threeItemBelongsToRoom({ roomIds: ["ldk", "hall"] }, "hall"), true);
  assert.equal(threeItemBelongsToRoom({ roomId: "bedroom" }, "ldk"), false);
  assert.deepEqual(threeRoomBounds([{ points: [{ x: 20, y: 30 }, { x: 220, y: 180 }] }]), { x: 20, y: 30, width: 200, height: 150 });
});

test("3D room focus retains unassigned partition walls inside the room", () => {
  const room = { id: "ldk", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] };
  assert.equal(threeWallBelongsToRoom({ from: { x: 50, y: 50 }, to: { x: 150, y: 50 } }, room), true);
  assert.equal(threeWallBelongsToRoom({ from: { x: 250, y: 50 }, to: { x: 300, y: 50 } }, room), false);
  assert.equal(threeWallBelongsToRoom({ points: [{ x: 20, y: 20 }, { x: 40, y: 20 }, { x: 40, y: 40 }] }, room), true);
});

test("3D boxes choose the two front faces after every rotation", () => {
  const bounds = { x: 0, y: 0, width: 400, height: 300 };
  const base = [{ x: 100, y: 100 }, { x: 200, y: 100 }, { x: 200, y: 200 }, { x: 100, y: 200 }];
  const initial = visibleBoxSideIndexes(base.map((point) => projectThreePoint(point, bounds, 0)));
  const rotated = visibleBoxSideIndexes(base.map((point) => projectThreePoint(point, bounds, 1)));
  assert.equal(initial.length, 2);
  assert.equal(rotated.length, 2);
  assert.notDeepEqual(initial, rotated);
});

test("3D openings preserve measured door and window heights", () => {
  const from = { x: 0, y: 0 }; const to = { x: 100, y: 0 };
  assert.deepEqual(openingVerticalRange({ kind: "door", from, to, heightCm: 199 }), { bottomCm: 0, topCm: 199, isWindow: false });
  assert.deepEqual(openingVerticalRange({ kind: "window", from, to, heightCm: 96.5, sillHeightCm: 88 }), { bottomCm: 88, topCm: 184.5, isWindow: true });
  assert.equal(openingVerticalRange({ kind: "window", from, to }), null);
});

test("3D cutaway walls follow the selected viewing direction", () => {
  const room = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  assert.deepEqual(room.map((_, index) => isCutawayEdge(room, index, 0)), [false, true, true, false]);
  assert.deepEqual(room.map((_, index) => isCutawayEdge(room, index, 2)), [true, false, false, true]);
});

test("3D wall faces are split around door and window openings", () => {
  assert.deepEqual(splitWallFace(300, 220, [{ u1: 100, u2: 180, z1: 0, z2: 199 }]), [
    { u1: 0, u2: 100, z1: 0, z2: 220 },
    { u1: 180, u2: 300, z1: 0, z2: 220 },
    { u1: 100, u2: 180, z1: 199, z2: 220 },
  ]);
  assert.equal(splitWallFace(300, 220, [{ u1: 80, u2: 180, z1: 88, z2: 184.5 }]).length, 4);
});

test("3D wall strips are subdivided for local depth sorting", () => {
  const rectangles = subdivideWallRectangle({ u1: 0, u2: 100, z1: 0, z2: 220 }, 35);
  assert.equal(rectangles.length, 3);
  assert.equal(rectangles[0].u1, 0);
  assert.equal(rectangles.at(-1).u2, 100);
  assert.deepEqual(rectangles.map(({ stripIndex, stripCount }) => [stripIndex, stripCount]), [[0, 3], [1, 3], [2, 3]]);
  assert.ok(rectangles.every((rectangle) => rectangle.u2 - rectangle.u1 <= 35.4));
  const segments = subdivideWallSegment({ x: 0, y: 0 }, { x: 100, y: 0 }, 35);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[0].from, { x: 0, y: 0 });
  assert.deepEqual(segments.at(-1).to, { x: 100, y: 0 });
  assert.deepEqual(segments.map(({ stripIndex, stripCount }) => [stripIndex, stripCount]), [[0, 3], [1, 3], [2, 3]]);
  const rows = subdivideVerticalRange(0, 220, 55);
  assert.equal(rows.length, 4);
  assert.equal(rows[0].z1, 0);
  assert.equal(rows.at(-1).z2, 220);
  const tiles = subdivideWallRectangleTiles({ u1: 0, u2: 100, z1: 0, z2: 220 }, 35, 55);
  assert.equal(tiles.length, 12);
});

test("3D equipment uses measured vertical ranges without making tall closets opaque", () => {
  assert.deepEqual(featureVerticalRange({ kind: "closet", derivedInteriorHeightCm: 232 }), { bottomCm: 0, topCm: 232, schematic: false });
  assert.deepEqual(featureVerticalRange({ kind: "cabinet", bottomHeightCm: 8, topHeightCm: 112 }), { bottomCm: 8, topCm: 112, schematic: false });
  assert.deepEqual(featureVerticalRange({ kind: "counter", undersideHeightCm: 90, derivedTopHeightCm: 91.5 }), { bottomCm: 90, topCm: 91.5, schematic: false });
  assert.deepEqual(featureVerticalRange({ kind: "washer-pan" }), { bottomCm: 0, topCm: 4, schematic: true });
  assert.deepEqual(featureVerticalRange({ kind: "unknown" }), { bottomCm: 0, topCm: 55, schematic: true });
});

test("all app element bindings exist in the HTML", () => {
  const appSource = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
  const htmlSource = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  const bindingBlock = appSource.match(/Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1];
  const boundIds = [...bindingBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const htmlIds = new Set([...htmlSource.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual(boundIds.filter((id) => !htmlIds.has(id)), []);
});

