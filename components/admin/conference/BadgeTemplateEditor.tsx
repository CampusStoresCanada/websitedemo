"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
  type SetStateAction,
} from "react";
import type {
  BadgeFrontLayerId,
  BadgeLogoBindingKey,
  BadgeRole,
  BadgeShapeKind,
  BadgeTextBindingKey,
  BadgeTemplateConfigV1,
} from "@/lib/conference/badges/template";
import { normalizeBadgeTemplateConfig } from "@/lib/conference/badges/template";
import { designPxFromPt, fitTextLayout, slotHeightDesignPx } from "@/lib/conference/badges/text-fit";

type Props = {
  initialConfig: BadgeTemplateConfigV1;
  initialVersion: number;
  initialName: string;
  initialStatus: "draft" | "active" | "archived";
  saveAction: (formData: FormData) => Promise<void>;
};

type EditorSide = "front" | "back";
type SelectedLayer =
  | BadgeFrontLayerId
  | "back_qr"
  | `back_image:${string}`
  | `back_shape:${string}`
  | `back_text:${string}`
  | "role_background"
  | "role_tint"
  | "role_overlay";

type DragState = {
  layerId: SelectedLayer;
  mode: "move" | "resize";
  resizeAxis?: "both" | "horizontal" | "vertical";
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startX: number;
  startY: number;
  startWidth?: number;
  startHeight?: number;
  groupStart?: Record<string, { x: number; y: number }>;
} | null;

type EditorSnapshot = {
  config: BadgeTemplateConfigV1;
  name: string;
  version: number;
  status: "draft" | "active" | "archived";
};

const PREVIEW_WIDTH = 360;
const TEXT_BINDING_OPTIONS: BadgeTextBindingKey[] = [
  "computed.org_line_1",
  "computed.org_line_2",
  "computed.first_name",
  "computed.last_name",
  "computed.role_title",
  "person.display_name",
  "person.first_name",
  "person.last_name",
  "person.role_title",
  "person.organization_name",
  "person.city",
  "person.province",
];

const LOGO_BINDING_OPTIONS: BadgeLogoBindingKey[] = [
  "person.logo_url",
  "static_url",
  "none",
];

const TEXT_BINDING_LABELS: Record<BadgeTextBindingKey, string> = {
  "computed.org_line_1": "Organization line 1 (computed)",
  "computed.org_line_2": "Organization line 2 (computed)",
  "computed.first_name": "First name (computed)",
  "computed.last_name": "Last name (computed)",
  "computed.role_title": "Role title (computed)",
  "person.display_name": "Display name",
  "person.first_name": "First name",
  "person.last_name": "Last name",
  "person.role_title": "Role title",
  "person.organization_name": "Organization name",
  "person.city": "City",
  "person.province": "Province",
};

const LOGO_BINDING_LABELS: Record<BadgeLogoBindingKey, string> = {
  "person.logo_url": "Organization logo",
  static_url: "Static logo URL",
  none: "No logo",
};

const TYPEFACE_LABELS = {
  primary: "Gotham",
  secondary: "Calibri",
  slab: "Museo Slab",
} as const;

function designPx(config: BadgeTemplateConfigV1) {
  return {
    width: config.canvas.widthIn * config.canvas.dpi,
    height: config.canvas.heightIn * config.canvas.dpi,
  };
}

function isFrontTextLayer(
  layerId: SelectedLayer
): layerId is
  | "organizationLine1"
  | "organizationLine2"
  | "firstName"
  | "lastName"
  | "title" {
  return (
    layerId === "organizationLine1" ||
    layerId === "organizationLine2" ||
    layerId === "firstName" ||
    layerId === "lastName" ||
    layerId === "title"
  );
}

function isShapeLayer(layerId: SelectedLayer): layerId is `shape:${string}` {
  return layerId.startsWith("shape:");
}

function isImageLayer(layerId: SelectedLayer): layerId is `image:${string}` {
  return layerId.startsWith("image:");
}

function isBackImageLayer(layerId: SelectedLayer): layerId is `back_image:${string}` {
  return layerId.startsWith("back_image:");
}

function isBackShapeLayer(layerId: SelectedLayer): layerId is `back_shape:${string}` {
  return layerId.startsWith("back_shape:");
}

function isFrontFreeTextLayer(layerId: SelectedLayer): layerId is `text:${string}` {
  return layerId.startsWith("text:");
}

function isBackFreeTextLayer(layerId: SelectedLayer): layerId is `back_text:${string}` {
  return layerId.startsWith("back_text:");
}

function textFamilyStack(
  family: "primary" | "secondary" | "slab",
  fonts: BadgeTemplateConfigV1["fonts"]
): string {
  return family === "primary"
    ? fonts.primary
    : family === "secondary"
      ? fonts.secondary
      : fonts.slab;
}

function labelForLayer(layerId: SelectedLayer): string {
  if (layerId === "back_qr") return "back_qr";
  if (layerId === "role_background") return "front_background";
  if (layerId === "role_tint") return "front_tint";
  if (layerId === "role_overlay") return "front_overlay";
  if (layerId.startsWith("text:")) return layerId.replace("text:", "text_");
  if (layerId.startsWith("back_image:")) return layerId.replace("back_image:", "back_image_");
  if (layerId.startsWith("back_shape:")) return layerId.replace("back_shape:", "back_shape_");
  if (layerId.startsWith("back_text:")) return layerId.replace("back_text:", "back_text_");
  if (layerId.startsWith("image:image_bg_")) {
    return `background_${layerId.replace("image:image_bg_", "")}`;
  }
  return layerId;
}

function cloneDeep<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export default function BadgeTemplateEditor({
  initialConfig,
  initialVersion,
  initialName,
  initialStatus,
  saveAction,
}: Props) {
  const normalizedInitialConfig = normalizeBadgeTemplateConfig(initialConfig);
  const [config, setConfigState] = useState<BadgeTemplateConfigV1>(() => {
    const roleLayouts = {
      delegate:
        normalizedInitialConfig.roleLayouts?.delegate ?? {
          front: cloneDeep(normalizedInitialConfig.front),
          back: cloneDeep(normalizedInitialConfig.back),
        },
      exhibitor:
        normalizedInitialConfig.roleLayouts?.exhibitor ?? {
          front: cloneDeep(normalizedInitialConfig.front),
          back: cloneDeep(normalizedInitialConfig.back),
        },
    };
    return {
      ...normalizedInitialConfig,
      roleLayouts,
      front: cloneDeep(roleLayouts.delegate.front),
      back: cloneDeep(roleLayouts.delegate.back),
    };
  });
  const [version, setVersion] = useState<number>(initialVersion);
  const [name, setName] = useState<string>(initialName);
  const [status, setStatus] = useState<"draft" | "active" | "archived">(initialStatus);
  const [role, setRole] = useState<BadgeRole>("delegate");
  const [cloneTargetRole, setCloneTargetRole] = useState<BadgeRole>("exhibitor");
  const [side, setSide] = useState<EditorSide>("front");
  const [selectedLayer, setSelectedLayer] = useState<SelectedLayer>("firstName");
  const [selectedLayers, setSelectedLayers] = useState<SelectedLayer[]>(["firstName"]);
  const [dragState, setDragState] = useState<DragState>(null);
  const [snapSize, setSnapSize] = useState<number>(1);
  const [unitSystem, setUnitSystem] = useState<"in" | "mm">("in");
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [backLayerSettings, setBackLayerSettings] = useState<
    Record<string, { visible: boolean; locked: boolean }>
  >({});
  const [undoStack, setUndoStack] = useState<EditorSnapshot[]>([]);
  const [redoStack, setRedoStack] = useState<EditorSnapshot[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const skipHistoryRef = useRef(false);
  const historyInteractionRef = useRef<null | { baseline: EditorSnapshot }>(null);
  const snapshotRef = useRef<EditorSnapshot>({
    config: normalizedInitialConfig,
    name: initialName,
    version: initialVersion,
    status: initialStatus,
  });
  const snapshotHashRef = useRef(
    JSON.stringify({
      config: normalizedInitialConfig,
      name: initialName,
      version: initialVersion,
      status: initialStatus,
    })
  );

  const dims = useMemo(() => designPx(config), [config]);
  const scale = PREVIEW_WIDTH / dims.width;
  const previewHeight = dims.height * scale;
  const roleTheme = config.roles[role];
  const frontQr = config.front.qr ?? { x: 705, y: 1210, size: 200 };
  const frontLayerOrder = useMemo(() => {
    const withBase = [...config.front.layerOrder];
    const shapeIds = config.front.shapes.map((shape) => `shape:${shape.id}` as const);
    for (const shapeLayerId of shapeIds) {
      if (!withBase.includes(shapeLayerId)) withBase.push(shapeLayerId);
    }
    const imageIds = config.front.images.map((image) => `image:${image.id}` as const);
    for (const imageLayerId of imageIds) {
      if (!withBase.includes(imageLayerId)) withBase.push(imageLayerId);
    }
    const textIds = (config.front.textLayers ?? []).map((text) => `text:${text.id}` as const);
    for (const textLayerId of textIds) {
      if (!withBase.includes(textLayerId)) withBase.push(textLayerId);
    }
    return withBase;
  }, [config.front.layerOrder, config.front.shapes, config.front.images, config.front.textLayers]);

  const setConfig = useCallback(
    (updater: SetStateAction<BadgeTemplateConfigV1>) => {
      setConfigState((prev) => {
        const computed =
          typeof updater === "function"
            ? (updater as (value: BadgeTemplateConfigV1) => BadgeTemplateConfigV1)(prev)
            : updater;
        const normalized = normalizeBadgeTemplateConfig(computed);
        const existingLayouts = {
          delegate:
            normalized.roleLayouts?.delegate ?? {
              front: cloneDeep(normalized.front),
              back: cloneDeep(normalized.back),
            },
          exhibitor:
            normalized.roleLayouts?.exhibitor ?? {
              front: cloneDeep(normalized.front),
              back: cloneDeep(normalized.back),
            },
        };
        return {
          ...normalized,
          roleLayouts: {
            ...existingLayouts,
            [role]: {
              front: cloneDeep(normalized.front),
              back: cloneDeep(normalized.back),
            },
          },
        };
      });
    },
    [role]
  );

  const editorLayerOrder = useMemo<SelectedLayer[]>(() => {
    const out: SelectedLayer[] = [];
    for (const layer of frontLayerOrder) {
      if (layer === "role_visuals") {
        if ((roleTheme.frontBackgroundUrl ?? "").trim().length > 0) {
          out.push("role_background");
        }
        if ((roleTheme.mapTintOpacity ?? 0) > 0) {
          out.push("role_tint");
        }
        if ((roleTheme.frontOverlayUrl ?? "").trim().length > 0) {
          out.push("role_overlay");
        }
      } else {
        out.push(layer);
      }
    }
    return out;
  }, [
    frontLayerOrder,
    roleTheme.frontBackgroundUrl,
    roleTheme.frontOverlayUrl,
    roleTheme.mapTintOpacity,
  ]);

  useEffect(() => {
    setCloneTargetRole((prev) =>
      prev === role ? (role === "delegate" ? "exhibitor" : "delegate") : prev
    );
  }, [role]);

  const commitSnapshot = useCallback((baseline: EditorSnapshot, next: EditorSnapshot) => {
    const baselineHash = JSON.stringify(baseline);
    const nextHash = JSON.stringify(next);
    if (baselineHash === nextHash) {
      snapshotRef.current = next;
      snapshotHashRef.current = nextHash;
      return;
    }
    setUndoStack((past) => [...past, baseline].slice(-100));
    setRedoStack([]);
    snapshotRef.current = next;
    snapshotHashRef.current = nextHash;
  }, []);

  useEffect(() => {
    setConfigState((prev) => {
      const normalized = normalizeBadgeTemplateConfig(prev);
      const existingLayouts = normalized.roleLayouts ?? {
        delegate: {
          front: cloneDeep(normalized.front),
          back: cloneDeep(normalized.back),
        },
        exhibitor: {
          front: cloneDeep(normalized.front),
          back: cloneDeep(normalized.back),
        },
      };
      const target = existingLayouts[role];
      if (!target) return normalized;
      return {
        ...normalized,
        roleLayouts: existingLayouts,
        front: cloneDeep(target.front),
        back: cloneDeep(target.back),
      };
    });
  }, [role]);

  const applySnapshot = useCallback((snapshot: EditorSnapshot) => {
    skipHistoryRef.current = true;
    setConfigState(snapshot.config);
    setName(snapshot.name);
    setVersion(snapshot.version);
    setStatus(snapshot.status);
    snapshotRef.current = snapshot;
    snapshotHashRef.current = JSON.stringify(snapshot);
  }, []);

  const undo = useCallback(() => {
    setUndoStack((past) => {
      if (!past.length) return past;
      const previous = past[past.length - 1];
      const current = snapshotRef.current;
      setRedoStack((future) => [current, ...future].slice(0, 100));
      applySnapshot(previous);
      return past.slice(0, -1);
    });
  }, [applySnapshot]);

  const redo = useCallback(() => {
    setRedoStack((future) => {
      if (!future.length) return future;
      const next = future[0];
      const current = snapshotRef.current;
      setUndoStack((past) => [...past, current].slice(-100));
      applySnapshot(next);
      return future.slice(1);
    });
  }, [applySnapshot]);

  function snapValue(value: number): number {
    if (snapSize <= 1) return value;
    return Math.round(value / snapSize) * snapSize;
  }

  function designToUnit(value: number): number {
    const inches = value / config.canvas.dpi;
    return unitSystem === "in" ? inches : inches * 25.4;
  }

  function unitToDesign(value: number): number {
    const inches = unitSystem === "in" ? value : value / 25.4;
    return Math.round(inches * config.canvas.dpi);
  }

  function formatUnit(value: number): string {
    return designToUnit(value).toFixed(unitSystem === "in" ? 3 : 2);
  }

  function parseUnit(value: string): number {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return unitToDesign(numeric);
  }

  function selectedClass(layerId: SelectedLayer): string {
    if (!selectedLayers.includes(layerId)) return "";
    if (selectedLayer === layerId) return "ring-2 ring-red-600 border-red-700";
    return "ring-2 ring-red-300 border-red-400";
  }

  function frontLayerBounds(
    layerId: SelectedLayer
  ): { left: number; right: number; top: number; bottom: number; centerX: number; centerY: number } | null {
    if (
      layerId === "back_qr" ||
      layerId === "role_visuals" ||
      layerId === "role_background" ||
      layerId === "role_tint" ||
      layerId === "role_overlay"
    )
      return null;
    if (layerId === "logo") {
      const left = config.front.logo.x;
      const top = config.front.logo.y;
      const right = left + config.front.logo.diameter;
      const bottom = top + config.front.logo.diameter;
      return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    if (layerId === "front_qr") {
      const left = frontQr.x;
      const top = frontQr.y;
      const right = left + frontQr.size;
      const bottom = top + frontQr.size;
      return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    if (isFrontTextLayer(layerId)) {
      const slot = config.front[layerId];
      const lineHeight = slot.lineHeight ?? 1.12;
      const lineHeightPx = designPxFromPt(slot.defaultPt, config.canvas.dpi) * lineHeight;
      const slotHeight = slotHeightDesignPx(slot, config.canvas.dpi, {
        maxLines: slot.maxLines ?? 1,
        lineHeightEm: lineHeight,
        fallbackPt: slot.defaultPt,
      });
      const left = slot.x;
      const top = slot.baselineY - designPxFromPt(slot.defaultPt, config.canvas.dpi) * 0.8;
      const right = left + slot.width;
      const bottom = top + Math.max(slotHeight, lineHeightPx);
      return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    if (isShapeLayer(layerId)) {
      const shapeId = layerId.replace("shape:", "");
      const shape = config.front.shapes.find((item) => item.id === shapeId);
      if (!shape) return null;
      const left = shape.x;
      const top = shape.y;
      const right = left + shape.width;
      const bottom = top + shape.height;
      return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    if (isImageLayer(layerId)) {
      const imageId = layerId.replace("image:", "");
      const image = config.front.images.find((item) => item.id === imageId);
      if (!image) return null;
      const left = image.x;
      const top = image.y;
      const right = left + image.width;
      const bottom = top + image.height;
      return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    if (isFrontFreeTextLayer(layerId)) {
      const textId = layerId.replace("text:", "");
      const text = (config.front.textLayers ?? []).find((item) => item.id === textId);
      if (!text) return null;
      const sizePx = designPxFromPt(text.sizePt, config.canvas.dpi);
      const left = text.x;
      const top = text.y;
      const right = left + text.width;
      const bottom = top + sizePx * (text.lineHeight ?? 1.1);
      return { left, right, top, bottom, centerX: (left + right) / 2, centerY: (top + bottom) / 2 };
    }
    return null;
  }

  function ensureLayerOrderSync(nextConfig: BadgeTemplateConfigV1): BadgeTemplateConfigV1 {
    const shapeLayerIds = nextConfig.front.shapes.map(
      (shape) => `shape:${shape.id}` as BadgeFrontLayerId
    );
    const imageLayerIds = nextConfig.front.images.map(
      (image) => `image:${image.id}` as BadgeFrontLayerId
    );
    const textLayerIds = (nextConfig.front.textLayers ?? []).map(
      (text) => `text:${text.id}` as BadgeFrontLayerId
    );
    const nextOrder = nextConfig.front.layerOrder.filter((layerId) => {
      if (layerId.startsWith("shape:")) return shapeLayerIds.includes(layerId);
      if (layerId.startsWith("image:")) return imageLayerIds.includes(layerId);
      if (layerId.startsWith("text:")) return textLayerIds.includes(layerId);
      return true;
    });
    for (const shapeId of shapeLayerIds) {
      if (!nextOrder.includes(shapeId)) nextOrder.push(shapeId);
    }
    for (const imageId of imageLayerIds) {
      if (!nextOrder.includes(imageId)) nextOrder.push(imageId);
    }
    for (const textId of textLayerIds) {
      if (!nextOrder.includes(textId)) nextOrder.push(textId);
    }
    return {
      ...nextConfig,
      front: {
        ...nextConfig.front,
        layerOrder: nextOrder,
      },
    };
  }

  function roleLayoutSnapshot(prev: BadgeTemplateConfigV1) {
    const existing = prev.roleLayouts ?? {
      delegate: { front: cloneDeep(prev.front), back: cloneDeep(prev.back) },
      exhibitor: { front: cloneDeep(prev.front), back: cloneDeep(prev.back) },
    };
    return {
      delegate: {
        front: cloneDeep(existing.delegate?.front ?? prev.front),
        back: cloneDeep(existing.delegate?.back ?? prev.back),
      },
      exhibitor: {
        front: cloneDeep(existing.exhibitor?.front ?? prev.front),
        back: cloneDeep(existing.exhibitor?.back ?? prev.back),
      },
    } as Record<BadgeRole, { front: BadgeTemplateConfigV1["front"]; back: BadgeTemplateConfigV1["back"] }>;
  }

  function layerSetting(layerId: SelectedLayer) {
    if (layerId === "back_qr" || isBackImageLayer(layerId) || isBackShapeLayer(layerId) || isBackFreeTextLayer(layerId)) {
      return backLayerSettings[layerId] ?? { visible: true, locked: false };
    }
    const mappedId: BadgeFrontLayerId =
      layerId === "role_background" || layerId === "role_tint" || layerId === "role_overlay"
        ? "role_visuals"
        : (layerId as BadgeFrontLayerId);
    return config.front.layerSettings[mappedId] ?? {
      visible: true,
      locked: false,
    };
  }

  function updateLayerSetting(
    layerId: SelectedLayer,
    patch: Partial<{ visible: boolean; locked: boolean }>
  ) {
    if (layerId === "back_qr" || isBackImageLayer(layerId) || isBackShapeLayer(layerId) || isBackFreeTextLayer(layerId)) {
      setBackLayerSettings((prev) => ({
        ...prev,
        [layerId]: {
          visible: patch.visible ?? (prev[layerId]?.visible ?? true),
          locked: patch.locked ?? (prev[layerId]?.locked ?? false),
        },
      }));
      return;
    }
    const mappedId: BadgeFrontLayerId =
      layerId === "role_background" || layerId === "role_tint" || layerId === "role_overlay"
        ? "role_visuals"
        : (layerId as BadgeFrontLayerId);
    setConfig((prev) => ({
      ...prev,
      front: {
        ...prev.front,
        layerSettings: {
          ...prev.front.layerSettings,
          [mappedId]: {
            visible:
              patch.visible ??
              (prev.front.layerSettings[mappedId]?.visible ?? true),
            locked:
              patch.locked ??
              (prev.front.layerSettings[mappedId]?.locked ?? false),
          },
        },
      },
    }));
  }

  function isLayerVisible(layerId: SelectedLayer): boolean {
    return layerSetting(layerId).visible !== false;
  }

  function isLayerLocked(layerId: SelectedLayer): boolean {
    return layerSetting(layerId).locked === true;
  }

  function createGroupStart(
    layerId: SelectedLayer
  ): Record<string, { x: number; y: number }> | undefined {
    if (layerId === "back_qr" || selectedLayers.length < 2 || !selectedLayers.includes(layerId)) {
      return undefined;
    }
    const entries = selectedLayers
      .filter((id) => !isLayerLocked(id))
      .map((id) => ({ id, pos: frontLayerPosition(id) }))
      .filter(
        (entry): entry is { id: SelectedLayer; pos: { x: number; y: number } } =>
          Boolean(entry.pos)
      );
    if (entries.length < 2) return undefined;
    return Object.fromEntries(entries.map((entry) => [entry.id, entry.pos]));
  }

  function selectLayer(layerId: SelectedLayer, additive = false) {
    setSelectedLayer(layerId);
    setSelectedLayers((prev) => {
      if (!additive) return [layerId];
      if (prev.includes(layerId)) {
        const next = prev.filter((id) => id !== layerId);
        return next.length > 0 ? next : [layerId];
      }
      return [...prev, layerId];
    });
  }

  function startDrag(layerId: SelectedLayer, event: PointerEvent<HTMLElement>) {
    if (isLayerLocked(layerId)) return;
    if (!historyInteractionRef.current) {
      historyInteractionRef.current = { baseline: snapshotRef.current };
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (layerId === "back_qr") {
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: config.back.qr.x,
        startY: config.back.qr.y,
        groupStart: undefined,
      });
      return;
    }
    if (isBackImageLayer(layerId)) {
      const imageId = layerId.replace("back_image:", "");
      const image = config.back.images.find((item) => item.id === imageId);
      if (!image) return;
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: image.x,
        startY: image.y,
        groupStart: undefined,
      });
      return;
    }
    if (isBackShapeLayer(layerId)) {
      const shapeId = layerId.replace("back_shape:", "");
      const shape = (config.back.shapes ?? []).find((item) => item.id === shapeId);
      if (!shape) return;
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: shape.x,
        startY: shape.y,
        groupStart: undefined,
      });
      return;
    }
    if (isBackFreeTextLayer(layerId)) {
      const textId = layerId.replace("back_text:", "");
      const text = (config.back.textLayers ?? []).find((item) => item.id === textId);
      if (!text) return;
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: text.x,
        startY: text.y,
        groupStart: undefined,
      });
      return;
    }
    if (layerId === "logo") {
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: config.front.logo.x,
        startY: config.front.logo.y,
        groupStart: createGroupStart(layerId),
      });
      return;
    }
    if (layerId === "front_qr") {
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: frontQr.x,
        startY: frontQr.y,
        groupStart: createGroupStart(layerId),
      });
      return;
    }
    if (isFrontTextLayer(layerId)) {
      const slot = config.front[layerId];
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: slot.x,
        startY: slot.baselineY,
        groupStart: createGroupStart(layerId),
      });
      return;
    }
    if (isShapeLayer(layerId)) {
      const shapeId = layerId.replace("shape:", "");
      const shape = config.front.shapes.find((item) => item.id === shapeId);
      if (!shape) return;
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: shape.x,
        startY: shape.y,
        groupStart: createGroupStart(layerId),
      });
      return;
    }
    if (isImageLayer(layerId)) {
      const imageId = layerId.replace("image:", "");
      const image = config.front.images.find((item) => item.id === imageId);
      if (!image) return;
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: image.x,
        startY: image.y,
        groupStart: createGroupStart(layerId),
      });
      return;
    }
    if (isFrontFreeTextLayer(layerId)) {
      const textId = layerId.replace("text:", "");
      const text = (config.front.textLayers ?? []).find((item) => item.id === textId);
      if (!text) return;
      setDragState({
        layerId,
        mode: "move",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: text.x,
        startY: text.y,
        groupStart: createGroupStart(layerId),
      });
    }
  }

  function startResize(
    layerId: SelectedLayer,
    event: PointerEvent<HTMLElement>,
    resizeAxis: "both" | "horizontal" | "vertical" = "both"
  ) {
    if (isLayerLocked(layerId)) return;
    if (!historyInteractionRef.current) {
      historyInteractionRef.current = { baseline: snapshotRef.current };
    }
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);

    if (layerId === "back_qr") {
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: config.back.qr.x,
        startY: config.back.qr.y,
        resizeAxis,
        startWidth: config.back.qr.size,
        startHeight: config.back.qr.size,
      });
      return;
    }
    if (isBackImageLayer(layerId)) {
      const imageId = layerId.replace("back_image:", "");
      const image = config.back.images.find((item) => item.id === imageId);
      if (!image) return;
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: image.x,
        startY: image.y,
        resizeAxis,
        startWidth: image.width,
        startHeight: image.height,
      });
      return;
    }
    if (isBackShapeLayer(layerId)) {
      const shapeId = layerId.replace("back_shape:", "");
      const shape = (config.back.shapes ?? []).find((item) => item.id === shapeId);
      if (!shape) return;
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: shape.x,
        startY: shape.y,
        resizeAxis,
        startWidth: shape.width,
        startHeight: shape.height,
      });
      return;
    }
    if (isBackFreeTextLayer(layerId)) {
      const textId = layerId.replace("back_text:", "");
      const text = (config.back.textLayers ?? []).find((item) => item.id === textId);
      if (!text) return;
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: text.x,
        startY: text.y,
        resizeAxis,
        startWidth: text.width,
        startHeight: text.sizePt,
      });
      return;
    }
    if (layerId === "logo") {
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: config.front.logo.x,
        startY: config.front.logo.y,
        resizeAxis,
        startWidth: config.front.logo.diameter,
        startHeight: config.front.logo.diameter,
      });
      return;
    }
    if (layerId === "front_qr") {
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: frontQr.x,
        startY: frontQr.y,
        resizeAxis,
        startWidth: frontQr.size,
        startHeight: frontQr.size,
      });
      return;
    }
    if (isFrontTextLayer(layerId)) {
      const slot = config.front[layerId];
      const lineHeightEm = slot.lineHeight ?? 1.12;
      const slotHeight = slotHeightDesignPx(slot, config.canvas.dpi, {
        maxLines: slot.maxLines ?? 1,
        lineHeightEm,
        fallbackPt: slot.defaultPt,
      });
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: slot.x,
        startY: slot.baselineY,
        resizeAxis,
        startWidth: slot.width,
        startHeight: slotHeight,
      });
      return;
    }
    if (isShapeLayer(layerId)) {
      const shape = config.front.shapes.find((s) => `shape:${s.id}` === layerId);
      if (!shape) return;
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: shape.x,
        startY: shape.y,
        resizeAxis,
        startWidth: shape.width,
        startHeight: shape.height,
      });
      return;
    }
    if (isImageLayer(layerId)) {
      const image = config.front.images.find((img) => `image:${img.id}` === layerId);
      if (!image) return;
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: image.x,
        startY: image.y,
        resizeAxis,
        startWidth: image.width,
        startHeight: image.height,
      });
      return;
    }
    if (isFrontFreeTextLayer(layerId)) {
      const textId = layerId.replace("text:", "");
      const text = (config.front.textLayers ?? []).find((item) => item.id === textId);
      if (!text) return;
      setDragState({
        layerId,
        mode: "resize",
        pointerId: event.pointerId,
        startClientX: event.clientX,
        startClientY: event.clientY,
        startX: text.x,
        startY: text.y,
        resizeAxis,
        startWidth: text.width,
        startHeight: text.sizePt,
      });
    }
  }

  function onDragMove(event: PointerEvent<HTMLElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const rawDx = (event.clientX - dragState.startClientX) / scale;
    const rawDy = (event.clientY - dragState.startClientY) / scale;
    const lockAxis = dragState.mode === "move" && event.shiftKey;
    const dx = Math.round(
      lockAxis && Math.abs(rawDy) > Math.abs(rawDx) ? 0 : rawDx
    );
    const dy = Math.round(
      lockAxis && Math.abs(rawDx) >= Math.abs(rawDy) ? 0 : rawDy
    );
    let nextX = snapValue(dragState.startX + dx);
    let nextY = snapValue(dragState.startY + dy);

    // Edge snapping against current anchor layer in multi-select mode.
    if (
      selectedLayers.length > 1 &&
      selectedLayer !== dragState.layerId &&
      dragState.mode === "move"
    ) {
      const anchorBounds = frontLayerBounds(selectedLayer);
      const movingBounds = frontLayerBounds(dragState.layerId);
      if (anchorBounds && movingBounds) {
        const tolerance = Math.max(2, snapSize * 2);
        const shifted = {
          left: movingBounds.left + (nextX - dragState.startX),
          right: movingBounds.right + (nextX - dragState.startX),
          top: movingBounds.top + (nextY - dragState.startY),
          bottom: movingBounds.bottom + (nextY - dragState.startY),
          centerX: movingBounds.centerX + (nextX - dragState.startX),
          centerY: movingBounds.centerY + (nextY - dragState.startY),
        };
        const xCandidates = [
          { delta: anchorBounds.left - shifted.left },
          { delta: anchorBounds.right - shifted.right },
          { delta: anchorBounds.left - shifted.right },
          { delta: anchorBounds.right - shifted.left },
          { delta: anchorBounds.centerX - shifted.centerX },
        ].filter((entry) => Math.abs(entry.delta) <= tolerance);
        const yCandidates = [
          { delta: anchorBounds.top - shifted.top },
          { delta: anchorBounds.bottom - shifted.bottom },
          { delta: anchorBounds.top - shifted.bottom },
          { delta: anchorBounds.bottom - shifted.top },
          { delta: anchorBounds.centerY - shifted.centerY },
        ].filter((entry) => Math.abs(entry.delta) <= tolerance);

        if (xCandidates.length > 0) {
          const best = xCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
          nextX = snapValue(nextX + best.delta);
        }
        if (yCandidates.length > 0) {
          const best = yCandidates.sort((a, b) => Math.abs(a.delta) - Math.abs(b.delta))[0];
          nextY = snapValue(nextY + best.delta);
        }
      }
    }

    if (dragState.mode === "resize") {
      const resizeAxis = dragState.resizeAxis ?? "both";
      const baseWidth = dragState.startWidth ?? 10;
      const baseHeight = dragState.startHeight ?? 10;
      const nextWidth =
        resizeAxis === "vertical"
          ? Math.max(4, snapValue(Math.round(baseWidth)))
          : Math.max(4, snapValue(Math.round(baseWidth + dx)));
      const nextHeight =
        resizeAxis === "horizontal"
          ? Math.max(4, snapValue(Math.round(baseHeight)))
          : Math.max(4, snapValue(Math.round(baseHeight + dy)));
      if (dragState.layerId === "back_qr") {
        setConfig((prev) => ({
          ...prev,
          back: {
            ...prev.back,
            qr: {
              ...prev.back.qr,
              size: Math.max(nextWidth, nextHeight),
            },
          },
        }));
        return;
      }
      if (isBackImageLayer(dragState.layerId)) {
        const imageId = dragState.layerId.replace("back_image:", "");
        setConfig((prev) => ({
          ...prev,
          back: {
            ...prev.back,
            images: prev.back.images.map((image) =>
              image.id === imageId
                ? { ...image, width: nextWidth, height: nextHeight }
                : image
            ),
          },
        }));
        return;
      }
      if (isBackShapeLayer(dragState.layerId)) {
        const shapeId = dragState.layerId.replace("back_shape:", "");
        setConfig((prev) => ({
          ...prev,
          back: {
            ...prev.back,
            shapes: (prev.back.shapes ?? []).map((shape) =>
              shape.id === shapeId ? { ...shape, width: nextWidth, height: nextHeight } : shape
            ),
          },
        }));
        return;
      }
      if (isBackFreeTextLayer(dragState.layerId)) {
        const textId = dragState.layerId.replace("back_text:", "");
        const nextPt = Math.max(
          8,
          Math.min(
            160,
            Math.round(((dragState.startHeight ?? 24) + (dy * 72) / config.canvas.dpi) * 10) / 10
          )
        );
        setConfig((prev) => ({
          ...prev,
          back: {
            ...prev.back,
            textLayers: (prev.back.textLayers ?? []).map((text) =>
              text.id === textId ? { ...text, width: Math.max(20, nextWidth), sizePt: nextPt } : text
            ),
          },
        }));
        return;
      }
      if (dragState.layerId === "logo") {
        setConfig((prev) => ({
          ...prev,
          front: {
            ...prev.front,
            logo: {
              ...prev.front.logo,
              diameter: Math.max(nextWidth, nextHeight),
            },
          },
        }));
        return;
      }
      if (dragState.layerId === "front_qr") {
        setConfig((prev) => ({
          ...prev,
          front: {
            ...prev.front,
            qr: {
              ...prev.front.qr,
              size: Math.max(nextWidth, nextHeight),
            },
          },
        }));
        return;
      }
      if (isFrontTextLayer(dragState.layerId)) {
        const frontTextLayerId = dragState.layerId;
        setConfig((prev) => ({
          ...prev,
          front: {
            ...prev.front,
            [frontTextLayerId]: {
              ...prev.front[frontTextLayerId],
              width: Math.max(20, nextWidth),
              height: Math.max(8, nextHeight),
            },
          },
        }));
        return;
      }
      if (isShapeLayer(dragState.layerId)) {
        const shapeId = dragState.layerId.replace("shape:", "");
        setConfig((prev) => ({
          ...prev,
          front: {
            ...prev.front,
            shapes: prev.front.shapes.map((shape) =>
              shape.id === shapeId
                ? { ...shape, width: nextWidth, height: nextHeight }
                : shape
            ),
          },
        }));
        return;
      }
      if (isImageLayer(dragState.layerId)) {
        const imageId = dragState.layerId.replace("image:", "");
        setConfig((prev) => ({
          ...prev,
          front: {
            ...prev.front,
            images: prev.front.images.map((image) =>
              image.id === imageId
                ? { ...image, width: nextWidth, height: nextHeight }
                : image
            ),
          },
        }));
        return;
      }
      if (isFrontFreeTextLayer(dragState.layerId)) {
        const textId = dragState.layerId.replace("text:", "");
        const nextPt = Math.max(
          8,
          Math.min(
            160,
            Math.round(((dragState.startHeight ?? 24) + (dy * 72) / config.canvas.dpi) * 10) / 10
          )
        );
        setConfig((prev) => ({
          ...prev,
          front: {
            ...prev.front,
            textLayers: (prev.front.textLayers ?? []).map((text) =>
              text.id === textId ? { ...text, width: Math.max(20, nextWidth), sizePt: nextPt } : text
            ),
          },
        }));
      }
      return;
    }

    if (dragState.groupStart && dragState.layerId !== "back_qr") {
      const groupStart = dragState.groupStart;
      const deltaX = nextX - dragState.startX;
      const deltaY = nextY - dragState.startY;
      setConfig((prev) => {
        const nextFront = {
          ...prev.front,
          qr: { ...prev.front.qr },
          logo: { ...prev.front.logo },
          organizationLine1: { ...prev.front.organizationLine1 },
          organizationLine2: { ...prev.front.organizationLine2 },
          firstName: { ...prev.front.firstName },
          lastName: { ...prev.front.lastName },
          title: { ...prev.front.title },
          shapes: prev.front.shapes.map((shape) => ({ ...shape })),
          images: prev.front.images.map((image) => ({ ...image })),
          textLayers: (prev.front.textLayers ?? []).map((text) => ({ ...text })),
        };
        for (const [id, origin] of Object.entries(groupStart)) {
          const layerId = id as SelectedLayer;
          const movedX = snapValue(origin.x + deltaX);
          const movedY = snapValue(origin.y + deltaY);
          if (layerId === "logo") {
            nextFront.logo.x = movedX;
            nextFront.logo.y = movedY;
            continue;
          }
          if (layerId === "front_qr") {
            nextFront.qr.x = movedX;
            nextFront.qr.y = movedY;
            continue;
          }
          if (isFrontTextLayer(layerId)) {
            nextFront[layerId].x = movedX;
            nextFront[layerId].baselineY = movedY;
            continue;
          }
          if (isShapeLayer(layerId)) {
            const shapeId = layerId.replace("shape:", "");
            const shape = nextFront.shapes.find((entry) => entry.id === shapeId);
            if (!shape) continue;
            shape.x = movedX;
            shape.y = movedY;
            continue;
          }
          if (isImageLayer(layerId)) {
            const imageId = layerId.replace("image:", "");
            const image = nextFront.images.find((entry) => entry.id === imageId);
            if (!image) continue;
            image.x = movedX;
            image.y = movedY;
            continue;
          }
          if (isFrontFreeTextLayer(layerId)) {
            const textId = layerId.replace("text:", "");
            const text = nextFront.textLayers.find((entry) => entry.id === textId);
            if (!text) continue;
            text.x = movedX;
            text.y = movedY;
          }
        }
        return {
          ...prev,
          front: nextFront,
        };
      });
      return;
    }

    if (dragState.layerId === "back_qr") {
      setConfig((prev) => ({
        ...prev,
        back: {
          ...prev.back,
          qr: {
            ...prev.back.qr,
            x: nextX,
            y: nextY,
          },
        },
      }));
      return;
    }
    if (isBackImageLayer(dragState.layerId)) {
      const imageId = dragState.layerId.replace("back_image:", "");
      setConfig((prev) => ({
        ...prev,
        back: {
          ...prev.back,
          images: prev.back.images.map((image) =>
            image.id === imageId ? { ...image, x: nextX, y: nextY } : image
          ),
        },
      }));
      return;
    }
    if (isBackShapeLayer(dragState.layerId)) {
      const shapeId = dragState.layerId.replace("back_shape:", "");
      setConfig((prev) => ({
        ...prev,
        back: {
          ...prev.back,
          shapes: (prev.back.shapes ?? []).map((shape) =>
            shape.id === shapeId ? { ...shape, x: nextX, y: nextY } : shape
          ),
        },
      }));
      return;
    }
    if (isBackFreeTextLayer(dragState.layerId)) {
      const textId = dragState.layerId.replace("back_text:", "");
      setConfig((prev) => ({
        ...prev,
        back: {
          ...prev.back,
          textLayers: (prev.back.textLayers ?? []).map((text) =>
            text.id === textId ? { ...text, x: nextX, y: nextY } : text
          ),
        },
      }));
      return;
    }

    if (dragState.layerId === "logo") {
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          logo: {
            ...prev.front.logo,
            x: nextX,
            y: nextY,
          },
        },
      }));
      return;
    }
    if (dragState.layerId === "front_qr") {
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          qr: {
            ...prev.front.qr,
            x: nextX,
            y: nextY,
          },
        },
      }));
      return;
    }

    if (isFrontTextLayer(dragState.layerId)) {
      const frontTextLayerId = dragState.layerId;
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          [frontTextLayerId]: {
            ...prev.front[frontTextLayerId],
            x: nextX,
            baselineY: nextY,
          },
        },
      }));
      return;
    }

    if (isShapeLayer(dragState.layerId)) {
      const shapeId = dragState.layerId.replace("shape:", "");
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          shapes: prev.front.shapes.map((shape) =>
            shape.id === shapeId ? { ...shape, x: nextX, y: nextY } : shape
          ),
        },
      }));
      return;
    }
    if (isImageLayer(dragState.layerId)) {
      const imageId = dragState.layerId.replace("image:", "");
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          images: prev.front.images.map((image) =>
            image.id === imageId ? { ...image, x: nextX, y: nextY } : image
          ),
        },
      }));
      return;
    }
    if (isFrontFreeTextLayer(dragState.layerId)) {
      const textId = dragState.layerId.replace("text:", "");
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          textLayers: (prev.front.textLayers ?? []).map((text) =>
            text.id === textId ? { ...text, x: nextX, y: nextY } : text
          ),
        },
      }));
    }
  }

  function endDrag(event: PointerEvent<HTMLElement>) {
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragState(null);
    if (historyInteractionRef.current) {
      const baseline = historyInteractionRef.current.baseline;
      historyInteractionRef.current = null;
      commitSnapshot(baseline, { config, name, version, status });
    }
  }

  function moveLayer(direction: "up" | "down") {
    if (
      !selectedLayer ||
      selectedLayer === "back_qr" ||
      selectedLayer === "role_background" ||
      selectedLayer === "role_tint" ||
      selectedLayer === "role_overlay"
    )
      return;
    const idx = frontLayerOrder.indexOf(selectedLayer as BadgeFrontLayerId);
    if (idx < 0) return;
    const nextIdx = direction === "up" ? idx - 1 : idx + 1;
    if (nextIdx < 0 || nextIdx >= frontLayerOrder.length) return;
    const nextOrder = [...frontLayerOrder];
    const temp = nextOrder[idx];
    nextOrder[idx] = nextOrder[nextIdx];
    nextOrder[nextIdx] = temp;
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          layerOrder: nextOrder,
        },
      })
    );
  }

  function addShape(kind: BadgeShapeKind) {
    const id = `shape_${Date.now().toString(36)}`;
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          shapes: [
            ...prev.front.shapes,
            {
              id,
              kind,
              x: 80,
              y: 80,
              width: kind === "line" ? 220 : 140,
              height: kind === "line" ? 2 : 90,
              strokeColor: roleTheme.accentColor,
              fillColor: kind === "line" ? null : "transparent",
              strokeWidth: 2,
              opacity: 1,
              rotationDeg: 0,
            },
          ],
        },
      })
    );
    setSelectedLayer(`shape:${id}`);
    setSelectedLayers([`shape:${id}`]);
    setSide("front");
  }

  function deleteSelectedShape() {
    if (!isShapeLayer(selectedLayer)) return;
    const shapeId = selectedLayer.replace("shape:", "");
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          shapes: prev.front.shapes.filter((shape) => shape.id !== shapeId),
        },
      })
    );
    setSelectedLayer("firstName");
    setSelectedLayers(["firstName"]);
  }

  function addImageLayer() {
    const id = `image_${Date.now().toString(36)}`;
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          images: [
            ...prev.front.images,
            {
              id,
              x: 80,
              y: 80,
              width: 160,
              height: 90,
              src: "",
              opacity: 1,
              rotationDeg: 0,
              fit: "contain",
            },
          ],
        },
      })
    );
    setSelectedLayer(`image:${id}`);
    setSelectedLayers([`image:${id}`]);
    setSide("front");
  }

  function addFrontQrLayer() {
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          layerOrder: prev.front.layerOrder.includes("front_qr")
            ? prev.front.layerOrder
            : ["role_visuals", "front_qr", ...prev.front.layerOrder.filter((layer) => layer !== "role_visuals")],
        },
      })
    );
    setSelectedLayer("front_qr");
    setSelectedLayers(["front_qr"]);
    setSide("front");
  }

  function addFrontTextLayer() {
    const id = `text_${Date.now().toString(36)}`;
    const layerId = `text:${id}` as BadgeFrontLayerId;
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          layerOrder: [...prev.front.layerOrder, layerId],
          textLayers: [
            ...(prev.front.textLayers ?? []),
            {
              id,
              text: "NEW TEXT",
              x: 80,
              y: 80,
              width: 220,
              sizePt: 26,
              family: "primary",
              weight: 700,
              lineHeight: 1.1,
              opacity: 1,
              rotationDeg: 0,
            },
          ],
        },
      })
    );
    setSelectedLayer(`text:${id}`);
    setSelectedLayers([`text:${id}`]);
    setSide("front");
  }

  function addBackImageLayer() {
    const id = `back_image_${Date.now().toString(36)}`;
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        images: [
          ...(prev.back.images ?? []),
          {
            id,
            x: 80,
            y: 80,
            width: 160,
            height: 90,
            src: "",
            opacity: 1,
            rotationDeg: 0,
            fit: "contain",
          },
        ],
      },
    }));
    setSelectedLayer(`back_image:${id}`);
    setSelectedLayers([`back_image:${id}`]);
    setSide("back");
  }

  function addBackBackgroundLayer() {
    const id = `back_image_bg_${Date.now().toString(36)}`;
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        images: [
          ...(prev.back.images ?? []),
          {
            id,
            x: 0,
            y: 0,
            width: prev.canvas.widthIn * prev.canvas.dpi,
            height: prev.canvas.heightIn * prev.canvas.dpi,
            src: "",
            opacity: 1,
            rotationDeg: 0,
            fit: "cover",
          },
        ],
      },
    }));
    setSelectedLayer(`back_image:${id}`);
    setSelectedLayers([`back_image:${id}`]);
    setSide("back");
  }

  function addBackShape(kind: BadgeShapeKind) {
    const id = `back_shape_${Date.now().toString(36)}`;
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        shapes: [
          ...(prev.back.shapes ?? []),
          {
            id,
            kind,
            x: 80,
            y: 80,
            width: kind === "line" ? 220 : 140,
            height: kind === "line" ? 2 : 90,
            strokeColor: roleTheme.accentColor,
            fillColor: kind === "line" ? null : "transparent",
            strokeWidth: 2,
            opacity: 1,
            rotationDeg: 0,
          },
        ],
      },
    }));
    setSelectedLayer(`back_shape:${id}`);
    setSelectedLayers([`back_shape:${id}`]);
    setSide("back");
  }

  function addBackTextLayer() {
    const id = `back_text_${Date.now().toString(36)}`;
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        textLayers: [
          ...(prev.back.textLayers ?? []),
          {
            id,
            text: "NEW TEXT",
            x: 80,
            y: 80,
            width: 220,
            sizePt: 26,
            family: "primary",
            weight: 700,
            lineHeight: 1.1,
            opacity: 1,
            rotationDeg: 0,
          },
        ],
      },
    }));
    setSelectedLayer(`back_text:${id}`);
    setSelectedLayers([`back_text:${id}`]);
    setSide("back");
  }

  function addBackgroundLayer() {
    const id = `image_bg_${Date.now().toString(36)}`;
    const layerId = `image:${id}` as BadgeFrontLayerId;
    setConfig((prev) => {
      const roleIndex = prev.front.layerOrder.indexOf("role_visuals");
      const insertAt = roleIndex >= 0 ? roleIndex + 1 : 0;
      const nextOrder = [...prev.front.layerOrder];
      nextOrder.splice(insertAt, 0, layerId);
      return ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          layerOrder: nextOrder,
          images: [
            ...prev.front.images,
            {
              id,
              x: 0,
              y: 0,
              width: prev.canvas.widthIn * prev.canvas.dpi,
              height: prev.canvas.heightIn * prev.canvas.dpi,
              src: "",
              opacity: 1,
              rotationDeg: 0,
              fit: "cover",
            },
          ],
        },
      });
    });
    setSelectedLayer(`image:${id}`);
    setSelectedLayers([`image:${id}`]);
    setSide("front");
  }

  function deleteSelectedImage() {
    if (!isImageLayer(selectedLayer)) return;
    const imageId = selectedLayer.replace("image:", "");
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          images: prev.front.images.filter((image) => image.id !== imageId),
        },
      })
    );
    setSelectedLayer("firstName");
    setSelectedLayers(["firstName"]);
  }

  function deleteSelectedBackImage() {
    if (!isBackImageLayer(selectedLayer)) return;
    const imageId = selectedLayer.replace("back_image:", "");
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        images: (prev.back.images ?? []).filter((image) => image.id !== imageId),
      },
    }));
    setSelectedLayer("back_qr");
    setSelectedLayers(["back_qr"]);
    setSide("back");
  }

  function deleteSelectedBackShape() {
    if (!isBackShapeLayer(selectedLayer)) return;
    const shapeId = selectedLayer.replace("back_shape:", "");
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        shapes: (prev.back.shapes ?? []).filter((shape) => shape.id !== shapeId),
      },
    }));
    setSelectedLayer("back_qr");
    setSelectedLayers(["back_qr"]);
    setSide("back");
  }

  function deleteSelectedFrontText() {
    if (!isFrontFreeTextLayer(selectedLayer)) return;
    const textId = selectedLayer.replace("text:", "");
    setConfig((prev) =>
      ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          textLayers: (prev.front.textLayers ?? []).filter((text) => text.id !== textId),
        },
      })
    );
    setSelectedLayer("firstName");
    setSelectedLayers(["firstName"]);
    setSide("front");
  }

  function deleteSelectedBackText() {
    if (!isBackFreeTextLayer(selectedLayer)) return;
    const textId = selectedLayer.replace("back_text:", "");
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        textLayers: (prev.back.textLayers ?? []).filter((text) => text.id !== textId),
      },
    }));
    setSelectedLayer("back_qr");
    setSelectedLayers(["back_qr"]);
    setSide("back");
  }

  function deleteSelectedLayer() {
    if (selectedLayer === "back_qr") return;
    if (isShapeLayer(selectedLayer)) {
      deleteSelectedShape();
      return;
    }
    if (isImageLayer(selectedLayer)) {
      deleteSelectedImage();
      return;
    }
    if (isBackImageLayer(selectedLayer)) {
      deleteSelectedBackImage();
      return;
    }
    if (isBackShapeLayer(selectedLayer)) {
      deleteSelectedBackShape();
      return;
    }
    if (isFrontFreeTextLayer(selectedLayer)) {
      deleteSelectedFrontText();
      return;
    }
    if (isBackFreeTextLayer(selectedLayer)) {
      deleteSelectedBackText();
      return;
    }
    const selectFallbackFrontLayer = (removed: SelectedLayer) => {
      const next = editorLayerOrder.find((layerId) => layerId !== removed) ?? "firstName";
      setSelectedLayer(next);
      setSelectedLayers([next]);
      setSide("front");
    };
    if (selectedLayer === "role_background") {
      setConfig((prev) => ({
        ...prev,
        roles: {
          ...prev.roles,
          [role]: {
            ...prev.roles[role],
            frontBackgroundUrl: null,
          },
        },
      }));
      selectFallbackFrontLayer("role_background");
      return;
    }
    if (selectedLayer === "role_overlay") {
      setConfig((prev) => ({
        ...prev,
        roles: {
          ...prev.roles,
          [role]: {
            ...prev.roles[role],
            frontOverlayUrl: null,
          },
        },
      }));
      selectFallbackFrontLayer("role_overlay");
      return;
    }
    if (selectedLayer === "role_tint") {
      setConfig((prev) => ({
        ...prev,
        roles: {
          ...prev.roles,
          [role]: {
            ...prev.roles[role],
            mapTintOpacity: 0,
          },
        },
      }));
      selectFallbackFrontLayer("role_tint");
      return;
    }
    const mappedId = selectedLayer as BadgeFrontLayerId;
    const nextSelectionPool = editorLayerOrder.filter((layerId) => layerId !== selectedLayer);
    const nextSelectedLayer = nextSelectionPool[0] ?? "back_qr";

    setConfig((prev) => {
      const nextLayerSettings = { ...prev.front.layerSettings };
      delete nextLayerSettings[mappedId];
      return ensureLayerOrderSync({
        ...prev,
        front: {
          ...prev.front,
          layerOrder: prev.front.layerOrder.filter((layerId) => layerId !== mappedId),
          layerSettings: nextLayerSettings,
        },
      });
    });
    setSelectedLayer(nextSelectedLayer);
    setSelectedLayers([nextSelectedLayer]);
    setSide(nextSelectedLayer === "back_qr" ? "back" : "front");
  }

  function duplicateSelectedLayer() {
    if (isShapeLayer(selectedLayer)) {
      const shape = config.front.shapes.find(
        (item) => `shape:${item.id}` === selectedLayer
      );
      if (!shape) return;
      const id = `shape_${Date.now().toString(36)}`;
      const duplicated = {
        ...shape,
        id,
        x: shape.x + 12,
        y: shape.y + 12,
      };
      setConfig((prev) =>
        ensureLayerOrderSync({
          ...prev,
          front: {
            ...prev.front,
            shapes: [...prev.front.shapes, duplicated],
          },
        })
      );
      setSelectedLayer(`shape:${id}`);
      setSelectedLayers([`shape:${id}`]);
      return;
    }
    if (isImageLayer(selectedLayer)) {
      const image = config.front.images.find(
        (item) => `image:${item.id}` === selectedLayer
      );
      if (!image) return;
      const id = `image_${Date.now().toString(36)}`;
      const duplicated = {
        ...image,
        id,
        x: image.x + 12,
        y: image.y + 12,
      };
      setConfig((prev) =>
        ensureLayerOrderSync({
          ...prev,
          front: {
            ...prev.front,
            images: [...prev.front.images, duplicated],
          },
        })
      );
      setSelectedLayer(`image:${id}`);
      setSelectedLayers([`image:${id}`]);
      return;
    }
    if (isFrontFreeTextLayer(selectedLayer)) {
      const sourceTextId = selectedLayer.replace("text:", "");
      const text = (config.front.textLayers ?? []).find((item) => item.id === sourceTextId);
      if (!text) return;
      const id = `text_${Date.now().toString(36)}`;
      const duplicated = {
        ...text,
        id,
        x: text.x + 12,
        y: text.y + 12,
      };
      setConfig((prev) =>
        ensureLayerOrderSync({
          ...prev,
          front: {
            ...prev.front,
            textLayers: [...(prev.front.textLayers ?? []), duplicated],
          },
        })
      );
      setSelectedLayer(`text:${id}`);
      setSelectedLayers([`text:${id}`]);
      return;
    }
    if (isBackImageLayer(selectedLayer)) {
      const sourceImageId = selectedLayer.replace("back_image:", "");
      const image = (config.back.images ?? []).find((item) => item.id === sourceImageId);
      if (!image) return;
      const id = `back_image_${Date.now().toString(36)}`;
      const duplicated = { ...image, id, x: image.x + 12, y: image.y + 12 };
      setConfig((prev) => ({
        ...prev,
        back: { ...prev.back, images: [...(prev.back.images ?? []), duplicated] },
      }));
      setSelectedLayer(`back_image:${id}`);
      setSelectedLayers([`back_image:${id}`]);
      setSide("back");
      return;
    }
    if (isBackShapeLayer(selectedLayer)) {
      const sourceShapeId = selectedLayer.replace("back_shape:", "");
      const shape = (config.back.shapes ?? []).find((item) => item.id === sourceShapeId);
      if (!shape) return;
      const id = `back_shape_${Date.now().toString(36)}`;
      const duplicated = { ...shape, id, x: shape.x + 12, y: shape.y + 12 };
      setConfig((prev) => ({
        ...prev,
        back: { ...prev.back, shapes: [...(prev.back.shapes ?? []), duplicated] },
      }));
      setSelectedLayer(`back_shape:${id}`);
      setSelectedLayers([`back_shape:${id}`]);
      setSide("back");
      return;
    }
    if (isBackFreeTextLayer(selectedLayer)) {
      const sourceTextId = selectedLayer.replace("back_text:", "");
      const text = (config.back.textLayers ?? []).find((item) => item.id === sourceTextId);
      if (!text) return;
      const id = `back_text_${Date.now().toString(36)}`;
      const duplicated = {
        ...text,
        id,
        x: text.x + 12,
        y: text.y + 12,
      };
      setConfig((prev) => ({
        ...prev,
        back: { ...prev.back, textLayers: [...(prev.back.textLayers ?? []), duplicated] },
      }));
      setSelectedLayer(`back_text:${id}`);
      setSelectedLayers([`back_text:${id}`]);
      setSide("back");
    }
  }

  function cloneSelectedToBadge(targetRole: BadgeRole) {
    if (targetRole === role || !selectedLayer) return;
    setConfig((prev) => {
      const layouts = roleLayoutSnapshot(prev);
      const source = layouts[role];
      const target = cloneDeep(layouts[targetRole]);
      const targetTheme = cloneDeep(prev.roles[targetRole]);
      const nextLayerOrder = [...target.front.layerOrder];
      const layersToClone: SelectedLayer[] = Array.from(
        new Set(
          selectedLayers.length > 0 ? [...selectedLayers, selectedLayer] : [selectedLayer]
        )
      );

      for (const layerId of layersToClone) {
        if (layerId === "back_qr") {
          target.back.qr = cloneDeep(source.back.qr);
          continue;
        }
        if (isBackImageLayer(layerId)) {
          const sourceImageId = layerId.replace("back_image:", "");
          const sourceImage = (source.back.images ?? []).find((img) => img.id === sourceImageId);
          if (!sourceImage) continue;
          const id = `back_image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          target.back.images = [...(target.back.images ?? []), { ...cloneDeep(sourceImage), id }];
          continue;
        }
        if (isBackShapeLayer(layerId)) {
          const sourceShapeId = layerId.replace("back_shape:", "");
          const sourceShape = (source.back.shapes ?? []).find((shape) => shape.id === sourceShapeId);
          if (!sourceShape) continue;
          const id = `back_shape_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          target.back.shapes = [...(target.back.shapes ?? []), { ...cloneDeep(sourceShape), id }];
          continue;
        }
        if (isBackFreeTextLayer(layerId)) {
          const sourceTextId = layerId.replace("back_text:", "");
          const sourceText = (source.back.textLayers ?? []).find((text) => text.id === sourceTextId);
          if (!sourceText) continue;
          const id = `back_text_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          target.back.textLayers = [...(target.back.textLayers ?? []), { ...cloneDeep(sourceText), id }];
          continue;
        }
        if (layerId === "role_background") {
          targetTheme.frontBackgroundUrl = prev.roles[role].frontBackgroundUrl;
          continue;
        }
        if (layerId === "role_overlay") {
          targetTheme.frontOverlayUrl = prev.roles[role].frontOverlayUrl;
          continue;
        }
        if (layerId === "role_tint") {
          targetTheme.mapTintColor = prev.roles[role].mapTintColor;
          targetTheme.mapTintOpacity = prev.roles[role].mapTintOpacity;
          continue;
        }
        if (layerId === "logo") {
          target.front.logo = cloneDeep(source.front.logo);
          target.front.bindings.logo = source.front.bindings.logo;
          target.front.layerSettings.logo = cloneDeep(
            source.front.layerSettings.logo ?? { visible: true, locked: false }
          );
          continue;
        }
        if (layerId === "front_qr") {
          target.front.qr = cloneDeep(source.front.qr);
          if (!nextLayerOrder.includes("front_qr")) nextLayerOrder.push("front_qr");
          target.front.layerSettings.front_qr = cloneDeep(
            source.front.layerSettings.front_qr ?? { visible: true, locked: false }
          );
          continue;
        }
        if (isFrontTextLayer(layerId)) {
          target.front[layerId] = cloneDeep(source.front[layerId]);
          target.front.bindings[layerId] = source.front.bindings[layerId];
          if (!nextLayerOrder.includes(layerId)) nextLayerOrder.push(layerId);
          target.front.layerSettings[layerId] = cloneDeep(
            source.front.layerSettings[layerId] ?? { visible: true, locked: false }
          );
          continue;
        }
        if (isShapeLayer(layerId)) {
          const sourceShapeId = layerId.replace("shape:", "");
          const sourceShape = source.front.shapes.find((shape) => shape.id === sourceShapeId);
          if (!sourceShape) continue;
          const id = `shape_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          target.front.shapes = [...target.front.shapes, { ...cloneDeep(sourceShape), id }];
          nextLayerOrder.push(`shape:${id}`);
          target.front.layerSettings[`shape:${id}`] = cloneDeep(
            source.front.layerSettings[layerId] ?? { visible: true, locked: false }
          );
          continue;
        }
        if (isImageLayer(layerId)) {
          const sourceImageId = layerId.replace("image:", "");
          const sourceImage = source.front.images.find((image) => image.id === sourceImageId);
          if (!sourceImage) continue;
          const id = `image_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          target.front.images = [...target.front.images, { ...cloneDeep(sourceImage), id }];
          nextLayerOrder.push(`image:${id}`);
          target.front.layerSettings[`image:${id}`] = cloneDeep(
            source.front.layerSettings[layerId] ?? { visible: true, locked: false }
          );
          continue;
        }
        if (isFrontFreeTextLayer(layerId)) {
          const sourceTextId = layerId.replace("text:", "");
          const sourceText = (source.front.textLayers ?? []).find((text) => text.id === sourceTextId);
          if (!sourceText) continue;
          const id = `text_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
          target.front.textLayers = [...(target.front.textLayers ?? []), { ...cloneDeep(sourceText), id }];
          nextLayerOrder.push(`text:${id}`);
          target.front.layerSettings[`text:${id}`] = cloneDeep(
            source.front.layerSettings[layerId] ?? { visible: true, locked: false }
          );
        }
      }

      target.front.layerOrder = nextLayerOrder;
      const syncedTargetFront = ensureLayerOrderSync({
        ...prev,
        front: target.front,
      }).front;

      const nextLayouts = {
        ...layouts,
        [targetRole]: {
          front: syncedTargetFront,
          back: target.back,
        },
      };

      return {
        ...prev,
        roles: {
          ...prev.roles,
          [targetRole]: targetTheme,
        },
        roleLayouts: nextLayouts,
      };
    });
  }

  function cloneCurrentSideLayoutToBadge(targetRole: BadgeRole) {
    if (targetRole === role) return;
    setConfig((prev) => {
      const layouts = roleLayoutSnapshot(prev);
      const source = layouts[role];
      const target = cloneDeep(layouts[targetRole]);
      if (side === "front") {
        target.front = cloneDeep(source.front);
      } else {
        target.back = cloneDeep(source.back);
      }
      return {
        ...prev,
        roleLayouts: {
          ...layouts,
          [targetRole]: target,
        },
      };
    });
  }

  function frontLayerPosition(layerId: SelectedLayer): { x: number; y: number } | null {
    if (layerId === "role_visuals") return null;
    if (layerId === "back_qr") return { x: config.back.qr.x, y: config.back.qr.y };
    if (isBackImageLayer(layerId)) {
      const imageId = layerId.replace("back_image:", "");
      const image = (config.back.images ?? []).find((item) => item.id === imageId);
      if (!image) return null;
      return { x: image.x, y: image.y };
    }
    if (isBackShapeLayer(layerId)) {
      const shapeId = layerId.replace("back_shape:", "");
      const shape = (config.back.shapes ?? []).find((item) => item.id === shapeId);
      if (!shape) return null;
      return { x: shape.x, y: shape.y };
    }
    if (isBackFreeTextLayer(layerId)) {
      const textId = layerId.replace("back_text:", "");
      const text = (config.back.textLayers ?? []).find((item) => item.id === textId);
      if (!text) return null;
      return { x: text.x, y: text.y };
    }
    if (layerId === "logo") {
      return { x: config.front.logo.x, y: config.front.logo.y };
    }
    if (layerId === "front_qr") {
      return { x: frontQr.x, y: frontQr.y };
    }
    if (isFrontTextLayer(layerId)) {
      return { x: config.front[layerId].x, y: config.front[layerId].baselineY };
    }
    if (isShapeLayer(layerId)) {
      const shapeId = layerId.replace("shape:", "");
      const shape = config.front.shapes.find((item) => item.id === shapeId);
      if (!shape) return null;
      return { x: shape.x, y: shape.y };
    }
    if (isImageLayer(layerId)) {
      const imageId = layerId.replace("image:", "");
      const image = config.front.images.find((item) => item.id === imageId);
      if (!image) return null;
      return { x: image.x, y: image.y };
    }
    if (isFrontFreeTextLayer(layerId)) {
      const textId = layerId.replace("text:", "");
      const text = (config.front.textLayers ?? []).find((item) => item.id === textId);
      if (!text) return null;
      return { x: text.x, y: text.y };
    }
    return null;
  }

  function setFrontLayerPosition(layerId: SelectedLayer, x: number, y: number) {
    if (
      layerId === "role_visuals" ||
      layerId === "role_background" ||
      layerId === "role_tint" ||
      layerId === "role_overlay"
    )
      return;
    if (layerId === "back_qr") {
      setConfig((prev) => ({
        ...prev,
        back: { ...prev.back, qr: { ...prev.back.qr, x, y } },
      }));
      return;
    }
    if (isBackImageLayer(layerId)) {
      const imageId = layerId.replace("back_image:", "");
      setConfig((prev) => ({
        ...prev,
        back: {
          ...prev.back,
          images: (prev.back.images ?? []).map((image) =>
            image.id === imageId ? { ...image, x, y } : image
          ),
        },
      }));
      return;
    }
    if (isBackShapeLayer(layerId)) {
      const shapeId = layerId.replace("back_shape:", "");
      setConfig((prev) => ({
        ...prev,
        back: {
          ...prev.back,
          shapes: (prev.back.shapes ?? []).map((shape) =>
            shape.id === shapeId ? { ...shape, x, y } : shape
          ),
        },
      }));
      return;
    }
    if (isBackFreeTextLayer(layerId)) {
      const textId = layerId.replace("back_text:", "");
      setConfig((prev) => ({
        ...prev,
        back: {
          ...prev.back,
          textLayers: (prev.back.textLayers ?? []).map((text) =>
            text.id === textId ? { ...text, x, y } : text
          ),
        },
      }));
      return;
    }
    if (layerId === "logo") {
      setConfig((prev) => ({
        ...prev,
        front: { ...prev.front, logo: { ...prev.front.logo, x, y } },
      }));
      return;
    }
    if (layerId === "front_qr") {
      setConfig((prev) => ({
        ...prev,
        front: { ...prev.front, qr: { ...prev.front.qr, x, y } },
      }));
      return;
    }
    if (isFrontTextLayer(layerId)) {
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          [layerId]: { ...prev.front[layerId], x, baselineY: y },
        },
      }));
      return;
    }
    if (isShapeLayer(layerId)) {
      const shapeId = layerId.replace("shape:", "");
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          shapes: prev.front.shapes.map((shape) =>
            shape.id === shapeId ? { ...shape, x, y } : shape
          ),
        },
      }));
      return;
    }
    if (isImageLayer(layerId)) {
      const imageId = layerId.replace("image:", "");
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          images: prev.front.images.map((image) =>
            image.id === imageId ? { ...image, x, y } : image
          ),
        },
      }));
      return;
    }
    if (isFrontFreeTextLayer(layerId)) {
      const textId = layerId.replace("text:", "");
      setConfig((prev) => ({
        ...prev,
        front: {
          ...prev.front,
          textLayers: (prev.front.textLayers ?? []).map((text) =>
            text.id === textId ? { ...text, x, y } : text
          ),
        },
      }));
    }
  }

  function applyAlign(mode: "left" | "right" | "top" | "bottom" | "hcenter" | "vcenter") {
    const ids = selectedLayers.filter((id) => frontLayerPosition(id) && !isLayerLocked(id));
    if (ids.length < 2) return;
    const points = ids.map((id) => ({ id, ...frontLayerPosition(id)! }));
    const xs = points.map((p) => p.x);
    const ys = points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const centerX = Math.round((minX + maxX) / 2);
    const centerY = Math.round((minY + maxY) / 2);
    for (const point of points) {
      const nextX =
        mode === "left" ? minX : mode === "right" ? maxX : mode === "hcenter" ? centerX : point.x;
      const nextY =
        mode === "top" ? minY : mode === "bottom" ? maxY : mode === "vcenter" ? centerY : point.y;
      setFrontLayerPosition(point.id, nextX, nextY);
    }
  }

  function applyDistribute(axis: "horizontal" | "vertical") {
    const ids = selectedLayers.filter((id) => frontLayerPosition(id) && !isLayerLocked(id));
    if (ids.length < 3) return;
    const points = ids.map((id) => ({ id, ...frontLayerPosition(id)! }));
    const sorted = [...points].sort((a, b) => (axis === "horizontal" ? a.x - b.x : a.y - b.y));
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const span = axis === "horizontal" ? last.x - first.x : last.y - first.y;
    const step = span / (sorted.length - 1);
    sorted.forEach((point, index) => {
      if (index === 0 || index === sorted.length - 1) return;
      const target = Math.round((axis === "horizontal" ? first.x : first.y) + step * index);
      if (axis === "horizontal") {
        setFrontLayerPosition(point.id, target, point.y);
      } else {
        setFrontLayerPosition(point.id, point.x, target);
      }
    });
  }

  function nudgeSelected(dx: number, dy: number) {
    const ids = selectedLayers.filter((id) => frontLayerPosition(id) && !isLayerLocked(id));
    for (const id of ids) {
      const current = frontLayerPosition(id);
      if (!current) continue;
      setFrontLayerPosition(id, current.x + dx, current.y + dy);
    }
  }

  const sampleValues = {
    organizationLine1: "LAKELAND",
    organizationLine2: "COLLEGE",
    firstName: "SAM",
    lastName: "WILLIS",
    title: "GENERAL MANAGER",
  };
  const samplePerson = {
    display_name: "Samantha Willis",
    first_name: "Samantha",
    last_name: "Willis",
    role_title: "General Manager",
    organization_name: "Lakeland College",
    city: "Vermilion",
    province: "AB",
  };

  function previewTextForLayer(
    layerId: "organizationLine1" | "organizationLine2" | "firstName" | "lastName" | "title"
  ): string {
    const binding = config.front.bindings[layerId];
    switch (binding) {
      case "computed.org_line_1":
        return sampleValues.organizationLine1;
      case "computed.org_line_2":
        return sampleValues.organizationLine2;
      case "computed.first_name":
        return sampleValues.firstName;
      case "computed.last_name":
        return sampleValues.lastName;
      case "computed.role_title":
        return sampleValues.title;
      case "person.display_name":
        return samplePerson.display_name;
      case "person.first_name":
        return samplePerson.first_name;
      case "person.last_name":
        return samplePerson.last_name;
      case "person.role_title":
        return samplePerson.role_title;
      case "person.organization_name":
        return samplePerson.organization_name;
      case "person.city":
        return samplePerson.city;
      case "person.province":
        return samplePerson.province;
      default:
        return sampleValues[layerId];
    }
  }

  const serializedConfig = JSON.stringify({
    ...config,
    roleLayouts: {
      ...(config.roleLayouts ?? {}),
      [role]: {
        front: config.front,
        back: config.back,
      },
    },
  });
  const selectedShape = isShapeLayer(selectedLayer)
    ? config.front.shapes.find((shape) => shape.id === selectedLayer.replace("shape:", ""))
    : null;
  const selectedImage = isImageLayer(selectedLayer)
    ? config.front.images.find((image) => image.id === selectedLayer.replace("image:", ""))
    : null;
  const selectedBackImage = isBackImageLayer(selectedLayer)
    ? (config.back.images ?? []).find(
        (image) => image.id === selectedLayer.replace("back_image:", "")
      )
    : null;
  const selectedBackShape = isBackShapeLayer(selectedLayer)
    ? (config.back.shapes ?? []).find(
        (shape) => shape.id === selectedLayer.replace("back_shape:", "")
      ) ?? null
    : null;
  const selectedFrontFreeText = isFrontFreeTextLayer(selectedLayer)
    ? (config.front.textLayers ?? []).find(
        (text) => text.id === selectedLayer.replace("text:", "")
      ) ?? null
    : null;
  const selectedBackFreeText = isBackFreeTextLayer(selectedLayer)
    ? (config.back.textLayers ?? []).find(
        (text) => text.id === selectedLayer.replace("back_text:", "")
      ) ?? null
    : null;

  useEffect(() => {
    const nextSnapshot: EditorSnapshot = { config, name, version, status };
    const nextHash = JSON.stringify(nextSnapshot);
    if (nextHash === snapshotHashRef.current) return;
    if (historyInteractionRef.current) return;
    if (skipHistoryRef.current) {
      skipHistoryRef.current = false;
      snapshotRef.current = nextSnapshot;
      snapshotHashRef.current = nextHash;
      return;
    }
    commitSnapshot(snapshotRef.current, nextSnapshot);
  }, [commitSnapshot, config, name, version, status]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable)
      ) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      const key = event.key.toLowerCase();
      if (key === "z" && event.shiftKey) {
        event.preventDefault();
        redo();
        return;
      }
      if (key === "z") {
        event.preventDefault();
        undo();
        return;
      }
      if (key === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  function updateSelectedShape(patch: Record<string, unknown>) {
    if (!selectedShape) return;
    setConfig((prev) => ({
      ...prev,
      front: {
        ...prev.front,
        shapes: prev.front.shapes.map((shape) =>
          shape.id === selectedShape.id ? { ...shape, ...patch } : shape
        ),
      },
    }));
  }

  function updateSelectedImage(patch: Record<string, unknown>) {
    if (!selectedImage) return;
    setConfig((prev) => ({
      ...prev,
      front: {
        ...prev.front,
        images: prev.front.images.map((image) =>
          image.id === selectedImage.id ? { ...image, ...patch } : image
        ),
      },
    }));
  }

  function updateSelectedBackImage(patch: Record<string, unknown>) {
    if (!selectedBackImage) return;
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        images: (prev.back.images ?? []).map((image) =>
          image.id === selectedBackImage.id ? { ...image, ...patch } : image
        ),
      },
    }));
  }

  function updateSelectedBackShape(patch: Record<string, unknown>) {
    if (!selectedBackShape) return;
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        shapes: (prev.back.shapes ?? []).map((shape) =>
          shape.id === selectedBackShape.id ? { ...shape, ...patch } : shape
        ),
      },
    }));
  }

  function updateSelectedFrontFreeText(patch: Record<string, unknown>) {
    if (!selectedFrontFreeText) return;
    setConfig((prev) => ({
      ...prev,
      front: {
        ...prev.front,
        textLayers: (prev.front.textLayers ?? []).map((text) =>
          text.id === selectedFrontFreeText.id ? { ...text, ...patch } : text
        ),
      },
    }));
  }

  function updateSelectedBackFreeText(patch: Record<string, unknown>) {
    if (!selectedBackFreeText) return;
    setConfig((prev) => ({
      ...prev,
      back: {
        ...prev.back,
        textLayers: (prev.back.textLayers ?? []).map((text) =>
          text.id === selectedBackFreeText.id ? { ...text, ...patch } : text
        ),
      },
    }));
  }

  function exportTemplateJson() {
    const payload = JSON.stringify(
      {
        name,
        status,
        configVersion: version,
        config,
      },
      null,
      2
    );
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name || "badge-template"}-v${version}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importTemplateFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      let nextConfig: BadgeTemplateConfigV1 | null = null;
      let nextName: string | null = null;
      let nextStatus: "draft" | "active" | "archived" | null = null;
      let nextVersion: number | null = null;

      if (parsed && typeof parsed === "object") {
        const root = parsed as Record<string, unknown>;
        const candidate =
          root.config && typeof root.config === "object"
            ? (root.config as Record<string, unknown>)
            : root;
        if (
          typeof candidate.canvas === "object" &&
          typeof candidate.front === "object" &&
          typeof candidate.back === "object" &&
          typeof candidate.roles === "object"
        ) {
          nextConfig = candidate as unknown as BadgeTemplateConfigV1;
        }
        if (typeof root.name === "string") nextName = root.name;
        if (
          root.status === "draft" ||
          root.status === "active" ||
          root.status === "archived"
        ) {
          nextStatus = root.status;
        }
        if (typeof root.configVersion === "number" && Number.isFinite(root.configVersion)) {
          nextVersion = Math.max(1, Math.floor(root.configVersion));
        }
      }

      if (!nextConfig) {
        setImportMessage("Import failed: JSON does not contain a valid badge template config.");
        event.target.value = "";
        return;
      }

      setConfig(ensureLayerOrderSync(normalizeBadgeTemplateConfig(nextConfig)));
      if (nextName) setName(nextName);
      if (nextStatus) setStatus(nextStatus);
      if (nextVersion) setVersion(nextVersion);
      setSide("front");
      selectLayer("firstName");
      setImportMessage("Template imported.");
    } catch {
      setImportMessage("Import failed: invalid JSON file.");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Template & Layout Editor</h2>
          <p className="text-sm text-gray-600">
            Real-time badge editor: layer ordering, shapes, front/back placement, and live property control.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={undo}
            disabled={undoStack.length === 0}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Undo (Ctrl/Cmd+Z)"
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={redoStack.length === 0}
            className="rounded-md border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            title="Redo (Ctrl+Y or Ctrl/Cmd+Shift+Z)"
          >
            Redo
          </button>
          <button
            type="button"
            onClick={() => setRole("delegate")}
            className={`rounded-md border px-3 py-1 text-xs font-medium ${
              role === "delegate"
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Delegate
          </button>
          <button
            type="button"
            onClick={() => setRole("exhibitor")}
            className={`rounded-md border px-3 py-1 text-xs font-medium ${
              role === "exhibitor"
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Exhibitor
          </button>
          <div className="ml-1 flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1">
            <span className="text-[11px] text-gray-600">Clone selected to</span>
            <select
              value={cloneTargetRole}
              onChange={(event) =>
                setCloneTargetRole(
                  event.target.value === "delegate" ? "delegate" : "exhibitor"
                )
              }
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
            >
              <option value="delegate" disabled={role === "delegate"}>
                Delegate
              </option>
              <option value="exhibitor" disabled={role === "exhibitor"}>
                Exhibitor
              </option>
            </select>
            <button
              type="button"
              onClick={() => cloneSelectedToBadge(cloneTargetRole)}
              disabled={!selectedLayer || cloneTargetRole === role}
              className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clone
            </button>
          </div>
          <div className="ml-1 flex items-center gap-1 rounded-md border border-gray-300 px-2 py-1">
            <span className="text-[11px] text-gray-600">Clone {side} layout to</span>
            <select
              value={cloneTargetRole}
              onChange={(event) =>
                setCloneTargetRole(
                  event.target.value === "delegate" ? "delegate" : "exhibitor"
                )
              }
              className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px]"
            >
              <option value="delegate" disabled={role === "delegate"}>
                Delegate
              </option>
              <option value="exhibitor" disabled={role === "exhibitor"}>
                Exhibitor
              </option>
            </select>
            <button
              type="button"
              onClick={() => cloneCurrentSideLayoutToBadge(cloneTargetRole)}
              disabled={cloneTargetRole === role}
              className="rounded border border-gray-300 px-2 py-0.5 text-[11px] text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Clone Layout
            </button>
          </div>
          <button
            type="button"
            onClick={() => setSide("front")}
            className={`rounded-md border px-3 py-1 text-xs font-medium ${
              side === "front"
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Front
          </button>
          <button
            type="button"
            onClick={() => {
              setSide("back");
              selectLayer("back_qr");
            }}
            className={`rounded-md border px-3 py-1 text-xs font-medium ${
              side === "back"
                ? "border-gray-900 bg-gray-900 text-white"
                : "border-gray-300 text-gray-700 hover:bg-gray-50"
            }`}
          >
            Back
          </button>
          <label className="ml-2 flex items-center gap-1 text-xs text-gray-600">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
            >
              {showAdvanced ? "Hide Advanced" : "Show Advanced"}
            </button>
          </label>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)_360px]">
        <aside className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Layers</p>
          {side === "front" ? (
            <>
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => addBackgroundLayer()}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Background Layer
                </button>
                <button
                  type="button"
                  onClick={() => addShape("rect")}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Rect
                </button>
                <button
                  type="button"
                  onClick={() => addShape("circle")}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Circle
                </button>
                <button
                  type="button"
                  onClick={() => addShape("line")}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Line
                </button>
                <button
                  type="button"
                  onClick={() => addFrontQrLayer()}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + QR
                </button>
                <button
                  type="button"
                  onClick={() => addImageLayer()}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Image
                </button>
                <button
                  type="button"
                  onClick={() => addFrontTextLayer()}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Text
                </button>
              </div>
              <ul className="mt-2 space-y-1">
                {editorLayerOrder.map((layerId) => (
                  <li key={layerId}>
                    <button
                      type="button"
                      onClick={(event) => selectLayer(layerId, event.shiftKey)}
                      className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                        selectedLayer === layerId
                          ? "border-gray-900 bg-gray-900 text-white"
                          : selectedLayers.includes(layerId)
                            ? "border-red-400 bg-red-50 text-red-800"
                            : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                      }`}
                    >
                      {labelForLayer(layerId)}
                    </button>
                    <div className="mt-1 flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          updateLayerSetting(layerId, { visible: !isLayerVisible(layerId) })
                        }
                        className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                      >
                        {isLayerVisible(layerId) ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateLayerSetting(layerId, { locked: !isLayerLocked(layerId) })
                        }
                        className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                      >
                        {isLayerLocked(layerId) ? "Unlock" : "Lock"}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => addBackBackgroundLayer()}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Background Layer
                </button>
                <button
                  type="button"
                  onClick={() => addBackShape("rect")}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Rect
                </button>
                <button
                  type="button"
                  onClick={() => addBackShape("circle")}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Circle
                </button>
                <button
                  type="button"
                  onClick={() => addBackShape("line")}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Line
                </button>
                <button
                  type="button"
                  onClick={() => addBackImageLayer()}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Image
                </button>
                <button
                  type="button"
                  onClick={() => addBackTextLayer()}
                  className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                >
                  + Text
                </button>
              </div>
              <ul className="mt-2 space-y-1">
              <li>
                <button
                  type="button"
                  onClick={() => selectLayer("back_qr")}
                  className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                    selectedLayer === "back_qr"
                      ? "border-gray-900 bg-gray-900 text-white"
                      : selectedLayers.includes("back_qr")
                        ? "border-red-400 bg-red-50 text-red-800"
                        : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                  }`}
                >
                  back_qr
                </button>
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => updateLayerSetting("back_qr", { visible: !isLayerVisible("back_qr") })}
                    className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                  >
                    {isLayerVisible("back_qr") ? "Hide" : "Show"}
                  </button>
                  <button
                    type="button"
                    onClick={() => updateLayerSetting("back_qr", { locked: !isLayerLocked("back_qr") })}
                    className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                  >
                    {isLayerLocked("back_qr") ? "Unlock" : "Lock"}
                  </button>
                </div>
              </li>
                {(config.back.shapes ?? []).map((shape) => {
                  const layerId = `back_shape:${shape.id}` as SelectedLayer;
                  if (!isLayerVisible(layerId)) return null;
                  return (
                    <li key={layerId}>
                      <button
                        type="button"
                        onClick={(event) => selectLayer(layerId, event.shiftKey)}
                        className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                          selectedLayer === layerId
                            ? "border-gray-900 bg-gray-900 text-white"
                            : selectedLayers.includes(layerId)
                              ? "border-red-400 bg-red-50 text-red-800"
                              : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {labelForLayer(layerId)}
                      </button>
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateLayerSetting(layerId, { visible: !isLayerVisible(layerId) })
                          }
                          className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          {isLayerVisible(layerId) ? "Hide" : "Show"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateLayerSetting(layerId, { locked: !isLayerLocked(layerId) })
                          }
                          className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          {isLayerLocked(layerId) ? "Unlock" : "Lock"}
                        </button>
                      </div>
                    </li>
                  );
                })}
                {(config.back.images ?? []).map((image) => {
                  const layerId = `back_image:${image.id}` as SelectedLayer;
                  if (!isLayerVisible(layerId)) return null;
                  return (
                    <li key={layerId}>
                      <button
                        type="button"
                        onClick={(event) => selectLayer(layerId, event.shiftKey)}
                        className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                          selectedLayer === layerId
                            ? "border-gray-900 bg-gray-900 text-white"
                            : selectedLayers.includes(layerId)
                              ? "border-red-400 bg-red-50 text-red-800"
                              : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {labelForLayer(layerId)}
                      </button>
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateLayerSetting(layerId, { visible: !isLayerVisible(layerId) })
                          }
                          className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          {isLayerVisible(layerId) ? "Hide" : "Show"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateLayerSetting(layerId, { locked: !isLayerLocked(layerId) })
                          }
                          className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          {isLayerLocked(layerId) ? "Unlock" : "Lock"}
                        </button>
                      </div>
                    </li>
                  );
                })}
                {(config.back.textLayers ?? []).map((text) => {
                  const layerId = `back_text:${text.id}` as SelectedLayer;
                  return (
                    <li key={layerId}>
                      <button
                        type="button"
                        onClick={(event) => selectLayer(layerId, event.shiftKey)}
                        className={`w-full rounded-md border px-2 py-1 text-left text-xs ${
                          selectedLayer === layerId
                            ? "border-gray-900 bg-gray-900 text-white"
                            : selectedLayers.includes(layerId)
                              ? "border-red-400 bg-red-50 text-red-800"
                              : "border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100"
                        }`}
                      >
                        {labelForLayer(layerId)}
                      </button>
                      <div className="mt-1 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() =>
                            updateLayerSetting(layerId, { visible: !isLayerVisible(layerId) })
                          }
                          className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          {isLayerVisible(layerId) ? "Hide" : "Show"}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            updateLayerSetting(layerId, { locked: !isLayerLocked(layerId) })
                          }
                          className="rounded border border-gray-300 px-1 py-0 text-[10px] text-gray-600 hover:bg-gray-50"
                        >
                          {isLayerLocked(layerId) ? "Unlock" : "Lock"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>

        <div className="rounded-lg border border-gray-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">Canvas</p>
          <div
            className="relative overflow-hidden rounded border border-gray-200 bg-white"
            style={{ width: PREVIEW_WIDTH, height: previewHeight }}
          >
            {side === "front" ? (
              <>
                <div
                  className="absolute inset-0"
                  style={{
                    backgroundImage:
                      "radial-gradient(circle at 20% 20%, rgba(0,0,0,0.04) 0, rgba(0,0,0,0.04) 1px, transparent 1px)",
                    backgroundSize: "12px 12px",
                  }}
                />

                {editorLayerOrder.map((layerId) => {
                  if (!isLayerVisible(layerId)) return null;
                  if (layerId === "role_background") {
                    return (
                      <div key={layerId} className="absolute inset-0">
                        {roleTheme.frontBackgroundUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={roleTheme.frontBackgroundUrl}
                            alt=""
                            className={`absolute inset-0 h-full w-full object-cover ${selectedClass(
                              "role_background"
                            )}`}
                            onClick={(event) => selectLayer("role_background", event.shiftKey)}
                          />
                        ) : null}
                      </div>
                    );
                  }
                  if (layerId === "role_tint") {
                    return (
                      <div key={layerId} className="absolute inset-0">
                        <div
                          className={`absolute inset-0 ${selectedClass("role_tint")}`}
                          style={{
                            background: roleTheme.mapTintColor,
                            opacity: roleTheme.mapTintOpacity,
                          }}
                          onClick={(event) => selectLayer("role_tint", event.shiftKey)}
                        />
                      </div>
                    );
                  }
                  if (layerId === "role_overlay") {
                    return (
                      <div key={layerId} className="absolute inset-0">
                        {roleTheme.frontOverlayUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={roleTheme.frontOverlayUrl}
                            alt=""
                            className={`absolute inset-0 h-full w-full object-cover ${selectedClass(
                              "role_overlay"
                            )}`}
                            onClick={(event) => selectLayer("role_overlay", event.shiftKey)}
                          />
                        ) : null}
                      </div>
                    );
                  }

                  if (layerId === "logo") {
                    return (
                      <div
                        key={layerId}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => selectLayer("logo", event.shiftKey)}
                        onPointerDown={(event) => startDrag("logo", event)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        className={`absolute rounded-full border-2 ${
                          selectedLayers.includes("logo") ? "border-red-500" : "border-black/20"
                        } bg-white ${selectedClass("logo")}`}
                        style={{
                          left: config.front.logo.x * scale,
                          top: config.front.logo.y * scale,
                          width: config.front.logo.diameter * scale,
                          height: config.front.logo.diameter * scale,
                        }}
                      >
                        <div
                          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                          onPointerDown={(event) => startResize("logo", event)}
                        />
                      </div>
                    );
                  }
                  if (layerId === "front_qr") {
                    return (
                      <div
                        key={layerId}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => selectLayer("front_qr", event.shiftKey)}
                        onPointerDown={(event) => startDrag("front_qr", event)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        className={`absolute border-2 bg-white ${
                          selectedLayers.includes("front_qr") ? "border-red-500" : "border-black/20"
                        } ${selectedClass("front_qr")}`}
                        style={{
                          left: frontQr.x * scale,
                          top: frontQr.y * scale,
                          width: frontQr.size * scale,
                          height: frontQr.size * scale,
                        }}
                      >
                        <div
                          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                          onPointerDown={(event) => startResize("front_qr", event)}
                        />
                      </div>
                    );
                  }

                  if (isFrontTextLayer(layerId)) {
                    const slot = config.front[layerId];
                    const textValue = slot.allCaps
                      ? previewTextForLayer(layerId).toUpperCase()
                      : previewTextForLayer(layerId);
                    const layout = fitTextLayout(textValue, slot, config.canvas.dpi, {
                      maxLines: layerId === "firstName" ? 1 : slot.maxLines ?? 1,
                      lineHeightEm: slot.lineHeight ?? 1.12,
                    });
                    const fittedFontDesignPx = designPxFromPt(layout.sizePt, config.canvas.dpi);
                    const topPx = (slot.baselineY - fittedFontDesignPx * 0.8) * scale;
                    const lineBoxHeight = fittedFontDesignPx * layout.lineHeightEm * scale;
                    const boxHeightPx =
                      slotHeightDesignPx(slot, config.canvas.dpi, {
                        maxLines: layerId === "firstName" ? 1 : slot.maxLines ?? 1,
                        lineHeightEm: layout.lineHeightEm,
                        fallbackPt: layout.sizePt,
                      }) * scale;
                    return (
                      <div
                        key={layerId}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => selectLayer(layerId, event.shiftKey)}
                        onPointerDown={(event) => startDrag(layerId, event)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        className={`absolute select-none border ${
                          selectedLayers.includes(layerId)
                            ? "border-red-500 bg-red-50/40"
                            : "border-black/15 bg-white/25"
                        } ${selectedClass(layerId)}`}
                        style={{
                          left: slot.x * scale,
                          top: topPx,
                          width: slot.width * scale,
                          height: Math.max(18, boxHeightPx),
                          fontWeight: slot.weight,
                          fontFamily:
                            slot.family === "primary"
                              ? config.fonts.primary
                              : slot.family === "secondary"
                                ? config.fonts.secondary
                                : config.fonts.slab,
                          color: roleTheme.textColor,
                          lineHeight: 1,
                          overflow: "visible",
                        }}
                      >
                        {layout.lines.map((line, index) => (
                          <div
                            key={`${layerId}-line-${index}`}
                            style={{
                              fontSize: fittedFontDesignPx * scale,
                              letterSpacing: `${layout.trackingEm}em`,
                              lineHeight: layout.lineHeightEm,
                              whiteSpace: "nowrap",
                              overflow: "visible",
                              maxHeight: lineBoxHeight,
                            }}
                          >
                            {line}
                          </div>
                        ))}
                        <div
                          className="absolute -right-1 top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-e-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "horizontal")}
                        />
                        <div
                          className="absolute -bottom-1 left-1/2 h-2.5 w-5 -translate-x-1/2 cursor-s-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "vertical")}
                        />
                        <div
                          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                          onPointerDown={(event) => startResize(layerId, event)}
                        />
                      </div>
                    );
                  }

                  if (isFrontFreeTextLayer(layerId)) {
                    const textId = layerId.replace("text:", "");
                    const textLayer = (config.front.textLayers ?? []).find((entry) => entry.id === textId);
                    if (!textLayer) return null;
                    const fontSizePx = designPxFromPt(textLayer.sizePt, config.canvas.dpi);
                    return (
                      <div
                        key={layerId}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => selectLayer(layerId, event.shiftKey)}
                        onPointerDown={(event) => startDrag(layerId, event)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        className={`absolute select-none border ${
                          selectedLayers.includes(layerId)
                            ? "border-red-500 bg-red-50/40"
                            : "border-black/15 bg-white/25"
                        } ${selectedClass(layerId)}`}
                        style={{
                          left: textLayer.x * scale,
                          top: textLayer.y * scale,
                          width: textLayer.width * scale,
                          minHeight: Math.max(18, fontSizePx * (textLayer.lineHeight ?? 1.1) * scale),
                          fontWeight: textLayer.weight,
                          fontFamily: textFamilyStack(textLayer.family, config.fonts),
                          color: roleTheme.textColor,
                          opacity: textLayer.opacity,
                          transform: `rotate(${textLayer.rotationDeg ?? 0}deg)`,
                          transformOrigin: "top left",
                          lineHeight: 1,
                        }}
                      >
                        <div
                          style={{
                            fontSize: fontSizePx * scale,
                            lineHeight: textLayer.lineHeight ?? 1.1,
                            whiteSpace: "pre-wrap",
                            overflowWrap: "break-word",
                          }}
                        >
                          {textLayer.text}
                        </div>
                        <div
                          className="absolute -right-1 top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-e-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "horizontal")}
                        />
                        <div
                          className="absolute -bottom-1 left-1/2 h-2.5 w-5 -translate-x-1/2 cursor-s-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "vertical")}
                        />
                        <div
                          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                          onPointerDown={(event) => startResize(layerId, event)}
                        />
                      </div>
                    );
                  }

                  if (isShapeLayer(layerId)) {
                    const shapeId = layerId.replace("shape:", "");
                    const shape = config.front.shapes.find((entry) => entry.id === shapeId);
                    if (!shape) return null;
                    return (
                      <div
                        key={layerId}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => selectLayer(layerId, event.shiftKey)}
                        onPointerDown={(event) => startDrag(layerId, event)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        className={`absolute ${selectedClass(layerId)}`}
                        style={{
                          left: shape.x * scale,
                          top: shape.y * scale,
                          width: Math.max(1, shape.width * scale),
                          height: Math.max(1, shape.height * scale),
                          opacity: shape.opacity,
                          border:
                            shape.kind === "line"
                              ? "none"
                              : `${Math.max(1, shape.strokeWidth * scale)}px solid ${shape.strokeColor}`,
                          borderRadius: shape.kind === "circle" ? "9999px" : "0px",
                          background:
                            shape.kind === "line"
                              ? "transparent"
                              : shape.fillColor ?? "transparent",
                          transform: `rotate(${shape.rotationDeg ?? 0}deg)`,
                          transformOrigin: "top left",
                        }}
                      >
                        {shape.kind === "line" ? (
                          <div
                            className="absolute left-0 top-0 w-full"
                            style={{
                              borderTop: `${Math.max(1, shape.strokeWidth * scale)}px solid ${
                                shape.strokeColor
                              }`,
                            }}
                          />
                        ) : null}
                        <div
                          className="absolute -right-1 top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-e-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "horizontal")}
                        />
                        <div
                          className="absolute -bottom-1 left-1/2 h-2.5 w-5 -translate-x-1/2 cursor-s-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "vertical")}
                        />
                        <div
                          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                          onPointerDown={(event) => startResize(layerId, event)}
                        />
                      </div>
                    );
                  }

                  if (isImageLayer(layerId)) {
                    const imageId = layerId.replace("image:", "");
                    const image = config.front.images.find((entry) => entry.id === imageId);
                    if (!image) return null;
                    return (
                      <div
                        key={layerId}
                        role="button"
                        tabIndex={0}
                        onClick={(event) => selectLayer(layerId, event.shiftKey)}
                        onPointerDown={(event) => startDrag(layerId, event)}
                        onPointerMove={onDragMove}
                        onPointerUp={endDrag}
                        className={`absolute overflow-hidden border ${
                          selectedLayers.includes(layerId)
                            ? "border-red-500 ring-2 ring-red-500"
                            : "border-black/20"
                        } ${selectedClass(layerId)}`}
                        style={{
                          left: image.x * scale,
                          top: image.y * scale,
                          width: Math.max(1, image.width * scale),
                          height: Math.max(1, image.height * scale),
                          opacity: image.opacity,
                          transform: `rotate(${image.rotationDeg ?? 0}deg)`,
                          transformOrigin: "top left",
                        }}
                      >
                        {image.src ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={image.src}
                            alt=""
                            className="h-full w-full"
                            style={{
                              objectFit:
                                image.fit === "fill"
                                  ? "fill"
                                  : image.fit === "cover"
                                    ? "cover"
                                    : "contain",
                            }}
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-gray-100 text-[10px] text-gray-500">
                            image
                          </div>
                        )}
                        <div
                          className="absolute -right-1 top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-e-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "horizontal")}
                        />
                        <div
                          className="absolute -bottom-1 left-1/2 h-2.5 w-5 -translate-x-1/2 cursor-s-resize rounded-sm bg-red-400"
                          onPointerDown={(event) => startResize(layerId, event, "vertical")}
                        />
                        <div
                          className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                          onPointerDown={(event) => startResize(layerId, event)}
                        />
                      </div>
                    );
                  }

                  return null;
                })}
              </>
            ) : (
              <>
                {roleTheme.backBackgroundUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={roleTheme.backBackgroundUrl}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-gray-50" />
                )}
                {(config.back.shapes ?? []).map((shape) => {
                  const layerId = `back_shape:${shape.id}` as SelectedLayer;
                  return (
                    <div
                      key={layerId}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => selectLayer(layerId, event.shiftKey)}
                      onPointerDown={(event) => startDrag(layerId, event)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      className={`absolute ${selectedClass(layerId)}`}
                      style={{
                        left: shape.x * scale,
                        top: shape.y * scale,
                        width: Math.max(1, shape.width * scale),
                        height: Math.max(1, shape.height * scale),
                        opacity: shape.opacity,
                        border:
                          shape.kind === "line"
                            ? "none"
                            : `${Math.max(1, shape.strokeWidth * scale)}px solid ${shape.strokeColor}`,
                        borderRadius: shape.kind === "circle" ? "9999px" : "0px",
                        background:
                          shape.kind === "line" ? "transparent" : shape.fillColor ?? "transparent",
                        transform: `rotate(${shape.rotationDeg ?? 0}deg)`,
                        transformOrigin: "top left",
                      }}
                    >
                      {shape.kind === "line" ? (
                        <div
                          className="absolute left-0 top-0 w-full"
                          style={{
                            borderTop: `${Math.max(1, shape.strokeWidth * scale)}px solid ${shape.strokeColor}`,
                          }}
                        />
                      ) : null}
                      <div
                        className="absolute -right-1 top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-e-resize rounded-sm bg-red-400"
                        onPointerDown={(event) => startResize(layerId, event, "horizontal")}
                      />
                      <div
                        className="absolute -bottom-1 left-1/2 h-2.5 w-5 -translate-x-1/2 cursor-s-resize rounded-sm bg-red-400"
                        onPointerDown={(event) => startResize(layerId, event, "vertical")}
                      />
                      <div
                        className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                        onPointerDown={(event) => startResize(layerId, event)}
                      />
                    </div>
                  );
                })}
                {(config.back.images ?? []).map((image) => {
                  const layerId = `back_image:${image.id}` as SelectedLayer;
                  return (
                    <div
                      key={layerId}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => selectLayer(layerId, event.shiftKey)}
                      onPointerDown={(event) => startDrag(layerId, event)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      className={`absolute overflow-hidden border ${
                        selectedLayers.includes(layerId)
                          ? "border-red-500 ring-2 ring-red-500"
                          : "border-black/20"
                      } ${selectedClass(layerId)}`}
                      style={{
                        left: image.x * scale,
                        top: image.y * scale,
                        width: Math.max(1, image.width * scale),
                        height: Math.max(1, image.height * scale),
                        opacity: image.opacity,
                        transform: `rotate(${image.rotationDeg ?? 0}deg)`,
                        transformOrigin: "top left",
                      }}
                    >
                      {image.src ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={image.src}
                          alt=""
                          className="h-full w-full"
                          style={{
                            objectFit:
                              image.fit === "fill"
                                ? "fill"
                                : image.fit === "cover"
                                  ? "cover"
                                  : "contain",
                          }}
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center bg-gray-100 text-[10px] text-gray-500">
                          image
                        </div>
                      )}
                      <div
                        className="absolute -right-1 top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-e-resize rounded-sm bg-red-400"
                        onPointerDown={(event) => startResize(layerId, event, "horizontal")}
                      />
                      <div
                        className="absolute -bottom-1 left-1/2 h-2.5 w-5 -translate-x-1/2 cursor-s-resize rounded-sm bg-red-400"
                        onPointerDown={(event) => startResize(layerId, event, "vertical")}
                      />
                      <div
                        className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                        onPointerDown={(event) => startResize(layerId, event)}
                      />
                    </div>
                  );
                })}
                {(config.back.textLayers ?? []).map((textLayer) => {
                  const layerId = `back_text:${textLayer.id}` as SelectedLayer;
                  if (!isLayerVisible(layerId)) return null;
                  const fontSizePx = designPxFromPt(textLayer.sizePt, config.canvas.dpi);
                  return (
                    <div
                      key={layerId}
                      role="button"
                      tabIndex={0}
                      onClick={(event) => selectLayer(layerId, event.shiftKey)}
                      onPointerDown={(event) => startDrag(layerId, event)}
                      onPointerMove={onDragMove}
                      onPointerUp={endDrag}
                      className={`absolute select-none border ${
                        selectedLayers.includes(layerId)
                          ? "border-red-500 bg-red-50/40"
                          : "border-black/15 bg-white/25"
                      } ${selectedClass(layerId)}`}
                      style={{
                        left: textLayer.x * scale,
                        top: textLayer.y * scale,
                        width: textLayer.width * scale,
                        minHeight: Math.max(18, fontSizePx * (textLayer.lineHeight ?? 1.1) * scale),
                        fontWeight: textLayer.weight,
                        fontFamily: textFamilyStack(textLayer.family, config.fonts),
                        color: roleTheme.textColor,
                        opacity: textLayer.opacity,
                        transform: `rotate(${textLayer.rotationDeg ?? 0}deg)`,
                        transformOrigin: "top left",
                        lineHeight: 1,
                      }}
                    >
                      <div
                        style={{
                          fontSize: fontSizePx * scale,
                          lineHeight: textLayer.lineHeight ?? 1.1,
                          whiteSpace: "pre-wrap",
                          overflowWrap: "break-word",
                        }}
                      >
                        {textLayer.text}
                      </div>
                      <div
                        className="absolute -right-1 top-1/2 h-5 w-2.5 -translate-y-1/2 cursor-e-resize rounded-sm bg-red-400"
                        onPointerDown={(event) => startResize(layerId, event, "horizontal")}
                      />
                      <div
                        className="absolute -bottom-1 left-1/2 h-2.5 w-5 -translate-x-1/2 cursor-s-resize rounded-sm bg-red-400"
                        onPointerDown={(event) => startResize(layerId, event, "vertical")}
                      />
                      <div
                        className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                        onPointerDown={(event) => startResize(layerId, event)}
                      />
                    </div>
                  );
                })}
                {isLayerVisible("back_qr") ? (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => selectLayer("back_qr")}
                    onPointerDown={(event) => startDrag("back_qr", event)}
                    onPointerMove={onDragMove}
                    onPointerUp={endDrag}
                    className={`absolute border-2 bg-white ${
                      selectedLayers.includes("back_qr") ? "border-red-500" : "border-black/20"
                    } ${selectedClass("back_qr")}`}
                    style={{
                      left: config.back.qr.x * scale,
                      top: config.back.qr.y * scale,
                      width: config.back.qr.size * scale,
                      height: config.back.qr.size * scale,
                    }}
                  >
                    <div
                      className="absolute -bottom-1 -right-1 h-2.5 w-2.5 cursor-se-resize rounded-sm bg-red-500"
                      onPointerDown={(event) => startResize("back_qr", event)}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>

        <aside className="rounded-lg border border-gray-200 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Inspector</p>

          <div className="mt-2 space-y-3">
            <label className="block text-xs text-gray-700">
              Template Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-xs text-gray-700">
                Version
                <input
                  type="number"
                  min={1}
                  value={version}
                  onChange={(event) => setVersion(Number(event.target.value || 1))}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-700">
                Status
                <select
                  value={status}
                  onChange={(event) =>
                    setStatus(event.target.value as "draft" | "active" | "archived")
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                >
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </select>
              </label>
            </div>

            <div className="rounded-md border border-gray-200 p-2">
              <p className="text-xs font-semibold text-gray-700">Measurement Units</p>
              <div className="mt-2 flex items-center gap-2 text-xs">
                <select
                  value={unitSystem}
                  onChange={(event) => setUnitSystem(event.target.value === "mm" ? "mm" : "in")}
                  className="rounded border border-gray-300 px-2 py-1 text-xs"
                >
                  <option value="in">Inches</option>
                  <option value="mm">Millimeters</option>
                </select>
                <span className="text-gray-500">
                  Position/size fields below use {unitSystem === "in" ? "in" : "mm"}.
                </span>
              </div>
            </div>

            {showAdvanced ? (
              <div className="rounded-md border border-gray-200 p-2">
                <p className="text-xs font-semibold text-gray-700">Advanced Canvas</p>
                <label className="mt-2 flex items-center gap-1 text-xs text-gray-700">
                  Snap grid
                  <select
                    value={snapSize}
                    onChange={(event) => setSnapSize(Number(event.target.value))}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                  >
                    <option value={1}>off</option>
                    <option value={2}>{formatUnit(2)} {unitSystem}</option>
                    <option value={4}>{formatUnit(4)} {unitSystem}</option>
                    <option value={8}>{formatUnit(8)} {unitSystem}</option>
                  </select>
                </label>
                <p className="mt-1 text-[11px] text-gray-500">
                  Drag also edge-snaps to the selected anchor layer when multiple layers are selected.
                </p>
              </div>
            ) : null}

            {showAdvanced ? (
              <div className="rounded-md border border-gray-200 p-2">
              <p className="text-xs font-semibold text-gray-700">Assets & Data Sources</p>
              <label className="mt-2 block text-xs text-gray-700">
                Mapbox style id
                <input
                  value={config.mapbox.styleId}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      mapbox: { ...prev.mapbox, styleId: event.target.value },
                    }))
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="mt-2 block text-xs text-gray-700">
                Map default zoom
                <input
                  type="number"
                  step={0.1}
                  value={config.mapbox.defaultZoom}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      mapbox: { ...prev.mapbox, defaultZoom: Number(event.target.value || 0) },
                    }))
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="mt-2 block text-xs text-gray-700">
                Front background URL ({role})
                <input
                  value={roleTheme.frontBackgroundUrl ?? ""}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      roles: {
                        ...prev.roles,
                        [role]: {
                          ...prev.roles[role],
                          frontBackgroundUrl: event.target.value.trim() || null,
                        },
                      },
                    }))
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="mt-2 block text-xs text-gray-700">
                Front overlay URL ({role})
                <input
                  value={roleTheme.frontOverlayUrl ?? ""}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      roles: {
                        ...prev.roles,
                        [role]: {
                          ...prev.roles[role],
                          frontOverlayUrl: event.target.value.trim() || null,
                        },
                      },
                    }))
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              <label className="mt-2 block text-xs text-gray-700">
                Back background URL ({role})
                <input
                  value={roleTheme.backBackgroundUrl ?? ""}
                  onChange={(event) =>
                    setConfig((prev) => ({
                      ...prev,
                      roles: {
                        ...prev.roles,
                        [role]: {
                          ...prev.roles[role],
                          backBackgroundUrl: event.target.value.trim() || null,
                        },
                      },
                    }))
                  }
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                />
              </label>
              </div>
            ) : null}

            {side === "front" ? (
              <>
                <p className="text-xs text-gray-600">
                  Selected: {selectedLayers.length} (shift-click multi-select). Anchor:{" "}
                  <strong>{labelForLayer(selectedLayer)}</strong>
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => moveLayer("up")}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Layer Up
                  </button>
                  <button
                    type="button"
                    onClick={() => moveLayer("down")}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Layer Down
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        selectedLayer === "back_qr" ||
                        selectedLayer === "role_background" ||
                        selectedLayer === "role_tint" ||
                        selectedLayer === "role_overlay"
                      )
                        return;
                      const id = selectedLayer as BadgeFrontLayerId;
                      const next = frontLayerOrder.filter((layer) => layer !== id);
                      next.unshift(id);
                      setConfig((prev) =>
                        ensureLayerOrderSync({
                          ...prev,
                          front: { ...prev.front, layerOrder: next },
                        })
                      );
                    }}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    To Front
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (
                        selectedLayer === "back_qr" ||
                        selectedLayer === "role_background" ||
                        selectedLayer === "role_tint" ||
                        selectedLayer === "role_overlay"
                      )
                        return;
                      const id = selectedLayer as BadgeFrontLayerId;
                      const next = frontLayerOrder.filter((layer) => layer !== id);
                      next.push(id);
                      setConfig((prev) =>
                        ensureLayerOrderSync({
                          ...prev,
                          front: { ...prev.front, layerOrder: next },
                        })
                      );
                    }}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    To Back
                  </button>
                </div>
                <div className="grid grid-cols-[auto_1fr] gap-2 rounded border border-gray-200 p-2">
                  <p className="text-[11px] font-semibold text-gray-700">Nudge</p>
                  <div className="w-fit">
                    <div className="grid grid-cols-5 gap-1">
                      <span />
                      <span />
                      <button
                        type="button"
                        onClick={() => nudgeSelected(0, -10)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                        title="Nudge up (coarse)"
                      >
                        ↑10
                      </button>
                      <span />
                      <span />
                      <span />
                      <span />
                      <button
                        type="button"
                        onClick={() => nudgeSelected(0, -1)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                        title="Nudge up (fine)"
                      >
                        ↑1
                      </button>
                      <span />
                      <span />
                      <button
                        type="button"
                        onClick={() => nudgeSelected(-10, 0)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                        title="Nudge left (coarse)"
                      >
                        ←10
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeSelected(-1, 0)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                        title="Nudge left (fine)"
                      >
                        ←1
                      </button>
                      <button
                        type="button"
                        disabled
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-[11px] font-semibold text-red-700"
                        title="Anchor indicator"
                      >
                        •
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeSelected(1, 0)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                        title="Nudge right (fine)"
                      >
                        1→
                      </button>
                      <button
                        type="button"
                        onClick={() => nudgeSelected(10, 0)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                        title="Nudge right (coarse)"
                      >
                        10→
                      </button>
                      <span />
                      <span />
                      <button
                        type="button"
                        onClick={() => nudgeSelected(0, 1)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                        title="Nudge down (fine)"
                      >
                        ↓1
                      </button>
                      <span />
                      <span />
                      <span />
                      <span />
                      <button
                        type="button"
                        onClick={() => nudgeSelected(0, 10)}
                        className="rounded border border-gray-300 px-2 py-1 text-[11px] font-semibold text-gray-700 hover:bg-gray-50"
                        title="Nudge down (coarse)"
                      >
                        ↓10
                      </button>
                      <span />
                      <span />
                    </div>
                  </div>
                  <p className="text-[11px] font-semibold text-gray-700">Align</p>
                  <div className="grid grid-cols-2 gap-1">
                    <div className="rounded border border-gray-200 p-1">
                      <p className="mb-1 text-[10px] uppercase text-gray-500">Horizontal</p>
                      <div className="flex flex-wrap gap-1">
                        <button type="button" onClick={() => applyAlign("left")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Left</button>
                        <button type="button" onClick={() => applyAlign("hcenter")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Center</button>
                        <button type="button" onClick={() => applyAlign("right")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Right</button>
                      </div>
                    </div>
                    <div className="rounded border border-gray-200 p-1">
                      <p className="mb-1 text-[10px] uppercase text-gray-500">Vertical</p>
                      <div className="flex flex-wrap gap-1">
                        <button type="button" onClick={() => applyAlign("top")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Top</button>
                        <button type="button" onClick={() => applyAlign("vcenter")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Middle</button>
                        <button type="button" onClick={() => applyAlign("bottom")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Bottom</button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] font-semibold text-gray-700">Distribute</p>
                  <div className="flex flex-wrap gap-1">
                    <button
                      type="button"
                      onClick={() => applyDistribute("horizontal")}
                      className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                    >
                      Horizontal
                    </button>
                    <button
                      type="button"
                      onClick={() => applyDistribute("vertical")}
                      className="rounded border border-gray-300 px-2 py-1 text-[11px] text-gray-700 hover:bg-gray-50"
                    >
                      Vertical
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {isShapeLayer(selectedLayer) ? (
                    <button
                      type="button"
                      onClick={duplicateSelectedLayer}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Duplicate Shape
                    </button>
                  ) : null}
                  {isShapeLayer(selectedLayer) ? (
                    <button
                      type="button"
                      onClick={deleteSelectedShape}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Delete Shape
                    </button>
                  ) : null}
                  {isImageLayer(selectedLayer) ? (
                    <button
                      type="button"
                      onClick={duplicateSelectedLayer}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Duplicate Image
                    </button>
                  ) : null}
                  {isFrontFreeTextLayer(selectedLayer) ? (
                    <button
                      type="button"
                      onClick={duplicateSelectedLayer}
                      className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                    >
                      Duplicate Text
                    </button>
                  ) : null}
                  {selectedLayer !== "back_qr" ? (
                    <button
                      type="button"
                      onClick={deleteSelectedLayer}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                    >
                      Delete Layer
                    </button>
                  ) : null}
                </div>

                {selectedLayer === "role_background" ||
                selectedLayer === "role_tint" ||
                selectedLayer === "role_overlay" ? (
                  <>
                    {selectedLayer === "role_background" ? (
                      <label className="block text-xs text-gray-700">
                        Front background URL
                        <input
                          value={roleTheme.frontBackgroundUrl ?? ""}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              roles: {
                                ...prev.roles,
                                [role]: {
                                  ...prev.roles[role],
                                  frontBackgroundUrl: event.target.value.trim() || null,
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    ) : null}
                    {selectedLayer === "role_overlay" ? (
                      <label className="block text-xs text-gray-700">
                        Front overlay URL
                        <input
                          value={roleTheme.frontOverlayUrl ?? ""}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              roles: {
                                ...prev.roles,
                                [role]: {
                                  ...prev.roles[role],
                                  frontOverlayUrl: event.target.value.trim() || null,
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    ) : null}
                    {selectedLayer === "role_tint" ? (
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block text-xs text-gray-700">
                          Tint color
                          <input
                            value={roleTheme.mapTintColor}
                            onChange={(event) =>
                              setConfig((prev) => ({
                                ...prev,
                                roles: {
                                  ...prev.roles,
                                  [role]: {
                                    ...prev.roles[role],
                                    mapTintColor: event.target.value,
                                  },
                                },
                              }))
                            }
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        </label>
                        <label className="block text-xs text-gray-700">
                          Tint opacity
                          <input
                            type="number"
                            step={0.01}
                            min={0}
                            max={1}
                            value={roleTheme.mapTintOpacity}
                            onChange={(event) =>
                              setConfig((prev) => ({
                                ...prev,
                                roles: {
                                  ...prev.roles,
                                  [role]: {
                                    ...prev.roles[role],
                                    mapTintOpacity: Number(event.target.value || 0),
                                  },
                                },
                              }))
                            }
                            className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                          />
                        </label>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {selectedLayer === "front_qr" ? (
                  <div className="grid grid-cols-3 gap-2">
                    <label className="block text-xs text-gray-700">
                      Horizontal position
                      <input
                        type="number"
                        step={unitSystem === "in" ? 0.01 : 0.25}
                        value={formatUnit(frontQr.x)}
                        onChange={(event) =>
                          setConfig((prev) => ({
                            ...prev,
                            front: {
                              ...prev.front,
                              qr: { ...prev.front.qr, x: parseUnit(event.target.value) },
                            },
                          }))
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700">
                      Vertical position
                      <input
                        type="number"
                        step={unitSystem === "in" ? 0.01 : 0.25}
                        value={formatUnit(frontQr.y)}
                        onChange={(event) =>
                          setConfig((prev) => ({
                            ...prev,
                            front: {
                              ...prev.front,
                              qr: { ...prev.front.qr, y: parseUnit(event.target.value) },
                            },
                          }))
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700">
                      Size
                      <input
                        type="number"
                        step={unitSystem === "in" ? 0.01 : 0.25}
                        value={formatUnit(frontQr.size)}
                        onChange={(event) =>
                          setConfig((prev) => ({
                            ...prev,
                            front: {
                              ...prev.front,
                              qr: { ...prev.front.qr, size: parseUnit(event.target.value) },
                            },
                          }))
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </label>
                  </div>
                ) : null}

                {selectedLayer === "logo" ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Horizontal position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(config.front.logo.x)}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                logo: { ...prev.front.logo, x: parseUnit(event.target.value) },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Vertical position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(config.front.logo.y)}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                logo: { ...prev.front.logo, y: parseUnit(event.target.value) },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Diameter
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(config.front.logo.diameter)}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                logo: {
                                  ...prev.front.logo,
                                  diameter: parseUnit(event.target.value),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <label className="block text-xs text-gray-700">
                      Logo binding
                      <select
                        value={config.front.bindings.logo}
                        onChange={(event) =>
                          setConfig((prev) => ({
                            ...prev,
                            front: {
                              ...prev.front,
                              bindings: {
                                ...prev.front.bindings,
                                logo: event.target.value as BadgeLogoBindingKey,
                              },
                            },
                          }))
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        {LOGO_BINDING_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {LOGO_BINDING_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {config.front.bindings.logo === "static_url" ? (
                      <label className="block text-xs text-gray-700">
                        Static logo URL
                        <input
                          value={config.front.logo.staticUrl ?? ""}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                logo: {
                                  ...prev.front.logo,
                                  staticUrl: event.target.value.trim() || null,
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    ) : null}
                  </>
                ) : null}

                {isFrontTextLayer(selectedLayer) ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Horizontal position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(config.front[selectedLayer].x)}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  x: parseUnit(event.target.value),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Baseline (vertical)
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(config.front[selectedLayer].baselineY)}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  baselineY: parseUnit(event.target.value),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Width
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(config.front[selectedLayer].width)}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  width: parseUnit(event.target.value),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Default pt
                        <input
                          type="number"
                          value={config.front[selectedLayer].defaultPt}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  defaultPt: Number(event.target.value || 0),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Min pt
                        <input
                          type="number"
                          value={config.front[selectedLayer].minPt}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  minPt: Number(event.target.value || 0),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Weight
                        <input
                          type="number"
                          value={config.front[selectedLayer].weight}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  weight: Number(event.target.value || 0),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-gray-700">
                        Typeface
                        <select
                          value={config.front[selectedLayer].family}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  family: event.target.value as "primary" | "secondary" | "slab",
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="primary">{TYPEFACE_LABELS.primary}</option>
                          <option value="secondary">{TYPEFACE_LABELS.secondary}</option>
                          <option value="slab">{TYPEFACE_LABELS.slab}</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-700">
                        Max lines
                        <input
                          type="number"
                          min={1}
                          max={6}
                          value={
                            selectedLayer === "firstName"
                              ? 1
                              : config.front[selectedLayer].maxLines ?? 1
                          }
                          disabled={selectedLayer === "firstName"}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  maxLines:
                                    selectedLayer === "firstName"
                                      ? 1
                                      : Number(event.target.value || 1),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <label className="block text-xs text-gray-700">
                      Data binding
                      <select
                        value={config.front.bindings[selectedLayer]}
                        onChange={(event) =>
                          setConfig((prev) => ({
                            ...prev,
                            front: {
                              ...prev.front,
                              bindings: {
                                ...prev.front.bindings,
                                [selectedLayer]: event.target.value as BadgeTextBindingKey,
                              },
                            },
                          }))
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        {TEXT_BINDING_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {TEXT_BINDING_LABELS[option]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {showAdvanced ? (
                      <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Track min em
                        <input
                          type="number"
                          step={0.001}
                          value={config.front[selectedLayer].trackingMinEm ?? -0.06}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  trackingMinEm: Number(event.target.value || -0.06),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Track max em
                        <input
                          type="number"
                          step={0.001}
                          value={config.front[selectedLayer].trackingMaxEm ?? 0}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  trackingMaxEm: Number(event.target.value || 0),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Track step
                        <input
                          type="number"
                          step={0.001}
                          min={0.001}
                          value={config.front[selectedLayer].trackingStepEm ?? 0.005}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  trackingStepEm: Number(event.target.value || 0.005),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      </div>
                    ) : null}
                    <div className="grid grid-cols-1 gap-2">
                      <label className="block text-xs text-gray-700">
                        Line height
                        <input
                          type="number"
                          step={0.01}
                          value={config.front[selectedLayer].lineHeight ?? 1.1}
                          onChange={(event) =>
                            setConfig((prev) => ({
                              ...prev,
                              front: {
                                ...prev.front,
                                [selectedLayer]: {
                                  ...prev.front[selectedLayer],
                                  lineHeight: Number(event.target.value || 1.1),
                                },
                              },
                            }))
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <label className="mt-1 flex items-center gap-2 text-xs text-gray-700">
                      <input
                        type="checkbox"
                        checked={Boolean(config.front[selectedLayer].allCaps)}
                        onChange={(event) =>
                          setConfig((prev) => ({
                            ...prev,
                            front: {
                              ...prev.front,
                              [selectedLayer]: {
                                ...prev.front[selectedLayer],
                                allCaps: event.target.checked,
                              },
                            },
                          }))
                        }
                      />
                      All caps
                    </label>
                  </>
                ) : null}

                {selectedFrontFreeText ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Horizontal position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedFrontFreeText.x)}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({ x: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Vertical position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedFrontFreeText.y)}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({ y: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Width
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedFrontFreeText.width)}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({ width: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Point size
                        <input
                          type="number"
                          value={selectedFrontFreeText.sizePt}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({ sizePt: Number(event.target.value || 0) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Weight
                        <input
                          type="number"
                          value={selectedFrontFreeText.weight}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({ weight: Number(event.target.value || 0) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Rotation
                        <input
                          type="number"
                          value={selectedFrontFreeText.rotationDeg ?? 0}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({
                              rotationDeg: Number(event.target.value || 0),
                            })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Typeface
                        <select
                          value={selectedFrontFreeText.family}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({
                              family: event.target.value as "primary" | "secondary" | "slab",
                            })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="primary">{TYPEFACE_LABELS.primary}</option>
                          <option value="secondary">{TYPEFACE_LABELS.secondary}</option>
                          <option value="slab">{TYPEFACE_LABELS.slab}</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-700">
                        Line height
                        <input
                          type="number"
                          step={0.01}
                          value={selectedFrontFreeText.lineHeight ?? 1.1}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({
                              lineHeight: Number(event.target.value || 1.1),
                            })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Opacity
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedFrontFreeText.opacity}
                          onChange={(event) =>
                            updateSelectedFrontFreeText({
                              opacity: Number(event.target.value || 0),
                            })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <label className="block text-xs text-gray-700">
                      Text
                      <textarea
                        value={selectedFrontFreeText.text}
                        onChange={(event) =>
                          updateSelectedFrontFreeText({ text: event.target.value })
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        rows={3}
                      />
                    </label>
                  </>
                ) : null}

                {selectedShape ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Kind
                        <select
                          value={selectedShape.kind}
                          onChange={(event) =>
                            updateSelectedShape({
                              kind: event.target.value as BadgeShapeKind,
                            })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        >
                          <option value="rect">rect</option>
                          <option value="circle">circle</option>
                          <option value="line">line</option>
                        </select>
                      </label>
                      <label className="block text-xs text-gray-700">
                        Horizontal position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedShape.x)}
                          onChange={(event) => updateSelectedShape({ x: parseUnit(event.target.value) })}
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Vertical position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedShape.y)}
                          onChange={(event) => updateSelectedShape({ y: parseUnit(event.target.value) })}
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Width
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedShape.width)}
                          onChange={(event) =>
                            updateSelectedShape({ width: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Height
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedShape.height)}
                          onChange={(event) =>
                            updateSelectedShape({ height: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Rotation
                        <input
                          type="number"
                          value={selectedShape.rotationDeg ?? 0}
                          onChange={(event) =>
                            updateSelectedShape({ rotationDeg: Number(event.target.value || 0) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-gray-700">
                        Stroke color
                        <input
                          value={selectedShape.strokeColor}
                          onChange={(event) => updateSelectedShape({ strokeColor: event.target.value })}
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Fill color
                        <input
                          value={selectedShape.fillColor ?? ""}
                          onChange={(event) =>
                            updateSelectedShape({ fillColor: event.target.value.trim() || null })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <label className="block text-xs text-gray-700">
                        Stroke width
                        <input
                          type="number"
                          step={0.1}
                          value={selectedShape.strokeWidth}
                          onChange={(event) =>
                            updateSelectedShape({ strokeWidth: Number(event.target.value || 0) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Opacity
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedShape.opacity}
                          onChange={(event) =>
                            updateSelectedShape({ opacity: Number(event.target.value || 0) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                  </>
                ) : null}

                {selectedImage ? (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Horizontal position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedImage.x)}
                          onChange={(event) =>
                            updateSelectedImage({ x: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Vertical position
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedImage.y)}
                          onChange={(event) =>
                            updateSelectedImage({ y: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Rotation
                        <input
                          type="number"
                          value={selectedImage.rotationDeg ?? 0}
                          onChange={(event) =>
                            updateSelectedImage({
                              rotationDeg: Number(event.target.value || 0),
                            })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="block text-xs text-gray-700">
                        Width
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedImage.width)}
                          onChange={(event) =>
                            updateSelectedImage({ width: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Height
                        <input
                          type="number"
                          step={unitSystem === "in" ? 0.01 : 0.25}
                          value={formatUnit(selectedImage.height)}
                          onChange={(event) =>
                            updateSelectedImage({ height: parseUnit(event.target.value) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                      <label className="block text-xs text-gray-700">
                        Opacity
                        <input
                          type="number"
                          min={0}
                          max={1}
                          step={0.01}
                          value={selectedImage.opacity}
                          onChange={(event) =>
                            updateSelectedImage({ opacity: Number(event.target.value || 0) })
                          }
                          className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                        />
                      </label>
                    </div>
                    <label className="block text-xs text-gray-700">
                      Image URL
                      <input
                        value={selectedImage.src}
                        onChange={(event) =>
                          updateSelectedImage({ src: event.target.value.trim() })
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      />
                    </label>
                    <label className="block text-xs text-gray-700">
                      Fit
                      <select
                        value={selectedImage.fit ?? "contain"}
                        onChange={(event) =>
                          updateSelectedImage({
                            fit: event.target.value as "contain" | "cover" | "fill",
                          })
                        }
                        className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                      >
                        <option value="contain">contain</option>
                        <option value="cover">cover</option>
                        <option value="fill">fill</option>
                      </select>
                    </label>
                  </>
                ) : null}
              </>
            ) : null}

            {side === "back" ? (
              <>
                <p className="text-xs text-gray-600">
                  Selected: {selectedLayers.length} (shift-click multi-select). Anchor:{" "}
                  <strong>{labelForLayer(selectedLayer)}</strong>
                </p>
                <div className="grid grid-cols-[auto_1fr] gap-2 rounded border border-gray-200 p-2">
                  <p className="text-[11px] font-semibold text-gray-700">Nudge</p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => nudgeSelected(0, -10)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Up 10</button>
                    <button type="button" onClick={() => nudgeSelected(0, -1)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Up 1</button>
                    <button type="button" onClick={() => nudgeSelected(-10, 0)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Left 10</button>
                    <button type="button" onClick={() => nudgeSelected(-1, 0)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Left 1</button>
                    <button type="button" onClick={() => nudgeSelected(1, 0)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Right 1</button>
                    <button type="button" onClick={() => nudgeSelected(10, 0)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Right 10</button>
                    <button type="button" onClick={() => nudgeSelected(0, 1)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Down 1</button>
                    <button type="button" onClick={() => nudgeSelected(0, 10)} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Down 10</button>
                  </div>
                  <p className="text-[11px] font-semibold text-gray-700">Align</p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => applyAlign("left")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Left</button>
                    <button type="button" onClick={() => applyAlign("hcenter")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Center</button>
                    <button type="button" onClick={() => applyAlign("right")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Right</button>
                    <button type="button" onClick={() => applyAlign("top")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Top</button>
                    <button type="button" onClick={() => applyAlign("vcenter")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Middle</button>
                    <button type="button" onClick={() => applyAlign("bottom")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Bottom</button>
                  </div>
                  <p className="text-[11px] font-semibold text-gray-700">Distribute</p>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" onClick={() => applyDistribute("horizontal")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Horizontal</button>
                    <button type="button" onClick={() => applyDistribute("vertical")} className="rounded border border-gray-300 px-2 py-1 text-[11px]">Vertical</button>
                  </div>
                </div>
                <div className="flex gap-2">
                  {selectedLayer !== "back_qr" ? (
                    <>
                      <button
                        type="button"
                        onClick={duplicateSelectedLayer}
                        className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Duplicate Layer
                      </button>
                      <button
                        type="button"
                        onClick={deleteSelectedLayer}
                        className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Delete Layer
                      </button>
                    </>
                  ) : null}
                </div>
              </>
            ) : null}

            {side === "back" && selectedLayer === "back_qr" ? (
              <div className="grid grid-cols-3 gap-2">
                <label className="block text-xs text-gray-700">
                  Horizontal position
                  <input
                    type="number"
                    step={unitSystem === "in" ? 0.01 : 0.25}
                    value={formatUnit(config.back.qr.x)}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        back: {
                          ...prev.back,
                          qr: { ...prev.back.qr, x: parseUnit(event.target.value) },
                        },
                      }))
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="block text-xs text-gray-700">
                  Vertical position
                  <input
                    type="number"
                    step={unitSystem === "in" ? 0.01 : 0.25}
                    value={formatUnit(config.back.qr.y)}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        back: {
                          ...prev.back,
                          qr: { ...prev.back.qr, y: parseUnit(event.target.value) },
                        },
                      }))
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <label className="block text-xs text-gray-700">
                  Size
                  <input
                    type="number"
                    step={unitSystem === "in" ? 0.01 : 0.25}
                    value={formatUnit(config.back.qr.size)}
                    onChange={(event) =>
                      setConfig((prev) => ({
                        ...prev,
                        back: {
                          ...prev.back,
                          qr: { ...prev.back.qr, size: parseUnit(event.target.value) },
                        },
                      }))
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
              </div>
            ) : null}

            {side === "back" && selectedBackImage ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs text-gray-700">
                    Horizontal position
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackImage.x)}
                      onChange={(event) =>
                        updateSelectedBackImage({ x: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Vertical position
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackImage.y)}
                      onChange={(event) =>
                        updateSelectedBackImage({ y: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Rotation
                    <input
                      type="number"
                      value={selectedBackImage.rotationDeg ?? 0}
                      onChange={(event) =>
                        updateSelectedBackImage({
                          rotationDeg: Number(event.target.value || 0),
                        })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs text-gray-700">
                    Width
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackImage.width)}
                      onChange={(event) =>
                        updateSelectedBackImage({ width: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Height
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackImage.height)}
                      onChange={(event) =>
                        updateSelectedBackImage({ height: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Opacity
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selectedBackImage.opacity}
                      onChange={(event) =>
                        updateSelectedBackImage({ opacity: Number(event.target.value || 0) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <label className="block text-xs text-gray-700">
                  Image URL
                  <input
                    value={selectedBackImage.src}
                    onChange={(event) =>
                      updateSelectedBackImage({ src: event.target.value.trim() })
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-gray-700">
                    Fit
                    <select
                      value={selectedBackImage.fit ?? "contain"}
                      onChange={(event) =>
                        updateSelectedBackImage({
                          fit: event.target.value as "contain" | "cover" | "fill",
                        })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="contain">contain</option>
                      <option value="cover">cover</option>
                      <option value="fill">fill</option>
                    </select>
                  </label>
                  <div className="flex items-end">
                    <div className="flex w-full gap-2">
                      <button
                        type="button"
                        onClick={duplicateSelectedLayer}
                        className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                      >
                        Duplicate Layer
                      </button>
                      <button
                        type="button"
                        onClick={deleteSelectedBackImage}
                        className="w-full rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                      >
                        Delete Layer
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : null}

            {side === "back" && selectedBackShape ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs text-gray-700">
                    Kind
                    <select
                      value={selectedBackShape.kind}
                      onChange={(event) =>
                        updateSelectedBackShape({ kind: event.target.value as BadgeShapeKind })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="rect">rect</option>
                      <option value="circle">circle</option>
                      <option value="line">line</option>
                    </select>
                  </label>
                  <label className="block text-xs text-gray-700">
                    Horizontal position
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackShape.x)}
                      onChange={(event) =>
                        updateSelectedBackShape({ x: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Vertical position
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackShape.y)}
                      onChange={(event) =>
                        updateSelectedBackShape({ y: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs text-gray-700">
                    Width
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackShape.width)}
                      onChange={(event) =>
                        updateSelectedBackShape({ width: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Height
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackShape.height)}
                      onChange={(event) =>
                        updateSelectedBackShape({ height: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Rotation
                    <input
                      type="number"
                      value={selectedBackShape.rotationDeg ?? 0}
                      onChange={(event) =>
                        updateSelectedBackShape({ rotationDeg: Number(event.target.value || 0) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-gray-700">
                    Stroke color
                    <input
                      value={selectedBackShape.strokeColor}
                      onChange={(event) => updateSelectedBackShape({ strokeColor: event.target.value })}
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Fill color
                    <input
                      value={selectedBackShape.fillColor ?? ""}
                      onChange={(event) =>
                        updateSelectedBackShape({ fillColor: event.target.value.trim() || null })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-gray-700">
                    Stroke width
                    <input
                      type="number"
                      step={0.1}
                      value={selectedBackShape.strokeWidth}
                      onChange={(event) =>
                        updateSelectedBackShape({ strokeWidth: Number(event.target.value || 0) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Opacity
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selectedBackShape.opacity}
                      onChange={(event) =>
                        updateSelectedBackShape({ opacity: Number(event.target.value || 0) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={duplicateSelectedLayer}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Duplicate Layer
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedBackShape}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Delete Layer
                  </button>
                </div>
              </>
            ) : null}

            {side === "back" && selectedBackFreeText ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs text-gray-700">
                    Horizontal position
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackFreeText.x)}
                      onChange={(event) =>
                        updateSelectedBackFreeText({ x: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Vertical position
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackFreeText.y)}
                      onChange={(event) =>
                        updateSelectedBackFreeText({ y: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Width
                    <input
                      type="number"
                      step={unitSystem === "in" ? 0.01 : 0.25}
                      value={formatUnit(selectedBackFreeText.width)}
                      onChange={(event) =>
                        updateSelectedBackFreeText({ width: parseUnit(event.target.value) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs text-gray-700">
                    Point size
                    <input
                      type="number"
                      value={selectedBackFreeText.sizePt}
                      onChange={(event) =>
                        updateSelectedBackFreeText({ sizePt: Number(event.target.value || 0) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Weight
                    <input
                      type="number"
                      value={selectedBackFreeText.weight}
                      onChange={(event) =>
                        updateSelectedBackFreeText({ weight: Number(event.target.value || 0) })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Rotation
                    <input
                      type="number"
                      value={selectedBackFreeText.rotationDeg ?? 0}
                      onChange={(event) =>
                        updateSelectedBackFreeText({
                          rotationDeg: Number(event.target.value || 0),
                        })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <label className="block text-xs text-gray-700">
                    Typeface
                    <select
                      value={selectedBackFreeText.family}
                      onChange={(event) =>
                        updateSelectedBackFreeText({
                          family: event.target.value as "primary" | "secondary" | "slab",
                        })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    >
                      <option value="primary">{TYPEFACE_LABELS.primary}</option>
                      <option value="secondary">{TYPEFACE_LABELS.secondary}</option>
                      <option value="slab">{TYPEFACE_LABELS.slab}</option>
                    </select>
                  </label>
                  <label className="block text-xs text-gray-700">
                    Line height
                    <input
                      type="number"
                      step={0.01}
                      value={selectedBackFreeText.lineHeight ?? 1.1}
                      onChange={(event) =>
                        updateSelectedBackFreeText({
                          lineHeight: Number(event.target.value || 1.1),
                        })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                  <label className="block text-xs text-gray-700">
                    Opacity
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selectedBackFreeText.opacity}
                      onChange={(event) =>
                        updateSelectedBackFreeText({
                          opacity: Number(event.target.value || 0),
                        })
                      }
                      className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    />
                  </label>
                </div>
                <label className="block text-xs text-gray-700">
                  Text
                  <textarea
                    value={selectedBackFreeText.text}
                    onChange={(event) =>
                      updateSelectedBackFreeText({ text: event.target.value })
                    }
                    className="mt-1 w-full rounded border border-gray-300 px-2 py-1 text-sm"
                    rows={3}
                  />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={duplicateSelectedLayer}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Duplicate Text
                  </button>
                  <button
                    type="button"
                    onClick={deleteSelectedBackText}
                    className="rounded border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
                  >
                    Delete Layer
                  </button>
                </div>
              </>
            ) : null}

            {showAdvanced ? (
              <div className="rounded-md border border-gray-200 p-2">
                <p className="text-xs font-semibold text-gray-700">Developer Template JSON</p>
                <p className="mt-1 text-[11px] text-gray-500">
                  Advanced only. Prefer visual editing for normal operations.
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={exportTemplateJson}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Export JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                  >
                    Import JSON
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={importTemplateFile}
                    className="hidden"
                  />
                </div>
                {importMessage ? (
                  <p className="mt-2 text-[11px] text-gray-600">{importMessage}</p>
                ) : null}
              </div>
            ) : null}
          </div>

          <form action={saveAction} className="mt-4">
            <input type="hidden" name="config_version" value={String(version)} />
            <input type="hidden" name="name" value={name} />
            <input type="hidden" name="status" value={status} />
            <input type="hidden" name="field_mapping_json" value={serializedConfig} />
            <button
              type="submit"
              className="w-full rounded-md bg-[#D60001] px-3 py-2 text-sm font-medium text-white hover:bg-[#b50001]"
            >
              Save Template
            </button>
          </form>
        </aside>
      </div>
    </section>
  );
}
