import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeFurnitureConflicts, analyzeFurniturePlacement, buildElevationItems, buildRoomWalls, buildWallDiagram, countQualities, createSamplePlan, duplicateFurniture, FORMAT, getDimensionGroup, moveDimensionGuide, pointInPolygon, rectanglesOverlap, rotateFurniture, snapToGrid, updateFurniture, validatePlan, wallDisplayWidth } from "../dist/model.js";
import { zoomTransformAround } from "../dist/renderer.js";

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

test("quality counts include uncertain room geometry", () => {
  const sample = createSamplePlan();
  sample.plan.rooms[0].uncertain = true;
  const counts = countQualities(sample);
  assert.equal(counts.measured, 3);
  assert.equal(counts.uncertain, 3);
});

test("wall elevation items preserve measured heights without inventing a ceiling", () => {
  const sample = createSamplePlan();
  const items = buildElevationItems(sample, "sample-room");
  assert.deepEqual(items.map(({ name, bottomCm, topCm }) => ({ name, bottomCm, topCm })), [
    { name: "掃き出し窓", bottomCm: 0, topCm: 180 },
    { name: "洋室引き戸", bottomCm: 0, topCm: 200 },
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
  updateFurniture(furniture, { name: "テーブル", roomId: "bedroom", widthCm: 140, depthCm: 80 });
  assert.deepEqual(furniture, { id: "f1", name: "テーブル", roomId: "bedroom", x: 80, y: 185, widthCm: 140, depthCm: 80 });
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

test("all app element bindings exist in the HTML", () => {
  const appSource = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
  const htmlSource = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8");
  const bindingBlock = appSource.match(/Object\.fromEntries\(\[([\s\S]*?)\]\.map/)[1];
  const boundIds = [...bindingBlock.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const htmlIds = new Set([...htmlSource.matchAll(/id="([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual(boundIds.filter((id) => !htmlIds.has(id)), []);
});

