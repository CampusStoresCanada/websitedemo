import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { measureLogoContent } from "@/lib/conference/badges/logo-fit";

/**
 * A logo cropped tight runs to every edge of its file, exactly as a photo
 * does. Treating it as a photo fills the badge's circle with it and cuts the
 * lettering off, which is how "KPU" printed as "KPI" in the 2027 rehearsal.
 */

const SIZE = 200;

function serve(png: Buffer) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(new Uint8Array(png), { status: 200 }))
  );
}

/** Two flat colours, with ink touching all four edges: a tight wordmark. */
async function tightLogo(): Promise<Buffer> {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      const cornerIsGround = x < 20 && y < 20;
      const ink = !cornerIsGround && (x < 30 || x >= SIZE - 30 || y < 30 || y >= SIZE - 30 || (x > 80 && x < 120));
      const [r, g, b] = ink ? [120, 30, 50] : [255, 255, 255];
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();
}

/** Continuous tone to every edge: a photograph. */
async function photograph(): Promise<Buffer> {
  const data = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = (y * SIZE + x) * 4;
      data[i] = Math.round((x / SIZE) * 255);
      data[i + 1] = Math.round((y / SIZE) * 255);
      data[i + 2] = Math.round(((x + y) / (2 * SIZE)) * 255);
      data[i + 3] = 255;
    }
  }
  return sharp(data, { raw: { width: SIZE, height: SIZE, channels: 4 } }).png().toBuffer();
}

afterEach(() => vi.unstubAllGlobals());

describe("measureLogoContent: photo or logo", () => {
  it("does not call a tightly cropped logo a photo", async () => {
    serve(await tightLogo());
    const fit = await measureLogoContent("https://example.ca/logo.png");
    expect(fit).not.toBeNull();
    // It does run to every edge, which is what used to decide it.
    expect(fit!.width).toBeGreaterThanOrEqual(0.95);
    expect(fit!.height).toBeGreaterThanOrEqual(0.95);
    expect(fit!.photo).toBe(false);
  });

  it("still fills the circle with a real photograph", async () => {
    serve(await photograph());
    const fit = await measureLogoContent("https://example.ca/storefront.png");
    expect(fit?.photo).toBe(true);
  });
});
