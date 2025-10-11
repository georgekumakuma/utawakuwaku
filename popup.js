// popup.js
// 時間入力用ポップアップ（物理削除方式）

// ポップアップを開く（改良版：現在の動画時間を活用）
export function showTimeEditPopup({ fieldId, value, onOk, onCancel }) {
  // 既存ポップアップ削除（多重生成防止）
  hideTimeEditPopup();

  // 動的生成
  const popup = document.createElement('div');
  popup.id = 'timeEditPopup';
  popup.style.display = 'flex';

  // 現在の動画時間を取得
  let currentTime = 0;
  let duration = 0;
  if (window.ytPlayer && window.ytPlayer.getCurrentTime) {
    currentTime = Math.floor(window.ytPlayer.getCurrentTime());
  }
  if (window.ytPlayer && window.ytPlayer.getDuration) {
    duration = Math.floor(window.ytPlayer.getDuration());
  }

  const formatTime = (sec) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}:${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}` : `${m}:${s.toString().padStart(2,'0')}`;
  };

  // 内部
  popup.innerHTML = `
    <div id="timeEditPopupInner">
      <h3 style="margin: 0 0 20px 0; color: var(--accent-primary);">時間設定</h3>
      <div style="margin-bottom: 20px; color: var(--text-secondary); font-size: 14px;">
        現在の動画位置: ${formatTime(currentTime)} / ${formatTime(duration)}
      </div>
      <div style="margin-bottom: 16px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500;">時間を入力</label>
        <input type="text" id="popupTimeInput" value="${value || ''}" 
               placeholder="例: 1:30 または 90" 
               style="width: 100%; margin-bottom: 12px;">
        <div style="font-size: 13px; color: var(--text-muted);">
          形式: mm:ss、HH:MM:SS、または秒数
        </div>
      </div>
      <div style="display: flex; gap: 12px; margin-bottom: 16px;">
        <button id="popupCurrentBtn" class="btn btn-secondary" style="flex: 1;">現在位置を設定</button>
        <button id="popupEndBtn" class="btn btn-secondary" style="flex: 1;">動画の最後</button>
      </div>
      <div style="display: flex; gap: 12px; justify-content: center;">
        <button id="popupTimeOk" class="btn btn-primary">OK</button>
        <button id="popupTimeCancel" class="btn btn-secondary">キャンセル</button>
      </div>
    </div>
  `;

  // イベント設定
  const timeInput = popup.querySelector('#popupTimeInput');
  
  // 現在位置ボタン
  popup.querySelector('#popupCurrentBtn').onclick = () => {
    timeInput.value = formatTime(currentTime);
  };
  
  // 動画の最後ボタン
  popup.querySelector('#popupEndBtn').onclick = () => {
    timeInput.value = formatTime(duration);
  };

  // OK/キャンセルイベント
  popup.querySelector('#popupTimeOk').onclick = () => {
    const val = timeInput.value.trim();
    if (!val.match(/^(\d{1,3}:\d{1,2}:\d{1,2}|\d{1,3}:\d{1,2}|\d+)$/)) {
      showToast('mm:ss、HH:MM:SS、または秒で入力してください');
      return;
    }
    onOk && onOk(val);
    hideTimeEditPopup();
  };
  
  popup.querySelector('#popupTimeCancel').onclick = () => {
    onCancel && onCancel();
    hideTimeEditPopup();
  };
  
  // 外側クリックでもキャンセル
  popup.onclick = (e) => {
    if (e.target === popup) {
      onCancel && onCancel();
      hideTimeEditPopup();
    }
  };

  // Enterキーで確定
  timeInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      popup.querySelector('#popupTimeOk').click();
    }
  });

  document.body.appendChild(popup);
  setTimeout(() => timeInput.focus(), 10);
}

// トースト通知を表示する関数（ここにも追加）
function showToast(message) {
  const toast = document.getElementById('toast');
  if (toast) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

// ポップアップを物理削除
export function hideTimeEditPopup() {
  const popup = document.getElementById('timeEditPopup');
  if (popup) popup.remove();
  // 追加：フォームの全inputのpointer-events, user-selectをリセット
  document.querySelectorAll('#songForm input, #songForm textarea').forEach(inp => {
    inp.style.pointerEvents = '';
    inp.style.userSelect = '';
    inp.readOnly = false;
    inp.disabled = false;
  });
}

