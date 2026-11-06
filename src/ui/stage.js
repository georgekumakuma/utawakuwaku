// ステージ: 動画（2デッキ）と「再生中」の情報

import { h, icon, stars, setStars, animateText, fill } from './dom.js';
import { state } from '../core/store.js';
import * as store from '../core/store.js';
import * as actions from '../app/actions.js';
import { ctx } from '../app/context.js';
import { thumbUrl } from '../core/ytid.js';
import { formatTime } from '../core/time.js';
import { hasValidEnd } from '../core/model.js';

export function mountStage(root) {
  const bg = h('div.stage-bg');
  const video = h('div.stage-video',
    h('div.deck.active', h('div#deckA')),
    h('div.deck', h('div#deckB')),
    h('div.stage-placeholder', h('div.stage-ph-inner', h('span.brand-mark.big', '♪'), h('p', 'プレイリストから曲を選んで再生')))
  );
  const title = h('div.np-title', '—');
  const sub = h('div.np-sub');
  const chips = h('div.np-chips');
  const st = stars(1, { interactive: true, onChange: (v) => { const s = ctx.engine.state.song; if (s && !s._draft) actions.rateSong(s.id, v); } });
  const nextLine = h('div.np-next');
  const meta = h('div.stage-meta',
    h('div.np-kicker', '再生中'),
    title, sub, chips,
    h('div.np-row', st,
      h('div.np-actions',
        h('button.btn.btn-ghost.sm', { type: 'button', title: 'この曲を編集 (E)', onclick: () => { const s = ctx.engine.state.song; if (s && !s._draft) actions.openEditor(s.id); } }, icon('edit'), ' 編集'),
        h('button.btn.btn-ghost.sm', { type: 'button', title: 'YouTubeで開く', onclick: () => { const s = ctx.engine.state.song; if (s) actions.openOnYouTube(s); } }, icon('external')),
        h('button.btn.btn-ghost.sm', { type: 'button', title: '映像を隠す/表示 (V)', onclick: () => store.setSetting('showVideo', !state.settings.showVideo) }, icon('video')),
        h('button.btn.btn-ghost.sm.np-theater', { type: 'button', title: 'シアターモード (T)', onclick: () => import('./theater.js').then(m => m.openTheater()) }, icon('theater'), ' シアター')
      )),
    nextLine
  );
  const glowA = h('i'), glowB = h('i');
  const glow = h('div.stage-glow', { 'aria-hidden': 'true' }, glowA, glowB);
  const wrap = h('div.stage-wrap', glow, video);
  root.append(bg, wrap, meta);
  let glowFront = glowA;

  let lastVideoId = null;
  function render() {
    const e = ctx.engine;
    const s = e ? e.state.song : null;
    root.classList.toggle('has-song', !!s);
    root.classList.toggle('video-hidden', !state.settings.showVideo);
    if (!s) {
      title.dataset.text = '';
      title.textContent = '再生していません';
      sub.textContent = 'リストの曲をクリックすると再生が始まります。Space で再生/停止、← → で曲送り。';
      chips.replaceChildren();
      nextLine.replaceChildren();
      bg.style.backgroundImage = '';
      lastVideoId = null;
      return;
    }
    if (s.videoId !== lastVideoId) {
      lastVideoId = s.videoId;
      bg.style.backgroundImage = `url(${thumbUrl(s.videoId, 'hqdefault')})`;
      const back = glowFront === glowA ? glowB : glowA;
      back.style.backgroundImage = `url(${thumbUrl(s.videoId, 'mqdefault')})`;
      back.classList.add('on');
      glowFront.classList.remove('on');
      glowFront = back;
    }
    animateText(title, s.title || '(無題)');
    const parts = [];
    if (s.artist) parts.push(s.artist);
    if (s.article) parts.push(s.article);
    sub.textContent = parts.join(' · ');
    sub.title = sub.textContent;
    const pl = e.state.playlistId ? store.playlistById(e.state.playlistId) : null;
    fill(chips,
      pl ? h('span.chip.chip-pl', pl.icon ? pl.icon + ' ' : '', pl.name) : (s._draft ? h('span.chip', '編集中のドラフト') : null),
      h('span.chip', hasValidEnd(s) ? `${formatTime(s.start)} – ${formatTime(s.end)}` : `${formatTime(s.start)} – 最後まで`),
      ...(s.tags || []).map(t => h('span.chip.chip-tag', '#' + t)),
      s.playCount ? h('span.chip', `${s.playCount}回再生`) : null
    );
    setStars(st, s.rating);
    const nx = e.peekNext();
    fill(nextLine, nx && nx.item && nx.item.song !== s ? h('span', icon('next'), ' 次: ', h('b', nx.item.song.title), nx.from === 'queue' ? h('span.chip.sm', 'キュー') : null) : (nx && nx.from === 'repeat' ? h('span', icon('repeatOne'), ' この曲をリピート') : null));
  }

  if (ctx.engine) ctx.engine.on('change', render);
  store.on('settings', render);
  store.on('data', render);
  render();
}
