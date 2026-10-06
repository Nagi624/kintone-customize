/*
 * 社内マニュアル(app33) 添付の動画をその場で再生する  PC/スマホ両対応
 *
 * - 詳細画面で、添付ファイルに動画(mp4など)があれば、添付欄の下に「▶ 再生」の一覧とプレーヤーを出す。
 * - 押した動画だけを kintone からブラウザのメモリに読み込んで再生する(ファイルとしては保存されない)。
 *   <video src="/k/v1/file.json?..."> では、ブラウザのログイン状態でのファイル取得がCSRF対策で拒否されるため、
 *   X-Requested-With ヘッダー付きの XMLHttpRequest で取得し、Blob の URL を再生する。
 */
(function () {
  'use strict';

  var FIELD = '添付';
  var BOX_ID = 'manual-video-box';
  var IS_MOBILE = false;
  var currentUrl = null;

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  function isVideo(f) {
    return /^video\//.test(f.contentType || '') || /\.(mp4|m4v|webm|mov)$/i.test(f.name || '');
  }

  function sizeText(bytes) {
    var mb = Number(bytes) / 1048576;
    return mb >= 1 ? mb.toFixed(1) + 'MB' : Math.max(1, Math.round(Number(bytes) / 1024)) + 'KB';
  }

  function loadBlob(fileKey, onProgress) {
    return new kintone.Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', kintone.api.url('/k/v1/file', true) + '?fileKey=' + encodeURIComponent(fileKey));
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
      xhr.responseType = 'blob';
      xhr.onprogress = function (e) { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
      xhr.onload = function () { xhr.status === 200 ? resolve(xhr.response) : reject(new Error('HTTP ' + xhr.status)); };
      xhr.onerror = function () { reject(new Error('通信エラー')); };
      xhr.send();
    });
  }

  function build(videos) {
    var box = document.createElement('div');
    box.id = BOX_ID;
    box.style.cssText = 'margin:12px ' + (IS_MOBILE ? '12px' : '0') + ';padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;max-width:960px';
    var head = document.createElement('div');
    head.textContent = '🎬 動画をこの画面で見る(▶ を押すと再生します)';
    head.style.cssText = 'font-weight:bold;margin-bottom:8px;font-size:14px';
    var player = document.createElement('video');
    player.controls = true;
    player.playsInline = true;
    player.style.cssText = 'display:none;width:100%;max-height:540px;background:#000;border-radius:6px;margin-bottom:8px';
    var status = document.createElement('div');
    status.style.cssText = 'font-size:13px;color:#475569;margin-bottom:8px;display:none';
    var list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;gap:4px';
    box.appendChild(head);
    box.appendChild(player);
    box.appendChild(status);
    box.appendChild(list);

    videos.forEach(function (f) {
      var row = document.createElement('button');
      row.type = 'button';
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;text-align:left;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px';
      var name = document.createElement('span');
      name.textContent = '▶ ' + f.name.replace(/\.[^.]+$/, '');
      var size = document.createElement('span');
      size.textContent = sizeText(f.size);
      size.style.color = '#94a3b8';
      row.appendChild(name);
      row.appendChild(size);
      row.addEventListener('click', function () {
        [].forEach.call(list.children, function (x) { x.style.background = '#fff'; });
        row.style.background = '#e0e7ff';
        status.style.display = 'block';
        status.textContent = '読み込み中… 0%';
        player.pause();
        loadBlob(f.fileKey, function (pct) { status.textContent = '読み込み中… ' + pct + '%'; }).then(function (blob) {
          if (currentUrl) URL.revokeObjectURL(currentUrl);
          currentUrl = URL.createObjectURL(new Blob([blob], { type: f.contentType || 'video/mp4' }));
          player.src = currentUrl;
          player.style.display = 'block';
          status.textContent = '再生中: ' + f.name.replace(/\.[^.]+$/, '');
          player.play().catch(function () { /* 自動再生が止められた場合は ▶ を押してもらう */ });
          player.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }).catch(function (err) {
          status.textContent = '動画を読み込めませんでした(' + err.message + ')。添付のファイル名を押すとダウンロードして見られます。';
        });
      });
      list.appendChild(row);
    });
    return box;
  }

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    // スマホは画面遷移しても前の表示が残ることがあるため作り直す
    var old = document.getElementById(BOX_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    var videos = fv(event.record, FIELD, []).filter(isVideo);
    if (!videos.length) return event;
    var el = IS_MOBILE ? kintone.mobile.app.record.getFieldElement(FIELD) : kintone.app.record.getFieldElement(FIELD);
    var box = build(videos);
    if (el && el.parentNode) {
      el.parentNode.insertBefore(box, el.nextSibling);
    } else {
      var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
      if (space) space.appendChild(box);
    }
    return event;
  });
})();
