// 曲の右クリック／⋯メニュー（各ビューで共通）

import * as store from '../core/store.js';
import * as actions from './actions.js';
import { showMenu } from '../ui/menu.js';
import { promptDialog } from '../ui/dialog.js';

export function openSongMenu(item, selected, e, anchor, { playlistId = null, allItems = null } = {}) {
  const items = selected && selected.length > 1 ? selected : [item];
  const many = items.length > 1;
  const songs = items.map(it => it.song);
  const ids = songs.map(s => s.id);
  const pl = playlistId ? store.playlistById(playlistId) : null;

  const copyTargets = store.playlists().map(p => ({
    label: `${p.icon ? p.icon + ' ' : ''}${p.name}`,
    disabled: p.id === playlistId,
    onClick: () => actions.copySongsTo(p.id, songs)
  }));
  copyTargets.push('sep', {
    label: '新しいプレイリスト…', icon: 'plus',
    onClick: async () => {
      const name = await promptDialog('', { title: '新しいプレイリスト', placeholder: 'プレイリスト名' });
      if (!name) return;
      actions.importSongs(songs.map(s => ({ ...s, id: undefined })), { mode: 'new', name });
    }
  });
  const moveTargets = pl ? store.playlists().filter(p => p.id !== playlistId).map(p => ({
    label: `${p.icon ? p.icon + ' ' : ''}${p.name}`,
    onClick: () => actions.moveSongsTo(p.id, playlistId, ids)
  })) : [];

  const menu = [
    { label: many ? `${items.length}曲を再生` : '再生', icon: 'play', onClick: () => {
      if (many) actions.playItems(items, items[0].song.id);
      else actions.playSong(item.song.id, allItems);
    } },
    { label: '次に再生', icon: 'next', onClick: () => actions.enqueue(items, { next: true }) },
    { label: 'キューに追加', icon: 'queue', onClick: () => actions.enqueue(items) },
    'sep',
    !many ? { label: '編集', icon: 'edit', hint: 'E', onClick: () => actions.openEditor(item.song.id) } : null,
    pl ? { label: '複製', icon: 'layers', onClick: () => actions.duplicateSongs(playlistId, ids) } : null,
    { label: '別のプレイリストにコピー', icon: 'library', submenu: copyTargets },
    pl && moveTargets.length ? { label: '別のプレイリストへ移動', icon: 'share', submenu: moveTargets } : null,
    'sep',
    !many ? { label: 'YouTubeで開く', icon: 'external', onClick: () => actions.openOnYouTube(item.song) } : null,
    !many ? { label: 'YouTubeリンクをコピー', icon: 'link', onClick: () => actions.copyYouTubeLink(item.song) } : null,
    pl ? 'sep' : null,
    pl ? { label: many ? `${items.length}曲を削除` : '削除', icon: 'trash', danger: true, hint: 'Del', onClick: () => actions.deleteSongs(playlistId, ids) } : null,
    !pl && item.playlists ? { label: 'このプレイリストから削除', icon: 'trash', danger: true, submenu: item.playlists.map(p => ({
      label: `${p.icon ? p.icon + ' ' : ''}${p.name}`,
      onClick: () => {
        const target = p.songs.filter(s => songs.some(x => x.videoId === s.videoId && x.start === s.start && x.end === s.end)).map(s => s.id);
        actions.deleteSongs(p.id, target);
      }
    })) } : null
  ];
  showMenu(menu.filter(Boolean), anchor ? { anchor } : { x: e.clientX, y: e.clientY });
}
