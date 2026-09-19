const DEFAULT_MODULE = 'https://cdn.jsdelivr.net/npm/@tanstack/virtual-core@3.17.9/+esm';

/** Thin vanilla adapter around TanStack Virtual Core. */
export class VirtualScriptList {
  constructor(viewport, inner, renderRow, options = {}) {
    this.viewport = viewport;
    this.inner = inner;
    this.renderRow = renderRow;
    this.moduleSpecifier = options.moduleSpecifier || DEFAULT_MODULE;
    this.overscan = options.overscan ?? 12;
    this.rows = [];
    this.virtualizer = null;
    this.cleanup = null;
    this.module = null;
    this.raf = 0;
  }

  async ensure() {
    if (this.virtualizer) return;
    if (!this.module) this.module = await import(this.moduleSpecifier);
    const { Virtualizer, observeElementRect, observeElementOffset, elementScroll } = this.module;
    const makeOptions = () => ({
      count: this.rows.length,
      getScrollElement: () => this.viewport,
      estimateSize: index => {
        const row = this.rows[index];
        if (!row) return 42;
        if (Number.isFinite(row.estimateSize)) return row.estimateSize;
        if (row.kind === 'drop-end') return 40;
        return row.kind === 'line' ? 44 : 32;
      },
      getItemKey: index => this.rows[index]?.key || `virtual-${index}`,
      overscan: this.overscan,
      observeElementRect,
      observeElementOffset,
      scrollToFn: elementScroll,
      onChange: () => this.scheduleRender()
    });
    this.makeOptions = makeOptions;
    this.virtualizer = new Virtualizer(makeOptions());
    this.cleanup = this.virtualizer._didMount();
    this.virtualizer._willUpdate();
  }

  async setRows(rows) {
    this.rows = rows;
    await this.ensure();
    this.virtualizer.setOptions(this.makeOptions());
    this.virtualizer._willUpdate();
    this.render();
  }

  scheduleRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  render() {
    if (!this.virtualizer) return;
    this.inner.innerHTML = '';
    this.inner.style.height = `${Math.ceil(this.virtualizer.getTotalSize())}px`;
    this.inner.style.position = 'relative';
    const fragment = document.createDocumentFragment();
    for (const item of this.virtualizer.getVirtualItems()) {
      const row = this.rows[item.index];
      if (!row) continue;
      const node = this.renderRow(row);
      node.classList.add('virtual-row');
      node.style.position = 'absolute';
      node.style.top = '0';
      node.style.left = '0';
      node.style.width = '100%';
      node.style.transform = `translateY(${Math.round(item.start)}px)`;
      fragment.append(node);
    }
    this.inner.append(fragment);
  }

  scrollToKey(key, align = 'auto') {
    if (!this.virtualizer) return false;
    const index = this.rows.findIndex(row => row.key === key);
    if (index < 0) return false;
    this.virtualizer.scrollToIndex(index, { align });
    return true;
  }

  destroy() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    try { this.cleanup?.(); } catch {}
    this.cleanup = null;
    this.virtualizer = null;
    this.inner.style.height = '';
    this.inner.style.position = '';
  }
}
