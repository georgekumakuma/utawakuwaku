// 仮想スクロール付きの曲リスト
// 数千曲でも軽快に動くよう、見えている行だけを DOM に置き、行要素は ID キーで再利用する。
// 選択（Ctrl/Shift クリック）、キーボード操作、ポインタによる並べ替え、コンテキストメニューに対応。

import { h, icon, stars, setStars, highlightInto, rafThrottle } from './dom.js';
import { formatTime, formatRelative } from '../core/time.js';
import { hasValidEnd } from '../core/model.js';
import { thumbUrl } from '../core/ytid.js';

const OVERSCAN = 6;

export class SongList {
  constructor(container, opts = {}) {
    this.c = container;
    this.opts = {
      rowHeight: 60,
      showIndex: true,
      showRange: true,
      showRating: true,
      showPlaylist: false,
      showPlayedAt: false,
      showRemove: false,
      draggable: false,
      query: '',
      onActivate: null,       // (item, index, e)
      onContextMenu: null,    // (item, selectedItems, e, anchor)
      onRate: null,           // (item, rating)
      onReorder: null,        // (ids, toIndex)
      onRemove: null,         // (item, index)
      onSelectionChange: null,
      emptyContent: null,
      ...opts
    };
    this.items = [];
    this.rows = new Map();      // key → rowEl
    this.selection = new Set();
    this.anchor = null;
    this.activeId = null;
    this.focusIndex = -1;
    this.drag = null;

    this.c.classList.add('songlist');
    this.c.tabIndex = 0;
    this.c.style.setProperty('--row-h', this.opts.rowHeight + 'px');
    this.spacer = h('div.songlist-spacer');
    this.empty = h('div.songlist-empty');
    this.dropLine = h('div.drop-line');
    this.c.append(this.spacer, this.empty, this.dropLine);

    this.renderWindow = rafThrottle(() => this._render());
    this.c.addEventListener('scroll', this.renderWindow, { passive: true });
    this.ro = new ResizeObserver(() => this.renderWindow());
    this.ro.observe(this.c);
    this.c.addEventListener('keydown', (e) => this._onKey(e));
    this.c.addEventListener('pointerdown', (e) => this._onPointerDown(e));
  }

  destroy() { this.ro.disconnect(); }

  setItems(items, { keepScroll = true } = {}) {
    this.items = items;
    const valid = new Set(items.map(it => it.song.id));
    for (const id of Array.from(this.selection)) if (!valid.has(id)) this.selection.delete(id);
    this.spacer.style.height = (items.length * this.opts.rowHeight) + 'px';
    this.empty.style.display = items.length ? 'none' : '';
    if (!items.length) {
      this.empty.replaceChildren(this.opts.emptyContent ? (typeof this.opts.emptyContent === 'function' ? this.opts.emptyContent() : this.opts.emptyContent) : h('div', 'まだ曲がありません'));
    }
    if (!keepScroll) this.c.scrollTop = 0;
    this._render();
  }

  setQuery(q) { this.opts.query = q; this._render(true); }
  setActive(id) {
    if (this.activeId === id) return;
    this.activeId = id;
    this._render(true);
  }
  setRowHeight(hpx) {
    if (this.opts.rowHeight === hpx) return;
    this.opts.rowHeight = hpx;
    this.c.style.setProperty('--row-h', hpx + 'px');
    this.spacer.style.height = (this.items.length * hpx) + 'px';
    this.rows.forEach(r => r.remove());
    this.rows.clear();
    this._render();
  }

  selectedItems() { return this.items.filter(it => this.selection.has(it.song.id)); }
  clearSelection() { this.selection.clear(); this._render(true); this._emitSel(); }
  selectAll() { this.items.forEach(it => this.selection.add(it.song.id)); this._render(true); this._emitSel(); }
  _emitSel() { this.opts.onSelectionChange && this.opts.onSelectionChange(this.selection); }

  scrollToId(id, { center = true } = {}) {
    const i = this.items.findIndex(it => it.song.id === id);
    if (i < 0) return;
    const rh = this.opts.rowHeight;
    const top = i * rh;
    const vh = this.c.clientHeight;
    if (center) this.c.scrollTop = Math.max(0, top - vh / 2 + rh / 2);
    else if (top < this.c.scrollTop) this.c.scrollTop = top;
    else if (top + rh > this.c.scrollTop + vh) this.c.scrollTop = top + rh - vh;
    this.focusIndex = i;
    this._render(true);
  }

  // ===== 描画 =====
  _render(force = false) {
    const rh = this.opts.rowHeight;
    const n = this.items.length;
    const top = this.c.scrollTop;
    const vh = this.c.clientHeight || 600;
    const first = Math.max(0, Math.floor(top / rh) - OVERSCAN);
    const last = Math.min(n - 1, Math.ceil((top + vh) / rh) + OVERSCAN);
    const keep = new Set();
    for (let i = first; i <= last; i++) {
      const item = this.items[i];
      const key = item.song.id;
      keep.add(key);
      let row = this.rows.get(key);
      if (!row) {
        row = this._createRow();
        this.rows.set(key, row);
        this.c.appendChild(row);
        force = true;
      }
      if (force || row._index !== i || row._item !== item || row._version !== this._versionOf(item)) {
        this._bind(row, item, i);
      }
    }
    for (const [key, row] of this.rows) {
      if (!keep.has(key)) { row.remove(); this.rows.delete(key); }
    }
  }

  _versionOf(item) {
    const s = item.song;
    return `${s.title}|${s.artist}|${s.article}|${s.start}|${s.end}|${s.rating}|${(s.tags || []).join(',')}|${s.playCount}|${item.at || ''}`;
  }

  _createRow() {
    const o = this.opts;
    const row = h('div.row', { role: 'row' },
      h('div.row-idx', o.draggable ? icon('grip', 'row-grip') : null, h('span.row-num'), h('span.row-eq', h('i'), h('i'), h('i'))),
      h('div.row-thumb', h('img', { loading: 'lazy', alt: '', draggable: false }), h('span.row-thumb-play', icon('play'))),
      h('div.row-main',
        h('div.row-title'),
        h('div.row-sub', h('span.row-artist'), h('span.row-article'), h('span.row-sub-range'))
      ),
      h('div.row-extra'),
      h('div.row-range', h('span.row-time'), h('span.row-len')),
      h('div.row-rating'),
      h('div.row-actions',
        o.showRemove ? h('button.icon-btn.row-remove', { type: 'button', title: 'キューから削除' }, icon('close')) : null,
        h('button.icon-btn.row-more', { type: 'button', title: 'メニュー' }, icon('more'))
      )
    );
    row.querySelector('img').addEventListener('error', (e) => { e.target.style.visibility = 'hidden'; });
    row.addEventListener('click', (e) => this._onRowClick(e, row));
    row.addEventListener('dblclick', (e) => { e.preventDefault(); });
    row.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this._ensureSelected(row._item);
      o.onContextMenu && o.onContextMenu(row._item, this.selectedItems(), e, null);
    });
    row.querySelector('.row-more').addEventListener('click', (e) => {
      e.stopPropagation();
      this._ensureSelected(row._item);
      o.onContextMenu && o.onContextMenu(row._item, this.selectedItems(), e, e.currentTarget);
    });
    const rm = row.querySelector('.row-remove');
    if (rm) rm.addEventListener('click', (e) => { e.stopPropagation(); o.onRemove && o.onRemove(row._item, row._index); });
    if (o.showRating) {
      const st = stars(1, { interactive: !!o.onRate, onChange: (v) => o.onRate && o.onRate(row._item, v) });
      row.querySelector('.row-rating').appendChild(st);
    }
    return row;
  }

  _bind(row, item, i) {
    const o = this.opts;
    const s = item.song;
    row._item = item;
    row._index = i;
    row._version = this._versionOf(item);
    row.dataset.id = s.id;
    row.setAttribute('aria-rowindex', String(i + 1));
    row.style.transform = `translateY(${i * o.rowHeight}px)`;
    row.classList.toggle('active', s.id === this.activeId);
    row.classList.toggle('selected', this.selection.has(s.id));
    row.classList.toggle('focused', i === this.focusIndex);
    row.classList.toggle('from-queue', !!item.fromQueue);
    row.querySelector('.row-num').textContent = o.showIndex ? String(i + 1) : '';
    const img = row.querySelector('img');
    const src = thumbUrl(s.videoId, 'default');
    if (img.getAttribute('src') !== src) { img.style.visibility = ''; img.src = src; }
    highlightInto(row.querySelector('.row-title'), s.title || '(無題)', o.query);
    row.querySelector('.row-title').title = s.title || '';
    const artistEl = row.querySelector('.row-artist');
    const articleEl = row.querySelector('.row-article');
    highlightInto(artistEl, s.artist || '', o.query);
    artistEl.style.display = s.artist ? '' : 'none';
    highlightInto(articleEl, s.article || '', o.query);
    articleEl.title = s.article || '';
    const extra = row.querySelector('.row-extra');
    extra.replaceChildren();
    if (o.showPlaylist && item.playlists) {
      for (const p of item.playlists.slice(0, 2)) extra.appendChild(h('span.chip.chip-pl', { title: p.name }, p.icon ? p.icon + ' ' : '', p.name));
      if (item.playlists.length > 2) extra.appendChild(h('span.chip', `+${item.playlists.length - 2}`));
    }
    if (o.showPlayedAt && item.at) extra.appendChild(h('span.row-played', formatRelative(item.at)));
    if (s.tags && s.tags.length && !o.showPlaylist) {
      for (const t of s.tags.slice(0, 3)) extra.appendChild(h('span.chip.chip-tag', '#' + t));
    }
    if (o.showRange) {
      const valid = hasValidEnd(s);
      row.querySelector('.row-time').textContent = valid ? `${formatTime(s.start)}–${formatTime(s.end)}` : `${formatTime(s.start)}–最後`;
      row.querySelector('.row-len').textContent = valid ? formatTime(s.end - s.start) : '';
      row.querySelector('.row-sub-range').textContent = valid ? formatTime(s.end - s.start) : '最後まで';
    }
    if (o.showRating) setStars(row.querySelector('.stars'), s.rating);
  }

  // ===== クリック・選択 =====
  _onRowClick(e, row) {
    if (e.target.closest('.row-actions') || e.target.closest('.stars')) return;
    const item = row._item;
    const i = row._index;
    const multi = e.ctrlKey || e.metaKey;
    if (multi) {
      if (this.selection.has(item.song.id)) this.selection.delete(item.song.id);
      else this.selection.add(item.song.id);
      this.anchor = i;
      this.focusIndex = i;
      this._render(true); this._emitSel();
      return;
    }
    if (e.shiftKey && this.anchor != null) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      for (let k = a; k <= b; k++) this.selection.add(this.items[k].song.id);
      this.focusIndex = i;
      this._render(true); this._emitSel();
      return;
    }
    this.selection.clear();
    this.selection.add(item.song.id);
    this.anchor = i;
    this.focusIndex = i;
    this._render(true); this._emitSel();
    this.opts.onActivate && this.opts.onActivate(item, i, e);
  }

  _ensureSelected(item) {
    if (!this.selection.has(item.song.id)) {
      this.selection.clear();
      this.selection.add(item.song.id);
      this._render(true); this._emitSel();
    }
  }

  _onKey(e) {
    if (!this.items.length) return;
    const n = this.items.length;
    const move = (to, extend) => {
      to = Math.max(0, Math.min(n - 1, to));
      if (!extend) this.selection.clear();
      this.selection.add(this.items[to].song.id);
      this.focusIndex = to;
      if (!extend) this.anchor = to;
      this.scrollToId(this.items[to].song.id, { center: false });
      this._emitSel();
    };
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(this.focusIndex + 1, e.shiftKey); break;
      case 'ArrowUp': e.preventDefault(); move(this.focusIndex - 1, e.shiftKey); break;
      case 'Home': e.preventDefault(); move(0, e.shiftKey); break;
      case 'End': e.preventDefault(); move(n - 1, e.shiftKey); break;
      case 'PageDown': e.preventDefault(); move(this.focusIndex + Math.floor(this.c.clientHeight / this.opts.rowHeight), e.shiftKey); break;
      case 'PageUp': e.preventDefault(); move(this.focusIndex - Math.floor(this.c.clientHeight / this.opts.rowHeight), e.shiftKey); break;
      case 'Enter': {
        e.preventDefault();
        const it = this.items[this.focusIndex];
        if (it) this.opts.onActivate && this.opts.onActivate(it, this.focusIndex, e);
        break;
      }
      case 'a': case 'A':
        if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.selectAll(); }
        break;
      case 'Escape':
        if (this.selection.size) { e.preventDefault(); this.clearSelection(); }
        break;
      default: break;
    }
  }

  // ===== 並べ替え（ポインタドラッグ）=====
  _onPointerDown(e) {
    if (!this.opts.draggable || !this.opts.onReorder) return;
    const grip = e.target.closest('.row-grip');
    const row = e.target.closest('.row');
    if (!row) return;
    // つまみ、または（タッチ以外で）行全体の長押しなしドラッグはつまみのみ
    if (!grip && e.pointerType !== 'mouse') return;
    if (!grip) return;
    e.preventDefault();
    const item = row._item;
    const ids = this.selection.has(item.song.id) ? this.items.filter(it => this.selection.has(it.song.id)).map(it => it.song.id) : [item.song.id];
    const rh = this.opts.rowHeight;
    const rect = this.c.getBoundingClientRect();
    this.drag = { ids, toIndex: row._index, pointerId: e.pointerId, startY: e.clientY, moved: false };
    this.c.setPointerCapture(e.pointerId);
    this.c.classList.add('dragging');
    ids.forEach(id => { const r = this.rows.get(id); if (r) r.classList.add('drag-src'); });

    const onMove = (ev) => {
      if (!this.drag) return;
      if (Math.abs(ev.clientY - this.drag.startY) > 3) this.drag.moved = true;
      const y = ev.clientY - rect.top + this.c.scrollTop;
      let to = Math.round(y / rh);
      to = Math.max(0, Math.min(this.items.length, to));
      this.drag.toIndex = to;
      this.dropLine.style.display = 'block';
      this.dropLine.style.transform = `translateY(${to * rh}px)`;
      // 端に近ければ自動スクロール
      const edge = 40;
      if (ev.clientY < rect.top + edge) this.c.scrollTop -= 8;
      else if (ev.clientY > rect.bottom - edge) this.c.scrollTop += 8;
    };
    const onUp = () => {
      const d = this.drag;
      this.drag = null;
      this.c.classList.remove('dragging');
      this.dropLine.style.display = 'none';
      this.rows.forEach(r => r.classList.remove('drag-src'));
      this.c.removeEventListener('pointermove', onMove);
      this.c.removeEventListener('pointerup', onUp);
      this.c.removeEventListener('pointercancel', onUp);
      try { this.c.releasePointerCapture(d.pointerId); } catch { /* ignore */ }
      if (d.moved) this.opts.onReorder(d.ids, d.toIndex);
    };
    this.c.addEventListener('pointermove', onMove);
    this.c.addEventListener('pointerup', onUp);
    this.c.addEventListener('pointercancel', onUp);
  }
}
