import {
  getPrimaryColor,
  getAccentColor,
  getBackgroundColor,
  getTextColor,
} from "@/lib/branding";

/** Parse a hex color (#rrggbb or #rgb) into [r, g, b] integers. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0] + h[0], 16),
      parseInt(h[1] + h[1], 16),
      parseInt(h[2] + h[2], 16),
    ];
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Server component that injects CSS custom properties from platform branding
 * settings. Works in both OSS and Pro editions. In Pro, TenantStyles may
 * override these values for non-default tenants.
 */
export function BrandStyles() {
  const primary = getPrimaryColor();
  const accent = getAccentColor();
  const bg = getBackgroundColor();
  const text = getTextColor();

  const [pr, pg, pb] = hexToRgb(primary);
  const [ar, ag, ab] = hexToRgb(accent);

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `:root {
  --blue: ${primary};
  --blue-dark: ${primary};
  --teal: ${accent};
  --background: ${bg};
  --foreground: ${text};
  --primary-r: ${pr};
  --primary-g: ${pg};
  --primary-b: ${pb};
  --accent-r: ${ar};
  --accent-g: ${ag};
  --accent-b: ${ab};
}`,
      }}
    />
  );
}
