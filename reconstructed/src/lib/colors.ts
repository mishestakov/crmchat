function hueToRgb(p: number, q: number, t: number) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function toHex(x: number): string {
  const hex = Math.round(x * 255).toString(16);
  return hex.length === 1 ? "0" + hex : hex;
}

/**
 * Converts an HSL color string (e.g. "240 10% 3.9%") to RGB hex format
 */
export function hslToHex(hsl: string): `#${string}` {
  // Parse HSL values from string
  const [h, s, l] = hsl
    .split(" ")
    .map((val) => Number.parseFloat(val.replace("%", "")));

  // Convert to 0-1 range
  const hue = h! / 360;
  const sat = s! / 100;
  const light = l! / 100;

  let r, g, b;

  if (sat === 0) {
    r = g = b = light;
  } else {
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    r = hueToRgb(p, q, hue + 1 / 3);
    g = hueToRgb(p, q, hue);
    b = hueToRgb(p, q, hue - 1 / 3);
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string): string {
  // Remove # if present
  const cleanHex = hex.charAt(0) === "#" ? hex.slice(1) : hex;

  // Convert hex to RGB
  const r = Number.parseInt(cleanHex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(cleanHex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(cleanHex.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }

    h /= 6;
  }

  // Convert to degrees and percentages with 2 decimal places
  const hDeg = (h * 360).toFixed(2);
  const sPct = (s * 100).toFixed(2);
  const lPct = (l * 100).toFixed(2);

  return `${hDeg} ${sPct}% ${lPct}%`;
}
