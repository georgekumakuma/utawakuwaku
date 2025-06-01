// popup.js
// 時間入力用ポップアップ（物理削除方式）

// ポップアップを開く
export function showTimeEditPopup({ fieldId, value, onOk, onCancel }) {
  // 既存ポップアップ削除（多重生成防止）
  hideTimeEditPopup();

  // 動的生成
  const popup = document.createElement('div');
  popup.id = 'timeEditPopup';
  popup.style.display = 'flex';
  popup.style.position = 'fixed';
  popup.style.top = 0;
  popup.style.left = 0;
  popup.style.width = '100vw';
  popup.style.height = '100vh';
  popup.style.background = '#000a';
  popup.style.zIndex = 10000;
  popup.style.justifyContent = 'center';
  popup.style.alignItems = 'center';

  // 内部
  popup.innerHTML = `
    <div id="timeEditPopupInner" style="background:#232944;padding:24px 32px;border-radius:13px;box-shadow:0 2px 32px #000b;color:#fff; min-width:260px; text-align:center;">
      <div style="margin-bottom:8px;" id="popupLabel">時間を入力（mm:ss または HH:MM:SS または 秒）</div>
      <input type="text" id="popupTimeInput" value="${value || ''}" style="font-size:1.1em;padding:6px 12px;border-radius:7px;border:1.3px solid #456;min-width:95px;background:#1a2238; color:#fff;margin-bottom:10px;">
      <div style="margin-top:16px;text-align:center;">
        <button id="popupTimeOk">OK</button>
        <button id="popupTimeCancel">キャンセル</button>
      </div>
    </div>
  `;

  // OK/キャンセルイベント
  popup.querySelector('#popupTimeOk').onclick = () => {
    const val = popup.querySelector('#popupTimeInput').value.trim();
    // 入力バリデーション（必要ならカスタマイズ）
    if (!val.match(/^(\d{1,3}:\d{1,2}:\d{1,2}|\d{1,3}:\d{1,2}|\d+)$/)) {
      alert('mm:ss、HH:MM:SS、または秒で入力してください');
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

  document.body.appendChild(popup);
  setTimeout(() => popup.querySelector('#popupTimeInput').focus(), 10);
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

