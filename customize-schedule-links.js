/*
 * 案件管理(app19)・ネタリスト(app29) → スケジュール(app34) への「予定に登録」ボタン  PC/スマホ両対応
 *
 * - 案件管理: 「📅 訪問を予定に登録」。件名・種類(訪問)・案件・顧客・参加者(主担当)・開始(次回商談日が先なら その日時)を
 *   入れた状態でスケジュールの新規作成画面を開く。
 * - ネタリスト: 「📅 アポを予定に登録」。件名・種類(訪問)・ネタNo(未顧客の訪問先)を入れた状態で開く。
 * - 値の受け渡しは sessionStorage(キー sched-prefill-34)。受け取り側は customize-schedule.js の新規作成画面。
 * - 案件管理で次回商談日を入れて保存すると、スケジュールに予定を自動で作る(前の次回商談日の予定があればその日時を動かす)。
 *   参加者=商談担当者(空なら主担当)。案件側のリマインダー通知は廃止し、スケジュールのリマインダーに一本化した。
 * - 案件の詳細画面で、次回商談日とスケジュールの「この案件の次の予定」が食い違っていたら赤い警告と直すボタンを出す。
 * - 案件管理: 「📄 見積書を作成」で、案件No.を取得した状態の見積書の作成画面を開く(受け取りは customize-quote-number.js)。
 * - ネタリスト: 「📞 架電を記録」で、結果・メモ・次回架電予定日だけの小さな画面から架電履歴に1行足して保存する
 *   (日付=今日・担当=自分。獲得ならアポ獲得者が空のとき自分を入れ、続けてアポをスケジュールに登録するか聞く)。
 */
(function () {
  'use strict';

  var SCHEDULE_APP_ID = 34;
  var DEAL_APP_ID = 19;
  var LEAD_APP_ID = 29;
  var QUOTE_APP_ID = 16;
  var PREFILL_KEY = 'sched-prefill-34';
  var BUTTON_ID = 'schedule-link-button';

  var IS_MOBILE = false;

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }

  function toKintoneDT(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }

  function nextHour() {
    var s = new Date();
    s.setMinutes(0, 0, 0);
    s.setHours(s.getHours() + 1);
    return s;
  }

  function openScheduleCreate(prefill) {
    try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill)); } catch (e) { /* 自動入力なしで開く */ }
    location.href = IS_MOBILE ? '/k/m/' + SCHEDULE_APP_ID + '/edit' : '/k/' + SCHEDULE_APP_ID + '/edit';
  }

  function dealPrefill(r) {
    var next = fv(r, '次回商談日', '');
    var start = next && new Date(next) > new Date() ? new Date(next) : nextHour();
    var owner = fv(r, '主担当', [])[0] || kintone.getLoginUser();
    var name = fv(r, '会社名', '') + (fv(r, '提案商品', '') ? ' / ' + fv(r, '提案商品', '') : '');
    return {
      start: toKintoneDT(start), end: toKintoneDT(new Date(start.getTime() + 3600000)), allDay: false,
      user: { code: owner.code, name: owner.name },
      title: '訪問: ' + name, type: '訪問',
      dealNo: fv(r, '案件No_', ''), custNo: fv(r, '顧客No_', '')
    };
  }

  function leadPrefill(r) {
    var start = nextHour();
    var me = kintone.getLoginUser();
    return {
      start: toKintoneDT(start), end: toKintoneDT(new Date(start.getTime() + 3600000)), allDay: false,
      user: { code: me.code, name: me.name },
      title: '訪問: ' + fv(r, '会社名', ''), type: '訪問',
      netaNo: fv(r, 'レコード番号', '')
    };
  }

  // ---------- 案件管理: 次回商談日 → スケジュールの予定を自動で作る・動かす ----------
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];
  var prevNext = null; // 編集前の次回商談日

  function api(path, method, params) { return kintone.api(kintone.api.url(path, true), method, params); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function label(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ') ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function sameTime(a, b) { return !!a && !!b && new Date(a).getTime() === new Date(b).getTime(); }

  // スケジュール側の「この案件の次の予定」(customize-schedule.js の次回商談日の計算と同じ条件)
  function nextScheduled(dealNo) {
    return api('/k/v1/records', 'GET', {
      app: SCHEDULE_APP_ID, fields: ['$id', '開始日時'],
      query: '案件No = "' + dealNo + '" and 元予定No = "" and 実施状況 in ("予定") and 種類 not in ("休暇") and 開始日時 >= NOW() order by 開始日時 asc limit 1'
    }).then(function (resp) { return resp.records[0] ? fv(resp.records[0], '開始日時', '') : ''; });
  }

  function findAt(dealNo, iso) {
    return api('/k/v1/records', 'GET', {
      app: SCHEDULE_APP_ID, fields: ['$id', '開始日時', '終了日時', '公開区分'],
      query: '案件No = "' + dealNo + '" and 元予定No = "" and 開始日時 = "' + iso + '" limit 1'
    }).then(function (resp) { return resp.records[0] || null; });
  }

  // 次回商談日の予定を用意する: 前の次回商談日の予定があれば日時を動かし、無ければ新しく作る
  function pushToSchedule(dealNo, r, prev) {
    var next = fv(r, '次回商談日', '');
    if (!next) return kintone.Promise.resolve('');
    // 新しい日時の予定があるか・前の日時の予定があるかは、同時に問い合わせる(保存後の待ち時間を短くするため)
    return kintone.Promise.all([findAt(dealNo, next), prev ? findAt(dealNo, prev) : kintone.Promise.resolve(null)]).then(function (res) {
      var already = res[0];
      if (already) return '';
      return kintone.Promise.resolve(res[1]).then(function (old) {
        if (old) {
          if (fv(old, '公開区分', '') === '非公開') {
            throw new Error('前の次回商談日の予定が非公開のため、自動では動かしませんでした。スケジュールで直してください。');
          }
          var dur = new Date(fv(old, '終了日時', '')).getTime() - new Date(fv(old, '開始日時', '')).getTime();
          var end = new Date(new Date(next).getTime() + (dur > 0 ? dur : 3600000));
          return api('/k/v1/record', 'PUT', { app: SCHEDULE_APP_ID, id: old.$id.value, record: {
            開始日時: { value: next }, 終了日時: { value: toKintoneDT(end) }
          } }).then(function () { return 'スケジュールの予定(' + label(next) + ')を動かしました。'; });
        }
        var users = fv(r, '商談担当者', []);
        if (!users.length) users = fv(r, '主担当', []);
        if (!users.length) users = [kintone.getLoginUser()];
        var name = fv(r, '会社名', '') + (fv(r, '提案商品', '') ? ' / ' + fv(r, '提案商品', '') : '');
        var rec = {
          件名: { value: '商談: ' + name }, 種類: { value: '訪問' },
          開始日時: { value: next }, 終了日時: { value: toKintoneDT(new Date(new Date(next).getTime() + 3600000)) },
          参加者: { value: users.map(function (u) { return { code: u.code }; }) },
          案件No: { value: String(dealNo) },
          リマインダー: { value: ['1時間前', '当日の朝8時'] },
          出欠: { value: users.map(function (u) {
            return { value: { 出欠_参加者: { value: [{ code: u.code }] }, 出欠_回答: { value: '承諾' }, 出欠_コメント: { value: '' } } };
          }) },
          内容: { value: '(案件管理の次回商談日から自動作成)' }
        };
        if (fv(r, '顧客No_', '')) rec.顧客No = { value: String(fv(r, '顧客No_', '')) };
        return api('/k/v1/record', 'POST', { app: SCHEDULE_APP_ID, record: rec })
          .then(function () { return 'スケジュールに予定(' + label(next) + ')を作りました。'; });
      });
    });
  }

  kintone.events.on(['app.record.create.show', 'app.record.edit.show',
    'mobile.app.record.create.show', 'mobile.app.record.edit.show'], function (event) {
    if (Number(event.appId) !== DEAL_APP_ID) return event;
    prevNext = event.type.indexOf('edit') >= 0 ? fv(event.record, '次回商談日', '') : '';
    return event;
  });

  kintone.events.on(['app.record.create.submit.success', 'app.record.edit.submit.success',
    'mobile.app.record.create.submit.success', 'mobile.app.record.edit.submit.success'], function (event) {
    if (Number(event.appId) !== DEAL_APP_ID) return event;
    var r = event.record;
    var next = fv(r, '次回商談日', '');
    if (!next || sameTime(next, prevNext)) return event;
    var id = event.recordId || fv(r, '案件No_', '');
    return pushToSchedule(id, r, prevNext).then(function (msg) {
      if (msg) alert('案件を保存しました。\n' + msg);
      return event;
    }).catch(function (err) {
      alert('案件は保存しましたが、スケジュールへの反映に失敗しました。\n' + (err && err.message ? err.message : ''));
      return event;
    });
  });

  // 詳細画面: 次回商談日とスケジュールが食い違っていたら警告を出す
  function showConsistency(event) {
    var old = document.getElementById('deal-schedule-check');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var r = event.record;
    var dealNo = event.recordId || fv(r, '案件No_', '');
    var next = fv(r, '次回商談日', '');
    nextScheduled(dealNo).then(function (expected) {
      var msg = '', fixLabel = '', fix = null;
      if (expected && !sameTime(expected, next)) {
        msg = '⚠ 次回商談日がスケジュールと食い違っています。案件: ' + (next ? label(next) : '(空欄)') + ' / スケジュールの次の予定: ' + label(expected);
        fixLabel = 'スケジュールに合わせる';
        fix = function () { return api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: dealNo, record: { 次回商談日: { value: expected } } }); };
      } else if (!expected && next && new Date(next) > new Date()) {
        msg = '⚠ 次回商談日(' + label(next) + ')の予定がスケジュールにありません。';
        fixLabel = 'スケジュールに登録';
        fix = function () { return pushToSchedule(dealNo, r, null); };
      }
      if (!msg) return;
      var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
      if (!space) return;
      var box = document.createElement('div');
      box.id = 'deal-schedule-check';
      box.style.cssText = 'margin:6px 12px;padding:8px 12px;border:1px solid #fca5a5;background:#fef2f2;color:#b91c1c;border-radius:6px;font-size:13px;display:flex;flex-wrap:wrap;gap:8px;align-items:center';
      box.appendChild(document.createTextNode(msg));
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = fixLabel;
      b.style.cssText = 'padding:4px 10px;border:1px solid #b91c1c;background:#fff;color:#b91c1c;border-radius:4px;cursor:pointer';
      b.addEventListener('click', function () {
        fix().then(function () { location.reload(); }).catch(function (err) { alert('直せませんでした。' + (err && err.message ? '\n' + err.message : '')); });
      });
      box.appendChild(b);
      space.appendChild(box);
    }).catch(function () { /* スケジュールを見られない人には出さない */ });
  }

  // ---------- ネタリスト: 架電を記録(編集画面を開かずに1回で保存) ----------
  var CALL_RESULTS = ['架電済み', '不通・不在', 'ネタ', '獲得', '失注'];

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // REST APIで返ってきたテーブルの行を、更新(PUT)に使える形にする
  function rowForPut(row) {
    var v = {};
    Object.keys(row.value).forEach(function (c) {
      var x = row.value[c].value;
      v[c] = { value: x && x.length && x[0] && x[0].code ? x.map(function (u) { return { code: u.code }; }) : x };
    });
    return { id: row.id, value: v };
  }

  function openCallDialog(r) {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px';
    var m = document.createElement('div');
    m.style.cssText = 'background:#fff;border-radius:8px;padding:16px;width:100%;max-width:420px;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.25)';
    m.innerHTML = '<div style="font-size:16px;font-weight:bold;margin-bottom:10px">📞 架電を記録</div>' +
      '<div style="color:#475569;margin-bottom:6px">結果</div><div class="call-results" style="display:flex;flex-wrap:wrap;gap:6px"></div>' +
      '<div style="color:#475569;margin:12px 0 6px">メモ</div><input class="call-memo" type="text" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box">' +
      '<div style="color:#475569;margin:12px 0 6px">次回架電予定日(また連絡するとき)</div><input class="call-next" type="date" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button type="button" class="call-cancel" style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer">キャンセル</button>' +
      '<button type="button" class="call-save" style="padding:8px 14px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer">保存</button></div>';
    bg.appendChild(m);
    document.body.appendChild(bg);
    var chosen = '';
    var box = m.querySelector('.call-results');
    CALL_RESULTS.forEach(function (res) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = res;
      b.style.cssText = 'padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer';
      b.addEventListener('click', function () {
        chosen = res;
        [].forEach.call(box.children, function (x) { x.style.background = '#fff'; x.style.color = ''; });
        b.style.background = '#1e293b';
        b.style.color = '#fff';
      });
      box.appendChild(b);
    });
    var nextVal = fv(r, '次回架電予定日', '');
    if (nextVal) m.querySelector('.call-next').value = nextVal;
    function close() { if (bg.parentNode) document.body.removeChild(bg); }
    m.querySelector('.call-cancel').addEventListener('click', close);
    m.querySelector('.call-save').addEventListener('click', function () {
      if (!chosen) { alert('結果を選んでください'); return; }
      var memo = m.querySelector('.call-memo').value;
      var next = m.querySelector('.call-next').value;
      var id = fv(r, 'レコード番号', '') || fv(r, '$id', '');
      var me = kintone.getLoginUser();
      this.disabled = true;
      api('/k/v1/record', 'GET', { app: LEAD_APP_ID, id: id }).then(function (resp) {
        var cur = resp.record;
        // 何も入っていない行(新規作成時の初期値だけの行など)は除いて、新しい行を足す
        var rows = fv(cur, '架電履歴', []).filter(function (row) {
          return fv(row.value, '履歴結果', '') || fv(row.value, '履歴メモ', '');
        }).map(rowForPut);
        rows.push({ value: {
          履歴日付: { value: todayYmd() }, 履歴担当: { value: [{ code: me.code }] },
          履歴結果: { value: chosen }, 履歴メモ: { value: memo }
        } });
        var upd = { 架電履歴: { value: rows }, 次回架電予定日: { value: next || null } };
        if (chosen === '獲得' && !fv(cur, 'アポ獲得者', []).length) upd.アポ獲得者 = { value: [{ code: me.code }] };
        return api('/k/v1/record', 'PUT', { app: LEAD_APP_ID, id: id, record: upd });
      }).then(function () {
        close();
        if (chosen === '獲得' && confirm('アポ獲得として記録しました。続けて、アポをスケジュールに登録しますか？')) {
          openScheduleCreate(leadPrefill(r));
          return;
        }
        location.reload();
      }).catch(function (err) {
        alert('記録できませんでした。' + (err && err.message ? '\n' + err.message : ''));
        close();
      });
    });
  }

  // ---------- 詳細画面のボタン ----------
  function makeButton(text, primary, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    btn.style.cssText = 'margin-right:8px;padding:6px 14px;border-radius:4px;border:1px solid #2563eb;cursor:pointer;font-size:13px;' +
      (primary ? 'background:#2563eb;color:#fff;' : 'background:#fff;color:#2563eb;') +
      (IS_MOBILE ? 'display:block;width:calc(100% - 24px);margin:6px 12px;padding:10px 14px;' : '');
    btn.addEventListener('click', onClick);
    return btn;
  }

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    var appId = Number(event.appId);
    if (appId !== DEAL_APP_ID && appId !== LEAD_APP_ID) return event;
    if (appId === DEAL_APP_ID) showConsistency(event);
    // スマホは画面遷移しても前のボタンが残ることがあるため作り直す
    var old = document.getElementById(BUTTON_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return event;
    var r = event.record;
    var wrap = document.createElement('span');
    wrap.id = BUTTON_ID;
    if (appId === DEAL_APP_ID) {
      wrap.appendChild(makeButton('📅 訪問を予定に登録', false, function () { openScheduleCreate(dealPrefill(r)); }));
      wrap.appendChild(makeButton('📄 見積書を作成', false, function () {
        try { sessionStorage.setItem('quote-prefill-16', JSON.stringify({ dealNo: fv(r, '案件No_', '') })); } catch (e) { /* 案件は手で取得する */ }
        location.href = IS_MOBILE ? '/k/m/' + QUOTE_APP_ID + '/edit' : '/k/' + QUOTE_APP_ID + '/edit';
      }));
    } else {
      wrap.appendChild(makeButton('📞 架電を記録', true, function () { openCallDialog(r); }));
      wrap.appendChild(makeButton('📅 アポを予定に登録', false, function () { openScheduleCreate(leadPrefill(r)); }));
    }
    space.appendChild(wrap);
    return event;
  });
})();
