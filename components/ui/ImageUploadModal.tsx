"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { uploadOrganizationImage } from "@/lib/actions/upload-organization-image";

// ---------------------------------------------------------------------------
// Slot configuration
// ---------------------------------------------------------------------------

export type OrgImageType = "hero_image" | "logo" | "logo_horizontal" | "product_overlay";

interface SlotConfig {
  label: string;
  aspectRatio: number; // width / height
  description: string;
  tip: string;
  allowBgRemoval: boolean;
  preferFormats: string;
  previewShape: "wide" | "square" | "portrait" | "circle";
}

const SLOT: Record<OrgImageType, SlotConfig> = {
  hero_image: {
    label: "Hero Image",
    aspectRatio: 2 / 3,
    description: "Portrait photo that fills the coloured strip on your profile page.",
    tip: "Tall and narrow — portrait orientation photography works best.",
    allowBgRemoval: false,
    preferFormats: "JPEG or WebP",
    previewShape: "portrait",
  },
  logo: {
    label: "Directory Logo",
    aspectRatio: 1,
    description: "Square logo used on the map and in directory cards.",
    tip: "Appears in a circle on the map — centre your mark within the frame.",
    allowBgRemoval: false,
    preferFormats: "SVG or PNG with transparent background",
    previewShape: "circle",
  },
  logo_horizontal: {
    label: "Profile Logo",
    aspectRatio: 4,
    description: "Wide logo displayed on your full profile page.",
    tip: "Roughly 4× as wide as it is tall — your horizontal lockup.",
    allowBgRemoval: false,
    preferFormats: "SVG or PNG with transparent background",
    previewShape: "wide",
  },
  product_overlay: {
    label: "Product Image",
    aspectRatio: 1,
    description: "Your featured product displayed as a cutout over the hero strip.",
    tip: "Shown as a cut-out over your hero strip — a PNG with no background looks best. Got a photo with a background? Upload it, then use Remove background.",
    allowBgRemoval: true,
    preferFormats: "PNG with transparent background",
    previewShape: "square",
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function cropToBlob(
  img: HTMLImageElement,
  crop: CropRect,
  displayW: number,
  displayH: number,
  sourceType: string
): Promise<Blob> {
  const scaleX = img.naturalWidth / displayW;
  const scaleY = img.naturalHeight / displayH;
  const srcX = Math.round(crop.x * scaleX);
  const srcY = Math.round(crop.y * scaleY);
  const srcW = Math.round(crop.w * scaleX);
  const srcH = Math.round(crop.h * scaleY);

  const canvas = document.createElement("canvas");
  canvas.width = srcW;
  canvas.height = srcH;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);

  const outputType = sourceType === "image/jpeg" ? "image/jpeg" : "image/png";
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Canvas toBlob failed"))),
      outputType,
      0.93
    );
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CropRect { x: number; y: number; w: number; h: number }
type DragKind = "move" | "tl" | "tr" | "bl" | "br";

interface DragState {
  kind: DragKind;
  startMx: number;
  startMy: number;
  startCrop: CropRect;
}

// ---------------------------------------------------------------------------
// Context preview — shows a miniature version of where the image will appear
// ---------------------------------------------------------------------------

function ContextPreview({
  config,
  sourceUrl,
  crop,
  displayW,
  displayH,
  bgColor,
}: {
  config: SlotConfig;
  sourceUrl: string;
  crop: CropRect;
  displayW: number;
  displayH: number;
  bgColor: string;
}) {
  // Scale the crop region into the preview frame
  const shape = config.previewShape;

  // Preview frame dimensions
  const frameW = shape === "wide" ? 200 : shape === "portrait" ? 60 : 96;
  const frameH = shape === "wide" ? 50 : shape === "portrait" ? 96 : 96;

  // How much to scale the source image so that crop.w → frameW
  const scale = frameW / crop.w;
  const imgDisplayW = displayW * scale;
  const imgDisplayH = displayH * scale;
  const offsetX = -crop.x * scale;
  const offsetY = -crop.y * scale;

  const frameStyle: React.CSSProperties = {
    width: frameW,
    height: frameH,
    overflow: "hidden",
    position: "relative",
    flexShrink: 0,
    borderRadius: shape === "circle" ? "50%" : shape === "portrait" ? 6 : 8,
    backgroundColor: bgColor,
  };

  const imgStyle: React.CSSProperties = {
    position: "absolute",
    width: imgDisplayW,
    height: imgDisplayH,
    top: offsetY,
    left: offsetX,
    objectFit: "fill",
  };

  const label = {
    wide: "Profile page logo",
    circle: "Map pin & directory",
    portrait: "Hero strip",
    square: "Profile page overlay",
  }[shape];

  if (shape === "portrait") {
    // Show as the colorized strip with a color overlay
    return (
      <div className="flex flex-col items-center gap-2">
        <div style={{ ...frameStyle, borderRadius: 6 }}>
          <img src={sourceUrl} alt="" style={{ ...imgStyle, filter: "saturate(0.6)" }} />
          <div
            className="absolute inset-0"
            style={{ backgroundColor: bgColor, opacity: 0.4, mixBlendMode: "multiply" }}
          />
        </div>
        <p className="text-xs text-gray-400 text-center">{label}</p>
      </div>
    );
  }

  if (shape === "square") {
    // Show on a colored background
    return (
      <div className="flex flex-col items-center gap-2">
        <div
          style={{
            width: 96,
            height: 96,
            borderRadius: 8,
            background: `linear-gradient(135deg, ${bgColor}44, ${bgColor}22)`,
            border: `1px solid ${bgColor}33`,
            position: "relative",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          <img src={sourceUrl} alt="" style={{ ...imgStyle }} />
        </div>
        <p className="text-xs text-gray-400 text-center">{label}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        style={{
          ...frameStyle,
          border: "1px solid #e5e7eb",
          backgroundColor: "#f9fafb",
        }}
      >
        <img src={sourceUrl} alt="" style={imgStyle} />
      </div>
      <p className="text-xs text-gray-400 text-center">{label}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crop editor
// ---------------------------------------------------------------------------

const HANDLE = 12; // corner handle hit radius px
const MIN_W = 40;

function CropEditor({
  sourceUrl,
  config,
  onCropChange,
}: {
  sourceUrl: string;
  config: SlotConfig;
  onCropChange: (crop: CropRect, displayW: number, displayH: number) => void;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [displaySize, setDisplaySize] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<CropRect | null>(null);
  const drag = useRef<DragState | null>(null);

  const initCrop = useCallback(
    (dw: number, dh: number): CropRect => {
      const ar = config.aspectRatio;
      let cropW, cropH;
      if (dw / dh > ar) {
        cropH = dh;
        cropW = cropH * ar;
      } else {
        cropW = dw;
        cropH = cropW / ar;
      }
      return { x: (dw - cropW) / 2, y: (dh - cropH) / 2, w: cropW, h: cropH };
    },
    [config.aspectRatio]
  );

  const onImageLoad = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const MAX_W = 400;
    const MAX_H = 280;
    const imgAR = img.naturalWidth / img.naturalHeight;
    const boxAR = MAX_W / MAX_H;
    let dw, dh;
    if (imgAR > boxAR) { dw = MAX_W; dh = MAX_W / imgAR; }
    else { dh = MAX_H; dw = MAX_H * imgAR; }
    const c = initCrop(dw, dh);
    setDisplaySize({ w: dw, h: dh });
    setCrop(c);
    onCropChange(c, dw, dh);
  }, [initCrop, onCropChange]);

  // Emit crop changes upward
  useEffect(() => {
    if (crop && displaySize) onCropChange(crop, displaySize.w, displaySize.h);
  }, [crop, displaySize, onCropChange]);

  const clampCrop = useCallback(
    (c: CropRect, dw: number, dh: number): CropRect => {
      const w = Math.max(MIN_W, Math.min(c.w, dw));
      const h = w / config.aspectRatio;
      const x = Math.max(0, Math.min(c.x, dw - w));
      const y = Math.max(0, Math.min(c.y, dh - h));
      return { x, y, w, h };
    },
    [config.aspectRatio]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!crop || !displaySize || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      let kind: DragKind | null = null;
      if (Math.hypot(mx - crop.x, my - crop.y) < HANDLE) kind = "tl";
      else if (Math.hypot(mx - (crop.x + crop.w), my - crop.y) < HANDLE) kind = "tr";
      else if (Math.hypot(mx - crop.x, my - (crop.y + crop.h)) < HANDLE) kind = "bl";
      else if (Math.hypot(mx - (crop.x + crop.w), my - (crop.y + crop.h)) < HANDLE) kind = "br";
      else if (mx > crop.x && mx < crop.x + crop.w && my > crop.y && my < crop.y + crop.h) kind = "move";

      if (!kind) return;
      e.preventDefault();
      drag.current = { kind, startMx: mx, startMy: my, startCrop: { ...crop } };
    },
    [crop, displaySize]
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!drag.current || !displaySize || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const dx = mx - drag.current.startMx;
      const dy = my - drag.current.startMy;
      const sc = drag.current.startCrop;
      const { w: dw, h: dh } = displaySize;
      const ar = config.aspectRatio;

      let next: CropRect = { ...sc };

      if (drag.current.kind === "move") {
        next = {
          x: Math.max(0, Math.min(sc.x + dx, dw - sc.w)),
          y: Math.max(0, Math.min(sc.y + dy, dh - sc.h)),
          w: sc.w, h: sc.h,
        };
      } else if (drag.current.kind === "br") {
        let w = Math.max(MIN_W, sc.w + dx);
        if (sc.x + w > dw) w = dw - sc.x;
        let h = w / ar;
        if (sc.y + h > dh) { h = dh - sc.y; w = h * ar; }
        next = { x: sc.x, y: sc.y, w, h };
      } else if (drag.current.kind === "tl") {
        let w = Math.max(MIN_W, sc.w - dx);
        let h = w / ar;
        let nx = sc.x + sc.w - w, ny = sc.y + sc.h - h;
        if (nx < 0) { w = sc.w + sc.x; h = w / ar; nx = 0; ny = sc.y + sc.h - h; }
        if (ny < 0) { h = sc.h + sc.y; w = h * ar; nx = sc.x + sc.w - w; ny = 0; }
        next = { x: nx, y: ny, w, h };
      } else if (drag.current.kind === "tr") {
        let w = Math.max(MIN_W, sc.w + dx);
        if (sc.x + w > dw) w = dw - sc.x;
        let h = w / ar;
        let ny = sc.y + sc.h - h;
        if (ny < 0) { h = sc.h + sc.y; w = h * ar; ny = 0; }
        next = { x: sc.x, y: ny, w, h };
      } else if (drag.current.kind === "bl") {
        let w = Math.max(MIN_W, sc.w - dx);
        let nx = sc.x + sc.w - w;
        if (nx < 0) { w = sc.w + sc.x; nx = 0; }
        let h = w / ar;
        if (sc.y + h > dh) { h = dh - sc.y; w = h * ar; nx = sc.x + sc.w - w; }
        next = { x: nx, y: sc.y, w, h };
      }

      setCrop(clampCrop(next, dw, dh));
    };

    const onUp = () => { drag.current = null; };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [displaySize, config.aspectRatio, clampCrop]);

  if (!displaySize || !crop) {
    return (
      <div className="flex items-center justify-center" style={{ width: 400, height: 280 }}>
        <img
          ref={imgRef}
          src={sourceUrl}
          alt=""
          onLoad={onImageLoad}
          className="max-w-full max-h-full opacity-0 absolute"
        />
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    );
  }

  const { w: dw, h: dh } = displaySize;
  const cornerStyle = (cx: number, cy: number): React.CSSProperties => ({
    position: "absolute",
    width: 12,
    height: 12,
    backgroundColor: "white",
    border: "2px solid #10b981",
    borderRadius: 2,
    left: cx - 6,
    top: cy - 6,
    cursor: "pointer",
    zIndex: 2,
  });

  return (
    <div
      ref={containerRef}
      className="relative select-none"
      style={{ width: dw, height: dh, cursor: "crosshair", flexShrink: 0 }}
      onMouseDown={handleMouseDown}
    >
      <img
        ref={imgRef}
        src={sourceUrl}
        alt=""
        onLoad={onImageLoad}
        draggable={false}
        style={{ width: dw, height: dh, display: "block", objectFit: "fill" }}
      />

      {/* Dark overlay — 4 rects around the crop */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 1 }}>
        {/* top */}
        <div className="absolute bg-black/60" style={{ top: 0, left: 0, right: 0, height: crop.y }} />
        {/* bottom */}
        <div className="absolute bg-black/60" style={{ top: crop.y + crop.h, left: 0, right: 0, bottom: 0 }} />
        {/* left */}
        <div className="absolute bg-black/60" style={{ top: crop.y, left: 0, width: crop.x, height: crop.h }} />
        {/* right */}
        <div className="absolute bg-black/60" style={{ top: crop.y, left: crop.x + crop.w, right: 0, height: crop.h }} />
        {/* crop border */}
        <div
          className="absolute border-2 border-white"
          style={{ top: crop.y, left: crop.x, width: crop.w, height: crop.h }}
        >
          {/* rule-of-thirds guides */}
          <div className="absolute inset-0 opacity-30">
            <div className="absolute border-white border-r" style={{ left: "33.33%", top: 0, bottom: 0, borderRightWidth: 1 }} />
            <div className="absolute border-white border-r" style={{ left: "66.66%", top: 0, bottom: 0, borderRightWidth: 1 }} />
            <div className="absolute border-white border-b" style={{ top: "33.33%", left: 0, right: 0, borderBottomWidth: 1 }} />
            <div className="absolute border-white border-b" style={{ top: "66.66%", left: 0, right: 0, borderBottomWidth: 1 }} />
          </div>
          {/* move cursor overlay */}
          <div className="absolute inset-0" style={{ cursor: "move", zIndex: 1 }} />
        </div>
      </div>

      {/* Corner handles */}
      <div style={cornerStyle(crop.x, crop.y)} />
      <div style={{ ...cornerStyle(crop.x + crop.w, crop.y), cursor: "ne-resize" }} />
      <div style={{ ...cornerStyle(crop.x, crop.y + crop.h), cursor: "sw-resize" }} />
      <div style={{ ...cornerStyle(crop.x + crop.w, crop.y + crop.h), cursor: "se-resize" }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main modal
// ---------------------------------------------------------------------------

interface ImageUploadModalProps {
  imageType: OrgImageType;
  orgId: string;
  primaryColor?: string;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ImageUploadModal({
  imageType,
  orgId,
  primaryColor = "#1E3A5F",
  onClose,
  onSuccess,
}: ImageUploadModalProps) {
  const config = SLOT[imageType];

  type Step = "select" | "crop" | "uploading" | "done";
  const [step, setStep] = useState<Step>("select");

  // Source state
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  const [sourceType, setSourceType] = useState("image/jpeg");
  const [sourceName, setSourceName] = useState("image.jpg");
  const [isSvg, setIsSvg] = useState(false);

  // Crop state (lifted from CropEditor for use in preview + confirm)
  const [liveCrop, setLiveCrop] = useState<CropRect | null>(null);
  const [liveDisplayW, setLiveDisplayW] = useState(0);
  const [liveDisplayH, setLiveDisplayH] = useState(0);
  const imgRefForCrop = useRef<HTMLImageElement | null>(null);

  // BG removal
  const [isRemovingBg, setIsRemovingBg] = useState(false);
  const [bgRemoved, setBgRemoved] = useState(false);

  // Drop / drag state
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => { if (sourceUrl) URL.revokeObjectURL(sourceUrl); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFile = (file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
    if (!allowed.includes(file.type)) {
      setError("Please select a valid image file (JPEG, PNG, WebP, GIF, or SVG)");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File size must be less than 10MB");
      return;
    }
    setError(null);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
    const url = URL.createObjectURL(file);
    setSourceUrl(url);
    setSourceBlob(file);
    setSourceType(file.type);
    setSourceName(file.name);
    setIsSvg(file.type === "image/svg+xml");
    setBgRemoved(false);
    setStep("crop");
  };

  const handleRemoveBg = async () => {
    if (!sourceBlob || isRemovingBg) return;
    setIsRemovingBg(true);
    setError(null);
    try {
      const { removeBackground } = await import("@imgly/background-removal");
      const result = await removeBackground(sourceBlob);
      if (sourceUrl) URL.revokeObjectURL(sourceUrl);
      const url = URL.createObjectURL(result);
      setSourceUrl(url);
      setSourceBlob(result);
      setSourceType("image/png");
      setSourceName(sourceName.replace(/\.[^.]+$/, "") + "_nobg.png");
      setBgRemoved(true);
    } catch {
      setError("Background removal failed — try uploading a PNG with a transparent background instead.");
    } finally {
      setIsRemovingBg(false);
    }
  };

  const handleConfirmCrop = async () => {
    if (!sourceBlob) return;
    setStep("uploading");
    setError(null);
    try {
      let finalBlob: Blob;

      if (isSvg) {
        // SVGs skip crop — upload as-is
        finalBlob = sourceBlob;
      } else {
        // Need the img element to read naturalWidth/Height for crop math
        const img = imgRefForCrop.current;
        if (!img || !liveCrop) throw new Error("Crop not ready");
        finalBlob = await cropToBlob(img, liveCrop, liveDisplayW, liveDisplayH, sourceType);
      }

      const dataUrl = await blobToDataUrl(finalBlob);
      const result = await uploadOrganizationImage({
        organizationId: orgId,
        imageType,
        fileData: dataUrl,
        fileName: sourceName,
        contentType: finalBlob.type,
      });

      if (result.success) {
        setStep("done");
        // Notify onboarding callouts (and any other listeners) that the field
        // was saved. The inline text-edit path dispatches this event; image
        // uploads must too, or steps like "Add your store's logo" never
        // register as complete and the prompt won't dismiss.
        if (typeof window !== "undefined") {
          const columnByImageType: Record<OrgImageType, string> = {
            hero_image: "hero_image_url",
            logo: "logo_url",
            logo_horizontal: "logo_horizontal_url",
            product_overlay: "product_overlay_url",
          };
          window.dispatchEvent(new CustomEvent("csc:field-updated", {
            detail: { table: "organizations", column: columnByImageType[imageType], entityId: orgId },
          }));
        }
        setTimeout(onSuccess, 900);
      } else {
        setError(result.error ?? "Upload failed");
        setStep("crop");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "An error occurred");
      setStep("crop");
    }
  };

  const handleCropChange = useCallback(
    (crop: CropRect, dw: number, dh: number) => {
      setLiveCrop(crop);
      setLiveDisplayW(dw);
      setLiveDisplayH(dh);
    },
    []
  );

  // Hidden img element that CropEditor's imgRef can populate — used for canvas crop
  // (CropEditor renders its own img; we sync via a callback ref pattern)
  const syncImgRef = useCallback((img: HTMLImageElement | null) => {
    imgRefForCrop.current = img;
  }, []);

  return (
    <div
      className="fixed inset-0 z-[65] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col mx-4">

        {/* Header */}
        <div className="flex items-start justify-between px-6 pt-5 pb-4 border-b border-gray-100 flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#1A1A1A]">
              {step === "select" && `Upload ${config.label}`}
              {step === "crop" && `Crop ${config.label}`}
              {step === "uploading" && "Saving…"}
              {step === "done" && "Saved!"}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">{config.description}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors ml-4 flex-shrink-0"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto">

          {/* ── STEP: SELECT ─────────────────────────────────────────── */}
          {step === "select" && (
            <div className="p-6 flex flex-col gap-4">
              {/* Tip bar */}
              <div className="flex items-start gap-3 px-4 py-3 rounded-xl bg-blue-50 border border-blue-100">
                <svg className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div>
                  <p className="text-xs font-semibold text-blue-700 mb-0.5">{config.tip}</p>
                  <p className="text-xs text-blue-500">Preferred format: {config.preferFormats}</p>
                </div>
              </div>

              {/* Drop zone */}
              <div
                className={`
                  flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed
                  cursor-pointer transition-all py-14
                  ${isDraggingOver
                    ? "border-emerald-400 bg-emerald-50"
                    : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"}
                `}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setIsDraggingOver(true); }}
                onDragLeave={() => setIsDraggingOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDraggingOver(false);
                  const file = e.dataTransfer.files[0];
                  if (file) loadFile(file);
                }}
              >
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-gray-700">
                    {isDraggingOver ? "Drop to upload" : "Drag & drop or click to browse"}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">JPEG, PNG, WebP, GIF, SVG — max 10 MB</p>
                </div>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
                className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
              />

              {error && <p className="text-sm text-red-500">{error}</p>}
            </div>
          )}

          {/* ── STEP: CROP ───────────────────────────────────────────── */}
          {step === "crop" && sourceUrl && (
            <div className="flex gap-0 min-h-0">

              {/* Left: crop editor */}
              <div className="flex-1 p-6 flex flex-col gap-4 min-w-0">

                {/* SVG notice — no crop needed */}
                {isSvg ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-10">
                    <img src={sourceUrl} alt="" className="max-w-full max-h-48 object-contain" />
                    <p className="text-sm text-gray-500 text-center">
                      SVG files are vector — no cropping needed. They'll scale perfectly at any size.
                    </p>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-gray-400">
                      Drag inside to move · Drag corners to resize · Aspect ratio is locked
                    </p>
                    <div className="flex justify-center">
                      <CropEditorWithRef
                        sourceUrl={sourceUrl}
                        config={config}
                        onCropChange={handleCropChange}
                        imgRef={syncImgRef}
                      />
                    </div>
                  </>
                )}

                {/* BG removal — product_overlay only */}
                {config.allowBgRemoval && !isSvg && (
                  <div className="flex items-center gap-3 pt-1">
                    {bgRemoved ? (
                      <div className="flex items-center gap-2 text-emerald-600 text-sm">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                        Background removed
                        <button
                          onClick={() => fileInputRef.current?.click()}
                          className="ml-2 text-xs text-gray-400 hover:text-gray-600 underline"
                        >
                          Start over
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={handleRemoveBg}
                        disabled={isRemovingBg}
                        className="flex items-center gap-2 px-4 py-2 rounded-full border border-gray-200 text-sm font-medium text-gray-600 hover:border-gray-400 hover:text-gray-800 transition-all disabled:opacity-60"
                      >
                        {isRemovingBg ? (
                          <>
                            <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Removing background…
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
                            </svg>
                            Remove Background
                          </>
                        )}
                      </button>
                    )}
                    {!isRemovingBg && !bgRemoved && (
                      <p className="text-xs text-gray-400">Runs in your browser — no upload needed</p>
                    )}
                  </div>
                )}

                {error && <p className="text-sm text-red-500">{error}</p>}
              </div>

              {/* Right: context preview */}
              <div className="w-52 border-l border-gray-100 p-5 flex flex-col gap-4 flex-shrink-0">
                <p className="text-xs uppercase tracking-wider font-semibold text-gray-400">Preview</p>
                {liveCrop && sourceUrl && !isSvg ? (
                  <ContextPreview
                    config={config}
                    sourceUrl={sourceUrl}
                    crop={liveCrop}
                    displayW={liveDisplayW}
                    displayH={liveDisplayH}
                    bgColor={primaryColor}
                  />
                ) : isSvg && sourceUrl ? (
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-full h-24 bg-gray-50 rounded-lg flex items-center justify-center p-3">
                      <img src={sourceUrl} alt="" className="max-w-full max-h-full object-contain" />
                    </div>
                    <p className="text-xs text-gray-400 text-center">SVG preview</p>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400">Loading preview…</div>
                )}

                <div className="mt-auto pt-3 border-t border-gray-100">
                  <p className="text-xs text-gray-400 leading-relaxed">{config.tip}</p>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP: UPLOADING ──────────────────────────────────────── */}
          {step === "uploading" && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <svg className="w-10 h-10 animate-spin text-gray-300" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-sm text-gray-500">Saving image…</p>
            </div>
          )}

          {/* ── STEP: DONE ───────────────────────────────────────────── */}
          {step === "done" && (
            <div className="flex flex-col items-center justify-center py-20 gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              </div>
              <p className="text-sm font-medium text-gray-700">{config.label} saved!</p>
            </div>
          )}

        </div>

        {/* Footer */}
        {(step === "select" || step === "crop") && (
          <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between flex-shrink-0">
            <button
              onClick={step === "select" ? onClose : () => setStep("select")}
              className="px-4 py-2 text-sm text-gray-600 hover:text-[#1A1A1A] transition-colors"
            >
              {step === "select" ? "Cancel" : "← Change image"}
            </button>
            {step === "crop" && (
              <button
                onClick={handleConfirmCrop}
                disabled={!sourceUrl || isRemovingBg}
                className="px-5 py-2 rounded-full text-sm font-semibold text-white transition-all hover:opacity-90 disabled:opacity-50"
                style={{ backgroundColor: primaryColor }}
              >
                Save Image
              </button>
            )}
          </div>
        )}

      </div>

      {/* Hidden file input for "Start over" in crop step */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// CropEditor wrapper that exposes the img element via a ref callback
// (We need it to call canvas.drawImage with naturalWidth/Height)
// ---------------------------------------------------------------------------

function CropEditorWithRef({
  sourceUrl,
  config,
  onCropChange,
  imgRef,
}: {
  sourceUrl: string;
  config: SlotConfig;
  onCropChange: (crop: CropRect, displayW: number, displayH: number) => void;
  imgRef: (img: HTMLImageElement | null) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);

  // After the CropEditor renders, find the img inside it and sync the ref
  useEffect(() => {
    if (!editorRef.current) return;
    const img = editorRef.current.querySelector("img");
    imgRef(img as HTMLImageElement | null);
    return () => imgRef(null);
  });

  return (
    <div ref={editorRef}>
      <CropEditor sourceUrl={sourceUrl} config={config} onCropChange={onCropChange} />
    </div>
  );
}
