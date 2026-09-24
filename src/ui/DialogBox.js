// PLACEHOLDER — replaced by the N64-style dialog box. Contract (docs/ARCHITECTURE.md):
//   new DialogBox(root, { events }); listens for 'signRead' { sign } and opens sign.pages
//   dialog.isOpen; dialog.update(controller) per 30 Hz tick while open (A/B advance)
//   emits 'dialogClosed' { sign } after the last page; dialog.close() closes at once.
export class DialogBox {
  constructor(root, { events } = {}) {
    this.events = events;
    this.isOpen = false;
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:absolute;left:10%;right:10%;bottom:8%;padding:16px 20px;background:#000b;color:#fff;font:600 20px/1.4 system-ui,sans-serif;border-radius:10px;display:none';
    root.appendChild(this.el);
    events?.on('signRead', ({ sign }) => this.open(sign));
  }

  open(sign) {
    this.sign = sign;
    this.page = 0;
    this.isOpen = true;
    this.el.style.display = 'block';
    this.el.textContent = sign.pages[0];
  }

  update(c) {
    if (!this.isOpen || !(c.A.pressed || c.B.pressed)) return;
    this.page++;
    if (this.page < this.sign.pages.length) this.el.textContent = this.sign.pages[this.page];
    else {
      this.close();
      this.events?.emit('dialogClosed', { sign: this.sign });
    }
  }

  close() {
    this.isOpen = false;
    this.el.style.display = 'none';
  }
}
