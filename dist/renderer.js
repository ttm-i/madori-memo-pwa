import { analyzeFurnitureConflicts, analyzeFurniturePlacement, getDimensionGroup, moveDimensionGuide, QUALITY_LABELS, snapToGrid } from "./model.js";

const NS = "http://www.w3.org/2000/svg";

function svg(name, attributes = {}, text = "") {
  const element = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  if (text) element.textContent = text;
  return element;
}

function pointsValue(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export class PlanRenderer {
  constructor(svgElement, layer, onSelect, onFurnitureEvent) {
    this.svg = svgElement;
    this.layer = layer;
    this.onSelect = onSelect;
    this.onFurnitureEvent = onFurnitureEvent;
    this.transform = { x: 70, y: 50, scale: 0.78 };
    this.pointers = new Map();
    this.lastDistance = null;
    this.locked = true;
    this.snapEnabled = true;
    this.draggingFurniture = null;
    this.draggingDimension = null;
    this.selectedFurnitureId = null;
    this.dimensionScope = "all";
    this.bindGestures();
  }

  render(documentData) {
    this.layer.replaceChildren();
    this.document = documentData;
    if (!documentData) return;

    const defs = svg("defs");
    const pattern = svg("pattern", { id: "uncertainPattern", width: 12, height: 12, patternUnits: "userSpaceOnUse", patternTransform: "rotate(45)" });
    pattern.append(svg("rect", { width: 12, height: 12, fill: "#f2e5d5" }), svg("line", { x1: 0, y1: 0, x2: 0, y2: 12, stroke: "#c7854c", "stroke-width": 4 }));
    defs.append(pattern);
    this.layer.append(defs);

    const content = svg("g", { class: "plan-content" });
    for (const room of documentData.plan.rooms) {
      const group = svg("g", { "data-id": room.id });
      const polygon = svg("polygon", { class: `room-shape ${room.uncertain ? "uncertain" : ""}`, points: pointsValue(room.points), fill: room.color ?? "#eee8d9" });
      polygon.addEventListener("click", () => this.onSelect("room", room));
      group.append(polygon);
      if (room.label) {
        group.append(svg("text", { class: "room-label", x: room.label.x, y: room.label.y }, room.name));
        if (room.areaLabel) group.append(svg("text", { class: "room-area", x: room.label.x, y: room.label.y + 24 }, room.areaLabel));
      }
      content.append(group);
    }

    for (const wall of documentData.plan.walls ?? []) {
      content.append(svg("line", {
        class: `wall-line ${wall.uncertain ? "uncertain" : ""}`,
        x1: wall.from.x,
        y1: wall.from.y,
        x2: wall.to.x,
        y2: wall.to.y,
        "stroke-width": wall.thicknessCm ?? 10,
      }));
    }

    for (const opening of documentData.plan.openings ?? []) {
      const line = svg("line", { class: `opening-line ${opening.uncertain ? "uncertain" : ""}`, x1: opening.from.x, y1: opening.from.y, x2: opening.to.x, y2: opening.to.y, tabindex: 0, role: "button", "aria-label": opening.name });
      line.addEventListener("click", () => this.onSelect("opening", opening));
      content.append(line);
    }

    for (const feature of documentData.plan.features ?? []) {
      const group = svg("g", { class: `feature ${feature.uncertain ? "uncertain" : ""}` });
      const rect = svg("rect", { class: `feature-shape ${feature.uncertain ? "uncertain" : ""}`, x: feature.x, y: feature.y, width: feature.width, height: feature.height, rx: 4, tabindex: 0, role: "button", "aria-label": feature.name });
      rect.addEventListener("click", () => this.onSelect("feature", feature));
      group.append(rect);
      if (feature.shortLabel) {
        group.append(svg("text", {
          class: "feature-label",
          x: feature.x + feature.width / 2,
          y: feature.y + feature.height / 2,
        }, feature.shortLabel));
      }
      content.append(group);
    }

    for (const furniture of documentData.plan.furniture ?? []) {
      const room = documentData.plan.rooms.find((item) => item.id === furniture.roomId);
      const placement = analyzeFurniturePlacement(furniture, room);
      const conflicts = analyzeFurnitureConflicts(furniture, documentData.plan);
      const selected = furniture.id === this.selectedFurnitureId;
      const group = svg("g", { class: `furniture-group ${selected ? "selected" : ""} ${placement.inside ? "" : "out-of-room"} ${conflicts.length ? "has-conflict" : ""}`, "data-furniture-id": furniture.id, tabindex: 0, role: "button", "aria-label": `${furniture.name}${placement.inside ? "" : " 部屋外"}${conflicts.length ? " 重なりあり" : ""}` });
      const rect = svg("rect", { class: "furniture-shape", x: furniture.x, y: furniture.y, width: furniture.widthCm, height: furniture.depthCm, rx: 5 });
      const label = svg("text", { class: "furniture-label", x: furniture.x + furniture.widthCm / 2, y: furniture.y + furniture.depthCm / 2 - 7 }, furniture.name);
      const sizeLabel = svg("text", { class: "furniture-size-label", x: furniture.x + furniture.widthCm / 2, y: furniture.y + furniture.depthCm / 2 + 10 }, `${furniture.widthCm}×${furniture.depthCm}`);
      group.append(rect, label, sizeLabel);
      if (selected && placement.inside && placement.boundaries) {
        const centerX = furniture.x + furniture.widthCm / 2;
        const centerY = furniture.y + furniture.depthCm / 2;
        const guides = [
          [placement.boundaries.left, centerY, furniture.x, centerY, placement.clearances.left, "horizontal"],
          [furniture.x + furniture.widthCm, centerY, placement.boundaries.right, centerY, placement.clearances.right, "horizontal"],
          [centerX, placement.boundaries.top, centerX, furniture.y, placement.clearances.top, "vertical"],
          [centerX, furniture.y + furniture.depthCm, centerX, placement.boundaries.bottom, placement.clearances.bottom, "vertical"],
        ];
        for (const [x1, y1, x2, y2, distance, direction] of guides) {
          if (![x1, y1, x2, y2, distance].every(Number.isFinite)) continue;
          group.append(svg("line", { class: "placement-guide", x1, y1, x2, y2 }));
          group.append(svg("text", {
            class: "placement-distance",
            x: (x1 + x2) / 2 + (direction === "vertical" ? 12 : 0),
            y: (y1 + y2) / 2 + (direction === "horizontal" ? -6 : 0),
          }, `${Math.round(distance * 10) / 10} cm`));
        }
      }
      if (!placement.inside || conflicts.length) {
        const warning = !placement.inside && conflicts.length ? "⚠ 部屋外・重なり" : !placement.inside ? "⚠ 部屋外" : "⚠ 重なり";
        group.append(svg("text", { class: "placement-warning", x: furniture.x + furniture.widthCm / 2, y: furniture.y - 10 }, warning));
      }
      group.addEventListener("click", () => { if (this.locked) this.onSelect("furniture", furniture); });
      group.addEventListener("pointerdown", (event) => {
        if (this.locked) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        this.onFurnitureEvent?.("start");
        this.draggingFurniture = {
          furniture, rect, label, sizeLabel,
          clientX: event.clientX, clientY: event.clientY,
          startX: furniture.x, startY: furniture.y,
        };
      });
      content.append(group);
    }

    for (const dimension of documentData.plan.dimensions ?? []) {
      const label = `${dimension.label ?? dimension.valueCm} cm`;
      const horizontal = Math.abs(dimension.to.x - dimension.from.x) >= Math.abs(dimension.to.y - dimension.from.y);
      const dimensionGroup = getDimensionGroup(dimension);
      const group = svg("g", {
        class: `dimension ${horizontal ? "horizontal" : "vertical"} ${dimension.uncertain ? "uncertain" : ""} ${this.dimensionScope !== "all" && this.dimensionScope !== dimensionGroup ? "scope-hidden" : ""}`,
        "data-dimension-group": dimensionGroup,
        tabindex: 0,
        role: "button",
        "aria-label": `${dimension.name ?? "寸法"} ${label}`,
      });
      const dx = dimension.to.x - dimension.from.x;
      const dy = dimension.to.y - dimension.from.y;
      const segmentLength = Math.hypot(dx, dy) || 1;
      const normal = { x: -dy / segmentLength, y: dx / segmentLength };
      const capHalf = 6;
      const lineAttributes = { x1: dimension.from.x, y1: dimension.from.y, x2: dimension.to.x, y2: dimension.to.y };

      if (dimension.witnessFrom) group.append(svg("line", { class: "dimension-witness", x1: dimension.witnessFrom.x, y1: dimension.witnessFrom.y, x2: dimension.from.x, y2: dimension.from.y }));
      if (dimension.witnessTo) group.append(svg("line", { class: "dimension-witness", x1: dimension.witnessTo.x, y1: dimension.witnessTo.y, x2: dimension.to.x, y2: dimension.to.y }));
      group.append(svg("line", { class: "dimension-hit", ...lineAttributes }));
      group.append(svg("line", { class: "dimension-line", ...lineAttributes }));
      for (const point of [dimension.from, dimension.to]) {
        group.append(svg("line", {
          class: "dimension-cap",
          x1: point.x - normal.x * capHalf,
          y1: point.y - normal.y * capHalf,
          x2: point.x + normal.x * capHalf,
          y2: point.y + normal.y * capHalf,
        }));
      }
      const labelOffset = dimension.labelOffset ?? -14;
      const midX = (dimension.from.x + dimension.to.x) / 2 + normal.x * labelOffset;
      const midY = (dimension.from.y + dimension.to.y) / 2 + normal.y * labelOffset;
      group.append(svg("text", { class: "dimension-text", x: midX, y: midY }, label));
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        if (!this.locked) return;
        this.onSelect("dimension", { ...dimension, name: dimension.name ?? "寸法" });
      });
      group.addEventListener("pointerdown", (event) => {
        if (this.locked) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        this.onFurnitureEvent?.("start");
        this.draggingDimension = { dimension, group, horizontal, clientX: event.clientX, clientY: event.clientY, offset: 0 };
      });
      content.append(group);
    }
    this.layer.append(content);
    this.applyTransform();
  }

  setLocked(value) {
    this.locked = value;
    this.svg.classList.toggle("editing", !value);
  }
  setDimensionsVisible(value) { this.svg.classList.toggle("dimensions-hidden", !value); }
  setUncertaintyVisible(value) { this.svg.classList.toggle("uncertainty-hidden", !value); }
  setFeaturesVisible(value) { this.svg.classList.toggle("features-hidden", !value); }
  setFurnitureVisible(value) { this.svg.classList.toggle("furniture-hidden", !value); }
  setSnapEnabled(value) { this.snapEnabled = value; }
  setDimensionScope(value) {
    this.dimensionScope = value;
    this.layer.querySelectorAll(".dimension").forEach((group) => {
      group.classList.toggle("scope-hidden", value !== "all" && group.dataset.dimensionGroup !== value);
    });
  }
  setSelectedFurniture(id) {
    this.selectedFurnitureId = id;
    if (this.document) this.render(this.document);
  }

  fit() {
    if (!this.document) return;
    const bounds = this.document.plan.bounds;
    const viewport = this.svg.viewBox.baseVal;
    const scale = Math.min((viewport.width - 90) / bounds.width, (viewport.height - 90) / bounds.height);
    this.transform.scale = Math.max(0.15, scale);
    this.transform.x = (viewport.width - bounds.width * scale) / 2 - bounds.x * scale;
    this.transform.y = (viewport.height - bounds.height * scale) / 2 - bounds.y * scale;
    this.applyTransform();
  }

  applyTransform() {
    const { x, y, scale } = this.transform;
    this.layer.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
  }

  bindGestures() {
    this.svg.addEventListener("pointerdown", (event) => {
      event.target.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (this.draggingFurniture) {
        const drag = this.draggingFurniture;
        const rect = this.svg.getBoundingClientRect();
        const viewport = this.svg.viewBox.baseVal;
        const dx = (event.clientX - drag.clientX) * viewport.width / rect.width / this.transform.scale;
        const dy = (event.clientY - drag.clientY) * viewport.height / rect.height / this.transform.scale;
        drag.furniture.x = this.snapEnabled ? snapToGrid(drag.startX + dx) : drag.startX + dx;
        drag.furniture.y = this.snapEnabled ? snapToGrid(drag.startY + dy) : drag.startY + dy;
        drag.rect.setAttribute("x", drag.furniture.x);
        drag.rect.setAttribute("y", drag.furniture.y);
        drag.label.setAttribute("x", drag.furniture.x + drag.furniture.widthCm / 2);
        drag.label.setAttribute("y", drag.furniture.y + drag.furniture.depthCm / 2 - 7);
        drag.sizeLabel.setAttribute("x", drag.furniture.x + drag.furniture.widthCm / 2);
        drag.sizeLabel.setAttribute("y", drag.furniture.y + drag.furniture.depthCm / 2 + 10);
        return;
      }
      if (this.draggingDimension) {
        const drag = this.draggingDimension;
        const rect = this.svg.getBoundingClientRect();
        const viewport = this.svg.viewBox.baseVal;
        const dx = (event.clientX - drag.clientX) * viewport.width / rect.width / this.transform.scale;
        const dy = (event.clientY - drag.clientY) * viewport.height / rect.height / this.transform.scale;
        drag.offset = drag.horizontal ? dy : dx;
        drag.group.setAttribute("transform", drag.horizontal ? `translate(0 ${drag.offset})` : `translate(${drag.offset} 0)`);
        return;
      }
      if (!this.pointers.has(event.pointerId)) return;
      const previous = this.pointers.get(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const values = [...this.pointers.values()];
      if (values.length === 1) {
        const rect = this.svg.getBoundingClientRect();
        const viewport = this.svg.viewBox.baseVal;
        this.transform.x += (event.clientX - previous.x) * viewport.width / rect.width;
        this.transform.y += (event.clientY - previous.y) * viewport.height / rect.height;
      } else if (values.length === 2) {
        const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
        if (this.lastDistance) this.transform.scale = Math.min(4, Math.max(.15, this.transform.scale * (distance / this.lastDistance)));
        this.lastDistance = distance;
      }
      this.applyTransform();
    });
    const release = (event) => {
      if (this.draggingFurniture) {
        this.draggingFurniture = null;
        this.onFurnitureEvent?.("commit");
        return;
      }
      if (this.draggingDimension) {
        const drag = this.draggingDimension;
        this.draggingDimension = null;
        moveDimensionGuide(drag.dimension, Math.round(drag.offset * 10) / 10);
        this.render(this.document);
        this.onFurnitureEvent?.("commit");
        return;
      }
      this.pointers.delete(event.pointerId);
      if (this.pointers.size < 2) this.lastDistance = null;
    };
    this.svg.addEventListener("pointerup", release);
    this.svg.addEventListener("pointercancel", release);
    this.svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : .92;
      this.transform.scale = Math.min(4, Math.max(.15, this.transform.scale * factor));
      this.applyTransform();
    }, { passive: false });
  }
}

export function detailMarkup(type, item) {
  const escapeHTML = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
  const values = [];
  if (type === "room") {
    if (item.areaLabel) values.push(["面積", item.areaLabel]);
    values.push(["頂点", `${item.points.length}点`]);
  } else if (type === "dimension") {
    values.push(["寸法", `${item.label ?? item.valueCm} cm`]);
  } else {
    if (Number.isFinite(item.widthCm)) values.push(["幅", `${item.widthCm} cm`]);
    if (Number.isFinite(item.depthCm)) values.push(["奥行", `${item.depthCm} cm`]);
    if (!Number.isFinite(item.widthCm) && Number.isFinite(item.width)) values.push(["表示幅", `${item.width} cm`]);
    if (!Number.isFinite(item.depthCm) && Number.isFinite(item.height)) values.push(["表示奥行", `${item.height} cm`]);
    if (item.kind) values.push(["種類", item.kind]);
    if (type === "furniture" && item.roomName) values.push(["配置先", item.roomName]);
    if (type === "furniture" && item.placement?.inside) {
      const labels = { left: "左の壁まで", right: "右の壁まで", top: "上の壁まで", bottom: "下の壁まで" };
      for (const [key, label] of Object.entries(labels)) {
        const value = item.placement.clearances?.[key];
        if (Number.isFinite(value)) values.push([label, `${Math.round(value * 10) / 10} cm`]);
      }
    }
  }
  const quality = item.quality ?? (item.uncertain ? "unmeasured" : "measured");
  const safeQuality = escapeHTML(QUALITY_LABELS[quality] ?? quality);
  const list = values.length ? `<dl class="detail-list">${values.map(([key, value]) => `<dt>${escapeHTML(key)}</dt><dd>${escapeHTML(value)}</dd>`).join("")}</dl>` : "<p>詳細値はまだ登録されていません。</p>";
  const warnings = [];
  if (type === "furniture" && item.placement && !item.placement.inside) warnings.push("指定した部屋から家具がはみ出しています。");
  if (type === "furniture" && item.conflicts?.length) warnings.push(`重なり: ${item.conflicts.map((conflict) => escapeHTML(conflict.name)).join("、")}`);
  const warning = warnings.length ? `<p class="placement-alert">${warnings.join("<br>")}</p>` : "";
  return `${list}${warning}<span class="quality-tag ${escapeHTML(quality)}">${safeQuality}</span>${item.note ? `<p>${escapeHTML(item.note)}</p>` : ""}`;
}

