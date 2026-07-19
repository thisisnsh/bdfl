'use strict';

const TEXT = 'BDFL is here, love is in the air';
const PERIODS = Object.freeze([1, 2, 3, 4, 3, 2]);
const PINK = '\u001b[38;5;205m';
const RESET = '\u001b[0m';

function bannerFrame(index, color = true) {
  const text = `${TEXT}${'.'.repeat(PERIODS[((index % PERIODS.length) + PERIODS.length) % PERIODS.length])}`;
  return color ? `${PINK}${text}${RESET}` : text;
}

function frameAt(time = Date.now(), color = true) {
  return bannerFrame(Math.floor(time / 500), color);
}

module.exports = { TEXT, PERIODS, PINK, RESET, bannerFrame, frameAt };

