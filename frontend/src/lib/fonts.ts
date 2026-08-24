import type { LayerSpecification } from '@maplibre/maplibre-react-native';

// MapLibre Native corrupts the {fontstack} URL substitution for font-stack
// names containing spaces (reproduced on-device: requests came back as
// "Noto Þ<garbage>ans20Regular" instead of "Noto%20Sans%20Regular", timing
// out instead of 404ing cleanly — a known class of client-side encoding
// bug, not fixable from application code). Since we control both the
// style's font references and our own hosted glyph file names, sidestep
// the bug by renaming font stacks to be space-free on both ends.
export const FONT_RENAME: Record<string, string> = {
  'Noto Sans Regular': 'NotoSansRegular',
  'Noto Sans Medium': 'NotoSansMedium',
  'Noto Sans Italic': 'NotoSansItalic',
};

// MapLibre expressions are JSON: strings (font names, operators), numbers
// and booleans (e.g. a zoom threshold), or nested arrays of the same.
type FontExpr = string | number | boolean | null | FontExpr[];

function renameInExpr(expr: FontExpr): FontExpr {
  if (typeof expr === 'string') {
    return FONT_RENAME[expr] ?? expr;
  }
  if (Array.isArray(expr)) {
    return expr.map(renameInExpr);
  }
  return expr;
}

// Scoped to each layer's `layout['text-font']` only — deliberately not a
// blanket string replace over the whole layer, so it can't touch unrelated
// text (e.g. a text-field template) that happens to contain a matching
// substring.
export function withNoSpaceFontStacks(layers: LayerSpecification[]): LayerSpecification[] {
  return layers.map((layer) => {
    const layout = (layer as { layout?: Record<string, unknown> }).layout;
    if (!layout || !('text-font' in layout)) {
      return layer;
    }
    return {
      ...layer,
      layout: {
        ...layout,
        'text-font': renameInExpr(layout['text-font'] as FontExpr),
      },
    } as LayerSpecification;
  });
}
