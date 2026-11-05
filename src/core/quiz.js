// イントロクイズのロジック（出題・採点・再生位置）

import { normalizeTitle } from './insights.js';
import { hasValidEnd } from './model.js';
import { isValidVideoId } from './ytid.js';

export const CHOICES = 4;

function shuffle(arr, rand) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 出題できる曲（曲名が違うものだけを1つずつ）
export function quizPool(items) {
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const s = it.song;
    if (!s || s.broken || !isValidVideoId(s.videoId) || !s.title) continue;
    const key = normalizeTitle(s.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(it);
  }
  return out;
}

// 問題を作る: [{ answer, choices: [item × 4] }]
export function buildQuiz(items, { count = 10, rand = Math.random } = {}) {
  const pool = quizPool(items);
  if (pool.length < CHOICES) throw new Error(`曲名の違う曲が${CHOICES}曲以上必要です（いま${pool.length}曲）`);
  const answers = shuffle(pool, rand).slice(0, Math.min(count, pool.length));
  return answers.map(answer => {
    const others = shuffle(pool.filter(x => x !== answer), rand).slice(0, CHOICES - 1);
    return { answer, choices: shuffle([answer, ...others], rand) };
  });
}

// 採点: 速いほど高得点、連続正解でボーナス（最大 +50%）
export function scoreAnswer({ correct, elapsedMs, limitMs, streak = 0 }) {
  if (!correct) return { points: 0, streak: 0 };
  const speed = Math.max(0, Math.min(1, 1 - elapsedMs / limitMs));
  const base = 400 + 600 * speed;
  const mult = 1 + Math.min(streak, 5) * 0.1;
  return { points: Math.round(base * mult / 10) * 10, streak: streak + 1 };
}

// 再生開始位置: 'start' は曲の頭、'random' は区間内のランダムな位置（イントロ秒数ぶんの余裕を残す）
export function quizStart(song, mode, introSec, rand = Math.random) {
  if (mode !== 'random' || !hasValidEnd(song)) return song.start;
  const room = song.end - song.start - introSec - 2;
  if (room < 4) return song.start;
  return Math.round((song.start + 1 + rand() * room) * 10) / 10;
}

export function grade(ratio) {
  if (ratio >= 1) return { label: 'PERFECT', msg: '全問正解！ 完全に耳コピ済みですね' };
  if (ratio >= 0.8) return { label: 'S', msg: 'すばらしい！ 歌枠マスター' };
  if (ratio >= 0.6) return { label: 'A', msg: 'かなりの通です' };
  if (ratio >= 0.4) return { label: 'B', msg: 'いい感じ。もう一度いけば伸びます' };
  return { label: 'C', msg: '聴き込むチャンス！ 気になった曲をキューへどうぞ' };
}
