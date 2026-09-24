// Sign dialog box (docs/ARCHITECTURE.md "Signs and dialog"): text clean-up, wrapping and
// pagination, box metrics, the typing / paging logic and the DialogBox event contract (run
// without a DOM: logic and events only).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  DIALOG_FONT,
  TYPING,
  BOX,
  normalizeText,
  wrapText,
  paginate,
  boxLines,
  snapPx,
  dialogMetrics,
  boxHeight,
  boxTop,
  DialogLogic,
} from '../src/ui/dialogLogic.js';
import { DialogBox } from '../src/ui/DialogBox.js';
import { missingGlyphs, measureText } from '../src/ui/bitmapFont.js';
import { Events } from '../src/core/events.js';
import { SIGNS } from '../src/world/layout.js';

const measure = (t) => measureText(DIALOG_FONT, t);
const WRAP = dialogMetrics(960, 540).wrap;

const button = (pressed = false, down = pressed) => ({ down, pressed, released: false });
const pad = ({ A = false, B = false, heldA = false } = {}) => ({ A: button(A, A || heldA), B: button(B) });

// A logic with its sfx and closes recorded.
function makeLogic(pages, opts = {}) {
  const sfx = [];
  let closes = 0;
  const logic = new DialogLogic({ sfx: (n) => sfx.push(n), onClose: () => closes++, ...opts });
  logic.open(paginate(pages, { wrap: opts.wrap ?? WRAP, maxLines: opts.maxLines ?? BOX.maxLines }));
  return { logic, sfx, closes: () => closes };
}

const ticksToComplete = (logic, limit = 2000) => {
  let n = 0;
  while (!logic.complete && n < limit) {
    logic.tick(false);
    n++;
  }
  return n;
};

describe('dialog text', () => {
  test('normalizeText maps typography to the font and drops what it cannot draw', () => {
    assert.equal(normalizeText('“Hi” — it’s here…'), '"Hi" - it\'s here...');
    assert.equal(normalizeText('Café naïve'), 'Cafe naive');
    assert.equal(normalizeText('  a b  \n c ☃ '), 'a b\n c');
    assert.equal(normalizeText(null), '');
    for (const s of ['"quoted"', 'a; b & c']) assert.deepEqual(missingGlyphs(DIALOG_FONT, s), [], s);
  });

  test('every sign page can be drawn in full with the dialog font', () => {
    const letters = (t) => (t.match(/[\p{L}\p{N}]/gu) ?? []).length;
    for (const sign of SIGNS) {
      assert.ok(sign.pages.length >= 1, sign.id);
      for (const page of sign.pages) {
        const text = normalizeText(page);
        assert.deepEqual(missingGlyphs(DIALOG_FONT, text), [], `${sign.id}: ${page}`);
        assert.equal(letters(text), letters(page), `${sign.id}: no letters lost in "${page}"`);
      }
    }
  });

  test('wrapText fits every line, keeps every word in order and records offsets', () => {
    const text = normalizeText(SIGNS[0].pages[1]);
    for (const width of [60, 120, WRAP, 400]) {
      const lines = wrapText(text, width, measure);
      for (const l of lines) {
        assert.ok(measure(l.text) <= width, `"${l.text}" wider than ${width}`);
        assert.equal(text.slice(l.start, l.start + l.text.length), l.text);
        assert.ok(!l.text.startsWith(' ') && !l.text.endsWith(' '));
      }
      assert.deepEqual(lines.flatMap((l) => l.text.split(' ')), text.split(' '), `words at ${width}`);
    }
    assert.equal(wrapText(text, 1e6, measure).length, 1);
  });

  test('wrapText breaks words too long for a line and honours line breaks', () => {
    const long = wrapText('Supercalifragilistic', 40, measure);
    assert.ok(long.length > 1);
    assert.equal(long.map((l) => l.text).join(''), 'Supercalifragilistic');
    for (const l of long) assert.ok(measure(l.text) <= 40);
    assert.deepEqual(
      wrapText('One\n\nTwo three', 400, measure).map((l) => l.text),
      ['One', '', 'Two three'],
    );
  });

  test('paginate cuts tall pages into screens of at most maxLines lines', () => {
    const pages = ['Short title', SIGNS[0].pages[1]];
    const screens = paginate(pages, { wrap: 60, maxLines: 2 });
    assert.equal(screens[0].page, 0);
    assert.ok(screens.length > 3);
    for (const s of screens) {
      assert.ok(s.lines.length <= 2);
      assert.equal(s.length, s.lines.reduce((n, l) => n + l.text.length, 0));
      assert.equal(s.flat, s.lines.map((l) => l.text).join(''));
    }
    const page1 = screens.filter((s) => s.page === 1);
    assert.deepEqual(page1.flatMap((s) => s.lines.map((l) => l.text)).join(' '), normalizeText(pages[1]));
    assert.equal(boxLines(screens), BOX.minLines);
    assert.equal(boxLines(paginate(['x'], { wrap: WRAP })), BOX.minLines, 'at least minLines tall');
  });
});

describe('dialog box metrics', () => {
  const SIZES = [
    [960, 540, 1],
    [1920, 1080, 1],
    [720, 540, 1], // 4:3 picture
    [1280, 720, 1.5],
    [2560, 1440, 1],
    [400, 800, 1],
    [400, 740, 3],
    [320, 568, 2],
    [740, 360, 3], // phone held sideways
  ];

  test('the box fits the picture and scales with it; phones keep the text readable', () => {
    for (const [w, h, dpr] of SIZES) {
      const m = dialogMetrics(w, h, dpr);
      const tag = `${w}x${h}@${dpr}`;
      assert.ok(m.w <= w * dpr * BOX.maxFrac + 1, `${tag}: box ${m.w} px wider than the picture allows`);
      assert.ok(m.w >= w * dpr * 0.5, `${tag}: box too narrow (${m.w})`);
      const tallest = boxHeight(m, BOX.maxLines);
      assert.ok(tallest <= h * dpr * 0.5, `${tag}: a ${BOX.maxLines}-line box covers half the picture`);
      assert.ok(m.wrap * m.fp + 2 * m.padX <= m.w, `${tag}: text wider than the box`);
      assert.ok(m.s >= Math.min(BOX.minScale, Math.min(h / 240, w / 320)) - 1e-9, `${tag}: scale`);
      assert.ok(m.fp / dpr >= 1.5, `${tag}: font pixels ${m.fp / dpr} CSS px, too small to read`);
      assert.equal(m.fp, Math.round(m.fp), `${tag}: font pixels are whole device px`);
    }
  });

  // The follow camera frames the reader and the sign in the lower-middle of the picture (in
  // the game at 960x540, reading any sign: Pip at y 344-446, the board from y 335), so the
  // box sits in the upper part: under the HUD counters row and the power meter, ending above
  // BOX.clear of the picture height.
  test('the box sits in the upper part, under the HUD and clear of the reader', () => {
    const hudRow = 31; // HUD px: counters row bottom (icons at y 13, 16 px tall with outline)
    const meterBottom = 70; // HUD px: power meter with its shadow at the low-health pulse
    for (const [w, h, dpr] of SIZES) {
      const m = dialogMetrics(w, h, dpr);
      const tag = `${w}x${h}@${dpr}`;
      const hud = Math.max(0.5, Math.min(h / 240, w / 320)) * dpr; // HUD device px per HUD px
      for (const sign of SIGNS) {
        const bh = boxHeight(m, boxLines(paginate(sign.pages, { wrap: m.wrap })));
        const top = boxTop(m, bh);
        assert.ok(top >= meterBottom * hud - 1, `${tag} ${sign.id}: box top ${top} over the power meter`);
        assert.ok(top + bh <= h * dpr * BOX.clear, `${tag} ${sign.id}: box reaches the reader (${top + bh} of ${h * dpr})`);
      }
      // The tallest box too: never over the counters row, never off the picture, and clear
      // of the reader as well.
      const tallest = boxHeight(m, BOX.maxLines);
      const top = boxTop(m, tallest);
      assert.ok(top >= hudRow * hud, `${tag}: ${BOX.maxLines}-line box over the HUD row`);
      assert.ok(top + tallest <= h * dpr, `${tag}: ${BOX.maxLines}-line box off the picture`);
      assert.ok(top + tallest <= h * dpr * BOX.clear, `${tag}: ${BOX.maxLines}-line box reaches the reader`);
    }
    // 960x540: the box ends above the board and Pip (measured in the game, see above).
    const m = dialogMetrics(960, 540, 1);
    const bh = boxHeight(m, 3);
    assert.ok(boxTop(m, bh) + bh < 330, `box bottom ${boxTop(m, bh) + bh}`);
  });

  test('boxTop: a box too tall to fit under the meter rises, but not over the HUD row', () => {
    const m = dialogMetrics(960, 540, 1);
    assert.equal(boxTop(m, 100), m.top);
    const tall = m.clearY - m.top + 40;
    assert.equal(boxTop(m, tall), m.clearY - tall, 'rises to end at the clear line');
    assert.equal(boxTop(m, m.clearY), m.topMin, 'stops under the counters row');
    assert.ok(boxTop(m, 530) + 530 <= m.H, 'stays on the picture');
    assert.ok(boxTop(m, 600) >= 0);
  });

  test('lines break the same way at every landscape and 4:3 size', () => {
    const wraps = new Set(SIZES.filter(([w, h]) => w >= h).map(([w, h, d]) => dialogMetrics(w, h, d).wrap));
    assert.equal(wraps.size, 1, [...wraps].join());
    // On a desktop picture every sign page fits one screen of the box.
    for (const sign of SIGNS) {
      const screens = paginate(sign.pages, { wrap: WRAP });
      assert.equal(screens.length, sign.pages.length, sign.id);
    }
  });

  test('the box follows the devicePixelRatio at the same CSS size', () => {
    const a = dialogMetrics(960, 540, 1);
    const b = dialogMetrics(960, 540, 2);
    assert.equal(a.s, b.s);
    assert.equal(b.u, a.u * 2);
    // Whole-pixel font sizes (2.7 -> 3 at 1x, 5.4 -> 5 at 2x) keep the CSS width within ~20%.
    assert.ok(Math.abs(b.w / 2 - a.w) <= a.w * 0.2, `${a.w} vs ${b.w / 2} CSS px`);
  });

  test('snapPx gives whole device pixels, at least one', () => {
    assert.equal(snapPx(1.4), 1);
    assert.equal(snapPx(2.7), 3);
    assert.equal(snapPx(5.4), 5);
    assert.equal(snapPx(0.4), 1);
  });
});

describe('dialog logic', () => {
  test('opening plays dialog_open; the text types a few characters per tick after the grow-in', () => {
    const { logic, sfx } = makeLogic(['Hello there friend']);
    assert.equal(logic.isOpen, true);
    assert.deepEqual(sfx, ['dialog_open']);
    for (let i = 0; i < TYPING.openTicks; i++) logic.tick(false);
    assert.equal(logic.count, 0, 'nothing typed during the grow-in');
    logic.tick(false);
    assert.equal(logic.count, TYPING.charsPerTick);
    logic.tick(false);
    logic.tick(false);
    // Spaces are free: 6 visible characters in 3 ticks.
    assert.equal(logic.screen.flat.slice(0, logic.count), 'Hello t');
    assert.ok(!logic.complete);
    const n = ticksToComplete(logic);
    assert.ok(n > 0 && n < 20, `completed in ${n} more ticks`);
    assert.equal(logic.count, logic.screen.length);
  });

  test('sentence marks pause the typing briefly, but not at the end of a screen', () => {
    const plain = makeLogic(['aaaa bbbb cccc dddd']).logic;
    const marks = makeLogic(['aaaa. bbbb cccc dddd']).logic;
    const end = makeLogic(['aaaa bbbb cccc dddd.']).logic;
    const tp = ticksToComplete(plain);
    assert.ok(ticksToComplete(marks) >= tp + TYPING.pauses['.'] - 1);
    assert.ok(ticksToComplete(end) <= tp + 1);
  });

  test('text_blip plays on the first character and then every few characters, throttled', () => {
    const { logic, sfx } = makeLogic([SIGNS[0].pages[1]]);
    const ticksWithBlip = [];
    let t = 0;
    while (!logic.complete) {
      const before = sfx.length;
      logic.tick(false);
      t++;
      if (sfx.slice(before).includes('text_blip')) ticksWithBlip.push(t);
      assert.ok(sfx.slice(before).filter((n) => n === 'text_blip').length <= 1);
    }
    assert.equal(ticksWithBlip[0], TYPING.openTicks + 1, 'the first character blips');
    for (let i = 1; i < ticksWithBlip.length; i++) {
      assert.ok(ticksWithBlip[i] - ticksWithBlip[i - 1] >= TYPING.blipMinTicks, 'throttled');
    }
    const visible = logic.screen.flat.replace(/ /g, '').length;
    assert.ok(ticksWithBlip.length >= visible / (TYPING.blipEvery * 3), `${ticksWithBlip.length} blips for ${visible} characters`);
    assert.ok(ticksWithBlip.length <= Math.ceil(visible / TYPING.blipEvery) + 1);
  });

  test('a press while typing completes the page; the next press pages on', () => {
    const { logic, sfx } = makeLogic(['First page of text', 'Second page', 'Third']);
    logic.tick(false);
    assert.equal(logic.tick(true), 'complete');
    assert.equal(logic.index, 0, 'still on the first page');
    assert.ok(logic.complete);
    assert.deepEqual(sfx, ['dialog_open'], 'completing makes no page sound');
    logic.tick(false);
    assert.equal(logic.index, 0, 'a complete page waits for a press');
    assert.equal(logic.tick(true), 'next');
    assert.equal(logic.index, 1);
    assert.equal(logic.count, 0);
    assert.equal(sfx.at(-1), 'dialog_next');
    logic.tick(false);
    assert.ok(logic.count > 0, 'the next page types at once (no grow-in)');
  });

  test('closes after the last page: dialog_close, then onClose exactly once', () => {
    const { logic, sfx, closes } = makeLogic(['One', 'Two']);
    const results = [];
    for (let i = 0; i < 200 && logic.isOpen; i++) results.push(logic.tick(i % 15 === 14));
    assert.equal(logic.isOpen, false);
    assert.deepEqual(results.filter(Boolean), ['next', 'close']);
    assert.equal(closes(), 1);
    assert.deepEqual(sfx.filter((n) => n.startsWith('dialog')), ['dialog_open', 'dialog_next', 'dialog_close']);
    for (let i = 0; i < 5; i++) assert.equal(logic.tick(true), null);
    assert.equal(closes(), 1, 'later presses do nothing');
  });

  test('close() stops at once without a sound', () => {
    const { logic, sfx, closes } = makeLogic(['One', 'Two']);
    logic.close();
    assert.equal(logic.isOpen, false);
    assert.equal(logic.tick(true), null);
    assert.deepEqual(sfx, ['dialog_open']);
    assert.equal(closes(), 0);
  });

  test('relayout keeps the reading position', () => {
    const pages = ['Title', SIGNS[0].pages[1]];
    const { logic } = makeLogic(pages, { wrap: WRAP });
    logic.tick(true); // complete the title
    logic.tick(true); // page 2
    for (let i = 0; i < 15; i++) logic.tick(false);
    const shown = logic.screen.flat.slice(0, logic.count).replace(/ /g, '');
    // A phone-narrow box: page 2 now spans several screens.
    logic.relayout(paginate(pages, { wrap: 70, maxLines: 2 }));
    assert.equal(logic.screen.page, 1);
    const before = logic.screens.slice(0, logic.index).filter((s) => s.page === 1).map((s) => s.flat).join('');
    assert.equal((before + logic.screen.flat.slice(0, logic.count)).replace(/ /g, ''), shown);
    // Back to the wide box: same text shown again.
    logic.relayout(paginate(pages, { wrap: WRAP }));
    assert.equal(logic.index, 1);
    assert.equal(logic.screen.flat.slice(0, logic.count).replace(/ /g, ''), shown);
  });

  test('an empty sign still opens and closes', () => {
    const { logic, closes } = makeLogic([]);
    assert.ok(logic.isOpen && logic.complete);
    logic.tick(true);
    assert.equal(closes(), 1);
  });
});

describe('DialogBox (events, no DOM)', () => {
  const SIGN = { id: 'test', pages: ['Page one.', 'Page two is a little longer.', 'The end!'] };

  function setup() {
    const events = new Events();
    const log = { sfx: [], closed: [] };
    events.on('sfx', (e) => log.sfx.push(e.name));
    events.on('dialogClosed', (e) => log.closed.push(e));
    const box = new DialogBox(null, { events });
    return { events, box, log };
  }

  test("opens on 'signRead', pages with A or B and emits dialogClosed once after the last page", () => {
    const { events, box, log } = setup();
    assert.equal(box.isOpen, false);
    box.update(pad({ A: true })); // closed: ignored
    events.emit('signRead', { sign: SIGN });
    assert.equal(box.isOpen, true);
    assert.equal(box.page, 0);
    events.emit('signRead', { sign: { id: 'other', pages: ['x'] } });
    assert.equal(box.sign, SIGN, 'a second sign does not replace the open one');

    // Held buttons (down, not freshly pressed) never page on.
    for (let i = 0; i < 60; i++) box.update(pad({ heldA: true }));
    assert.equal(box.page, 0);
    assert.ok(box.logic.complete);

    box.update(pad({ B: true }));
    assert.equal(box.page, 1);
    box.update(pad());
    box.update(pad({ A: true })); // completes page two
    assert.equal(box.page, 1);
    assert.ok(box.logic.complete);
    box.update(pad({ A: true }));
    assert.equal(box.page, 2);
    for (let i = 0; i < 40; i++) box.update(pad());
    assert.equal(log.closed.length, 0);
    box.update(pad({ B: true }));
    assert.equal(box.isOpen, false);
    assert.deepEqual(log.closed, [{ sign: SIGN }]);
    for (let i = 0; i < 5; i++) box.update(pad({ A: true, B: true }));
    box.close();
    assert.equal(log.closed.length, 1, 'dialogClosed exactly once');
    assert.deepEqual(log.sfx.filter((n) => n !== 'text_blip'), ['dialog_open', 'dialog_next', 'dialog_next', 'dialog_close']);
    assert.ok(log.sfx.includes('text_blip'));
  });

  test('close() releases a waiting reader once (cancelled), game events close it', () => {
    const { events, box, log } = setup();
    events.emit('signRead', { sign: SIGN });
    box.close();
    assert.equal(box.isOpen, false);
    assert.deepEqual(log.closed, [{ sign: SIGN, cancelled: true }]);
    assert.ok(!log.sfx.includes('dialog_close'), 'no closing sound when the game takes the box away');
    box.close();
    assert.equal(log.closed.length, 1);

    for (const name of ['gameOver', 'gameStart']) {
      events.emit('signRead', { sign: SIGN });
      assert.equal(box.isOpen, true);
      events.emit(name, {});
      assert.equal(box.isOpen, false, name);
    }
    assert.equal(log.closed.length, 3);
  });

  test('pause freezes nothing it should not: the box keeps its page across pause/unpause', () => {
    const { events, box } = setup();
    events.emit('signRead', { sign: SIGN });
    box.update(pad({ A: true }));
    events.emit('pause', {});
    events.emit('unpause', {});
    assert.equal(box.isOpen, true);
    assert.ok(box.logic.complete);
    box.update(pad({ A: true }));
    assert.equal(box.page, 1);
  });

  test('reopens for the next sign after closing', () => {
    const { events, box, log } = setup();
    events.emit('signRead', { sign: { id: 'a', pages: ['A'] } });
    box.update(pad({ A: true })); // completes the (still empty) page
    assert.equal(box.isOpen, true);
    box.update(pad({ A: true }));
    assert.equal(box.isOpen, false);
    events.emit('signRead', { sign: { id: 'b', pages: ['B', 'C'] } });
    assert.equal(box.isOpen, true);
    assert.equal(box.sign.id, 'b');
    assert.equal(box.logic.screens.length, 2);
    assert.deepEqual(log.closed.map((e) => e.sign.id), ['a']);
  });
});
