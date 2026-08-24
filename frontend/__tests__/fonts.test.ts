import type { LayerSpecification } from '@maplibre/maplibre-react-native';
import { FONT_RENAME, withNoSpaceFontStacks } from '../src/lib/fonts';

function symbolLayer(id: string, textFont: unknown): LayerSpecification {
  return {
    id,
    type: 'symbol',
    source: 'protomaps',
    layout: { 'text-font': textFont },
  } as unknown as LayerSpecification;
}

describe('FONT_RENAME', () => {
  it('maps every known Protomaps font stack to a space-free equivalent', () => {
    expect(FONT_RENAME).toEqual({
      'Noto Sans Regular': 'NotoSansRegular',
      'Noto Sans Medium': 'NotoSansMedium',
      'Noto Sans Italic': 'NotoSansItalic',
    });
  });
});

describe('withNoSpaceFontStacks', () => {
  it('renames a simple text-font array', () => {
    const layers = [symbolLayer('poi_label', ['Noto Sans Regular'])];

    const result = withNoSpaceFontStacks(layers);

    expect((result[0] as any).layout['text-font']).toEqual(['NotoSansRegular']);
  });

  it('renames font stacks nested inside a case/literal expression', () => {
    // The real shape protomaps-themes-base produces for zoom-dependent labels.
    const layers = [
      symbolLayer('places_locality', [
        'case',
        ['<=', ['get', 'min_zoom'], 5],
        ['literal', ['Noto Sans Medium']],
        ['literal', ['Noto Sans Regular']],
      ]),
    ];

    const result = withNoSpaceFontStacks(layers);

    expect((result[0] as any).layout['text-font']).toEqual([
      'case',
      ['<=', ['get', 'min_zoom'], 5],
      ['literal', ['NotoSansMedium']],
      ['literal', ['NotoSansRegular']],
    ]);
  });

  it('leaves layers without a text-font untouched', () => {
    const layer = { id: 'earth', type: 'fill', source: 'protomaps' } as unknown as LayerSpecification;

    const result = withNoSpaceFontStacks([layer]);

    expect(result[0]).toEqual(layer);
  });

  it('does not mutate the input array or its layer objects', () => {
    const original = [symbolLayer('poi_label', ['Noto Sans Regular'])];
    const originalJson = JSON.stringify(original);

    withNoSpaceFontStacks(original);

    expect(JSON.stringify(original)).toBe(originalJson);
  });

  it('only renames the text-font property, not other matching text on the layer', () => {
    const layers = [
      {
        id: 'poi_label',
        type: 'symbol',
        source: 'protomaps',
        layout: {
          'text-font': ['Noto Sans Regular'],
          'text-field': 'Noto Sans Regular is not a font stack here',
        },
      } as unknown as LayerSpecification,
    ];

    const result = withNoSpaceFontStacks(layers);

    expect((result[0] as any).layout['text-font']).toEqual(['NotoSansRegular']);
    expect((result[0] as any).layout['text-field']).toBe(
      'Noto Sans Regular is not a font stack here',
    );
  });
});
