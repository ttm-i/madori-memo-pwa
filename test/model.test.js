import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzeFurnitureConflicts, analyzeFurniturePlacement, buildElevationItems, countQualities, createSamplePlan, duplicateFurniture, FORMAT, getDimensionGroup, moveDimensionGuide, pointInPolygon, rectanglesOverlap, rotateFurniture, snapToGrid, updateFurniture, validatePlan } from "../dist/model.js";
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

