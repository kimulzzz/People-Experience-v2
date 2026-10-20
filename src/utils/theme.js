// src/utils/theme.js
// Per-user website accent theme (persisted in this browser only, via localStorage — never
// sent to the server/store.json). Re-themes every surface built in the red-gradient reskin
// (Dashboard hero + journey cards, Explore Metrics table, Signature Program Events panel,
// Score Deficit Alerts, Admin Parameters/Survey Question modals, nav tab bar) by deriving
// all 13 CSS custom properties declared in src/index.css's `:root` from one preset base hex,
// so every preset gets the same contrast relationships the original CIMB red was designed
// with, instead of 5 sets of hand-picked colors that could drift out of balance.

const STORAGE_KEY = 'px_theme_preset';

function hexToHsl(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = ((g - b) / d) % 6; break;
      case g: h = (b - r) / d + 2; break;
      default: h = (r - g) / d + 4; break;
    }
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: s * 100, l: l * 100 };
}

function hslToHex(h, s, l) {
  s = Math.min(Math.max(s, 0), 100) / 100;
  l = Math.min(Math.max(l, 0), 100) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0, g1 = 0, b1 = 0;
  if (h < 60) { r1 = c; g1 = x; } else if (h < 120) { r1 = x; g1 = c; }
  else if (h < 180) { g1 = c; b1 = x; } else if (h < 240) { g1 = x; b1 = c; }
  else if (h < 300) { r1 = x; b1 = c; } else { r1 = c; b1 = x; }
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r1)}${toHex(g1)}${toHex(b1)}`.toUpperCase();
}

// Derives the full 13-variable role set from a single preset base color, matching the exact
// lightness/saturation relationships the original hand-picked CIMB red palette has (e.g.
// --theme-deep sits ~26pp darker than --theme-base; --theme-row-end is a heavily desaturated
// near-white tint of the same hue) — see src/index.css for what each role is used for.
export function deriveThemeVars(baseHex) {
  const { h, s } = hexToHsl(baseHex);
  const sat = (delta) => Math.max(Math.min(s + delta, 100), 8);
  return {
    '--theme-deep': hslToHex(h, sat(0), 26),
    // full saturation for the colourful presets; a neutral base (e.g. Slate Gray, v2.47.0) keeps its low saturation
    // so the darkest accent stays grey instead of turning navy
    '--theme-dark': hslToHex(h, s >= 40 ? 100 : sat(10), 27),
    '--theme-mid': hslToHex(h, sat(0), 34),
    '--theme-strong': hslToHex(h, sat(0), 42),
    '--theme-base': hslToHex(h, sat(0), 52),
    '--theme-hover': hslToHex(h, sat(0), 48),
    '--theme-edge': hslToHex(h, sat(0), 28),
    '--theme-row-start': hslToHex(h, sat(-30), 64),
    '--theme-row-mid': hslToHex(h, sat(-45), 79),
    '--theme-row-end': hslToHex(h, sat(-58), 92),
    '--theme-row-start-h': hslToHex(h, sat(-30), 68),
    '--theme-row-mid-h': hslToHex(h, sat(-45), 83),
    '--theme-row-end-h': hslToHex(h, sat(-58), 95),
    '--theme-tint-50': hslToHex(h, sat(-50), 97),
    '--theme-tint-100': hslToHex(h, sat(-45), 94)
  };
}

// Preset bases reuse CIMB's own existing brand/journey colors (docs/05 §4) so every option
// still reads as "part of this app" rather than an arbitrary color.
export const THEME_PRESETS = [
  { id: 'red', label: 'Crimson', base: '#ED1C24' },
  { id: 'blue', label: 'Royal Blue', base: '#2563EB' },
  { id: 'teal', label: 'Teal', base: '#0D9488' },
  { id: 'purple', label: 'Violet', base: '#6716C4' },
  { id: 'orange', label: 'Tangerine', base: '#F7901E' },
  { id: 'slate', label: 'Slate Gray', base: '#475569' } // elegant neutral grey with a cool blue undertone (v2.47.0)
];

export function applyTheme(presetId) {
  const preset = THEME_PRESETS.find(p => p.id === presetId) || THEME_PRESETS[0];
  const vars = deriveThemeVars(preset.base);
  Object.entries(vars).forEach(([name, value]) => {
    document.documentElement.style.setProperty(name, value);
  });
  try {
    localStorage.setItem(STORAGE_KEY, preset.id);
  } catch (err) {
    // Private browsing / storage disabled — theme still applies for this page view,
    // it just won't persist across reloads.
  }
  return preset.id;
}

export function getSavedThemeId() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'red';
  } catch (err) {
    return 'red';
  }
}

// Call once on app startup so the saved preset (if any) applies before the first paint.
export function initTheme() {
  const saved = getSavedThemeId();
  if (saved !== 'red') applyTheme(saved);
  return saved;
}
