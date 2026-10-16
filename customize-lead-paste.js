/*
 * ネタリスト(app29) 一覧画面「📋 Googleマップから貼り付けて登録」  PC/スマホ両対応(2026-10-16)
 *
 * Googleマップでコピーした文字(スマホのアプリの「共有」→コピーはURLだけ。その場合はリンク先から店名、位置から住所を補う)を貼ると、店名・電話・〒・都道府県・市区町村・丁目番地等・URLを
 * 読み取ってネタを1件登録する(読み取り・重複チェックは customize-maps-paste.js と共用。同じアプリに登録が必要)。
 * - 電話した場合は結果も選べる → 架電履歴に1行(日付=今日・時刻・担当=自分・種別=電話)。選ばなければ未着手で登録
 * - 顧客管理・ネタリストに同じお店(会社名か電話番号)があれば登録させず、そちらを案内する
 * - 確認ステータス=稼働中・確認者=自分・業種確認メモ「Googleマップから登録」。座標は毎時の自動処理で入る
 * - GoogleのAPIは使わない(取得値は規約で30日を超えて保存できない。利用者が貼った文字だけを読む)
 */
(function () {
  'use strict';

  var LEAD_APP_ID = 29;
  var CUSTOMER_APP_ID = 18;
  var RESULTS = ['架電済み', '不通・不在', 'ネタ', '獲得', '失注', '受付ブロック'];
  var IS_MOBILE = false;

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function api(path, method, params) { return kintone.api(kintone.api.url(path, true), method, params); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function nowHm() { var d = new Date(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function MP() {
    if (!window.TaimeiMapsPaste) throw new Error('customize-maps-paste.js が読み込まれていません');
    return window.TaimeiMapsPaste;
  }
  function recUrl(app, id) { return IS_MOBILE ? '/k/m/' + app + '/show?record=' + id : '/k/' + app + '/show#record=' + id; }

  function injectStyle() {
    if (document.getElementById('lp-style')) return;
    var s = document.createElement('style');
    s.id = 'lp-style';
    s.textContent = [
      '.lp-bg{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px}',
      '.lp-modal{background:#fff;border-radius:10px;padding:16px;width:100%;max-width:520px;max-height:calc(100vh - 24px);overflow:auto;font-size:14px;color:#1e293b;box-shadow:0 10px 30px rgba(0,0,0,.25);box-sizing:border-box}',
      '.lp-modal h3{margin:0 0 4px;font-size:16px}.lp-sub{color:#64748b;font-size:12px;margin-bottom:10px}',
      '.lp-modal label{display:block;color:#475569;margin:12px 0 5px;font-size:13px}',
      '.lp-modal input,.lp-modal select,.lp-modal textarea{width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box;font-size:14px;font-family:inherit}',
      '.lp-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}.lp-row3{display:grid;grid-template-columns:1fr 1fr 2fr;gap:8px}',
      '.lp-box{margin-top:12px;padding:10px 12px;border-radius:8px;border:1px solid #cbd5e1;background:#f8fafc}',
      '.lp-warn{border-color:#fca5a5;background:#fef2f2;color:#b91c1c}',
      '.lp-results{display:flex;flex-wrap:wrap;gap:6px}',
      '.lp-results button{padding:7px 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:13px}',
      '.lp-results button.on{background:#1e293b;color:#fff;border-color:#1e293b}',
      '.lp-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
      '.lp-btns button{padding:9px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:14px}',
      '.lp-btns button.primary{border-color:#2563eb;background:#2563eb;color:#fff}.lp-btns button:disabled{opacity:.5}'
    ].join('\n');
    document.head.appendChild(s);
  }

  function openDialog() {
    var props = {};
    var bg = document.createElement('div');
    bg.className = 'lp-bg';
    var m = document.createElement('div');
    m.className = 'lp-modal';
    m.innerHTML = '<h3>📋 Googleマップから貼り付けて登録</h3>' +
      '<div class="lp-sub">Googleマップでお店を開き、店名〜電話番号の部分をコピー(スマホ・iPadは「共有」→コピー)して貼り付けると読み取ります。手で入れても直してもかまいません。</div>' +
      '<textarea class="p-paste" placeholder="ここに貼り付け(URLだけでも可)" style="min-height:64px"></textarea><div class="p-note lp-sub" style="margin:6px 0 0"></div>' +
      '<label>会社名・店名(必須)</label><input type="text" class="p-name">' +
      '<div class="lp-row2"><div><label>電話番号</label><input type="tel" class="p-phone"></div><div><label>大分類</label><select class="p-cat"></select></div></div>' +
      '<label>中分類(大分類を選ぶと候補が出ます)</label><select class="p-sub"></select>' +
      '<div class="lp-row3"><div><label>〒</label><input type="text" class="p-zip"></div><div><label>都道府県</label><input type="text" class="p-pref" value="北海道"></div><div><label>市区町村</label><input type="text" class="p-city"></div></div>' +
      '<label>丁目番地等</label><input type="text" class="p-rest">' +
      '<label>GoogleマップのURL(あれば)</label><input type="url" class="p-url">' +
      '<div class="p-dup"></div>' +
      '<div class="lp-box"><b>電話した場合だけ</b>:結果を選ぶと架電履歴にも残ります(選ばなければ「未着手」で登録)' +
      '<div class="lp-results" style="margin-top:8px"></div>' +
      '<label>メモ</label><input type="text" class="p-memo">' +
      '<label>次回架電予定日(またかけるとき)</label><input type="date" class="p-next"></div>' +
      '<div class="lp-btns"><button type="button" class="p-cancel">キャンセル</button><button type="button" class="primary p-save">登録</button></div>';
    bg.appendChild(m);
    document.body.appendChild(bg);
    var $ = function (c) { return m.querySelector(c); };

    var chosen = '';
    var box = $('.lp-results');
    RESULTS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = v;
      b.addEventListener('click', function () {
        chosen = chosen === v ? '' : v; // もう一度押すと選択を外す
        [].forEach.call(box.children, function (x) { x.classList.toggle('on', x.textContent === chosen); });
      });
      box.appendChild(b);
    });

    api('/k/v1/app/form/fields', 'GET', { app: LEAD_APP_ID }).then(function (r) {
      props = r.properties;
      var sel = $('.p-cat');
      sel.appendChild(new Option('(未選択)', ''));
      var o = (props['大分類'] && props['大分類'].options) || {};
      Object.keys(o).sort(function (a, b) { return Number(o[a].index) - Number(o[b].index); }).forEach(function (v) { sel.appendChild(new Option(v, v)); });
    }).catch(function () { $('.p-cat').appendChild(new Option('(未選択)', '')); }).then(function () {
      // 中分類は分類マスタ(30)から大分類で絞って取得し、ルックアップ「中分類選択」にキーを入れる(レコード画面の「取得」と同じ結果)
      MP().bindMinor($('.p-cat'), $('.p-sub'));
    });

    var pasteSeq = 0;
    $('.p-paste').addEventListener('input', function () {
      var my = ++pasteSeq;
      var note = $('.p-note');
      note.textContent = '読み取り中…';
      MP().parseAsync(this.value).then(function (p) {
        if (my !== pasteSeq) return; // 貼り直されたら古い結果は使わない
        $('.p-name').value = p.name; $('.p-phone').value = p.phone; $('.p-zip').value = p.zip;
        if (p.pref) $('.p-pref').value = p.pref;
        $('.p-city').value = p.city; $('.p-rest').value = p.rest; $('.p-url').value = p.url;
        note.textContent = p.note || '';
        note.style.color = p.fromUrl || !p.note ? '#64748b' : '#b91c1c';
        checkDup();
      });
    });

    var timer = null, seq = 0, blocked = false;
    function checkDup() { clearTimeout(timer); timer = setTimeout(runDup, 400); }
    function runDup() {
      var name = $('.p-name').value.trim(), phone = $('.p-phone').value.trim();
      var my = ++seq;
      blocked = false;
      if (!name && MP().digits(phone).length < 9) { $('.p-dup').innerHTML = ''; return kintone.Promise.resolve(); }
      return kintone.Promise.all([MP().findSame(LEAD_APP_ID, name, phone), MP().findSame(CUSTOMER_APP_ID, name, phone)]).then(function (res) {
        if (my !== seq) return;
        var h = '';
        if (res[0].length) h += 'ネタリストに同じお店があります: <a href="' + recUrl(LEAD_APP_ID, res[0][0].$id.value) + '">ネタNo.' + esc(res[0][0].$id.value) + ' ' + esc(fv(res[0][0], '会社名', '')) + '</a>(そちらで「📞 架電を記録」してください)<br>';
        if (res[1].length) h += '顧客管理に同じお店があります: <a href="' + recUrl(CUSTOMER_APP_ID, res[1][0].$id.value) + '">顧客No.' + esc(res[1][0].$id.value) + ' ' + esc(fv(res[1][0], '会社名', '')) + '</a>(そちらで「📞 電話を記録」してください)';
        blocked = !!h;
        $('.p-dup').innerHTML = h ? '<div class="lp-box lp-warn">' + h + '</div>' : '';
      });
    }
    $('.p-name').addEventListener('input', checkDup);
    $('.p-phone').addEventListener('input', checkDup);

    function close() { if (bg.parentNode) document.body.removeChild(bg); }
    $('.p-cancel').addEventListener('click', close);
    $('.p-save').addEventListener('click', function () {
      var btn = this;
      var name = $('.p-name').value.trim();
      if (!name) { alert('会社名・店名を入れてください'); return; }
      btn.disabled = true;
      clearTimeout(timer);
      var me = kintone.getLoginUser();
      runDup().then(function () {
        if (blocked) throw new Error('同じお店がすでに登録されています。表示されたリンクから開いてください。');
        var rec = {
          会社名: { value: name },
          確認ステータス: { value: '稼働中' },
          確認者: { value: [{ code: me.code }] },
          業種確認メモ: { value: 'Googleマップから登録(' + today() + ')' },
          進捗状況: { value: chosen === '失注' ? '失注' : chosen ? '架電済み' : '未着手' }
        };
        var vals = {
          電話番号: $('.p-phone').value.trim(), 郵便番号: $('.p-zip').value.trim(), 都道府県: $('.p-pref').value.trim(),
          市区町村: $('.p-city').value.trim(), 丁目番地等: MP().toWideAddr($('.p-rest').value.trim()),
          大分類: $('.p-cat').value, 中分類選択: $('.p-sub').value, GoogleマップURL: $('.p-url').value.trim(), 次回架電予定日: $('.p-next').value
        };
        Object.keys(vals).forEach(function (k) { if (vals[k] && (props[k] || !Object.keys(props).length)) rec[k] = { value: vals[k] }; });
        if (chosen) {
          rec.架電履歴 = { value: [{ value: {
            履歴日付: { value: today() }, 履歴時刻: { value: nowHm() }, 履歴種別: { value: '電話' },
            履歴担当: { value: [{ code: me.code }] }, 履歴結果: { value: chosen }, 履歴メモ: { value: $('.p-memo').value.trim() }
          } }] };
          if (chosen === '獲得') rec.アポ獲得者 = { value: [{ code: me.code }] };
        }
        return api('/k/v1/record', 'POST', { app: LEAD_APP_ID, record: rec });
      }).then(function (resp) {
        close();
        if (chosen === '獲得') {
          alert('アポ獲得として登録しました。ネタの画面で「📅 アポを予定に登録」→「顧客管理へ登録」に進んでください。');
          location.href = recUrl(LEAD_APP_ID, resp.id);
          return;
        }
        alert('ネタリストに登録しました(ネタNo.' + resp.id + ')。');
        location.reload();
      }).catch(function (err) {
        btn.disabled = false;
        alert('登録できませんでした。' + (err && err.message ? '\n' + err.message : ''));
      });
    });
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    if (Number(event.appId) !== LEAD_APP_ID) return event;
    injectStyle();
    var old = document.getElementById('lp-open');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.getHeaderMenuSpaceElement();
    if (!space) return event;
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'lp-open';
    b.textContent = '📋 Googleマップから貼り付けて登録';
    b.style.cssText = 'padding:6px 14px;border-radius:4px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;margin-right:8px;' +
      (IS_MOBILE ? 'display:block;width:calc(100% - 24px);margin:8px 12px;padding:12px 14px;font-size:15px;' : '');
    b.addEventListener('click', openDialog);
    if (IS_MOBILE) space.appendChild(b); else space.insertBefore(b, space.firstChild);
    return event;
  });
})();
