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
 * - ネタリスト: 「📞 架電を記録」「🚶 訪問を記録」で、結果・メモ・次回架電予定日だけの小さな画面から架電履歴に1行足して保存する
 *   (2026-10-11: 架電/飛び込みの区別と時刻も残す。毎朝の架電・飛び込みリストの点数とおすすめ時間帯の学習に使う)
 *   (2026-10-17: ボタン名を「飛び込みを記録」→「訪問を記録」。今日の自分の訪問予定がこのネタにあれば、架電履歴には足さず
 *    予定を完了にして活動履歴に1件残す=スケジュールの訪問完了と同じ。同じ訪問を予定と飛び込みの両方に数えないため)
 *   (日付=今日・担当=自分。獲得ならアポ獲得者が空のとき自分を入れ、続けてアポをスケジュールに登録するか聞く)。
 *   (2026-10-21: 日付を選べるようにした。今日以外の日は時刻を空にする(日報では午後扱い)。
 *    2026-10-25 P1: 日付の初期値は日本時間の今日(朝6時前でも前日にしない)。日付欄の下に「何日の業務として記録するか」を常に出す。
 *    日付・時刻は共通部品 customize-business-date.js(window.TaimeiDate)を使う(同じアプリに登録が必要)。
 *    訪問の日付はキーボードで打ち終わってから、その日の予定で開き直す(onDateCommit)。
 *    結果が失注なら進捗状況も失注に(架電リストから外す)、それ以外で未着手なら架電済みに。種別の値は「電話」→「架電」に改名)
 *   (ネタリストの「📋 Googleマップから貼り付けて登録」で訪問したを選んだときは、登録後にこの画面で「🚶 訪問を記録」を自動で開く)
 * - 案件管理の「コール業務」は入力できなくする(2026-10-16 使用終了。架電の結果は顧客管理の作業パネルから活動履歴へ)。
 */
(function () {
  'use strict';

  var SCHEDULE_APP_ID = 34;
  var DEAL_APP_ID = 19;
  var LEAD_APP_ID = 29;
  var QUOTE_APP_ID = 16;
  var ACTIVITY_APP_ID = 17;
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
    // 「コール業務」は使用終了(2026-10-16)。架電の結果は顧客管理の「📞 架電を記録」で活動履歴に残す。過去の値は見られるよう残す
    if (event.record['コール業務']) event.record['コール業務'].disabled = true;
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
  var CALL_RESULTS = ['架電済み', '不通・不在', 'ネタ', '獲得', '失注', '受付ブロック']; // 受付ブロック: 受付で断られた・取り付く島もない(2026-10-16)

  // 日付・時刻は日本時間(端末のタイムゾーンに関係なく)。記録する日の初期値は今日で、朝6時前でも前日にしない
  function TD() {
    if (!window.TaimeiDate) throw new Error('customize-business-date.js が読み込まれていません');
    return window.TaimeiDate;
  }
  function todayYmd() { return TD().today(); }

  // REST APIで返ってきたテーブルの行を、更新(PUT)に使える形にする
  function rowForPut(row) {
    var v = {};
    Object.keys(row.value).forEach(function (c) {
      var x = row.value[c].value;
      v[c] = { value: x && x.length && x[0] && x[0].code ? x.map(function (u) { return { code: u.code }; }) : x };
    });
    return { id: row.id, value: v };
  }

  function nowHm() { return TD().nowHm(); }

  // その日の自分の訪問予定(まだ「予定」のもの)で、このネタが訪問先のもの。見られない人は無しとして扱う
  function plansOfLead(leadId, day) {
    return api('/k/v1/records', 'GET', { app: SCHEDULE_APP_ID, fields: ['$id', '件名', '開始日時', '内容'],
      query: 'ネタNo = "' + leadId + '" and 元予定No = "" and 種類 in ("訪問") and 実施状況 in ("予定") and 参加者 in (LOGINUSER()) and ' +
        TD().dayQuery('開始日時', day) + ' order by 開始日時 asc limit 1' })
      .then(function (resp) { return resp.records[0] || null; }).catch(function () { return null; });
  }

  // ネタの進捗状況: 失注なら失注(架電リストから外す)、未着手のネタに記録したら架電済み
  function progressUpdate(cur, chosen) {
    var now = fv(cur, '進捗状況', '');
    if (chosen === '失注') return now === '失注' ? null : '失注';
    return now === '未着手' || !now ? '架電済み' : null;
  }

  // 予定のある訪問: スケジュールの「✅ 訪問完了」と同じく、活動履歴に1件残して予定を完了にする(架電履歴には足さない。
  // 足すと日報の訪問件数で予定と飛び込みの両方に数えられ、飛び込みリストの学習にもアポの訪問が混ざるため)
  function recordPlannedVisit(r, plan, chosen, memo, next, day) {
    var me = kintone.getLoginUser();
    var id = fv(r, 'レコード番号', '') || fv(r, '$id', '');
    var body = fv(plan, '内容', '').replace(/\(案件管理の次回商談日から自動作成\)/g, '').trim();
    var act = {
      タイトル: { value: '訪問: ' + fv(r, '会社名', '') }, 対応日付: { value: day },
      対応者: { value: [{ code: me.code }] }, 対応種別: { value: '商談（初回）' },
      内容: { value: '訪問先: ' + fv(r, '会社名', '') + '(ネタNo.' + id + '、顧客未登録)\n結果: ' + chosen + (memo ? '\n' + memo : '') +
        (body ? '\n\n【予定のメモ】' + body : '') + '\n\n(スケジュールNo.' + plan.$id.value + ' から作成)' }
    };
    return api('/k/v1/record', 'POST', { app: ACTIVITY_APP_ID, record: act }).then(function (resp) {
      return api('/k/v1/record', 'PUT', { app: SCHEDULE_APP_ID, id: plan.$id.value, record: { 実施状況: { value: '完了' }, 活動履歴No: { value: String(resp.id) } } });
    }).then(function () {
      var upd = { 次回架電予定日: { value: next || null } };
      if (chosen === '獲得' && !fv(r, 'アポ獲得者', []).length) upd.アポ獲得者 = { value: [{ code: me.code }] };
      var pg = progressUpdate(r, chosen);
      if (pg) upd.進捗状況 = { value: pg };
      return api('/k/v1/record', 'PUT', { app: LEAD_APP_ID, id: id, record: upd });
    });
  }

  // kind: '架電' または '飛び込み'(ボタン名は「🚶 訪問を記録」。架電履歴の種別の値は学習・日報で使うので「飛び込み」のまま)
  // day: 記録する日(省略で日本時間の今日)。carry: 日付を変えて開き直すときに引き継ぐ入力
  function openCallDialog(r, kind, day, carry) {
    kind = kind || '架電';
    day = day || todayYmd();
    if (kind !== '飛び込み') return showCallDialog(r, kind, null, day, carry);
    plansOfLead(fv(r, 'レコード番号', '') || fv(r, '$id', ''), day).then(function (plan) { showCallDialog(r, kind, plan, day, carry); });
  }

  function showCallDialog(r, kind, plan, day, carry) {
    var bg = document.createElement('div');
    bg.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px';
    var m = document.createElement('div');
    m.style.cssText = 'background:#fff;border-radius:8px;padding:16px;width:100%;max-width:420px;max-height:calc(100vh - 24px);overflow:auto;box-sizing:border-box;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.25)';
    var ps = plan ? new Date(fv(plan, '開始日時', '')) : null;
    m.innerHTML = '<div style="font-size:16px;font-weight:bold;margin-bottom:10px">' + (kind === '飛び込み' ? '🚶 訪問を記録' : '📞 架電を記録') + '</div>' +
      '<div style="color:#475569;margin-bottom:6px">' + (kind === '飛び込み' ? '訪問した日' : '架電した日') + '</div>' +
      '<input class="call-date" type="date" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' +
      '<div class="call-date-note" style="color:#b45309;font-size:12px;margin:4px 0 10px"></div>' +
      (plan ? '<div style="margin-bottom:10px;padding:8px 10px;border:1px solid #86efac;background:#f0fdf4;border-radius:6px;font-size:13px">📅 ' +
        (ps.getMonth() + 1) + '/' + ps.getDate() + ' ' + pad(ps.getHours()) + ':' + pad(ps.getMinutes()) +
        ' の訪問予定の訪問として記録し、予定を「完了」にします(スケジュールの「✅ 訪問完了」と同じ。活動履歴に残ります)。</div>' : '') +
      '<div style="color:#475569;margin-bottom:6px">結果</div><div class="call-results" style="display:flex;flex-wrap:wrap;gap:6px"></div>' +
      '<div class="call-lose" style="display:none;margin-top:8px;padding:6px 10px;border:1px solid #fca5a5;background:#fef2f2;border-radius:6px;font-size:12px;color:#991b1b">失注: ネタの進捗状況も「失注」にし、架電リストに出なくなります。次回架電予定日は空にします。</div>' +
      '<div style="color:#475569;margin:12px 0 6px">メモ</div><input class="call-memo" type="text" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box">' +
      '<div style="color:#475569;margin:12px 0 6px">次回架電予定日(また連絡するとき)</div><input class="call-next" type="date" style="padding:8px;border:1px solid #cbd5e1;border-radius:6px">' +
      '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px"><button type="button" class="call-cancel" style="padding:8px 14px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer">キャンセル</button>' +
      '<button type="button" class="call-save" style="padding:8px 14px;border:1px solid #2563eb;border-radius:6px;background:#2563eb;color:#fff;cursor:pointer">保存</button></div>';
    bg.appendChild(m);
    document.body.appendChild(bg);
    var nextIn = m.querySelector('.call-next');
    var nextVal = fv(r, '次回架電予定日', '');
    if (nextVal) nextIn.value = nextVal;
    if (carry) { m.querySelector('.call-memo').value = carry.memo || ''; nextIn.value = carry.next || ''; }
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
        m.querySelector('.call-lose').style.display = chosen === '失注' ? 'block' : 'none';
        // 失注は今後かけないので次回架電予定日を空に。ほかの結果に戻したら元の値に
        nextIn.disabled = chosen === '失注';
        nextIn.value = chosen === '失注' ? '' : (nextIn.value || nextVal || '');
      });
      box.appendChild(b);
    });
    var dateIn = m.querySelector('.call-date');
    dateIn.value = day;
    // 何日の業務として記録するかを常に出す(日付は変えない。前の日の分は利用者が選ぶ)
    function dateNote() { TD().renderNote(m.querySelector('.call-date-note'), dateIn.value, '時刻は空になります。'); }
    dateNote();
    function close() { if (bg.parentNode) document.body.removeChild(bg); }
    dateIn.addEventListener('change', dateNote);
    // 訪問は、その日の訪問予定で記録し直せるように開き直す(書いたメモは引き継ぐ)
    function reopen(v) {
      var keep = { memo: m.querySelector('.call-memo').value, next: nextIn.value };
      close();
      openCallDialog(r, kind, v, keep);
    }
    // キーボードで打ち終わるまで待つ(2026-10-25 P1。1文字目で開き直して違う日になっていた)
    if (kind === '飛び込み') {
      TD().onDateCommit(dateIn, function (v) { if (v && v !== day) reopen(v); }, [m.querySelector('.call-save'), m.querySelector('.call-cancel')]);
    }
    m.querySelector('.call-cancel').addEventListener('click', close);
    m.querySelector('.call-save').addEventListener('click', function () {
      if (!chosen) { alert('結果を選んでください'); return; }
      var d = dateIn.value;
      if (!d) { alert('日付を入れてください'); return; }
      // 日付を打ってすぐ保存を押したときは、その日の予定で開き直してから保存してもらう(開いた日の予定を完了にしないように)
      if (kind === '飛び込み' && d !== day) {
        alert('訪問した日を変えたので、その日の訪問予定で開き直します。内容を確かめて、もう一度「保存」を押してください。');
        reopen(d);
        return;
      }
      var memo = m.querySelector('.call-memo').value;
      var next = nextIn.value;
      var id = fv(r, 'レコード番号', '') || fv(r, '$id', '');
      var me = kintone.getLoginUser();
      this.disabled = true;
      (plan ? recordPlannedVisit(r, plan, chosen, memo, next, d) : api('/k/v1/record', 'GET', { app: LEAD_APP_ID, id: id }).then(function (resp) {
        var cur = resp.record;
        // 何も入っていない行(新規作成時の初期値だけの行など)は除いて、新しい行を足す
        var rows = fv(cur, '架電履歴', []).filter(function (row) {
          return fv(row.value, '履歴結果', '') || fv(row.value, '履歴メモ', '');
        }).map(rowForPut);
        rows.push({ value: {
          // 今日以外の日の分は、記録した時刻が当てにならないので時刻を空にする
          履歴日付: { value: d }, 履歴時刻: { value: d === todayYmd() ? nowHm() : '' }, 履歴種別: { value: kind },
          履歴担当: { value: [{ code: me.code }] }, 履歴結果: { value: chosen }, 履歴メモ: { value: memo }
        } });
        var upd = { 架電履歴: { value: rows }, 次回架電予定日: { value: next || null } };
        if (chosen === '獲得' && !fv(cur, 'アポ獲得者', []).length) upd.アポ獲得者 = { value: [{ code: me.code }] };
        var pg = progressUpdate(cur, chosen);
        if (pg) upd.進捗状況 = { value: pg };
        return api('/k/v1/record', 'PUT', { app: LEAD_APP_ID, id: id, record: upd });
      })).then(function () {
        close();
        if (plan) alert('予定を完了にして、活動履歴に記録しました。');
        if (chosen === '獲得' && !plan && confirm('アポ獲得として記録しました。続けて、アポをスケジュールに登録しますか？')) {
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
      wrap.appendChild(makeButton('📞 架電を記録', true, function () { openCallDialog(r, '架電'); }));
      wrap.appendChild(makeButton('🚶 訪問を記録', true, function () { openCallDialog(r, '飛び込み'); }));
      wrap.appendChild(makeButton('📅 アポを予定に登録', false, function () { openScheduleCreate(leadPrefill(r)); }));
    }
    space.appendChild(wrap);
    // 「📋 Googleマップから貼り付けて登録」で訪問したを選んで登録した直後は、訪問の記録を開く(customize-lead-paste.js)
    if (appId === LEAD_APP_ID) {
      var openVisit = false;
      try {
        openVisit = sessionStorage.getItem('lead-open-visit') === String(event.recordId);
        if (openVisit) sessionStorage.removeItem('lead-open-visit');
      } catch (e) { openVisit = false; }
      if (openVisit) setTimeout(function () { openCallDialog(r, '飛び込み'); }, 0);
    }
    return event;
  });
})();
