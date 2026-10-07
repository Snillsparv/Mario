// What main holds for the phone panel (ui/PhonePanel.js) while its chunk is not in (src/core/
// chunks.js `phone`: loaded once the dev or preview server's relay answers; a static host never
// loads it): main, the title card and the tests keep this slot, which answers as a closed,
// unavailable panel until attach(panel), then hands everything on. It listens for the panel's
// keys itself (window, capture phase) from where main used to build the panel, so P and the
// closing keys reach the panel before the title card's listener, as they always did.
//
//   const phone = new PhoneSlot();   phone.attach(new PhonePanel(uiRoot, { ..., keys: false }))
//   phone.panel (null until attached), .isOpen, .joined, .available, open(), close(), update(c)

export class PhoneSlot {
  constructor(win = globalThis.window) {
    this.panel = null;
    this._onKey = (e) => this.panel?._key(e);
    win?.addEventListener?.('keydown', this._onKey, true);
  }

  attach(panel) {
    this.panel ??= panel;
    return this.panel;
  }

  get isOpen() {
    return !!this.panel?.isOpen;
  }

  get joined() {
    return !!this.panel?.joined;
  }

  get available() {
    return !!this.panel?.available;
  }

  open() {
    return this.panel?.open() ?? false;
  }

  close() {
    this.panel?.close();
  }

  update(controller) {
    this.panel?.update(controller);
  }
}
