// プライバシーと利用規約（YouTube API サービスの利用に必要な表示を含む）

import { h } from './dom.js';
import { openModal } from './dialog.js';

const YT_TERMS = 'https://www.youtube.com/t/terms';
const GOOGLE_PRIVACY = 'https://policies.google.com/privacy';

export function privacyLinks() {
  return h('span.privacy-links',
    'YouTube API サービスを使用しています（',
    h('a', { href: YT_TERMS, target: '_blank', rel: 'noopener' }, 'YouTube 利用規約'), '・',
    h('a', { href: GOOGLE_PRIVACY, target: '_blank', rel: 'noopener' }, 'Google プライバシーポリシー'), '）');
}

export function openPrivacy() {
  const sec = (title, ...body) => h('section.privacy-sec', h('h4', title), ...body);
  const content = h('div.privacy',
    sec('保存するデータ',
      h('p', 'プレイリスト・再生履歴・設定は、このブラウザの中（IndexedDB）にだけ保存します。作者のサーバーに送ることはありません。ブラウザのデータを消すと失われるため、設定の「バックアップ」で保存できます。')),
    sec('YouTube（再生・サムネイル）',
      h('p', '曲の再生には YouTube 公式の埋め込みプレイヤーを使い、再生時やサムネイル表示時に YouTube に接続します。YouTube の利用には YouTube 利用規約が適用されます。')),
    sec('YouTube API サービス（「セトリを探す」）',
      h('p', 'このアプリは YouTube API サービスを使用しています。「セトリを探す」を押したときだけ、その動画の公開情報（タイトル・チャンネル名・概要欄・長さ・上位のコメント）を読み取ります。Google アカウントへのログインや、あなたのアカウントの情報は使いません。'),
      h('p', '読み取った概要欄やコメントの文章は保存せず、その場でセットリスト（曲名と時刻）に変換するためだけに使います。保存されるのは、あなたが取り込んだ曲の情報だけです。'),
      h('p', '利用にあたっては ', h('a', { href: YT_TERMS, target: '_blank', rel: 'noopener' }, 'YouTube 利用規約'), ' に同意したものとみなされます。Google によるデータの扱いは ', h('a', { href: GOOGLE_PRIVACY, target: '_blank', rel: 'noopener' }, 'Google プライバシーポリシー'), ' をご覧ください。')),
    sec('Apple（「曲間をカット」）',
      h('p', '原曲の長さを調べるため、曲名とアーティスト名だけを Apple の iTunes Search API に送ります。結果はこの端末に保存し、同じ曲を二度問い合わせません。')),
    sec('共有バンク',
      h('p', '「URLでバンクを追加」で登録した URL（Googleスプレッドシートなど）から、プレイリストを読み込みます。')),
    sec('お問い合わせ',
      h('p', '不具合報告・ご要望は、アプリの readme に記載の連絡先までお願いします。'))
  );
  openModal({ title: 'プライバシーと利用規約', content, size: 'md' });
}
