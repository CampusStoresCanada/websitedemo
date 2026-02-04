"use client";

import { useEffect, useRef, useState } from "react";

interface ColorizedImageProps {
  src: string;
  color: string; // hex color like "#D6001C"
  alt: string;
  className?: string;
  intensity?: number; // 0-1, how much color to apply (default 1 = full colorize)
}

/**
 * Renders an image with a colorize effect using canvas.
 * The image is converted to grayscale, then the color is applied as a multiply blend.
 */
export default function ColorizedImage({
  src,
  color,
  alt,
  className = "",
  intensity = 1,
}: ColorizedImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.crossOrigin = "anonymous";

    img.onload = () => {
      // Set canvas dimensions to match image
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      setDimensions({ width: img.naturalWidth, height: img.naturalHeight });

      // Draw original image
      ctx.drawImage(img, 0, 0);

      // Get image data
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Parse the color
      const rgb = hexToRgb(color);
      if (!rgb) {
        setLoaded(true);
        return;
      }

      // Apply colorize effect
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        // Alpha stays the same

        // Convert to grayscale (luminosity method)
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;

        // Apply color using multiply blend mode formula
        // Result = (gray / 255) * color
        const newR = (gray / 255) * rgb.r;
        const newG = (gray / 255) * rgb.g;
        const newB = (gray / 255) * rgb.b;

        // Blend based on intensity
        data[i] = Math.round(r * (1 - intensity) + newR * intensity);
        data[i + 1] = Math.round(g * (1 - intensity) + newG * intensity);
        data[i + 2] = Math.round(b * (1 - intensity) + newB * intensity);
      }

      // Put the modified data back
      ctx.putImageData(imageData, 0, 0);
      setLoaded(true);
    };

    img.onerror = () => {
      console.error("Failed to load image for colorization:", src);
      setLoaded(true);
    };

    img.src = src;
  }, [src, color, intensity]);

  return (
    <div className={`relative ${className}`}>
      {!loaded && (
        <div className="absolute inset-0 bg-slate-200 animate-pulse" />
      )}
      <canvas
        ref={canvasRef}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
        style={{
          aspectRatio: dimensions.width && dimensions.height
            ? `${dimensions.width} / ${dimensions.height}`
            : undefined
        }}
        aria-label={alt}
      />
    </div>
  );
}

/**
 * Convert hex color to RGB object
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  // Remove # if present
  const cleanHex = hex.replace("#", "");

  // Parse 3 or 6 character hex
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

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    return null;
  }

  return { r, g, b };
}
