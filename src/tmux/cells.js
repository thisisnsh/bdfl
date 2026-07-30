'use strict';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemes(value) {
  return [...segmenter.segment(`${value ?? ''}`)].map(({ segment }) => segment);
}

function cellWidth(value) {
  return graphemes(`${value ?? ''}`.replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')).reduce((total, character) => {
    if (![...character].some((item) => !/[\p{Mark}\u200d\ufe0e\ufe0f]/u.test(item))) return total;
    return (
      total +
      (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\p{Script=Han}|\p{Script=Hangul}|\p{Script=Hiragana}|\p{Script=Katakana}|[\u1100-\u115f\u2329\u232a\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe10-\ufe19\ufe30-\ufe6f\uff01-\uff60\uffe0-\uffe6]|[\u{20000}-\u{3fffd}]/u.test(
        character
      )
        ? 2
        : 1)
    );
  }, 0);
}

function cropCells(value, columns, ellipsis = true) {
  if (columns <= 0) return '';
  const clipped = cellWidth(value) > columns;
  const limit = clipped && ellipsis ? Math.max(0, columns - 1) : columns;
  let result = '';
  let width = 0;
  for (const character of graphemes(value)) {
    const size = cellWidth(character);
    if (width + size > limit) break;
    result += character;
    width += size;
  }
  return `${result}${clipped && ellipsis ? '…' : ''}`;
}

function fitsRail(labels, columns, { prefix = 0, gap = 1 } = {}) {
  return prefix + labels.reduce((total, label, index) => total + cellWidth(label) + (index ? gap : 0), 0) <= columns;
}

module.exports = { graphemes, cellWidth, cropCells, fitsRail };
