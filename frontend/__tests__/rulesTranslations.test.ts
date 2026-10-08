import de from '../src/i18n/locales/de.json';
import en from '../src/i18n/locales/en.json';
import tr from '../src/i18n/locales/tr.json';

type Tree = { [key: string]: string | Tree };

/** "a.b" → value, for every leaf. */
function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') out.set(key, v);
    else for (const [kk, vv] of leaves(v, key)) out.set(kk, vv);
  }
  return out;
}
const placeholders = (s: string) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('rules translations', () => {
  const english = leaves(en.rules as Tree);

  it.each([
    ['de', de.rules as Tree],
    ['tr', tr.rules as Tree],
  ])('%s has the same keys and placeholders as en, none empty', (_lang, rules) => {
    const other = leaves(rules);
    expect([...other.keys()].sort()).toEqual([...english.keys()].sort());
    for (const [key, value] of other) {
      expect(value.trim()).not.toBe('');
      expect([key, placeholders(value)]).toEqual([key, placeholders(english.get(key) ?? '')]);
    }
  });
});
