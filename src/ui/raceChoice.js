// The title card's game choice (ui/TitleScreen.js): play WITH the AI RACE button on the lawn
// (the default) or WITHOUT it (the button is not there, so AI RACE, its robots, Rustmaw and the
// meltdown never start). Remembered per browser. Pure: no DOM, unit tested in node.
//
//   RACE_CHOICES                      // [{ on: true, label }, { on: false, label }], left to right
//   loadRaceChoice(storage) -> bool   // the saved choice, true (with) when there is none
//   saveRaceChoice(on, storage) -> bool   // true when it was written
//   choiceForKey(code, current) -> bool | null   // the choice a key picks, null: not a choice key

import { browserStorage } from '../render/post/settings.js';

export const RACE_CHOICES = Object.freeze([
  Object.freeze({ on: true, label: 'WITH AI RACE' }),
  Object.freeze({ on: false, label: 'WITHOUT AI RACE' }),
]);

const STORAGE_KEY = 'castleGrounds.aiRace.v1';

export function loadRaceChoice(storage = browserStorage()) {
  try {
    return storage?.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true; // inaccessible storage: the default
  }
}

export function saveRaceChoice(on, storage = browserStorage()) {
  if (!storage) return false;
  try {
    storage.setItem(STORAGE_KEY, on ? 'on' : 'off');
    return true;
  } catch {
    return false;
  }
}

// Left (arrow or A) picks the left option, right (arrow or D) the right one; up and down (arrows,
// W, S) and Tab switch to the other one.
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const SWITCH = new Set(['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS', 'Tab']);

export function choiceForKey(code, current) {
  if (LEFT.has(code)) return RACE_CHOICES[0].on;
  if (RIGHT.has(code)) return RACE_CHOICES[1].on;
  if (SWITCH.has(code)) return !current;
  return null;
}
