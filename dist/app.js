import { deleteActivePlan, loadActivePlan, saveActivePlan } from "./db.js";
import { analyzeFurnitureConflicts, analyzeFurniturePlacement, countQualities, createSamplePlan, DIMENSION_GROUP_LABELS, duplicateFurniture, getDimensionGroup, rotateFurniture, updateFurniture, validatePlan } from "./model.js";
import { detailMarkup, PlanRenderer } from "./renderer.js";

const elements = Object.fromEntries([
  "menuButton", "dataMenu", "detailDialog", "detailType", "detailTitle", "detailBody", "fileInput",
  "importButton", "emptyImportButton", "exportButton", "resetButton", "sampleButton", "emptyState",
  "planCanvas", "viewportLayer", "canvasFrame", "lockButton", "dimensionsButton", "fitButton", "undoButton",
  "dimensionFilters", "dimensionFilterList", "selectionMenuButton", "selectionMenu", "selectionModeHint",
  "furnitureMenuButton", "furnitureMenu", "furnitureLayerToggle", "snapToggle",
  "summaryTitle", "roomCount", "measuredCount", "uncertainCount", "connectionBadge", "saveStatus", "toast",
  "furnitureButton", "furnitureDialog", "furnitureForm", "cancelFurnitureButton",
  "furnitureName", "furnitureWidth", "furnitureDepth", "furnitureRoom", "furniturePreset",
  "furnitureActions", "rotateFurnitureButton", "duplicateFurnitureButton", "deleteFurnitureButton",
  "furnitureRoomEditGroup", "furnitureRoomEdit",
  "editFurnitureButton", "furnitureDialogTitle", "furnitureSubmitButton",
  "furnitureListButton", "furnitureListDialog", "furnitureList", "furnitureListCount",
].map((id) => [id, document.getElementById(id)]));

let activePlan = null;
let toastTimer = null;
let selectedFurnitureId = null;
let editingFurnitureId = null;
let locked = true;
let dimensionGroups = new Set();
const selectableByMode = {
  view: new Set(["room", "dimension", "equipment", "furniture"]),
  edit: new Set(["furniture"]),
};
const history = [];
const renderer = new PlanRenderer(elements.planCanvas, elements.viewportLayer, showDetail, handleFurnitureEvent, handleViewChange);

function updateUndoButton() {
  elements.undoButton.hidden = history.length === 0;
}

function handleViewChange(changed) {
  elements.fitButton.hidden = !activePlan || !changed;
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
    renderer.render(activePlan);
    persistActivePlan();
  }
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

function updateDimensionFilters() {
  const groups = activePlan ? [...new Set(activePlan.plan.dimensions.map(getDimensionGroup))] : [];
  const order = ["wet", "hall", "ldk", "bedroom", "balcony", "other"];
  groups.sort((first, second) => order.indexOf(first) - order.indexOf(second));
  dimensionGroups = new Set(groups);
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
  const chips = groups.length ? [makeChip("all", "すべて"), ...groups.map((group) => makeChip(group, DIMENSION_GROUP_LABELS[group] ?? group))] : [];
  elements.dimensionFilterList.replaceChildren(...chips);
  elements.dimensionFilters.hidden = !groups.length || elements.dimensionsButton.getAttribute("aria-pressed") !== "true";
  renderer.setDimensionGroups(groups);

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
  history.length = 0;
  updateUndoButton();
  renderer.render(plan);
  updateSummary();
  updateDimensionFilters();
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
  selectedFurnitureId = type === "furniture" ? item.id : null;
  renderer.setSelectedFurniture(selectedFurnitureId);
  const furnitureEditable = type === "furniture" && !locked;
  elements.furnitureActions.hidden = !furnitureEditable;
  elements.furnitureRoomEditGroup.hidden = !furnitureEditable;
  const typeLabels = { room: "ROOM", dimension: "DIMENSION", opening: "OPENING", feature: "EQUIPMENT", furniture: "FURNITURE" };
  const detailClasses = ["detail-room", "detail-dimension", "detail-equipment", "detail-furniture"];
  elements.detailDialog.classList.remove(...detailClasses);
  elements.detailDialog.classList.add(type === "room" ? "detail-room" : type === "dimension" ? "detail-dimension" : type === "furniture" ? "detail-furniture" : "detail-equipment");
  elements.detailType.textContent = typeLabels[type] ?? "DETAIL";
  elements.detailTitle.textContent = item.name;
  const room = type === "furniture" ? activePlan.plan.rooms.find((candidate) => candidate.id === item.roomId) : null;
  const detailItem = room ? { ...item, roomName: room.name, placement: analyzeFurniturePlacement(item, room), conflicts: analyzeFurnitureConflicts(item, activePlan.plan) } : item;
  elements.detailBody.innerHTML = detailMarkup(type, detailItem);
  if (type === "furniture") {
    elements.furnitureRoomEdit.replaceChildren(...activePlan.plan.rooms.map((candidate) => new Option(candidate.name, candidate.id, false, candidate.id === item.roomId)));
  }
  elements.detailDialog.showModal();
}

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
    const status = !placement.inside ? "・部屋外" : conflicts.length ? "・重なりあり" : "";
    roomLabel.textContent = `${room?.name ?? "未設定"}${status}`;
    const size = document.createElement("span");
    size.className = "furniture-list-size";
    size.textContent = `${furniture.widthCm}×${furniture.depthCm} cm`;
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
  renderer.render(activePlan);
  await persistActivePlan();
  elements.detailDialog.close();
  selectedFurnitureId = null;
  renderer.setSelectedFurniture(null);
  showToast(message);
}

function toggleButton(button, callback) {
  const next = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(next));
  button.classList.toggle("is-active", next);
  callback(next);
}

function setFurnitureVisible(value) {
  elements.furnitureLayerToggle.checked = value;
  renderer.setFurnitureVisible(value);
}

function closeToolMenus(except = null) {
  for (const [button, menu] of [[elements.selectionMenuButton, elements.selectionMenu], [elements.furnitureMenuButton, elements.furnitureMenu]]) {
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

document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
  document.querySelectorAll(".tab").forEach((item) => item.classList.toggle("is-active", item === tab));
  document.querySelectorAll(".view").forEach((view) => view.classList.remove("is-active"));
  document.getElementById(`${tab.dataset.view}View`).classList.add("is-active");
}));

elements.menuButton.addEventListener("click", () => elements.dataMenu.showModal());
elements.selectionMenuButton.addEventListener("click", (event) => {
  event.stopPropagation();
  toggleToolMenu(elements.selectionMenuButton, elements.selectionMenu);
});
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
  elements.furnitureName.value = "家具";
  elements.furniturePreset.value = "custom";
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
};
elements.furniturePreset.addEventListener("change", () => {
  const preset = furniturePresets[elements.furniturePreset.value];
  if (!preset) return;
  elements.furnitureName.value = preset.name;
  elements.furnitureWidth.value = String(preset.width);
  elements.furnitureDepth.value = String(preset.depth);
});
elements.cancelFurnitureButton.addEventListener("click", () => {
  editingFurnitureId = null;
  elements.furnitureDialog.close();
});
elements.furnitureForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const room = activePlan.plan.rooms.find((item) => item.id === elements.furnitureRoom.value) ?? activePlan.plan.rooms[0];
  const widthCm = Number(elements.furnitureWidth.value);
  const depthCm = Number(elements.furnitureDepth.value);
  if (!Number.isFinite(widthCm) || !Number.isFinite(depthCm) || widthCm <= 0 || depthCm <= 0) return showToast("家具寸法を確認してください");
  const name = elements.furnitureName.value.trim() || "家具";
  if (editingFurnitureId) {
    const furniture = activePlan.plan.furniture.find((item) => item.id === editingFurnitureId);
    if (!furniture) return showToast("編集する家具が見つかりません");
    pushHistory();
    updateFurniture(furniture, { name, roomId: room.id, widthCm, depthCm });
    renderer.render(activePlan);
    await persistActivePlan();
    editingFurnitureId = null;
    elements.furnitureDialog.close();
    showToast("家具の内容を変更しました");
    return;
  }
  const anchor = room.label ?? room.points[0];
  pushHistory();
  setFurnitureVisible(true);
  activePlan.plan.furniture.push({
    id: crypto.randomUUID(),
    name,
    roomId: room.id,
    x: anchor.x - widthCm / 2,
    y: anchor.y - depthCm / 2,
    widthCm,
    depthCm,
    quality: "measured",
  });
  renderer.render(activePlan);
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
  elements.furnitureRoom.replaceChildren(...activePlan.plan.rooms.map((room) => new Option(room.name, room.id, false, room.id === furniture.roomId)));
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
elements.furnitureLayerToggle.addEventListener("change", () => renderer.setFurnitureVisible(elements.furnitureLayerToggle.checked));
elements.dimensionsButton.addEventListener("click", () => toggleButton(elements.dimensionsButton, (value) => {
  renderer.setDimensionsVisible(value);
  elements.dimensionFilters.hidden = !value || !activePlan?.plan.dimensions.length;
}));
elements.fitButton.addEventListener("click", () => renderer.fit());
window.addEventListener("online", updateConnection);
window.addEventListener("offline", updateConnection);

updateConnection();
updateDimensionFilters();
syncSelectableControls();
updateUndoButton();
loadActivePlan().then((plan) => plan ? setActivePlan(validatePlan(plan), { persist: false }) : updateSummary()).catch(() => {
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

