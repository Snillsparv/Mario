// The game choice, on its own screen before the title card (ui/ChoiceScreen.js): play WITH the
// AI RACE button on the lawn (the default) or WITHOUT it (the button is not there, so AI RACE,
// its robots, Rustmaw and the meltdown never start). Remembered per browser. Pure: no DOM, unit
// tested in node.
//
//   RACE_CHOICES                      // [{ on: true, label, about }, { on: false, ... }], top to bottom
//   RACE_TEXTS, RACE_SMALL_STRINGS, RACE_BIG_STRINGS   // the screen's texts (glyph coverage)
//   loadRaceChoice(storage) -> bool   // the saved choice, true (with) when there is none
//   saveRaceChoice(on, storage) -> bool   // true when it was written
//   choiceForKey(code, current) -> bool | null   // the choice a key picks, null: not a choice key

export const RACE_CHOICES = Object.freeze([
  Object.freeze({ on: true, label: 'WITH AI RACE', about: 'The AI RACE button waits on the lawn' }),
  Object.freeze({ on: false, label: 'WITHOUT AI RACE', about: 'No AI RACE button: the grounds stay peaceful' }),
]);

export const RACE_TEXTS = Object.freeze({
  title: 'CHOOSE YOUR GAME',
  prompt: 'Up / down to choose · Enter or Space to play',
  touchPrompt: 'Tap a choice to play',
});

// Every string the screen draws: labels and the title in the big font, the rest in the small one.
export const RACE_BIG_STRINGS = [RACE_TEXTS.title, ...RACE_CHOICES.map((c) => c.label)];
export const RACE_SMALL_STRINGS = [RACE_TEXTS.prompt, RACE_TEXTS.touchPrompt, ...RACE_CHOICES.map((c) => c.about)];

const STORAGE_KEY = 'castleGrounds.aiRace.v1';

// localStorage, or null where it is missing or throws (private browsing, sandboxed frames,
// node). (Its own copy, not render/post/settings.js: the phone pad page imports this file
// through hudLogic.js and loads nothing of the game's renderer.)
function browserStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

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

// Up (arrow, W) or left (arrow, A) picks the first option, down (arrow, S) or right (arrow, D)
// the second; Tab switches to the other one.
const FIRST = new Set(['ArrowUp', 'KeyW', 'ArrowLeft', 'KeyA']);
const SECOND = new Set(['ArrowDown', 'KeyS', 'ArrowRight', 'KeyD']);

export function choiceForKey(code, current) {
  if (FIRST.has(code)) return RACE_CHOICES[0].on;
  if (SECOND.has(code)) return RACE_CHOICES[1].on;
  if (code === 'Tab') return !current;
  return null;
}
