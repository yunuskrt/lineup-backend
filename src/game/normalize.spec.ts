import { normalizeName } from '@/game/normalize.js';

const SHAPE = /^[a-z0-9]+( [a-z0-9]+)*$/;

// [input, expected]; feeds the property check
const CASES: [string, string][] = [
  // Ported from the web mock's normalize.test.ts
  ['İbrahimović', 'ibrahimovic'],
  ['Čech', 'cech'],
  ['Özil', 'ozil'],
  ['Hernández', 'hernandez'],
  ['İSTANBUL', 'istanbul'],
  ['Şahin', 'sahin'],
  ['Ilıcalı', 'ilicali'],
  ['Gökhan', 'gokhan'],
  ['Çalhanoğlu', 'calhanoglu'],
  ['Bjørn', 'bjorn'],
  ['Łukasz', 'lukasz'],
  ['Weiß', 'weiss'],
  ["O'Shea", 'oshea'],
  ['Hernández-Pérez', 'hernandez perez'],
  ['  Zlatan   Ibrahimovic  ', 'zlatan ibrahimovic'],
  ['\tRafa\n', 'rafa'],
  // Added in B27
  ['Muñoz', 'munoz'],
  ['João', 'joao'],
  ['Gonçalves', 'goncalves'],
  ['Ødegaard', 'odegaard'],
  ['Guðjohnsen', 'gudjohnsen'],
  ['Þórður', 'thordur'],
  ['Ærø', 'aero'],
  ['Đoković', 'dokovic'],
  ['Šimić', 'simic'],
  ['Žigić', 'zigic'],
  ['Kanté', 'kante'],
  ['Müller', 'muller'],
  ['Gœthe', 'goethe'],
  ['ẞ', 'ss'],
  ['Iniesta', 'iniesta'],
  ['N. Kanté', 'n kante'],
  ['Neymar Jr.', 'neymar jr'],
  ['Bobby Charlton 2', 'bobby charlton 2'],
];

describe('normalizeName', () => {
  it.each(CASES)('normalizes %j to %j', (input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it('lowercases a plain ASCII I to i, not ı', () => {
    expect(normalizeName('IRAN')).toBe('iran');
  });

  it.each(["O'Neill", 'O’Neill', 'Oʼneill', 'O`Neill'])(
    'drops the apostrophe in %j',
    (input) => {
      expect(normalizeName(input)).toBe('oneill');
    },
  );

  it.each([
    ['a ligature', 'Raﬁnha', 'rafinha'],
    ['fullwidth letters', 'Ｍｅｓｓｉ', 'messi'],
    ['a superscript digit', 'Xavi²', 'xavi2'],
  ])('folds %s through NFKD', (_, input, expected) => {
    expect(normalizeName(input)).toBe(expected);
  });

  it.each([
    ['a zero-width space', 'Mes​si'],
    ['a zero-width joiner', 'Mes‍si'],
    ['a soft hyphen', 'Mes­si'],
    ['a BOM', '﻿Messi'],
  ])('leaves no gap for %s', (_, input) => {
    expect(normalizeName(input)).toBe('messi');
  });

  it('gives decomposed and composed input the same result', () => {
    const composed = 'Çalhanoğlu Özil';
    expect(normalizeName(composed.normalize('NFD'))).toBe(
      normalizeName(composed),
    );
  });

  it('strips combining marks outside U+0300–U+036F', () => {
    // U+20D7: combining right arrow above
    expect(normalizeName('Mes⃗si')).toBe('messi');
  });

  it.each(['Аршавин', 'Χαριστέας', '中村俊輔'])(
    'gives an empty string for the non-Latin %j',
    (input) => {
      expect(normalizeName(input)).toBe('');
    },
  );

  it.each(['', '   ', '!!!', '-—–'])(
    'gives an empty string for %j',
    (input) => {
      expect(normalizeName(input)).toBe('');
    },
  );

  it('keeps every output idempotent and in shape', () => {
    for (const [input] of CASES) {
      const once = normalizeName(input);
      expect(normalizeName(once)).toBe(once);
      expect(once).toMatch(SHAPE);
    }
  });
});
