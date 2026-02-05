"use client";

import { useEffect, useRef, useState } from "react";

interface ColorizedImageProps {
  src: string;
  color: string; // hex color like "#D6001C"
  alt: string;
  className?: string;
  intensity?: number; // 0-1, how much colorize to apply (default 1 = full)
}

/**
 * Renders an image with a true colorize effect using canvas.
 * Like Photoshop's Hue/Saturation "Colorize" — preserves luminance,
 * replaces hue and saturation with the target color.
 */
export default function ColorizedImage({
  src,
  color,
  alt,
  className = "",
  intensity = 1,
}: ColorizedImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new window.Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Size canvas to container (for object-cover behavior)
      const containerWidth = container.offsetWidth;
      const containerHeight = container.offsetHeight;

      canvas.width = containerWidth;
      canvas.height = containerHeight;

      // Calculate object-cover dimensions
      const imgAspect = img.naturalWidth / img.naturalHeight;
      const containerAspect = containerWidth / containerHeight;

      let drawWidth: number, drawHeight: number, drawX: number, drawY: number;

      if (imgAspect > containerAspect) {
        // Image is wider - fit height, crop sides
        drawHeight = containerHeight;
        drawWidth = containerHeight * imgAspect;
        drawX = (containerWidth - drawWidth) / 2;
        drawY = 0;
      } else {
        // Image is taller - fit width, crop top/bottom
        drawWidth = containerWidth;
        drawHeight = containerWidth / imgAspect;
        drawX = 0;
        drawY = (containerHeight - drawHeight) / 2;
      }

      // Draw the image with cover behavior
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

      // Get image data for pixel manipulation
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Parse the target color and convert to HSL
      const rgb = hexToRgb(color);
      if (!rgb) {
        setLoaded(true);
        return;
      }

      const targetHSL = rgbToHsl(rgb.r, rgb.g, rgb.b);

      // Apply true colorize effect:
      // Keep luminance from original, use hue and saturation from target color
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // alpha stays the same

        // Get luminance of original pixel
        const origHSL = rgbToHsl(r, g, b);

        // Colorized pixel: target hue, target saturation, original luminance
        const colorized = hslToRgb(targetHSL.h, targetHSL.s, origHSL.l);

        // Blend based on intensity
        data[i] = Math.round(r * (1 - intensity) + colorized.r * intensity);
        data[i + 1] = Math.round(g * (1 - intensity) + colorized.g * intensity);
        data[i + 2] = Math.round(b * (1 - intensity) + colorized.b * intensity);
      }

      ctx.putImageData(imageData, 0, 0);
      setLoaded(true);
    };

    img.onerror = () => {
      console.error("Failed to load image for colorization:", src);
      setLoaded(true);
    };

    img.src = src;
  }, [src, color, intensity, renderKey]);

  // Re-render on container resize
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      setLoaded(false);
      setRenderKey((k) => k + 1);
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        aria-label={alt}
      />
    </div>
  );
}

/**
 * Convert hex color to RGB
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const cleanHex = hex.replace("#", "");

  let r: number, g: number, b: number;

  if (cleanHex.length === 3) {
    r = parseInt(cleanHex[0] + cleanHex[0], 16);
    g = parseInt(cleanHex[1] + cleanHex[1], 16);
    b = parseInt(cleanHex[2] + cleanHex[2], 16);
  } else if (cleanHex.length === 6) {
    r = parseInt(cleanHex.slice(0, 2), 16);
    g = parseInt(cleanHex.slice(2, 4), 16);
    b = parseInt(cleanHex.slice(4, 6), 16);
  } else {
    return null;
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
  return { r, g, b };
}

/**
 * RGB to HSL conversion
 */
function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) {
    return { h: 0, s: 0, l };
  }

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
      break;
    case g:
      h = ((b - r) / d + 2) / 6;
      break;
    default:
      h = ((r - g) / d + 4) / 6;
      break;
  }

  return { h, s, l };
}

/**
 * HSL to RGB conversion
 */
function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  if (s === 0) {
    const val = Math.round(l * 255);
    return { r: val, g: val, b: val };
  }

  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
}
