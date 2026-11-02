import { deleteActivePlan, loadActivePlan, saveActivePlan } from "./db.js?v=55";
import { alignFurnitureToSupport, alignSupportedFurniture, analyzeDeliveryRoute, analyzeFurnitureConflicts, analyzeFurniturePlacement, buildElevationItems, buildRoomWalls, buildWallDiagram, countQualities, createSamplePlan, DIMENSION_GROUP_LABELS, duplicateFurniture, findSupportItem, getDimensionGroup, getElectricalPlanPosition, resolveFurnitureVerticalRange, rotateFurniture, updateFurniture, validatePlan, wallDisplayWidth } from "./model.js?v=55";
import { detailMarkup, measurementMetrics, PlanRenderer } from "./renderer.js?v=55";
import { renderThreeView } from "./three.js?v=55";

const elements = Object.fromEntries([
  "menuButton", "dataMenu", "detailDialog", "detailType", "detailTitle", "detailBody", "fileInput",
  "importButton", "emptyImportButton", "exportButton", "resetButton", "sampleButton", "emptyState",
  "planCanvas", "viewportLayer", "canvasFrame", "lockButton", "fitButton", "undoButton",
  "displayMenuButton", "displayMenu", "displayRoomLabelsToggle", "displayFeaturesToggle",
  "displayFurnitureToggle", "displayElectricalToggle", "displayDimensionsToggle",
  "dimensionFilters", "dimensionFilterList", "selectionMenuButton", "selectionMenu", "selectionModeHint",
  "measureButton", "measurementPanel", "measurementStatus", "measurementClearButton", "measurementEndButton",
  "furnitureMenuButton", "furnitureMenu", "snapToggle",
  "summaryTitle", "roomCount", "measuredCount", "uncertainCount", "connectionBadge", "saveStatus", "toast",
  "furnitureButton", "furnitureDialog", "furnitureForm", "cancelFurnitureButton",
  "furnitureName", "furnitureWidth", "furnitureDepth", "furnitureHeight", "furnitureRoom", "furniturePreset", "furnitureSupport", "furnitureSupportHelp",
  "furnitureViewActions", "showFurnitureClearanceButton", "furnitureActions", "rotateFurnitureButton", "duplicateFurnitureButton", "deleteFurnitureButton",
  "furnitureRoomEditGroup", "furnitureRoomEdit",
  "editFurnitureButton", "furnitureDialogTitle", "furnitureSubmitButton",
  "furnitureListButton", "furnitureListDialog", "furnitureList", "furnitureListCount",
  "wallDiagramModeButton", "wallHeightModeButton", "wallRoomList", "wallEmpty",
  "wallDiagramPanel", "wallPlanTitle", "wallPlanSvg", "wallList", "wallDiagramTitle", "wallDiagramMeta", "wallDiagramSvg", "wallDiagramDetails",
  "wallScrollViewButton", "wallOverviewButton", "wallSvgScroll",
  "wallHeightPanel", "wallCanvas", "wallScale", "wallTrack", "wallLegend", "wallCeilingNote",
  "deliveryEmpty", "deliveryContent", "deliveryRouteGrid", "deliveryDoorGrid", "deliveryFurnitureList", "deliveryLimitations",
  "deliveryDialog", "deliveryForm", "deliveryDialogTitle", "cancelDeliveryButton", "deliveryBasis",
  "deliverySideA", "deliverySideB", "deliverySideC",
  "threeCanvas", "threeEmpty", "threeRotateLeft", "threeRotateRight", "threeReset", "threeHeightNote", "threeCutawayToggle", "threeLabelsToggle",
  "threeRoomFilter", "threeWallsToggle", "threeOpeningsToggle", "threeFeaturesToggle", "threeFurnitureToggle",
].map((id) => [id, document.getElementById(id)]));

let activePlan = null;
let toastTimer = null;
let selectedFurnitureId = null;
let editingFurnitureId = null;
let preserveFurnitureSelectionOnClose = false;
let locked = true;
let dimensionGroups = new Set();
let selectedWallRoomId = null;
let selectedWallId = null;
let wallDisplayMode = "diagram";
let wallViewportMode = "scroll";
let deliveryFurnitureId = null;
let threeQuarterTurn = 0;
let threeCutaway = true;
let threeShowLabels = false;
let threeRoomId = "";
const threeLayers = { walls: true, openings: true, features: true, furniture: true };
const selectableByMode = {
  view: new Set(["room", "dimension", "equipment", "electrical", "furniture"]),
  edit: new Set(["furniture"]),
};
const history = [];
const renderer = new PlanRenderer(elements.planCanvas, elements.viewportLayer, showDetail, handleFurnitureEvent, handleViewChange, handleMeasurementChange);

function updateThreeView() {
  elements.threeEmpty.hidden = Boolean(activePlan);
  elements.threeCanvas.hidden = !activePlan;
  if (!activePlan) {
    elements.threeHeightNote.textContent = "";
    return;
  }
  const result = renderThreeView(elements.threeCanvas, activePlan, {
    quarterTurn: threeQuarterTurn,
    cutaway: threeCutaway,
    showLabels: threeShowLabels,
    roomId: threeRoomId || null,
    ...threeLayers,
  }, (type, item) => showDetail(type, item));
  const scope = result.selectedRoomName ? `${result.selectedRoomName}を表示中。` : "全体を表示中。";
  const notes = [`${scope} ドア・窓 ${result.openingCount}点のうち ${result.cutOpeningCount}点を壁の開口として反映。間仕切り壁 ${result.partitionWallCount}点。壁上端は天井位置ではありません。`];
  notes.push(result.furnitureWithoutHeight
    ? `高さ未登録の家具 ${result.furnitureWithoutHeight}点は、位置確認用の低い箱として表示しています。`
    : "家具の高さデータを反映しています。");
  elements.threeHeightNote.textContent = notes.join(" ");
}

function updateThreeRoomFilter() {
  const rooms = activePlan?.plan?.rooms ?? [];
  if (threeRoomId && !rooms.some((room) => room.id === threeRoomId)) threeRoomId = "";
  const options = [new Option("全体", ""), ...rooms.map((room) => new Option(room.name, room.id))];
  elements.threeRoomFilter.replaceChildren(...options);
  elements.threeRoomFilter.value = threeRoomId;
}

function updateUndoButton() {
  elements.undoButton.hidden = history.length === 0;
}

function handleViewChange(changed) {
  elements.fitButton.hidden = !activePlan || !changed;
}

function handleMeasurementChange(measurement) {
  if (!measurement.from) elements.measurementStatus.textContent = "始点をタップ";
  else if (!measurement.to) elements.measurementStatus.textContent = "終点をタップ";
  else {
    const metrics = measurementMetrics(measurement.from, measurement.to);
    elements.measurementStatus.textContent = `${Math.round(metrics.distance * 10) / 10} cm`;
  }
}

function setMeasurementMode(value) {
  if (value && !activePlan) return showToast("先に間取りデータを読み込んでください");
  renderer.setMeasurementMode(value);
  elements.measurementPanel.hidden = !value;
  elements.measureButton.textContent = value ? "📏 測定を終了" : "📏 2点間を測る";
  closeToolMenus();
  if (value) showToast("始点と終点をタップしてください");
}

function pushHistory() {
  history.push(structuredClone(activePlan));
  if (history.length > 30) history.shift();
  updateUndoButton();
}

async function persistActivePlan() {
  elements.saveStatus.textContent = "保存中…";
  await saveActivePlan(activePlan);
  elements.saveStatus.textContent = "端末内に保存済み";
}

function handleFurnitureEvent(stage) {
  if (stage === "start") pushHistory();
  if (stage === "commit") {
    alignSupportedFurniture(activePlan.plan);
    renderer.render(activePlan);
    persistActivePlan();
  }
}

function furnitureDescendantIds(furnitureId) {
  const descendants = new Set();
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of activePlan?.plan.furniture ?? []) {
      if ((item.supportId === furnitureId || descendants.has(item.supportId)) && !descendants.has(item.id)) {
        descendants.add(item.id);
        changed = true;
      }
    }
  }
  return descendants;
}

function updateFurnitureSupportOptions(selectedId = "") {
  const roomId = elements.furnitureRoom.value;
  const excluded = editingFurnitureId ? furnitureDescendantIds(editingFurnitureId) : new Set();
  if (editingFurnitureId) excluded.add(editingFurnitureId);
  const options = [new Option("床に置く", "")];
  const appendGroup = (label, items) => {
    if (!items.length) return;
    const group = document.createElement("optgroup");
    group.label = label;
    group.append(...items.map((item) => new Option(item.name, item.id)));
    options.push(group);
  };
  appendGroup("固定設備の上", (activePlan?.plan.features ?? []).filter((item) => item.kind !== "column" && item.roomId === roomId));
  appendGroup("家具の上", (activePlan?.plan.furniture ?? []).filter((item) => item.roomId === roomId && !excluded.has(item.id)));
  elements.furnitureSupport.replaceChildren(...options);
  elements.furnitureSupport.value = [...elements.furnitureSupport.options].some((option) => option.value === selectedId) ? selectedId : "";
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 2600);
}

function updateConnection() {
  const online = navigator.onLine;
  elements.connectionBadge.textContent = online ? "オンライン" : "オフライン";
  elements.connectionBadge.classList.toggle("offline", !online);
}

function updateSummary() {
  const hasData = Boolean(activePlan);
  elements.emptyState.hidden = hasData;
  document.querySelector(".scale-indicator").classList.toggle("visible", hasData);
  if (!hasData) {
    elements.summaryTitle.textContent = "データ未読込";
    elements.roomCount.textContent = elements.measuredCount.textContent = elements.uncertainCount.textContent = "—";
    return;
  }
  const counts = countQualities(activePlan);
  elements.summaryTitle.textContent = activePlan.meta.title;
  elements.roomCount.textContent = activePlan.plan.rooms.length;
  elements.measuredCount.textContent = counts.measured;
  elements.uncertainCount.textContent = counts.uncertain;
}

function routeOpeningSize(route) {
  const opening = activePlan?.plan.openings?.find((item) => item.id === route?.dwellingEntranceOpeningId);
  return {
    width: route?.dwellingEntrance?.openingWidthCm ?? opening?.clearOpeningWidthCm ?? opening?.widthCm,
    height: route?.dwellingEntrance?.openingHeightCm ?? opening?.heightCm,
  };
}

function openDeliveryDialog(furniture) {
  deliveryFurnitureId = furniture.id;
  const dimensions = furniture.deliveryDimensions ?? {};
  elements.deliveryDialogTitle.textContent = `${furniture.name}の搬入寸法`;
  elements.deliveryBasis.value = dimensions.basis === "body" ? "body" : "packed";
  elements.deliverySideA.value = dimensions.sideACm ?? "";
  elements.deliverySideB.value = dimensions.sideBCm ?? "";
  elements.deliverySideC.value = dimensions.sideCCm ?? "";
  elements.deliveryDialog.showModal();
}

function makeDeliveryRouteCard(item) {
  const card = document.createElement("article");
  card.className = "delivery-route-card";
  const title = document.createElement("strong");
  title.textContent = item.title;
  const value = document.createElement("b");
  value.textContent = item.value;
  const note = document.createElement("span");
  note.textContent = item.note;
  card.append(title, value, note);
  return card;
}

function renderDeliveryView() {
  const route = activePlan?.plan.accessRoute;
  elements.deliveryEmpty.hidden = Boolean(route);
  elements.deliveryContent.hidden = !route;
  if (!route) {
    elements.deliveryRouteGrid.replaceChildren();
    elements.deliveryDoorGrid.replaceChildren();
    elements.deliveryFurnitureList.replaceChildren();
    elements.deliveryLimitations.replaceChildren();
    return;
  }
  const entrance = routeOpeningSize(route);
  const routeCards = [
    { title: "共用廊下", value: Number.isFinite(route.commonCorridor?.widthCm) ? `幅 ${route.commonCorridor.widthCm} cm` : "未測定", note: "曲がり角・待避余地は別途確認" },
    { title: "エレベーター入口", value: Number.isFinite(route.elevator?.openingWidthCm) && Number.isFinite(route.elevator?.openingHeightCm) ? `${route.elevator.openingWidthCm} × ${route.elevator.openingHeightCm} cm` : "未測定", note: "幅 × 開口高さ" },
    { title: "エレベーター庫内", value: Number.isFinite(route.elevator?.cabinWidthCm) && Number.isFinite(route.elevator?.cabinDepthCm) ? `${route.elevator.cabinWidthCm} × ${route.elevator.cabinDepthCm} cm` : "未測定", note: "床面の幅 × 奥行・高さ未測定" },
    { title: "住戸玄関", value: Number.isFinite(entrance.width) && Number.isFinite(entrance.height) ? `${entrance.width} × ${entrance.height} cm` : "未測定", note: "有効幅 × 開口高さ" },
  ].map(makeDeliveryRouteCard);
  elements.deliveryRouteGrid.replaceChildren(...routeCards);
  const internalDoors = activePlan.plan.openings
    .filter((opening) => String(opening.kind ?? "").includes("door") && opening.roomIds?.length === 2)
    .map((door) => {
      const width = door.clearOpeningWidthCm ?? door.widthCm;
      return makeDeliveryRouteCard({
        title: door.name,
        value: Number.isFinite(width) && Number.isFinite(door.heightCm) ? `${width} × ${door.heightCm} cm` : "未測定",
        note: "有効幅 × 開口高さ",
      });
    });
  elements.deliveryDoorGrid.replaceChildren(...internalDoors);

  const furniture = activePlan.plan.furniture ?? [];
  if (!furniture.length) {
    const empty = document.createElement("p");
    empty.className = "furniture-list-empty";
    empty.textContent = "2D画面で家具を追加すると、ここで搬入寸法を登録できます。";
    elements.deliveryFurnitureList.replaceChildren(empty);
  } else {
    const cards = furniture.map((item) => {
      const analysis = analyzeDeliveryRoute(item, activePlan);
      const statusLabels = { candidate: "数値上は通過候補", review: "要再確認", missing: "寸法未登録" };
      const card = document.createElement("article");
      card.className = "delivery-furniture-card";
      const header = document.createElement("div");
      header.className = "delivery-furniture-card-header";
      const name = document.createElement("strong");
      name.textContent = item.name;
      const status = document.createElement("span");
      status.className = `delivery-status ${analysis.status}`;
      status.textContent = statusLabels[analysis.status];
      header.append(name, status);
      const size = document.createElement("p");
      size.className = "delivery-size";
      const dimensions = item.deliveryDimensions;
      size.textContent = dimensions
        ? `${dimensions.basis === "body" ? "本体" : "梱包"} ${dimensions.sideACm} × ${dimensions.sideBCm} × ${dimensions.sideCCm} cm`
        : `設置寸法 ${item.widthCm} × ${item.depthCm} cm（搬入寸法は別途登録）`;
      const checks = document.createElement("ul");
      checks.className = "delivery-checks";
      for (const check of analysis.checks) {
        const row = document.createElement("li");
        row.className = check.status;
        const label = document.createElement("strong");
        label.textContent = check.label;
        const detail = document.createElement("span");
        detail.textContent = check.detail;
        row.append(label, detail);
        checks.append(row);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-button delivery-edit-button";
      button.textContent = dimensions ? "搬入寸法を変更" : "搬入寸法を設定";
      button.addEventListener("click", () => openDeliveryDialog(item));
      card.append(header, size);
      if (analysis.checks.length) card.append(checks);
      card.append(button);
      return card;
    });
    elements.deliveryFurnitureList.replaceChildren(...cards);
  }
  const limitations = route.limitations ?? [];
  const title = document.createElement("strong");
  title.textContent = "判定できない要素";
  const list = document.createElement("ul");
  for (const text of limitations) {
    const item = document.createElement("li");
    item.textContent = text;
    list.append(item);
  }
  elements.deliveryLimitations.replaceChildren(title, list);
}

const SVG_NS = "http://www.w3.org/2000/svg";
function wallSvg(tag, attributes = {}, text = "") {
  const element = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  if (text) element.textContent = text;
  return element;
}

function renderWallPlan(room, walls) {
  elements.wallPlanSvg.replaceChildren();
  if (!room || !walls.length) return;
  const padding = 38;
  const xs = room.points.map((point) => point.x);
  const ys = room.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  elements.wallPlanSvg.setAttribute("viewBox", `${minX - padding} ${minY - padding} ${maxX - minX + padding * 2} ${maxY - minY + padding * 2}`);
  elements.wallPlanTitle.textContent = `${room.name}の間取り図`;
  elements.wallPlanSvg.append(wallSvg("polygon", {
    class: "wall-plan-room",
    points: room.points.map((point) => `${point.x},${point.y}`).join(" "),
  }));
  for (const opening of activePlan.plan.openings ?? []) {
    const belongs = opening.roomId === room.id || opening.roomIds?.includes(room.id);
    if (!belongs || !opening.from || !opening.to) continue;
    elements.wallPlanSvg.append(wallSvg("line", {
      class: "wall-plan-opening",
      x1: opening.from.x, y1: opening.from.y, x2: opening.to.x, y2: opening.to.y,
    }));
  }
  const electricalItems = [
    ...(activePlan.plan.electrical?.outlets ?? []),
    ...(activePlan.plan.electrical?.switches ?? []),
  ];
  for (const electrical of electricalItems) {
    if (electrical.roomId !== room.id) continue;
    const position = getElectricalPlanPosition(activePlan, electrical);
    if (!position) continue;
    elements.wallPlanSvg.append(wallSvg("circle", {
      class: "wall-plan-electrical",
      cx: position.anchor.x,
      cy: position.anchor.y,
      r: 7,
    }));
  }
  walls.forEach((wall, index) => {
    const selected = wall.id === selectedWallId;
    const group = wallSvg("g", {
      class: `wall-plan-wall ${selected ? "is-selected" : ""}`,
      role: "button",
      tabindex: 0,
      "aria-label": `壁${index + 1} ${wall.label} ${Math.round(wall.lengthCm * 10) / 10} cm`,
    });
    const attributes = { x1: wall.from.x, y1: wall.from.y, x2: wall.to.x, y2: wall.to.y };
    group.append(
      wallSvg("line", { class: "wall-plan-wall-line", ...attributes }),
      wallSvg("line", { class: "wall-plan-wall-hit", ...attributes }),
    );
    const midX = (wall.from.x + wall.to.x) / 2;
    const midY = (wall.from.y + wall.to.y) / 2;
    group.append(
      wallSvg("circle", { class: "wall-plan-wall-number-bg", cx: midX, cy: midY, r: 13 }),
      wallSvg("text", { class: "wall-plan-wall-number", x: midX, y: midY + 5, "text-anchor": "middle" }, index + 1),
    );
    const select = () => updateWallView(selectedWallRoomId, wall.id);
    group.addEventListener("click", select);
    group.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        select();
      }
    });
    elements.wallPlanSvg.append(group);
  });
}

function renderWallDiagram(diagram, referenceLengthCm = diagram?.lengthCm) {
  elements.wallDiagramSvg.replaceChildren();
  elements.wallDiagramDetails.replaceChildren();
  if (!diagram) {
    elements.wallDiagramTitle.textContent = "壁を選択";
    elements.wallDiagramMeta.textContent = "—";
    return;
  }
  elements.wallDiagramTitle.textContent = diagram.label;
  elements.wallDiagramMeta.textContent = `幅 ${Math.round(diagram.lengthCm * 10) / 10} cm・部屋内共通縮尺`;
  const highest = Math.max(200, ...diagram.items.map((item) => item.topCm));
  const displayMaxCm = Math.max(225, Math.ceil((highest + 20) / 25) * 25);
  const left = 80;
  const maxDrawWidth = 840;
  const right = left + wallDisplayWidth(diagram.lengthCm, referenceLengthCm, maxDrawWidth);
  const top = 72;
  const floor = 500;
  const drawWidth = right - left;
  const drawHeight = floor - top;
  const xFor = (value) => left + value / diagram.lengthCm * drawWidth;
  const yFor = (value) => floor - value / displayMaxCm * drawHeight;

  const grid = wallSvg("g", { class: "wall-svg-grid" });
  for (let height = 0; height <= displayMaxCm; height += 50) {
    const y = yFor(height);
    grid.append(
      wallSvg("line", { x1: left, y1: y, x2: right, y2: y }),
      wallSvg("text", { x: left - 12, y: y + 5, "text-anchor": "end" }, `${height}`),
    );
  }
  elements.wallDiagramSvg.append(grid);
  elements.wallDiagramSvg.append(
    wallSvg("line", { class: "wall-svg-limit", x1: left, y1: top, x2: right, y2: top }),
    wallSvg("line", { class: "wall-svg-side", x1: left, y1: top, x2: left, y2: floor }),
    wallSvg("line", { class: "wall-svg-side", x1: right, y1: top, x2: right, y2: floor }),
    wallSvg("line", { class: "wall-svg-floor", x1: left, y1: floor, x2: right, y2: floor }),
    wallSvg("text", { class: "wall-svg-limit-text", x: Math.max(right, left + 160), y: top - 13, "text-anchor": "end" }, `${displayMaxCm} cm（表示上限）`),
    wallSvg("line", { class: "wall-svg-width-line", x1: left, y1: 36, x2: right, y2: 36 }),
    wallSvg("text", { class: "wall-svg-width-text", x: (left + right) / 2, y: 28, "text-anchor": "middle" }, `壁幅 ${Math.round(diagram.lengthCm * 10) / 10} cm`),
  );

  const shapes = wallSvg("g", { class: "wall-svg-items" });
  diagram.items.forEach((item, index) => {
    const x = xFor(item.offsetCm);
    const width = Math.max(4, item.widthCm / diagram.lengthCm * drawWidth);
    const y = yFor(item.topCm);
    const height = Math.max(3, yFor(item.bottomCm) - y);
    if (item.marker) {
      shapes.append(wallSvg("line", { class: `wall-svg-item wall-svg-${item.category} is-marker`, x1: x, y1: y, x2: x + width, y2: y }));
    } else {
      shapes.append(wallSvg("rect", { class: `wall-svg-item wall-svg-${item.category}`, x, y, width, height, rx: 4 }));
    }
    const badgeX = Math.min(right - 13, Math.max(left + 13, x + width / 2));
    const badgeY = Math.max(top + 15, y + 18);
    shapes.append(
      wallSvg("circle", { class: "wall-svg-number-bg", cx: badgeX, cy: badgeY, r: 12 }),
      wallSvg("text", { class: "wall-svg-number", x: badgeX, y: badgeY + 4, "text-anchor": "middle" }, index + 1),
    );
  });
  elements.wallDiagramSvg.append(shapes);

  const detailRows = diagram.items.map((item, index) => {
    const row = document.createElement("div");
    row.className = "wall-diagram-detail";
    const number = document.createElement("span");
    number.className = `wall-detail-number wall-detail-${item.category}`;
    number.textContent = String(index + 1);
    const body = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = item.name;
    const measurement = document.createElement("span");
    const vertical = item.marker ? `床から ${item.topCm} cm` : `高さ ${item.bottomCm}–${item.topCm} cm`;
    measurement.textContent = `図の左端から ${Math.round(item.offsetCm * 10) / 10} cm・幅 ${Math.round(item.widthCm * 10) / 10} cm・${vertical}`;
    body.append(name, measurement);
    row.append(number, body);
    return row;
  });
  if (!detailRows.length) {
    const empty = document.createElement("p");
    empty.className = "wall-diagram-detail-empty";
    empty.textContent = "この壁には、位置と高さが確定した開口部・設備がありません。";
    detailRows.push(empty);
  }
  elements.wallDiagramDetails.replaceChildren(...detailRows);
}

function renderHeightComparison(items) {
  elements.wallCanvas.hidden = items.length === 0;
  elements.wallLegend.hidden = items.length === 0;
  if (!items.length) {
    elements.wallScale.replaceChildren();
    elements.wallTrack.replaceChildren();
    return;
  }
  const highest = Math.max(...items.map((item) => item.topCm));
  const displayMaxCm = Math.max(200, Math.ceil((highest + 20) / 25) * 25);
  const scaleMarks = [];
  for (let height = 0; height <= displayMaxCm; height += 50) {
    const mark = document.createElement("span");
    mark.style.bottom = `${height / displayMaxCm * 100}%`;
    mark.textContent = `${height}`;
    scaleMarks.push(mark);
  }
  const limit = document.createElement("span");
  limit.className = "wall-limit-label";
  limit.style.bottom = "100%";
  limit.textContent = `${displayMaxCm} cm（表示上限）`;
  scaleMarks.push(limit);
  elements.wallScale.replaceChildren(...scaleMarks);
  elements.wallTrack.style.width = `${Math.max(100, items.length * 92)}px`;
  const lanes = items.map((item) => {
    const lane = document.createElement("div");
    lane.className = "wall-lane";
    const shape = document.createElement("div");
    shape.className = `wall-item wall-item-${item.category} ${item.marker ? "is-marker" : ""}`;
    shape.style.bottom = `${item.bottomCm / displayMaxCm * 100}%`;
    shape.style.height = item.marker ? "3px" : `${Math.max(1.5, (item.topCm - item.bottomCm) / displayMaxCm * 100)}%`;
    const heightLabel = item.marker ? `${item.topCm} cm` : `${item.bottomCm}–${item.topCm} cm`;
    const label = document.createElement("div");
    label.className = "wall-item-label";
    const name = document.createElement("strong");
    name.textContent = item.name;
    const value = document.createElement("span");
    value.textContent = heightLabel;
    label.append(name, value);
    if (item.detail) {
      const detail = document.createElement("small");
      detail.textContent = item.detail;
      label.append(detail);
    }
    lane.append(shape, label);
    return lane;
  });
  elements.wallTrack.replaceChildren(...lanes);
}

function updateWallView(preferredRoomId = selectedWallRoomId, preferredWallId = selectedWallId) {
  const rooms = activePlan?.plan.rooms ?? [];
  const roomChanged = preferredRoomId !== selectedWallRoomId;
  selectedWallRoomId = rooms.some((room) => room.id === preferredRoomId) ? preferredRoomId : rooms[0]?.id ?? null;
  if (roomChanged) preferredWallId = null;
  const hasData = Boolean(activePlan && selectedWallRoomId);
  elements.wallEmpty.hidden = hasData;
  elements.wallDiagramPanel.hidden = !hasData || wallDisplayMode !== "diagram";
  elements.wallHeightPanel.hidden = !hasData || wallDisplayMode !== "height";
  elements.wallCeilingNote.hidden = !hasData;

  const roomButtons = rooms.map((room) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wall-room-button ${room.id === selectedWallRoomId ? "is-active" : ""}`;
    button.textContent = room.name;
    button.setAttribute("aria-pressed", String(room.id === selectedWallRoomId));
    button.addEventListener("click", () => updateWallView(room.id, null));
    return button;
  });
  elements.wallRoomList.replaceChildren(...roomButtons);

  if (!hasData) {
    elements.wallRoomList.replaceChildren();
    elements.wallList.replaceChildren();
    elements.wallPlanSvg.replaceChildren();
    renderWallDiagram(null);
    renderHeightComparison([]);
    return;
  }

  const walls = buildRoomWalls(activePlan, selectedWallRoomId);
  const diagrams = walls.map((wall) => buildWallDiagram(activePlan, selectedWallRoomId, wall.id));
  selectedWallId = walls.some((wall) => wall.id === preferredWallId)
    ? preferredWallId
    : diagrams.sort((first, second) => second.items.length - first.items.length)[0]?.id ?? walls[0]?.id ?? null;
  const wallButtons = walls.map((wall, index) => {
    const diagram = buildWallDiagram(activePlan, selectedWallRoomId, wall.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `wall-list-button ${wall.id === selectedWallId ? "is-active" : ""}`;
    button.setAttribute("aria-pressed", String(wall.id === selectedWallId));
    const name = document.createElement("strong");
    name.textContent = `壁${index + 1}・${wall.label}`;
    const meta = document.createElement("span");
    meta.textContent = `${Math.round(wall.lengthCm * 10) / 10} cm${diagram.items.length ? `・${diagram.items.length}要素` : ""}`;
    button.append(name, meta);
    button.addEventListener("click", () => updateWallView(selectedWallRoomId, wall.id));
    return button;
  });
  elements.wallList.replaceChildren(...wallButtons);
  const selectedRoom = rooms.find((room) => room.id === selectedWallRoomId);
  renderWallPlan(selectedRoom, walls);
  renderWallDiagram(buildWallDiagram(activePlan, selectedWallRoomId, selectedWallId), Math.max(...walls.map((wall) => wall.lengthCm)));
  renderHeightComparison(buildElevationItems(activePlan, selectedWallRoomId));
}

function updateDimensionFilters() {
  const groups = activePlan ? [...new Set(activePlan.plan.dimensions.map(getDimensionGroup))] : [];
  const order = ["wet", "hall", "ldk", "bedroom", "balcony", "other"];
  groups.sort((first, second) => order.indexOf(first) - order.indexOf(second));
  const retainedGroups = groups.filter((group) => dimensionGroups.has(group));
  dimensionGroups = new Set(retainedGroups.length ? retainedGroups : groups);
  const makeChip = (value, label, checked = true) => {
    const wrapper = document.createElement("label");
    wrapper.className = "filter-chip";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = value;
    input.checked = checked;
    wrapper.append(input, document.createTextNode(label));
    return wrapper;
  };
  const allSelected = groups.length > 0 && groups.every((group) => dimensionGroups.has(group));
  const chips = groups.length ? [makeChip("all", "すべて", allSelected), ...groups.map((group) => makeChip(group, DIMENSION_GROUP_LABELS[group] ?? group, dimensionGroups.has(group)))] : [];
  elements.dimensionFilterList.replaceChildren(...chips);
  elements.dimensionFilters.hidden = !groups.length || !elements.displayDimensionsToggle.checked;
  renderer.setDimensionGroups(dimensionGroups);

  for (const input of elements.dimensionFilterList.querySelectorAll("input")) {
    input.addEventListener("change", () => {
      const groupInputs = [...elements.dimensionFilterList.querySelectorAll('input:not([value="all"])')];
      const allInput = elements.dimensionFilterList.querySelector('input[value="all"]');
      if (input.value === "all") groupInputs.forEach((item) => { item.checked = input.checked; });
      dimensionGroups = new Set(groupInputs.filter((item) => item.checked).map((item) => item.value));
      allInput.checked = groupInputs.length > 0 && groupInputs.every((item) => item.checked);
      renderer.setDimensionGroups(dimensionGroups);
    });
  }
}

async function setActivePlan(plan, { persist = true } = {}) {
  activePlan = plan;
  activePlan.plan.features = (activePlan.plan.features ?? []).filter((feature) => feature.kind !== "column");
  alignSupportedFurniture(activePlan.plan);
  history.length = 0;
  updateUndoButton();
  renderer.render(plan);
  updateSummary();
  updateWallView();
  renderDeliveryView();
  updateDimensionFilters();
  updateThreeRoomFilter();
  requestAnimationFrame(() => renderer.fit());
  if (persist) {
    await persistActivePlan();
  }
}

async function importFile(file) {
  const text = await file.text();
  const parsed = validatePlan(JSON.parse(text));
  await setActivePlan(parsed);
  elements.dataMenu.close();
  showToast("間取りデータを端末内に保存しました");
}

function exportPlan() {
  if (!activePlan) return showToast("書き出すデータがありません");
  const blob = new Blob([JSON.stringify(activePlan, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = URL.createObjectURL(blob);
  link.download = `madori-backup-${date}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  showToast("バックアップを書き出しました");
}

function showDetail(type, item) {
  if (!type || !item) {
    selectedFurnitureId = null;
    renderer.setSelectedFurniture(null);
    if (elements.detailDialog.open) elements.detailDialog.close();
    return;
  }
  selectedFurnitureId = type === "furniture" ? item.id : null;
  preserveFurnitureSelectionOnClose = false;
  renderer.setSelectedFurniture(selectedFurnitureId);
  const furnitureEditable = type === "furniture" && !locked;
  elements.furnitureViewActions.hidden = type !== "furniture";
  elements.furnitureActions.hidden = !furnitureEditable;
  elements.furnitureRoomEditGroup.hidden = !furnitureEditable;
  const typeLabels = { room: "ROOM", dimension: "DIMENSION", opening: "OPENING", feature: "EQUIPMENT", outlet: "OUTLET", switch: "SWITCH", furniture: "FURNITURE" };
  const detailClasses = ["detail-room", "detail-dimension", "detail-equipment", "detail-furniture"];
  elements.detailDialog.classList.remove(...detailClasses);
  elements.detailDialog.classList.add(type === "room" ? "detail-room" : type === "dimension" ? "detail-dimension" : type === "furniture" ? "detail-furniture" : "detail-equipment");
  elements.detailType.textContent = typeLabels[type] ?? "DETAIL";
  elements.detailTitle.textContent = item.name;
  const room = item.roomId ? activePlan.plan.rooms.find((candidate) => candidate.id === item.roomId) : null;
  const support = type === "furniture" ? findSupportItem(activePlan.plan, item.supportId) : null;
  const vertical = type === "furniture" ? resolveFurnitureVerticalRange(activePlan.plan, item) : null;
  const detailItem = type === "furniture" && room
    ? { ...item, roomName: room.name, supportName: support?.name, vertical, placement: analyzeFurniturePlacement(item, room), conflicts: analyzeFurnitureConflicts(item, activePlan.plan) }
    : room ? { ...item, roomName: room.name } : item;
  elements.detailBody.innerHTML = detailMarkup(type, detailItem);
  if (type === "furniture") {
    elements.furnitureRoomEdit.replaceChildren(...activePlan.plan.rooms.map((candidate) => new Option(candidate.name, candidate.id, false, candidate.id === item.roomId)));
  }
  elements.detailDialog.showModal();
}

elements.detailDialog.addEventListener("click", (event) => {
  if (event.target === elements.detailDialog) elements.detailDialog.close();
});
elements.detailDialog.addEventListener("close", () => {
  if (preserveFurnitureSelectionOnClose) {
    preserveFurnitureSelectionOnClose = false;
    return;
  }
  selectedFurnitureId = null;
  renderer.setSelectedFurniture(null);
});
elements.showFurnitureClearanceButton.addEventListener("click", () => {
  if (!selectedFurniture()) return;
  preserveFurnitureSelectionOnClose = true;
  document.querySelector('.tab[data-view="plan"]').click();
  elements.detailDialog.close();
  showToast("空白部分をタップすると距離表示を終了します");
});

function selectedFurniture() {
  return activePlan?.plan.furniture.find((item) => item.id === selectedFurnitureId);
}

function renderFurnitureList() {
  const furnitureItems = activePlan?.plan.furniture ?? [];
  elements.furnitureListCount.textContent = String(furnitureItems.length);
  if (!furnitureItems.length) {
    const empty = document.createElement("p");
    empty.className = "furniture-list-empty";
    empty.textContent = "配置した家具はありません。";
    elements.furnitureList.replaceChildren(empty);
    return;
  }
  const rows = furnitureItems.map((furniture) => {
    const room = activePlan.plan.rooms.find((candidate) => candidate.id === furniture.roomId);
    const placement = analyzeFurniturePlacement(furniture, room);
    const conflicts = analyzeFurnitureConflicts(furniture, activePlan.plan);
    const row = document.createElement("button");
    row.type = "button";
    row.className = `furniture-list-item ${!placement.inside ? "danger" : conflicts.length ? "warning" : ""}`;
    const name = document.createElement("strong");
    name.textContent = furniture.name;
    const roomLabel = document.createElement("span");
    const support = findSupportItem(activePlan.plan, furniture.supportId);
    const status = !placement.inside ? "・部屋外" : conflicts.length ? "・重なりあり" : "";
    roomLabel.textContent = `${room?.name ?? "未設定"}${support ? `・${support.name}の上` : ""}${status}`;
    const size = document.createElement("span");
    size.className = "furniture-list-size";
    size.textContent = Number.isFinite(furniture.heightCm)
      ? `${furniture.widthCm}×${furniture.depthCm}×高さ${furniture.heightCm} cm`
      : `${furniture.widthCm}×${furniture.depthCm} cm・高さ未登録`;
    row.append(name, roomLabel, size);
    row.addEventListener("click", () => {
      elements.furnitureListDialog.close();
      setFurnitureVisible(true);
      showDetail("furniture", furniture);
    });
    return row;
  });
  elements.furnitureList.replaceChildren(...rows);
}

async function commitFurnitureChange(message) {
  alignSupportedFurniture(activePlan.plan);
  renderer.render(activePlan);
  renderDeliveryView();
  await persistActivePlan();
  elements.detailDialog.close();
  selectedFurnitureId = null;
  renderer.setSelectedFurniture(null);
  showToast(message);
}

function setFurnitureVisible(value) {
  elements.displayFurnitureToggle.checked = value;
  renderer.setFurnitureVisible(value);
}

function closeToolMenus(except = null) {
  for (const [button, menu] of [[elements.displayMenuButton, elements.displayMenu], [elements.selectionMenuButton, elements.selectionMenu], [elements.furnitureMenuButton, elements.furnitureMenu]]) {
    if (menu === except) continue;
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  }
}

function toggleToolMenu(button, menu) {
  const willOpen = menu.hidden;
  closeToolMenus(menu);
  menu.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));
}

function syncSelectableControls() {
  const mode = locked ? "view" : "edit";
  const selected = selectableByMode[mode];
  elements.selectionModeHint.textContent = locked ? "閲覧モードの設定" : "編集モードの設定";
  document.querySelectorAll("[data-selectable]").forEach((input) => { input.checked = selected.has(input.dataset.selectable); });
  renderer.setSelectableTypes(selected);
}

function setWallDisplayMode(mode) {
  wallDisplayMode = mode;
  const diagramActive = mode === "diagram";
  elements.wallDiagramModeButton.classList.toggle("is-active", diagramActive);
  elements.wallDiagramModeButton.setAttribute("aria-pressed", String(diagramActive));
  elements.wallHeightModeButton.classList.toggle("is-active", !diagramActive);
  elements.wallHeightModeButton.setAttribute("aria-pressed", String(!diagramActive));
  updateWallView();
}

function setWallViewportMode(mode) {
  wallViewportMode = mode === "overview" ? "overview" : "scroll";
  const overviewActive = wallViewportMode === "overview";
  elements.wallSvgScroll.classList.toggle("is-overview", overviewActive);
  elements.wallScrollViewButton.classList.toggle("is-active", !overviewActive);
  elements.wallScrollViewButton.setAttribute("aria-pressed", String(!overviewActive));
  elements.wallOverviewButton.classList.toggle("is-active", overviewActive);
  elements.wallOverviewButton.setAttribute("aria-pressed", String(overviewActive));
  if (overviewActive) elements.wallSvgScroll.scrollLeft = 0;
}

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  if (tab.dataset.view !== "plan" && renderer.measurementMode) setMeasurementMode(false);
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("is-active", item === tab));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("is-active"));
  document.getElementById(`${tab.dataset.view}View`).classList.add("is-active");
  if (tab.dataset.view === "wall") updateWallView();
  if (tab.dataset.view === "delivery") renderDeliveryView();
  if (tab.dataset.view === "three") updateThreeView();
}));

elements.threeRotateLeft.addEventListener("click", () => { threeQuarterTurn = (threeQuarterTurn + 3) % 4; updateThreeView(); });
elements.threeRotateRight.addEventListener("click", () => { threeQuarterTurn = (threeQuarterTurn + 1) % 4; updateThreeView(); });
elements.threeReset.addEventListener("click", () => { threeQuarterTurn = 0; updateThreeView(); });
elements.threeCutawayToggle.addEventListener("change", () => { threeCutaway = elements.threeCutawayToggle.checked; updateThreeView(); });
elements.threeLabelsToggle.addEventListener("change", () => { threeShowLabels = elements.threeLabelsToggle.checked; updateThreeView(); });
elements.threeRoomFilter.addEventListener("change", () => { threeRoomId = elements.threeRoomFilter.value; updateThreeView(); });
for (const [toggle, layer] of [
  [elements.threeWallsToggle, "walls"],
  [elements.threeOpeningsToggle, "openings"],
  [elements.threeFeaturesToggle, "features"],
  [elements.threeFurnitureToggle, "furniture"],
]) toggle.addEventListener("change", () => { threeLayers[layer] = toggle.checked; updateThreeView(); });

elements.wallDiagramModeButton.addEventListener("click", () => setWallDisplayMode("diagram"));
elements.wallHeightModeButton.addEventListener("click", () => setWallDisplayMode("height"));
elements.wallScrollViewButton.addEventListener("click", () => setWallViewportMode("scroll"));
elements.wallOverviewButton.addEventListener("click", () => setWallViewportMode("overview"));

elements.menuButton.addEventListener("click", () => elements.dataMenu.showModal());
elements.displayMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleToolMenu(elements.displayMenuButton, elements.displayMenu);
});
elements.selectionMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleToolMenu(elements.selectionMenuButton, elements.selectionMenu);
});
elements.measureButton.addEventListener("click", () => setMeasurementMode(!renderer.measurementMode));
elements.measurementClearButton.addEventListener("click", () => renderer.clearMeasurement());
elements.measurementEndButton.addEventListener("click", () => setMeasurementMode(false));
elements.furnitureMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleToolMenu(elements.furnitureMenuButton, elements.furnitureMenu);
});
document.addEventListener("click", (event) => {
  if (!event.target.closest(".tool-menu")) closeToolMenus();
});
document.querySelectorAll("[data-selectable]").forEach((input) => input.addEventListener("change", () => {
  const selected = selectableByMode[locked ? "view" : "edit"];
  if (input.checked) selected.add(input.dataset.selectable);
  else selected.delete(input.dataset.selectable);
  renderer.setSelectableTypes(selected);
}));
[elements.importButton, elements.emptyImportButton].forEach((button) => button.addEventListener("click", () => elements.fileInput.click()));
elements.fileInput.addEventListener("change", async () => {
  const [file] = elements.fileInput.files;
  if (!file) return;
  try { await importFile(file); } catch (error) { showToast(`読み込み失敗: ${error.message}`); }
  elements.fileInput.value = "";
});
elements.exportButton.addEventListener("click", exportPlan);
elements.sampleButton.addEventListener("click", () => setActivePlan(createSamplePlan()).then(() => showToast("架空サンプルを読み込みました")));
elements.furnitureButton.addEventListener("click", () => {
  closeToolMenus();
  if (!activePlan) return showToast("先に間取りデータを読み込んでください");
  editingFurnitureId = null;
  elements.furnitureRoom.replaceChildren(...activePlan.plan.rooms.map((room) => new Option(room.name, room.id)));
  elements.furnitureWidth.value = "100";
  elements.furnitureDepth.value = "50";
  elements.furnitureHeight.value = "";
  elements.furnitureName.value = "家具";
  elements.furniturePreset.value = "custom";
  updateFurnitureSupportOptions();
  elements.furnitureDialogTitle.textContent = "家具を追加";
  elements.furnitureSubmitButton.textContent = "追加する";
  elements.furnitureDialog.showModal();
});
elements.furnitureListButton.addEventListener("click", () => {
  closeToolMenus();
  if (!activePlan) return showToast("先に間取りデータを読み込んでください");
  renderFurnitureList();
  elements.furnitureListDialog.showModal();
});
const furniturePresets = {
  dining: { name: "ダイニングテーブル", width: 140, depth: 80 },
  sofa: { name: "ソファ", width: 180, depth: 85 },
  "single-bed": { name: "シングルベッド", width: 97, depth: 195 },
  "tv-board": { name: "テレビ台", width: 150, depth: 40 },
  fridge: { name: "冷蔵庫", width: 70, depth: 70 },
  washer: { name: "洗濯機", width: 60, depth: 60 },
  microwave: { name: "電子レンジ", width: 50, depth: 40 },
};
elements.furniturePreset.addEventListener("change", () => {
  const preset = furniturePresets[elements.furniturePreset.value];
  if (!preset) return;
  elements.furnitureName.value = preset.name;
  elements.furnitureWidth.value = String(preset.width);
  elements.furnitureDepth.value = String(preset.depth);
});
elements.furnitureRoom.addEventListener("change", () => updateFurnitureSupportOptions());
elements.furnitureSupport.addEventListener("change", () => {
  const support = findSupportItem(activePlan?.plan, elements.furnitureSupport.value);
  elements.furnitureSupportHelp.textContent = support
    ? `${support.name}の上端から高さを計算し、上面からはみ出さない範囲で移動できます。`
    : "設備や家具の上に置く場合、平面上の位置と3Dの高さを連動します。";
});
elements.cancelFurnitureButton.addEventListener("click", () => {
  editingFurnitureId = null;
  elements.furnitureDialog.close();
});
elements.cancelDeliveryButton.addEventListener("click", () => {
  deliveryFurnitureId = null;
  elements.deliveryDialog.close();
});
elements.deliveryForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const furniture = activePlan?.plan.furniture.find((item) => item.id === deliveryFurnitureId);
  if (!furniture) return showToast("対象の家具が見つかりません");
  const sides = [Number(elements.deliverySideA.value), Number(elements.deliverySideB.value), Number(elements.deliverySideC.value)];
  if (!sides.every((value) => Number.isFinite(value) && value > 0)) return showToast("搬入寸法を確認してください");
  pushHistory();
  furniture.deliveryDimensions = {
    sideACm: sides[0],
    sideBCm: sides[1],
    sideCCm: sides[2],
    basis: elements.deliveryBasis.value === "body" ? "body" : "packed",
  };
  await persistActivePlan();
  renderDeliveryView();
  deliveryFurnitureId = null;
  elements.deliveryDialog.close();
  showToast("搬入時の寸法を保存しました");
});
elements.furnitureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const room = activePlan.plan.rooms.find((item) => item.id === elements.furnitureRoom.value) ?? activePlan.plan.rooms[0];
  const widthCm = Number(elements.furnitureWidth.value);
  const depthCm = Number(elements.furnitureDepth.value);
  const heightText = elements.furnitureHeight.value.trim();
  const heightCm = heightText === "" ? null : Number(heightText);
  if (!Number.isFinite(widthCm) || !Number.isFinite(depthCm) || widthCm <= 0 || depthCm <= 0) return showToast("家具寸法を確認してください");
  if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm <= 0)) return showToast("家具の高さを確認してください");
  const name = elements.furnitureName.value.trim() || "家具";
  const supportId = elements.furnitureSupport.value || null;
  if (editingFurnitureId) {
    const furniture = activePlan.plan.furniture.find((item) => item.id === editingFurnitureId);
    if (!furniture) return showToast("編集する家具が見つかりません");
    pushHistory();
    updateFurniture(furniture, { name, roomId: room.id, widthCm, depthCm, heightCm, supportId });
    alignFurnitureToSupport(activePlan.plan, furniture);
    alignSupportedFurniture(activePlan.plan);
    renderer.render(activePlan);
    renderDeliveryView();
    await persistActivePlan();
    editingFurnitureId = null;
    elements.furnitureDialog.close();
    showToast("家具の内容を変更しました");
    return;
  }
  const anchor = room.label ?? room.points[0];
  pushHistory();
  setFurnitureVisible(true);
  const furniture = {
    id: crypto.randomUUID(),
    name,
    roomId: room.id,
    x: anchor.x - widthCm / 2,
    y: anchor.y - depthCm / 2,
    widthCm,
    depthCm,
    quality: "measured",
  };
  if (heightCm !== null) furniture.heightCm = heightCm;
  if (supportId) furniture.supportId = supportId;
  alignFurnitureToSupport(activePlan.plan, furniture);
  activePlan.plan.furniture.push(furniture);
  renderer.render(activePlan);
  renderDeliveryView();
  await persistActivePlan();
  elements.furnitureDialog.close();
  showToast("家具を追加しました。編集モードで移動できます");
});
elements.editFurnitureButton.addEventListener("click", () => {
  if (locked) return;
  const furniture = selectedFurniture();
  if (!furniture) return;
  editingFurnitureId = furniture.id;
  elements.furniturePreset.value = "custom";
  elements.furnitureName.value = furniture.name;
  elements.furnitureWidth.value = String(furniture.widthCm);
  elements.furnitureDepth.value = String(furniture.depthCm);
  elements.furnitureHeight.value = Number.isFinite(furniture.heightCm) ? String(furniture.heightCm) : "";
  elements.furnitureRoom.replaceChildren(...activePlan.plan.rooms.map((room) => new Option(room.name, room.id, false, room.id === furniture.roomId)));
  updateFurnitureSupportOptions(furniture.supportId ?? "");
  elements.furnitureSupport.dispatchEvent(new Event("change"));
  elements.furnitureDialogTitle.textContent = "家具を編集";
  elements.furnitureSubmitButton.textContent = "変更を保存";
  elements.detailDialog.close();
  elements.furnitureDialog.showModal();
});
elements.rotateFurnitureButton.addEventListener("click", async () => {
  if (locked) return;
  const furniture = selectedFurniture();
  if (!furniture) return;
  pushHistory();
  rotateFurniture(furniture);
  await commitFurnitureChange("家具を90°回転しました");
});
elements.duplicateFurnitureButton.addEventListener("click", async () => {
  if (locked) return;
  const furniture = selectedFurniture();
  if (!furniture) return;
  pushHistory();
  activePlan.plan.furniture.push(duplicateFurniture(furniture, crypto.randomUUID()));
  await commitFurnitureChange("家具を複製しました");
});
elements.deleteFurnitureButton.addEventListener("click", async () => {
  if (locked) return;
  const furniture = selectedFurniture();
  if (!furniture || !confirm(`「${furniture.name}」を削除しますか？`)) return;
  pushHistory();
  activePlan.plan.furniture = activePlan.plan.furniture.filter((item) => item.id !== furniture.id);
  for (const item of activePlan.plan.furniture) if (item.supportId === furniture.id) {
    delete item.supportId;
    delete item.supportOffsetX;
    delete item.supportOffsetY;
  }
  await commitFurnitureChange("家具を削除しました");
});
elements.furnitureRoomEdit.addEventListener("change", async () => {
  if (locked) return;
  const furniture = selectedFurniture();
  if (!furniture || furniture.roomId === elements.furnitureRoomEdit.value) return;
  pushHistory();
  furniture.roomId = elements.furnitureRoomEdit.value;
  renderer.setSelectedFurniture(furniture.id);
  await persistActivePlan();
  const room = activePlan.plan.rooms.find((candidate) => candidate.id === furniture.roomId);
  const detailItem = room ? { ...furniture, roomName: room.name, placement: analyzeFurniturePlacement(furniture, room), conflicts: analyzeFurnitureConflicts(furniture, activePlan.plan) } : furniture;
  elements.detailBody.innerHTML = detailMarkup("furniture", detailItem);
  showToast(`設置する部屋を「${room?.name ?? "未設定"}」に変更しました`);
});
elements.undoButton.addEventListener("click", async () => {
  if (!history.length) return;
  activePlan = history.pop();
  renderer.render(activePlan);
  updateSummary();
  updateWallView();
  renderDeliveryView();
  updateUndoButton();
  await persistActivePlan();
  showToast("直前の変更を戻しました");
});
elements.resetButton.addEventListener("click", async () => {
  if (!confirm("この端末に保存した間取りデータを消去しますか？")) return;
  await deleteActivePlan();
  activePlan = null;
  history.length = 0;
  renderer.render(null);
  updateSummary();
  updateWallView();
  renderDeliveryView();
  updateDimensionFilters();
  updateUndoButton();
  elements.dataMenu.close();
  showToast("端末内データを消去しました");
});
elements.lockButton.addEventListener("click", () => {
  locked = !locked;
  elements.lockButton.setAttribute("aria-pressed", String(locked));
  elements.lockButton.classList.toggle("is-active", locked);
  elements.lockButton.textContent = locked ? "🔒 閲覧" : "🔓 編集";
  renderer.setLocked(locked);
  syncSelectableControls();
  closeToolMenus();
  showToast(locked ? "閲覧モードに切り替えました" : "家具などの編集操作ができます");
});
elements.snapToggle.addEventListener("change", () => renderer.setSnapEnabled(elements.snapToggle.checked));
elements.displayRoomLabelsToggle.addEventListener("change", () => renderer.setRoomLabelsVisible(elements.displayRoomLabelsToggle.checked));
elements.displayFeaturesToggle.addEventListener("change", () => renderer.setFeaturesVisible(elements.displayFeaturesToggle.checked));
elements.displayFurnitureToggle.addEventListener("change", () => renderer.setFurnitureVisible(elements.displayFurnitureToggle.checked));
elements.displayElectricalToggle.addEventListener("change", () => renderer.setElectricalVisible(elements.displayElectricalToggle.checked));
elements.displayDimensionsToggle.addEventListener("change", () => {
  renderer.setDimensionsVisible(elements.displayDimensionsToggle.checked);
  elements.dimensionFilters.hidden = !elements.displayDimensionsToggle.checked || !activePlan?.plan.dimensions.length;
});
elements.fitButton.addEventListener("click", () => renderer.fit());
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

updateConnection();
updateDimensionFilters();
syncSelectableControls();
updateUndoButton();
loadActivePlan().then((plan) => {
  if (!plan) return updateSummary();
  const validated = validatePlan(plan);
  const legacySample = validated.meta.title === "架空サンプル住戸"
    && (validated.meta.sampleVersion !== 3
      || !validated.plan.features.some((feature) => feature.kind === "kitchen")
      || !validated.plan.accessRoute
      || buildElevationItems(validated, "sample-room").length === 0);
  return setActivePlan(legacySample ? createSamplePlan() : validated, { persist: legacySample });
}).catch(() => {
  updateSummary();
  showToast("端末内データを開けませんでした");
});

if ("serviceWorker" in navigator) {
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js")
    .then((registration) => registration.update())
    .catch(() => showToast("オフライン準備に失敗しました")));
}

