import { analyzeFurnitureConflicts, analyzeFurniturePlacement, getDimensionGroup, getElectricalPlanPosition, moveDimensionGuide, QUALITY_LABELS, snapToGrid } from "./model.js?v=33";

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

export function zoomTransformAround(transform, previousAnchor, nextAnchor, factor, minScale = 0.15, maxScale = 4) {
  const scale = Math.min(maxScale, Math.max(minScale, transform.scale * factor));
  const contentX = (previousAnchor.x - transform.x) / transform.scale;
  const contentY = (previousAnchor.y - transform.y) / transform.scale;
  return {
    x: nextAnchor.x - contentX * scale,
    y: nextAnchor.y - contentY * scale,
    scale,
  };
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

export class PlanRenderer {
  constructor(svgElement, layer, onSelect, onFurnitureEvent, onViewChange) {
    this.svg = svgElement;
    this.layer = layer;
    this.onSelect = onSelect;
    this.onFurnitureEvent = onFurnitureEvent;
    this.onViewChange = onViewChange;
    this.transform = { x: 70, y: 50, scale: 0.78 };
    this.fitTransform = null;
    this.pointers = new Map();
    this.locked = true;
    this.snapEnabled = true;
    this.draggingFurniture = null;
    this.draggingDimension = null;
    this.selectedFurnitureId = null;
    this.dimensionGroups = null;
    this.selectableTypes = new Set(["room", "dimension", "equipment", "electrical", "furniture"]);
    this.suppressNextClick = false;
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
      const group = svg("g", { class: this.isSelectable("room") ? "" : "not-selectable", "data-id": room.id });
      const polygon = svg("polygon", { class: `room-shape ${room.uncertain ? "uncertain" : ""}`, points: pointsValue(room.points), fill: room.color ?? "#eee8d9" });
      polygon.addEventListener("click", () => { if (this.isSelectable("room")) this.onSelect("room", room); });
      group.append(polygon);
      room.points.forEach((from, index) => {
        if (room.nonWallEdges?.includes(index)) return;
        const to = room.points[(index + 1) % room.points.length];
        group.append(svg("line", {
          class: `room-boundary ${room.uncertain ? "uncertain" : ""}`,
          x1: from.x, y1: from.y, x2: to.x, y2: to.y,
        }));
      });
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
      const line = svg("line", { class: `opening-line ${opening.uncertain ? "uncertain" : ""} ${this.isSelectable("equipment") ? "" : "not-selectable"}`, x1: opening.from.x, y1: opening.from.y, x2: opening.to.x, y2: opening.to.y, tabindex: 0, role: "button", "aria-label": opening.name });
      line.addEventListener("click", () => { if (this.isSelectable("equipment")) this.onSelect("opening", opening); });
      content.append(line);
    }

    for (const feature of documentData.plan.features ?? []) {
      const placementUncertain = feature.placementQuality ? feature.placementQuality !== "confirmed" : Boolean(feature.uncertain);
      const group = svg("g", { class: `feature ${placementUncertain ? "placement-uncertain" : ""} ${this.isSelectable("equipment") ? "" : "not-selectable"}` });
      const rect = svg("rect", { class: `feature-shape ${placementUncertain ? "placement-uncertain" : ""}`, x: feature.x, y: feature.y, width: feature.width, height: feature.height, rx: 4, tabindex: 0, role: "button", "aria-label": feature.name });
      rect.addEventListener("click", () => { if (this.isSelectable("equipment")) this.onSelect("feature", feature); });
      group.append(rect);
      if (feature.kind === "kitchen") {
        for (const component of buildKitchenComponentRects(feature)) {
          group.append(svg("rect", {
            class: `kitchen-component kitchen-${component.kind}`,
            x: component.x, y: component.y, width: component.width, height: component.height, rx: 5,
          }));
          if (component.kind === "stove") {
            const burnerRadius = Math.max(3, Math.min(component.width, component.height) * 0.12);
            for (const xRatio of [0.3, 0.7]) for (const yRatio of [0.3, 0.7]) {
              group.append(svg("circle", {
                class: "kitchen-burner",
                cx: component.x + component.width * xRatio,
                cy: component.y + component.height * yRatio,
                r: burnerRadius,
              }));
            }
          }
          group.append(svg("text", {
            class: `kitchen-component-label kitchen-${component.kind}-label`,
            x: component.x + component.width / 2,
            y: component.y + component.height / 2,
          }, component.label));
        }
      }
      if (feature.shortLabel) {
        group.append(svg("text", {
          class: "feature-label",
          x: feature.x + feature.width / 2,
          y: feature.y + feature.height / 2,
        }, feature.shortLabel));
      }
      content.append(group);
    }

    const electricalItems = [
      ...(documentData.plan.electrical?.outlets ?? []).map((item) => ({ ...item, electricalType: "outlet" })),
      ...(documentData.plan.electrical?.switches ?? []).map((item) => ({ ...item, electricalType: "switch" })),
    ];
    for (const electrical of electricalItems) {
      const position = getElectricalPlanPosition(documentData, electrical);
      if (!position) continue;
      const selectable = this.isSelectable("electrical");
      const group = svg("g", {
        class: `electrical-marker electrical-${electrical.electricalType} ${selectable ? "" : "not-selectable"}`,
        tabindex: 0,
        role: "button",
        "aria-label": `${electrical.sourceLabel ?? ""} ${electrical.name}`.trim(),
      });
      if (position.anchor.x !== position.display.x || position.anchor.y !== position.display.y) {
        group.append(svg("line", {
          class: "electrical-leader",
          x1: position.anchor.x, y1: position.anchor.y,
          x2: position.display.x, y2: position.display.y,
        }));
      }
      group.append(svg("circle", { class: "electrical-hit", cx: position.display.x, cy: position.display.y, r: 25 }));
      if (electrical.electricalType === "outlet") {
        group.append(
          svg("circle", { class: "electrical-symbol", cx: position.display.x, cy: position.display.y, r: 12 }),
          svg("line", { class: "electrical-glyph", x1: position.display.x - 4, y1: position.display.y - 5, x2: position.display.x - 4, y2: position.display.y + 5 }),
          svg("line", { class: "electrical-glyph", x1: position.display.x + 4, y1: position.display.y - 5, x2: position.display.x + 4, y2: position.display.y + 5 }),
        );
      } else {
        group.append(
          svg("rect", { class: "electrical-symbol", x: position.display.x - 11, y: position.display.y - 11, width: 22, height: 22, rx: 4 }),
          svg("line", { class: "electrical-glyph", x1: position.display.x - 5, y1: position.display.y + 5, x2: position.display.x + 5, y2: position.display.y - 5 }),
        );
      }
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        if (selectable) this.onSelect(electrical.electricalType, electrical);
      });
      content.append(group);
    }

    for (const furniture of documentData.plan.furniture ?? []) {
      const room = documentData.plan.rooms.find((item) => item.id === furniture.roomId);
      const placement = analyzeFurniturePlacement(furniture, room);
      const conflicts = analyzeFurnitureConflicts(furniture, documentData.plan);
      const selected = furniture.id === this.selectedFurnitureId;
      const group = svg("g", { class: `furniture-group ${this.isSelectable("furniture") ? "" : "not-selectable"} ${selected ? "selected" : ""} ${placement.inside ? "" : "out-of-room"} ${conflicts.length ? "has-conflict" : ""}`, "data-furniture-id": furniture.id, tabindex: 0, role: "button", "aria-label": `${furniture.name}${placement.inside ? "" : " 部屋外"}${conflicts.length ? " 重なりあり" : ""}` });
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
      group.addEventListener("click", (event) => {
        event.stopPropagation();
        if (this.suppressNextClick) {
          this.suppressNextClick = false;
          return;
        }
        if (this.isSelectable("furniture")) this.onSelect("furniture", furniture);
      });
      group.addEventListener("pointerdown", (event) => {
        if (this.locked || !this.isSelectable("furniture")) return;
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        this.draggingFurniture = {
          furniture, rect, label, sizeLabel,
          clientX: event.clientX, clientY: event.clientY,
          startX: furniture.x, startY: furniture.y,
          moved: false,
        };
      });
      content.append(group);
    }

    for (const dimension of documentData.plan.dimensions ?? []) {
      const label = `${dimension.label ?? dimension.valueCm} cm`;
      const horizontal = Math.abs(dimension.to.x - dimension.from.x) >= Math.abs(dimension.to.y - dimension.from.y);
      const dimensionGroup = getDimensionGroup(dimension);
      const group = svg("g", {
        class: `dimension ${horizontal ? "horizontal" : "vertical"} ${dimension.uncertain ? "uncertain" : ""} ${this.dimensionGroups && !this.dimensionGroups.has(dimensionGroup) ? "scope-hidden" : ""} ${this.isSelectable("dimension") ? "" : "not-selectable"}`,
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
        if (this.suppressNextClick) {
          this.suppressNextClick = false;
          return;
        }
        if (this.isSelectable("dimension")) this.onSelect("dimension", { ...dimension, name: dimension.name ?? "寸法" });
      });
      group.addEventListener("pointerdown", (event) => {
        if (this.locked || !this.isSelectable("dimension")) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        this.draggingDimension = { dimension, group, horizontal, clientX: event.clientX, clientY: event.clientY, offset: 0, moved: false };
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
  setRoomLabelsVisible(value) { this.svg.classList.toggle("room-labels-hidden", !value); }
  setDimensionsVisible(value) { this.svg.classList.toggle("dimensions-hidden", !value); }
  setFeaturesVisible(value) { this.svg.classList.toggle("features-hidden", !value); }
  setFurnitureVisible(value) { this.svg.classList.toggle("furniture-hidden", !value); }
  setElectricalVisible(value) { this.svg.classList.toggle("electrical-hidden", !value); }
  setSnapEnabled(value) { this.snapEnabled = value; }
  setDimensionGroups(groups) {
    this.dimensionGroups = groups == null ? null : new Set(groups);
    this.layer.querySelectorAll(".dimension").forEach((group) => {
      group.classList.toggle("scope-hidden", this.dimensionGroups != null && !this.dimensionGroups.has(group.dataset.dimensionGroup));
    });
  }
  setSelectableTypes(types) {
    this.selectableTypes = new Set(types);
    if (this.document) this.render(this.document);
  }
  isSelectable(type) { return this.selectableTypes.has(type); }
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
    this.fitTransform = { ...this.transform };
    this.applyTransform();
  }

  applyTransform() {
    const { x, y, scale } = this.transform;
    this.layer.setAttribute("transform", `translate(${x} ${y}) scale(${scale})`);
    const changed = this.fitTransform != null && (
      Math.abs(x - this.fitTransform.x) > 0.5
      || Math.abs(y - this.fitTransform.y) > 0.5
      || Math.abs(scale - this.fitTransform.scale) > 0.001
    );
    this.onViewChange?.(changed);
  }

  bindGestures() {
    this.svg.addEventListener("pointerdown", (event) => {
      event.target.setPointerCapture?.(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    });
    this.svg.addEventListener("pointermove", (event) => {
      if (this.draggingFurniture) {
        const drag = this.draggingFurniture;
        if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
        if (!drag.moved) {
          drag.moved = true;
          this.onFurnitureEvent?.("start");
        }
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
        if (!drag.moved && Math.hypot(event.clientX - drag.clientX, event.clientY - drag.clientY) < 4) return;
        if (!drag.moved) {
          drag.moved = true;
          this.onFurnitureEvent?.("start");
        }
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
      const previousValues = [...this.pointers.values()];
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const values = [...this.pointers.values()];
      if (values.length === 1) {
        const rect = this.svg.getBoundingClientRect();
        const viewport = this.svg.viewBox.baseVal;
        this.transform.x += (event.clientX - previous.x) * viewport.width / rect.width;
        this.transform.y += (event.clientY - previous.y) * viewport.height / rect.height;
      } else if (values.length === 2) {
        const rect = this.svg.getBoundingClientRect();
        const viewport = this.svg.viewBox.baseVal;
        const toViewportPoint = (point) => ({
          x: viewport.x + (point.x - rect.left) * viewport.width / rect.width,
          y: viewport.y + (point.y - rect.top) * viewport.height / rect.height,
        });
        const previousDistance = Math.hypot(previousValues[1].x - previousValues[0].x, previousValues[1].y - previousValues[0].y);
        const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
        if (previousDistance > 0) {
          const previousMidpoint = toViewportPoint({
            x: (previousValues[0].x + previousValues[1].x) / 2,
            y: (previousValues[0].y + previousValues[1].y) / 2,
          });
          const midpoint = toViewportPoint({
            x: (values[0].x + values[1].x) / 2,
            y: (values[0].y + values[1].y) / 2,
          });
          this.transform = zoomTransformAround(this.transform, previousMidpoint, midpoint, distance / previousDistance);
        }
      }
      this.applyTransform();
    });
    const release = (event) => {
      if (this.draggingFurniture) {
        const moved = this.draggingFurniture.moved;
        this.draggingFurniture = null;
        if (moved) {
          this.suppressNextClick = true;
          setTimeout(() => { this.suppressNextClick = false; }, 0);
          this.onFurnitureEvent?.("commit");
        }
        return;
      }
      if (this.draggingDimension) {
        const drag = this.draggingDimension;
        this.draggingDimension = null;
        if (!drag.moved) return;
        this.suppressNextClick = true;
        setTimeout(() => { this.suppressNextClick = false; }, 0);
        moveDimensionGuide(drag.dimension, Math.round(drag.offset * 10) / 10);
        this.render(this.document);
        this.onFurnitureEvent?.("commit");
        return;
      }
      this.pointers.delete(event.pointerId);
    };
    this.svg.addEventListener("pointerup", release);
    this.svg.addEventListener("pointercancel", release);
    this.svg.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : .92;
      const rect = this.svg.getBoundingClientRect();
      const viewport = this.svg.viewBox.baseVal;
      const anchor = {
        x: viewport.x + (event.clientX - rect.left) * viewport.width / rect.width,
        y: viewport.y + (event.clientY - rect.top) * viewport.height / rect.height,
      };
      this.transform = zoomTransformAround(this.transform, anchor, anchor, factor);
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
  } else if (type === "outlet" || type === "switch") {
    const referenceLabels = {
      "left-side-wall": "左側の壁",
      "right-side-wall": "右側の壁",
      "wall-right-edge": "壁の右端",
      "wall-start": "壁の始点",
      "ldk-right-column": "LDK柱型",
      "counter-right-edge": "カウンター右端",
      "washroom-door": "洗面所ドア",
      "ldk-door": "LDKドア",
    };
    if (item.roomName) values.push(["場所", item.roomName]);
    if (item.sourceLabel) values.push(["図面記号", item.sourceLabel]);
    values.push(["種類", type === "outlet" ? "コンセント" : "スイッチ"]);
    if (type === "outlet" && Number.isFinite(item.receptacleCount)) values.push(["口数", `${item.receptacleCount}口`]);
    const centerHeight = item.verticalPosition?.centerHeightCm ?? item.verticalPosition?.derivedCenterHeightCm;
    if (Number.isFinite(centerHeight)) values.push(["中心高さ", `床から ${centerHeight} cm`]);
    if (item.horizontalPosition?.reference) values.push(["水平基準", referenceLabels[item.horizontalPosition.reference] ?? item.horizontalPosition.reference]);
    if (Number.isFinite(item.horizontalPosition?.offsetCm)) values.push(["基準から", `${item.horizontalPosition.offsetCm} cm`]);
    values.push(["測定点", "プレート中心"]);
  } else {
    if (item.kind === "kitchen") {
      if (Number.isFinite(item.overallWidthCm) && Number.isFinite(item.overallDepthCm)) values.push(["キッチン全体", `${item.overallWidthCm} × ${item.overallDepthCm} cm`]);
      if (Number.isFinite(item.worktopHeightCm)) values.push(["天板高さ", `床から ${item.worktopHeightCm} cm`]);
      if (Number.isFinite(item.horizontalSegmentsCm?.sinkWidth) && Number.isFinite(item.depthDetailsCm?.sinkDepth)) values.push(["シンク", `${item.horizontalSegmentsCm.sinkWidth} × ${item.depthDetailsCm.sinkDepth} cm`]);
      if (Number.isFinite(item.horizontalSegmentsCm?.stoveWidth) && Number.isFinite(item.depthDetailsCm?.stoveDepth)) values.push(["コンロ", `${item.horizontalSegmentsCm.stoveWidth} × ${item.depthDetailsCm.stoveDepth} cm`]);
      if (Number.isFinite(item.horizontalSegmentsCm?.sinkToStove)) values.push(["シンク～コンロ", `${item.horizontalSegmentsCm.sinkToStove} cm`]);
      if (Number.isFinite(item.horizontalSegmentsCm?.stoveToLeftEdge)) values.push(["左端～コンロ", `${item.horizontalSegmentsCm.stoveToLeftEdge} cm`]);
      if (Number.isFinite(item.horizontalSegmentsCm?.rightEdgeToSink)) values.push(["シンク～右端", `${item.horizontalSegmentsCm.rightEdgeToSink} cm`]);
    } else {
      if (Number.isFinite(item.widthCm)) values.push(["幅", `${item.widthCm} cm`]);
      if (Number.isFinite(item.depthCm)) values.push(["奥行", `${item.depthCm} cm`]);
      if (!Number.isFinite(item.widthCm) && Number.isFinite(item.width)) values.push(["表示幅", `${item.width} cm`]);
      if (!Number.isFinite(item.depthCm) && Number.isFinite(item.height)) values.push(["表示奥行", `${item.height} cm`]);
    }
    if (item.kind && item.kind !== "kitchen") values.push(["種類", item.kind]);
    if (type === "furniture" && item.roomName) values.push(["配置先", item.roomName]);
    if (type === "furniture" && item.deliveryDimensions) {
      const dimensions = item.deliveryDimensions;
      values.push(["搬入時の3辺", `${dimensions.sideACm} × ${dimensions.sideBCm} × ${dimensions.sideCCm} cm`]);
      values.push(["搬入寸法の対象", dimensions.basis === "body" ? "本体（梱包なし）" : "梱包状態"]);
    }
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
  const qualityTags = type === "feature"
    ? `<div class="quality-tags"><span class="quality-tag ${escapeHTML(quality)}">寸法: ${safeQuality}</span><span class="quality-tag placement ${escapeHTML(item.placementQuality ?? (item.uncertain ? "approximate" : "confirmed"))}">配置: ${item.placementQuality === "confirmed" || (!item.placementQuality && !item.uncertain) ? "確認済み" : "要確認"}</span></div>`
    : `<span class="quality-tag ${escapeHTML(quality)}">${safeQuality}</span>`;
  return `${list}${warning}${qualityTags}${item.note ? `<p>${escapeHTML(item.note)}</p>` : ""}`;
}

