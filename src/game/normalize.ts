// Letters NFKD won't decompose; mapped explicitly
const NON_DECOMPOSING: Record<string, string> = {
  ı: 'i',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
};

const COMBINING_MARKS = /\p{M}/gu;
// Zero-width space and joiner, soft hyphen, BOM
const FORMAT_CHARACTERS = /\p{Cf}/gu;
const WITHIN_WORD_APOSTROPHES = /['’ʼ`]/g;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;

export function normalizeName(input: string): string {
  // Marks go before lowercasing: İ loses its dot
  const stripped = input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(FORMAT_CHARACTERS, '')
    .toLowerCase();

  const mapped = Array.from(
    stripped,
    (char) => NON_DECOMPOSING[char] ?? char,
  ).join('');

  return mapped
    .replace(WITHIN_WORD_APOSTROPHES, '')
    .replace(NON_ALPHANUMERIC, ' ')
    .trim();
}
