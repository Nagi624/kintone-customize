/*
 * 顧客管理(app18) 詳細画面の「作業パネル」と一覧画面の「Googleマップからお店を登録」  PC/スマホ両対応(2026-10-16)
 *
 * 架電担当が 顧客管理→案件管理→活動履歴 を行き来せず、顧客の画面だけで済むようにする。
 * データの置き場所は今のまま(案件=19・活動履歴=17・予定=34)。この画面から各アプリへ書き込むだけなので、
 * 日報の自動取り込み・週報月報・グラフ・見積/請求の紐付けはそのまま動く。
 *
 * - 上段: この顧客の案件(進行中)・次の連絡/予定・先方担当者・最近のやりとり を1枚に表示
 * - 📞 架電を記録: 結果(コール業務)・メモ・次回連絡日 → 活動履歴17に1件(対応種別=架電)。
 *   結果が「アポ獲得」のときだけ、商談日時・商談に行く人・提案商品を聞いて案件19を作る(進行中の案件があれば更新)。
 *   商談担当者は自分+商談に行く人(渡邉さんの「架電時フロー」(マニュアル12)どおり、両方の予定表に入る)
 *   → 案件の次回商談日からスケジュール34の予定を作る(customize-schedule-links.js と同じ処理)。
 *   案件は「商談が決まったら作る」もので、架電1本ごとには作らない。
 * - 🚶 訪問を記録(2026-10-17): 報告・案件のフェーズ/確度・次回連絡日 → 活動履歴17に1件(対応種別=商談(初回/2回目以降))。
 *   今日の自分の訪問予定がこの会社にあれば、その予定の訪問として記録して予定を完了にする(スケジュールの訪問完了と同じ。二重にしない)。
 *   活動履歴17は確認用(直接の入力・編集はしない)。記録はこのパネル・スケジュールの訪問完了・ネタリストからだけ入る。
 * - 💼 案件を作る・進める: フェーズ・確度・次回商談日などを小窓で更新(新規も可)。次回商談日を変えたら予定も作る/動かす。
 * - 📅 予定を入れる: 顧客・案件を入れた状態でスケジュールの新規作成画面を開く(受け取りは customize-schedule.js)。
 * - 📍 Googleマップ: GoogleマップURL(無ければWebサイトに入っているGoogleマップのURL)、どちらも無ければ店名+住所の検索で開く。
 * - 一覧画面「📍 Googleマップからお店を登録」(2026-10-20に「📞 …電話先を登録」から改名。2026-10-21に画面の「電話」を「架電」に統一): 架電した/訪問したを選んで登録する。
 *   訪問を選ぶと架電の記録は作らず、登録後の顧客画面で「🚶 訪問を記録」を開く(訪問の人が架電扱いにならないように)。
 *   Googleマップでコピーした文字(スマホは共有)を貼ると店名・電話番号・住所を読み取り、
 *   顧客を登録(顧客ランクは仮のD)して、そのまま架電の結果まで記録する。顧客管理に同じお店があれば登録させずそちらへ案内。
 *   ネタリストに同じお店があれば、履歴が無いネタは顧客管理へ移し(ネタは削除)、履歴があるネタはネタリストの「顧客管理へ登録」へ案内。
 *   GoogleのAPIは使わない(取った値は規約で30日を超えて保存できないため。利用者が貼り付けた文字だけを読む)。
 *
 * 2026-10-21:
 * - 架電の結果に「失注」(はっきり断られた・今後かけない)。進行中の案件があれば一緒に失注にでき、次回連絡日は空にする
 * - 架電・訪問の記録に「日付」を付けた(夜中に前日分を入れると当日の記録になり、日報が二重になっていたため)
 *
 * 2026-10-25(P1 日付の正常化): 記録する日の初期値は日本時間の今日。朝6時前でも前日にしない(会社の日付ルール)。
 *   日付欄の下に「何日の業務として記録するか」を常に出し、前の日の分は利用者が選ぶ。案件ダイアログで受注にするときは
 *   「受注日(実際に受注した日)」を聞く。日付は共通部品 customize-business-date.js(window.TaimeiDate)で日本時間に揃える
 *   受注日は必須・未来の日付は不可(空や未来なら保存しない)。訪問の日付はキーボードで打ち終わってから開き直す
 * - 対応種別の値は「電話」→「架電」(活動履歴17の選択肢も改名)
 *
 * 貼り付けの読み取り・重複チェックは customize-maps-paste.js(同じアプリに登録が必要。ネタリストと共用)。
 * 置き場所: フォームのスペース(要素ID customer_hub)。無ければヘッダーの空き(PCはメニュー横・スマホはヘッダー)に出す。
 * 前提の欄: 活動履歴17「コール業務」(ドロップダウン)、顧客管理18「次回連絡日」(日付)・「GoogleマップURL」(リンク)。無い場合はその部分を出さない。
 * 受注日(2026-10-24): 訪問の記録・案件を作る/進めるで商談フェーズを受注にしたら、案件19の「受注日」が空のときだけ
 *   訪問した日(案件のダイアログは「受注日」欄で選んだ日。初期値は日本時間の今日)を入れる(setWonDate)
 */
(function () {
  'use strict';

  var CUSTOMER_APP_ID = 18;
  var ACTIVITY_APP_ID = 17;
  var DEAL_APP_ID = 19;
  var CONTACT_APP_ID = 20;
  var SCHEDULE_APP_ID = 34;
  var MEMBER_APP_ID = 35;
  var SPACE_ID = 'customer_hub';
  var ROOT_ID = 'chub-root';
  var PREFILL_KEY = 'sched-prefill-34';

  // 架電の結果(案件管理の旧「コール業務」と同じ言葉。活動履歴17の「コール業務」に入れる)
  var CALL_RESULTS = [
    { v: 'コールのみ', hint: '留守電・通話中・つながらない' },
    { v: '担当不在', hint: '担当者が不在・手が離せない' },
    { v: 'ネタ', hint: '話せた(今回はアポなし)' },
    { v: 'アポ獲得', hint: '商談の約束ができた' },
    { v: '受付ブロック', hint: '受付で断られた・取り付く島もない' },
    { v: '失注', hint: 'はっきり断られた・今後かけない' }
  ];
  var CLOSED = ['受注', '失注', '保留/中止'];
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  var IS_MOBILE = false;

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function api(path, method, params) { return kintone.api(kintone.api.url(path, true), method, params); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // 業務日は共通部品 customize-business-date.js(window.TaimeiDate)で日本時間に揃える(同じアプリに登録が必要)
  function TD() {
    if (!window.TaimeiDate) throw new Error('customize-business-date.js が読み込まれていません');
    return window.TaimeiDate;
  }
  // 記録する日の初期値: 日本時間の今日(2026-10-25 P1: 朝6時前でも前日にしない。前の日の分は利用者が日付欄で選ぶ)
  function workDay() { return TD().today(); }
  // 商談フェーズを受注にしたら、受注日が空のときだけ day を入れる(2026-10-24。日報の受注の取り込みと受注の集計に使う)
  function setWonDate(upd, deal, phase, day) {
    if (phase === '受注' && (!deal || (fv(deal, '商談フェーズ', '') !== '受注' && !fv(deal, '受注日', '')))) upd.受注日 = { value: day };
  }
  // 日付の入力欄。何日の業務として記録するかを常に出す(日付は変えない。決定1・案A)
  function dateNote(input, note) {
    function upd() { TD().renderNote(note, input.value); }
    input.addEventListener('change', upd);
    upd();
  }
  function toKintoneDT(d) { return d.toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function dtLabel(iso) {
    var d = new Date(iso);
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ') ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function dLabel(s) {
    if (!s) return '';
    var d = new Date(s + 'T00:00:00');
    return (d.getMonth() + 1) + '/' + d.getDate() + '(' + WEEKDAYS[d.getDay()] + ')';
  }
  // <input type="datetime-local"> の値(ローカル時刻) ⇔ kintoneの日時(UTC)
  function localInput(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return ymd(d) + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fromLocalInput(v) { return v ? toKintoneDT(new Date(v)) : ''; }
  function users(list) { return (list || []).map(function (u) { return { code: u.code }; }); }
  function names(list) { return (list || []).map(function (u) { return u.name; }).join('・'); }
  function esc(s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function el(tag, attrs, html) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { if (k === 'className') e.className = attrs[k]; else e.setAttribute(k, attrs[k]); });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function dealUrl(id) { return IS_MOBILE ? '/k/m/' + DEAL_APP_ID + '/show?record=' + id : '/k/' + DEAL_APP_ID + '/show#record=' + id; }
  function actUrl(id) { return IS_MOBILE ? '/k/m/' + ACTIVITY_APP_ID + '/show?record=' + id : '/k/' + ACTIVITY_APP_ID + '/show#record=' + id; }

  // ---------- 見た目 ----------
  function injectStyle() {
    if (document.getElementById('chub-style')) return;
    var css = [
      '#chub-root{font-size:13px;color:#1e293b;margin:8px 0 12px;max-width:1100px}',
      '#chub-root .chub-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}',
      '#chub-root button.chub-btn{padding:8px 16px;border-radius:6px;border:1px solid #2563eb;background:#fff;color:#2563eb;cursor:pointer;font-size:14px}',
      '#chub-root button.chub-btn.primary{background:#2563eb;color:#fff}',
      '#chub-root .chub-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}',
      '#chub-root .chub-card{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;background:#f8fafc;min-width:0}',
      '#chub-root .chub-card h4{margin:0 0 6px;font-size:12px;color:#64748b;font-weight:bold}',
      '#chub-root .chub-card.wide{grid-column:span 2}',
      '#chub-root .chub-item{padding:5px 0;border-top:1px dashed #e2e8f0;line-height:1.5;overflow-wrap:anywhere}',
      '#chub-root .chub-item:first-of-type{border-top:none}',
      '#chub-root .chub-muted{color:#94a3b8}',
      '#chub-root .chub-warn{color:#b91c1c;font-weight:bold}',
      '#chub-root a{color:#2563eb;text-decoration:none}',
      '.chub-badge{display:inline-block;padding:1px 7px;border-radius:10px;font-size:11px;margin-right:4px;background:#e2e8f0;color:#334155;white-space:nowrap}',
      '.chub-badge.b-apo{background:#dcfce7;color:#166534}.chub-badge.b-neta{background:#fef9c3;color:#854d0e}',
      '.chub-badge.b-fuzai{background:#e0e7ff;color:#3730a3}.chub-badge.b-call{background:#f1f5f9;color:#475569}',
      '.chub-badge.b-visit{background:#fce7f3;color:#9d174d}',
      '.chub-badge.b-block{background:#fee2e2;color:#991b1b}',
      '#chub-root.chub-m .chub-grid{grid-template-columns:1fr}',
      '#chub-root.chub-m .chub-card.wide{grid-column:auto}',
      '#chub-root.chub-m .chub-bar button.chub-btn{flex:1 1 100%;padding:12px}',
      '#chub-root.chub-m{margin:8px 12px}',
      '.chub-bg{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:10000;display:flex;align-items:center;justify-content:center;padding:12px}',
      '.chub-modal{background:#fff;border-radius:10px;padding:16px;width:100%;max-width:460px;max-height:calc(100vh - 24px);overflow:auto;font-size:14px;box-shadow:0 10px 30px rgba(0,0,0,.25);box-sizing:border-box}',
      '.chub-modal h3{margin:0 0 4px;font-size:16px}',
      '.chub-modal .chub-sub{color:#64748b;font-size:12px;margin-bottom:10px}',
      '.chub-modal label{display:block;color:#475569;margin:12px 0 5px;font-size:13px}',
      '.chub-modal input,.chub-modal select,.chub-modal textarea{width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:6px;box-sizing:border-box;font-size:14px;font-family:inherit}',
      '.chub-modal textarea{min-height:70px}',
      '.chub-results{display:grid;grid-template-columns:1fr 1fr;gap:6px}',
      '.chub-results button{padding:8px 6px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;text-align:left;line-height:1.3}',
      '.chub-results button small{display:block;color:#64748b;font-size:11px}',
      '.chub-results button.on{background:#1e293b;color:#fff;border-color:#1e293b}.chub-results button.on small{color:#cbd5e1}',
      '.chub-apo{margin-top:12px;padding:10px 12px;border:1px solid #86efac;background:#f0fdf4;border-radius:8px}',
      '.chub-apo b{color:#166534}',
      '.chub-btns{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}',
      '.chub-btns button{padding:9px 16px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;font-size:14px}',
      '.chub-btns button.primary{border-color:#2563eb;background:#2563eb;color:#fff}',
      '.chub-btns button:disabled{opacity:.5;cursor:default}',
      '.chub-row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}',
      '.chub-chips{display:flex;flex-wrap:wrap;gap:6px}',
      '.chub-chip{padding:7px 12px;border:1px solid #cbd5e1;border-radius:16px;background:#fff;cursor:pointer;font-size:13px}',
      '.chub-chip.on{background:#2563eb;border-color:#2563eb;color:#fff}',
      '.chub-chip.on::before{content:"✓ "}'
    ].join('\n');
    var s = el('style', { id: 'chub-style' });
    s.textContent = css;
    document.head.appendChild(s);
  }

  function badgeOf(a) {
    var r = fv(a, 'コール業務', '');
    var kind = fv(a, '対応種別', '');
    if (r) {
      var cls = r === 'アポ獲得' ? 'b-apo' : r === 'ネタ' ? 'b-neta' : r === '担当不在' ? 'b-fuzai' : (r === '受付ブロック' || r === '失注') ? 'b-block' : 'b-call';
      return '<span class="chub-badge ' + cls + '">📞 ' + esc(r) + '</span>';
    }
    if (kind.indexOf('商談') === 0) return '<span class="chub-badge b-visit">🤝 ' + esc(kind) + '</span>';
    return '<span class="chub-badge">' + esc(kind || 'その他') + '</span>';
  }

  // ---------- データ ----------
  function loadAll(custNo) {
    var q = function (p) { return p.catch(function () { return { records: [] }; }); };
    return kintone.Promise.all([
      q(api('/k/v1/records', 'GET', { app: DEAL_APP_ID, query: '顧客No_ = "' + custNo + '" order by 案件No_ desc limit 50',
        fields: ['$id', '案件No_', '案件名', '会社名', '顧客No_', '提案商品', '商談フェーズ', '確度', '次回商談日', '受注予定日', '受注日', '売上', '主担当', '商談担当者', 'アポ獲得者'] })),
      q(api('/k/v1/records', 'GET', { app: ACTIVITY_APP_ID, query: '顧客No = "' + custNo + '" order by 対応日付 desc, $id desc limit 6',
        fields: ['$id', '対応日付', '対応種別', 'コール業務', '対応者', '内容', 'タイトル'] })),
      q(api('/k/v1/records', 'GET', { app: CONTACT_APP_ID, query: '顧客No_ = "' + custNo + '" limit 20',
        fields: ['$id', 'お名前', '姓', '名', '役職', '部署', '電話番号', '携帯番号', '決裁権'] })),
      // スケジュールを見られない人もいるので、失敗したら空として扱う
      q(api('/k/v1/records', 'GET', { app: SCHEDULE_APP_ID,
        query: '顧客No = "' + custNo + '" and 元予定No = "" and 実施状況 in ("予定") and 開始日時 >= NOW() order by 開始日時 asc limit 3',
        fields: ['$id', '件名', '種類', '開始日時', '参加者'] })),
      q(api('/k/v1/app/form/fields', 'GET', { app: DEAL_APP_ID }).then(function (r) { return { records: [], props: r.properties }; }))
    ]).then(function (res) {
      return { deals: res[0].records, acts: res[1].records, contacts: res[2].records, plans: res[3].records, dealProps: res[4].props || {} };
    });
  }

  function optionsOf(props, code, fallback) {
    var o = props[code] && props[code].options;
    if (!o) return fallback;
    return Object.keys(o).sort(function (a, b) { return Number(o[a].index) - Number(o[b].index); });
  }

  // 商談担当の候補: スケジュール表示メンバー(35)。読めなければ自分だけ
  var memberCache = null;
  function loadMembers() {
    if (memberCache) return kintone.Promise.resolve(memberCache);
    var me = kintone.getLoginUser();
    // 「表示」(スケジュールに出すか)では絞らない。商談に行く人は誰でも選べるようにする(2026-10-16)
    return api('/k/v1/records', 'GET', { app: MEMBER_APP_ID, query: 'order by 表示順 asc limit 100', fields: ['メンバー'] })
      .then(function (resp) {
        var list = [];
        resp.records.forEach(function (r) { fv(r, 'メンバー', []).forEach(function (u) { if (!list.some(function (x) { return x.code === u.code; })) list.push(u); }); });
        if (!list.some(function (x) { return x.code === me.code; })) list.unshift({ code: me.code, name: me.name });
        memberCache = list;
        return list;
      }).catch(function () { memberCache = [{ code: me.code, name: me.name }]; return memberCache; });
  }

  // 商談に行く人を選ぶボタン群。selected: 最初に選んでおく人 [{code,name}]。get() で選ばれている人を返す
  function userPicker(box, selected) {
    var chosen = {};
    var order = [];
    (selected || []).forEach(function (u) { chosen[u.code] = u; });
    function draw(list) {
      box.innerHTML = '';
      list.forEach(function (u) {
        if (order.indexOf(u.code) < 0) order.push(u.code);
        var b = el('button', { type: 'button', 'class': 'chub-chip' + (chosen[u.code] ? ' on' : '') }, esc(u.name));
        b.addEventListener('click', function () {
          if (chosen[u.code]) delete chosen[u.code]; else chosen[u.code] = u;
          b.classList.toggle('on', !!chosen[u.code]);
        });
        box.appendChild(b);
      });
    }
    loadMembers().then(function (list) {
      // 候補に無い人(今の商談担当者など)も出す
      var all = list.slice();
      (selected || []).forEach(function (u) { if (!all.some(function (x) { return x.code === u.code; })) all.push(u); });
      draw(all);
    });
    return { get: function () { return order.filter(function (c) { return chosen[c]; }).map(function (c) { return chosen[c]; }); } };
  }

  // ---------- スケジュール連動(customize-schedule-links.js の pushToSchedule と同じ考え方) ----------
  function findAt(dealNo, iso) {
    return api('/k/v1/records', 'GET', {
      app: SCHEDULE_APP_ID, fields: ['$id', '開始日時', '終了日時', '公開区分'],
      query: '案件No = "' + dealNo + '" and 元予定No = "" and 開始日時 = "' + iso + '" limit 1'
    }).then(function (resp) { return resp.records[0] || null; });
  }

  // deal: {会社名, 提案商品, 顧客No_, 商談担当者[], 主担当[], 次回商談日}
  function pushToSchedule(dealNo, deal, prev) {
    var next = deal.次回商談日;
    if (!next) return kintone.Promise.resolve('');
    return kintone.Promise.all([findAt(dealNo, next), prev ? findAt(dealNo, prev) : kintone.Promise.resolve(null)]).then(function (res) {
      if (res[0]) return '';
      var old = res[1];
      if (old) {
        if (fv(old, '公開区分', '') === '非公開') throw new Error('前の次回商談日の予定が非公開のため、自動では動かしませんでした。スケジュールで直してください。');
        var dur = new Date(fv(old, '終了日時', '')).getTime() - new Date(fv(old, '開始日時', '')).getTime();
        var end = new Date(new Date(next).getTime() + (dur > 0 ? dur : 3600000));
        return api('/k/v1/record', 'PUT', { app: SCHEDULE_APP_ID, id: old.$id.value, record: { 開始日時: { value: next }, 終了日時: { value: toKintoneDT(end) } } })
          .then(function () { return 'スケジュールの予定(' + dtLabel(next) + ')を動かしました。'; });
      }
      var us = deal.商談担当者 && deal.商談担当者.length ? deal.商談担当者 : (deal.主担当 && deal.主担当.length ? deal.主担当 : [kintone.getLoginUser()]);
      var name = deal.会社名 + (deal.提案商品 ? ' / ' + deal.提案商品 : '');
      var rec = {
        件名: { value: '商談: ' + name }, 種類: { value: '訪問' },
        開始日時: { value: next }, 終了日時: { value: toKintoneDT(new Date(new Date(next).getTime() + 3600000)) },
        参加者: { value: users(us) }, 案件No: { value: String(dealNo) },
        リマインダー: { value: ['1時間前', '当日の朝8時'] },
        出欠: { value: us.map(function (u) { return { value: { 出欠_参加者: { value: [{ code: u.code }] }, 出欠_回答: { value: '承諾' }, 出欠_コメント: { value: '' } } }; }) },
        内容: { value: '(案件管理の次回商談日から自動作成)' }
      };
      if (deal.顧客No_) rec.顧客No = { value: String(deal.顧客No_) };
      return api('/k/v1/record', 'POST', { app: SCHEDULE_APP_ID, record: rec })
        .then(function () { return 'スケジュールに予定(' + dtLabel(next) + ')を作りました。'; });
    });
  }

  // ---------- パネル ----------
  function openDeals(deals) { return deals.filter(function (d) { return CLOSED.indexOf(fv(d, '商談フェーズ', '')) < 0; }); }

  function render(root, ctx) {
    var r = ctx.record, data = ctx.data;
    var open = openDeals(data.deals);
    var closed = data.deals.length - open.length;
    root.innerHTML = '';
    root.className = IS_MOBILE ? 'chub-m' : '';

    var bar = el('div', { className: 'chub-bar' });
    var b1 = el('button', { type: 'button', className: 'chub-btn primary' }, '📞 架電を記録');
    var b5 = el('button', { type: 'button', className: 'chub-btn primary' }, '🚶 訪問を記録');
    var b2 = el('button', { type: 'button', className: 'chub-btn' }, '💼 案件を作る・進める');
    var b3 = el('button', { type: 'button', className: 'chub-btn' }, '📅 予定を入れる');
    b1.addEventListener('click', function () { openCallDialog(ctx); });
    b5.addEventListener('click', function () { openVisitDialog(ctx); });
    b2.addEventListener('click', function () { openDealDialog(ctx, open.length === 1 ? open[0] : null); });
    b3.addEventListener('click', function () { openSchedule(ctx); });
    bar.appendChild(b1); bar.appendChild(b5); bar.appendChild(b2); bar.appendChild(b3);
    // Googleマップ: 登録時のURLがあればそれ、無ければ店名+住所で検索
    var web = fv(r, 'Webサイト', '');
    var murl = fv(r, 'GoogleマップURL', '') || (/google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/.test(web) ? web : '') ||
      'https://www.google.com/maps/search/?api=1&query=' +
      encodeURIComponent([fv(r, '会社名', ''), fv(r, '都道府県', ''), fv(r, '住所', '')].join(' ').trim());
    var b4 = el('button', { type: 'button', className: 'chub-btn' }, '📍 Googleマップ');
    b4.addEventListener('click', function () { window.open(murl, '_blank'); });
    bar.appendChild(b4);
    root.appendChild(bar);

    var grid = el('div', { className: 'chub-grid' });

    // 案件
    var h = '<h4>💼 案件(進行中 ' + open.length + '件' + (closed ? '・終了 ' + closed + '件' : '') + ')</h4>';
    if (!open.length) h += '<div class="chub-muted">進行中の案件はありません。<br>アポが取れたら「📞 架電を記録」→アポ獲得で自動で作られます。</div>';
    open.forEach(function (d) {
      var next = fv(d, '次回商談日', '');
      var late = next && new Date(next) < new Date();
      h += '<div class="chub-item"><a href="' + dealUrl(d.$id.value) + '">' + esc(fv(d, '提案商品', '') || '(商品未選択)') + '</a> ' +
        '<span class="chub-badge">' + esc(fv(d, '商談フェーズ', '') || 'フェーズ未入力') + '</span>' +
        (fv(d, '確度', '') ? '<span class="chub-badge">確度 ' + esc(fv(d, '確度', '')) + '</span>' : '') +
        '<br>次回商談: ' + (next ? '<span class="' + (late ? 'chub-warn' : '') + '">' + dtLabel(next) + (late ? '(過ぎています)' : '') + '</span>' : '<span class="chub-muted">未定</span>') +
        (names(fv(d, '商談担当者', [])) ? '<br><span class="chub-muted">商談: ' + esc(names(fv(d, '商談担当者', []))) + '</span>' : '') + '</div>';
    });
    // 終了した案件(受注・失注・保留/中止)も見えるように並べる(「💼 案件を作る・進める」からも選べる)
    data.deals.filter(function (d) { return CLOSED.indexOf(fv(d, '商談フェーズ', '')) >= 0; }).slice(0, 5).forEach(function (d) {
      var ph = fv(d, '商談フェーズ', '');
      h += '<div class="chub-item chub-muted"><a href="' + dealUrl(d.$id.value) + '" style="color:#64748b">' + esc(fv(d, '提案商品', '') || '(商品未選択)') + '</a> ' +
        '<span class="chub-badge' + (ph === '受注' ? ' b-apo' : '') + '">' + esc(ph) + '</span>' +
        (Number(fv(d, '売上', 0)) > 0 ? ' ' + Number(fv(d, '売上', 0)).toLocaleString() + '円' : '') + '</div>';
    });
    grid.appendChild(el('div', { className: 'chub-card' }, h));

    // 次の連絡・予定
    var nextCall = fv(r, '次回連絡日', '');
    h = '<h4>📌 次にやること</h4>';
    if (r['次回連絡日']) {
      var lateCall = nextCall && nextCall < TD().today();
      h += '<div class="chub-item">次回連絡日: ' + (nextCall ? '<span class="' + (lateCall ? 'chub-warn' : '') + '">' + dLabel(nextCall) + (lateCall ? '(過ぎています)' : '') + '</span>' : '<span class="chub-muted">未定</span>') + '</div>';
    }
    if (data.plans.length) {
      data.plans.forEach(function (p) {
        h += '<div class="chub-item">📅 ' + dtLabel(fv(p, '開始日時', '')) + ' ' + esc(fv(p, '件名', '')) + '<br><span class="chub-muted">' + esc(names(fv(p, '参加者', []))) + '</span></div>';
      });
    } else {
      h += '<div class="chub-item chub-muted">これからの予定はありません</div>';
    }
    grid.appendChild(el('div', { className: 'chub-card' }, h));

    // 先方担当者
    h = '<h4>👤 先方の担当者</h4>';
    if (!data.contacts.length) h += '<div class="chub-muted">未登録</div>';
    data.contacts.forEach(function (c) {
      var nm = fv(c, 'お名前', '') || (fv(c, '姓', '') + ' ' + fv(c, '名', '')).trim();
      var tel = fv(c, '携帯番号', '') || fv(c, '電話番号', '');
      h += '<div class="chub-item">' + esc(nm) + (fv(c, '決裁権', '') === 'あり' ? ' <span class="chub-badge b-apo">決裁者</span>' : '') +
        '<br><span class="chub-muted">' + esc([fv(c, '部署', ''), fv(c, '役職', '')].filter(Boolean).join(' ')) + '</span>' +
        (tel ? '<br><a href="tel:' + esc(tel.replace(/[^\d+]/g, '')) + '">📞 ' + esc(tel) + '</a>' : '') + '</div>';
    });
    grid.appendChild(el('div', { className: 'chub-card' }, h));

    // 最近のやりとり
    h = '<h4>🕘 最近のやりとり</h4>';
    if (!data.acts.length) h += '<div class="chub-muted">まだありません</div>';
    data.acts.slice(0, 5).forEach(function (a) {
      var memo = fv(a, '内容', '').replace(/\s+/g, ' ');
      h += '<div class="chub-item">' + dLabel(fv(a, '対応日付', '')) + ' ' + badgeOf(a) + '<span class="chub-muted">' + esc(names(fv(a, '対応者', []))) + '</span>' +
        (memo ? '<br><a href="' + actUrl(a.$id.value) + '" style="color:#334155">' + esc(memo.length > 46 ? memo.slice(0, 46) + '…' : memo) + '</a>' : '') + '</div>';
    });
    grid.appendChild(el('div', { className: 'chub-card' }, h));

    root.appendChild(grid);
  }

  // ---------- 📞 架電を記録 ----------
  // 架電の結果・アポ・メモ・次回連絡日の入力欄(架電を記録/新規登録の両方で使う)
  // opts: {open(進行中の案件), dealProps, hasNextField, nextValue}。戻り値: {el, read(): 入力値 or null(足りない)}
  function buildCallForm(opts) {
    var open = opts.open || [];
    var w = el('div');
    w.innerHTML = '<label style="margin-top:0">架電した日</label><input type="date" class="c-date"><div class="chub-sub c-date-note" style="margin:4px 0 0;color:#b45309"></div>' +
      '<label>結果</label><div class="chub-results"></div>' +
      '<div class="chub-apo c-lose" style="display:none;border-color:#fca5a5;background:#fef2f2"><b style="color:#991b1b">失注 — 今後はかけません</b>' +
      (open.length ? '<label style="display:flex;gap:6px;align-items:center;margin:8px 0 0"><input type="checkbox" class="c-lose-deal" checked style="width:auto">進行中の案件(' +
        esc(open.map(function (d) { return fv(d, '提案商品', '') || '商品未選択'; }).join('・')) + ')も失注にする</label>' : '') +
      '<div class="chub-sub" style="margin:6px 0 0">次回連絡日は空にします。断られた理由をメモに残してください。</div></div>' +
      '<div class="chub-apo" style="display:none"><b>🎉 アポ獲得 — 商談の予定</b>' +
      '<label>商談の日時</label><input type="datetime-local" class="c-apo-dt">' +
      '<label>商談に行く人(押すたびに選ぶ/外す。何人でも)</label><div class="chub-chips c-apo-users"></div>' +
      '<div class="chub-row2"><div><label>提案商品</label><select class="c-apo-item"></select></div>' +
      '<div><label>確度</label><select class="c-apo-kakudo"></select></div></div>' +
      '<div class="chub-sub" style="margin:8px 0 0">' + (open.length ? '進行中の案件(' + esc(fv(open[0], '提案商品', '') || '商品未選択') + ')の次回商談日を更新します。' : '案件を新しく作り、') + 'あなたと商談に行く人の両方の予定表に入ります。</div></div>' +
      '<label>メモ(話した内容・相手の名前・かけ直す時間など)</label><textarea class="c-memo"></textarea>' +
      (opts.hasNextField ? '<label>次回連絡日(またかけるとき)</label><input type="date" class="c-next">' : '');
    var chosen = '';
    var box = w.querySelector('.chub-results');
    var apoBox = w.querySelector('.chub-apo:not(.c-lose)');
    var loseBox = w.querySelector('.c-lose');
    var dateIn = w.querySelector('.c-date');
    dateIn.value = workDay();
    dateNote(dateIn, w.querySelector('.c-date-note'));
    var nextIn = opts.hasNextField ? w.querySelector('.c-next') : null;
    CALL_RESULTS.forEach(function (c) {
      var b = el('button', { type: 'button' }, esc(c.v) + '<small>' + esc(c.hint) + '</small>');
      b.addEventListener('click', function () {
        chosen = c.v;
        [].forEach.call(box.children, function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        apoBox.style.display = chosen === 'アポ獲得' ? 'block' : 'none';
        loseBox.style.display = chosen === '失注' ? 'block' : 'none';
        if (nextIn) {
          // 失注は今後かけないので次回連絡日を空に。ほかの結果に戻したら元の値に
          nextIn.disabled = chosen === '失注';
          nextIn.value = chosen === '失注' ? '' : (nextIn.value || opts.nextValue || '');
        }
      });
      box.appendChild(b);
    });
    if (nextIn && opts.nextValue) nextIn.value = opts.nextValue;
    var itemSel = w.querySelector('.c-apo-item');
    optionsOf(opts.dealProps || {}, '提案商品', ['RIDE CAST(タクシー動画広告)', 'MEO代行', 'その他']).forEach(function (v) {
      var o = el('option', { value: v }, esc(v));
      if (v === (open.length ? fv(open[0], '提案商品', '') : 'MEO代行')) o.selected = true;
      itemSel.appendChild(o);
    });
    // 確度(2026-10-20): アポの段階は低めの20%を初期値に。進行中の案件に確度があればそれ
    var kakudoSel = w.querySelector('.c-apo-kakudo');
    var curKakudo = open.length && fv(open[0], '確度', '') ? fv(open[0], '確度', '') : '20%';
    optionsOf(opts.dealProps || {}, '確度', ['100%', '80%', '60%', '40%', '20%']).forEach(function (v) {
      var o = el('option', { value: v }, esc(v));
      if (v === curKakudo) o.selected = true;
      kakudoSel.appendChild(o);
    });
    var me = kintone.getLoginUser();
    // 最初は自分(アポを取った人)を選んでおく。訪問する人を足す
    var picker = userPicker(w.querySelector('.c-apo-users'), [{ code: me.code, name: me.name }]);
    return {
      el: w,
      read: function () {
        if (!chosen) { alert('結果を選んでください'); return null; }
        if (!dateIn.value) { alert('架電した日を入れてください'); return null; }
        var apoDt = fromLocalInput(w.querySelector('.c-apo-dt').value);
        if (chosen === 'アポ獲得' && !apoDt) { alert('商談の日時を入れてください'); return null; }
        if (chosen === 'アポ獲得' && !picker.get().length) { alert('商談に行く人を選んでください'); return null; }
        return {
          open: open, chosen: chosen, memo: w.querySelector('.c-memo').value.trim(), date: dateIn.value,
          loseDeal: chosen === '失注' && !!w.querySelector('.c-lose-deal') && w.querySelector('.c-lose-deal').checked,
          next: nextIn ? nextIn.value : '', prevNext: opts.nextValue || '', hasNextField: opts.hasNextField,
          apoDt: apoDt, apoUsers: picker.get(),
          item: itemSel.value, kakudo: kakudoSel.value
        };
      }
    };
  }

  function openCallDialog(ctx) {
    var r = ctx.record, data = ctx.data;
    var form = buildCallForm({ open: openDeals(data.deals), dealProps: data.dealProps, hasNextField: !!r['次回連絡日'], nextValue: fv(r, '次回連絡日', '') });
    var bg = el('div', { className: 'chub-bg' });
    var m = el('div', { className: 'chub-modal' });
    m.innerHTML = '<h3>📞 架電を記録</h3><div class="chub-sub">' + esc(fv(r, '会社名', '')) + ' ・ ' + esc(kintone.getLoginUser().name) + '(活動履歴に1件残ります)</div>';
    m.appendChild(form.el);
    m.appendChild(el('div', { className: 'chub-btns' }, '<button type="button" class="c-cancel">キャンセル</button><button type="button" class="primary c-save">保存</button>'));
    bg.appendChild(m);
    document.body.appendChild(bg);

    function close() { if (bg.parentNode) document.body.removeChild(bg); }
    m.querySelector('.c-cancel').addEventListener('click', close);
    m.querySelector('.c-save').addEventListener('click', function () {
      var p = form.read();
      if (!p) return;
      var btn = this;
      btn.disabled = true;
      var msgs = [];
      p.custNo = fv(r, '顧客No', '') || fv(r, '$id', '');
      p.company = fv(r, '会社名', '');
      recordCall(p, msgs).then(function () {
        close();
        alert('記録しました。' + (msgs.length ? '\n' + msgs.join('\n') : ''));
        location.reload();
      }).catch(function (err) {
        btn.disabled = false;
        alert('記録できませんでした。' + (msgs.length ? '\n(ここまでは済んでいます: ' + msgs.join(' ') + ')' : '') + (err && err.message ? '\n' + err.message : ''));
      });
    });
  }

  // 架電1本の記録: アポ獲得なら案件を作る/更新して予定も入れ、活動履歴に1件、次回連絡日を更新する。
  // p: {custNo, company, open(進行中の案件), chosen, memo, next, prevNext, hasNextField, apoDt, apoUsers, item, kakudo}
  // msgs: 済んだことを順に足していく(途中で失敗したときに伝えるため)
  function recordCall(p, msgs) {
    var me = kintone.getLoginUser();
    var open = p.open || [], chosen = p.chosen, memo = p.memo, custNo = p.custNo, company = p.company;
    var apoDt = p.apoDt, next = p.next;
    // 1. アポ獲得なら案件を作る/更新して、予定も入れる
    var dealP = kintone.Promise.resolve(open.length === 1 ? open[0].$id.value : '');
    if (chosen === 'アポ獲得') {
      // 商談担当者=選んだ人(最初は自分が選ばれている。架電時フローどおり、アポを取った人と行く人の両方を入れると両方の予定表に入る)
      var team = p.apoUsers && p.apoUsers.length ? p.apoUsers : [{ code: me.code, name: me.name }];
      var item = p.item;
      if (open.length) {
        var d = open[0];
        var prev = fv(d, '次回商談日', '');
        var upd = { 次回商談日: { value: apoDt }, 商談担当者: { value: users(team) } };
        if (!fv(d, '商談フェーズ', '')) upd.商談フェーズ = { value: '商談予定' };
        if (!fv(d, '提案商品', '')) upd.提案商品 = { value: item };
        if (p.kakudo && p.kakudo !== fv(d, '確度', '')) upd.確度 = { value: p.kakudo };
        if (!fv(d, 'アポ獲得者', []).length) upd.アポ獲得者 = { value: [{ code: me.code }] };
        dealP = api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: d.$id.value, record: upd }).then(function () {
          msgs.push('案件(' + (fv(d, '提案商品', '') || item) + ')の次回商談日を ' + dtLabel(apoDt) + ' にしました。');
          return pushToSchedule(d.$id.value, { 会社名: company, 提案商品: fv(d, '提案商品', '') || item, 顧客No_: custNo, 商談担当者: team, 次回商談日: apoDt }, prev);
        }).then(function (m2) { if (m2) msgs.push(m2); return d.$id.value; });
      } else {
        var rec = {
          会社名: { value: company }, 提案商品: { value: item }, 商談フェーズ: { value: '商談予定' }, 確度: { value: p.kakudo || '' },
          主担当: { value: [{ code: me.code }] }, 商談担当者: { value: users(team) }, アポ獲得者: { value: [{ code: me.code }] },
          初回商談日: { value: TD().ofIso(apoDt).date }, 次回商談日: { value: apoDt },
          詳細: { value: memo ? '(アポ獲得時のメモ)' + memo : '' }
        };
        dealP = api('/k/v1/record', 'POST', { app: DEAL_APP_ID, record: rec }).then(function (resp) {
          msgs.push('案件(' + item + ')を作りました。');
          return pushToSchedule(resp.id, { 会社名: company, 提案商品: item, 顧客No_: custNo, 商談担当者: team, 次回商談日: apoDt }, '')
            .then(function (m2) { if (m2) msgs.push(m2); return resp.id; });
        });
      }
    }
    // 1'. 失注で「進行中の案件も失注にする」なら、案件のフェーズを失注に(活動履歴は最初の案件に紐付ける)
    if (chosen === '失注' && p.loseDeal && open.length) {
      dealP = kintone.Promise.all(open.map(function (d) {
        return api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: d.$id.value, record: { 商談フェーズ: { value: '失注' } } });
      })).then(function () {
        msgs.push('進行中の案件(' + open.length + '件)を失注にしました。');
        return open[0].$id.value;
      });
    }

    // 2. 活動履歴に1件(案件があれば紐付け) 3. 次回連絡日
    return dealP.then(function (dealNo) {
      var act = {
        タイトル: { value: '架電: ' + company }, 対応日付: { value: p.date || workDay() },
        対応者: { value: [{ code: me.code }] }, 対応種別: { value: '架電' }, コール業務: { value: chosen },
        内容: { value: memo || chosen }, 会社名: { value: company }
      };
      if (dealNo) act.案件No = { value: String(dealNo) };
      return api('/k/v1/record', 'POST', { app: ACTIVITY_APP_ID, record: act });
    }).then(function () {
      msgs.push('活動履歴に記録しました。');
      if (!p.hasNextField || next === (p.prevNext || '')) return null;
      return api('/k/v1/record', 'PUT', { app: CUSTOMER_APP_ID, id: custNo, record: { 次回連絡日: { value: next || null } } });
    });
  }

  // ---------- 🚶 訪問を記録(2026-10-17) ----------
  // 予定の無い突発の訪問も、ここから活動履歴に1件残す(活動履歴は確認用で、直接は入力しない)。
  // 今日の自分の訪問予定(まだ「予定」のもの)がこの会社にあれば、その予定の訪問として記録して予定を「完了」にする。
  // スケジュールの「✅ 訪問完了」と同じ結果になり、同じ訪問が2件にならない。
  function syncDealNext(no) {
    if (!no) return kintone.Promise.resolve(null);
    var base = '案件No = "' + no + '" and 元予定No = ""';
    return kintone.Promise.all([
      api('/k/v1/records', 'GET', { app: SCHEDULE_APP_ID, fields: ['開始日時'],
        query: base + ' and 実施状況 in ("予定") and 種類 not in ("休暇") and 開始日時 >= NOW() order by 開始日時 asc limit 1' }),
      api('/k/v1/record', 'GET', { app: DEAL_APP_ID, id: no })
    ]).then(function (res) {
      var next = res[0].records[0] ? fv(res[0].records[0], '開始日時', '') : '';
      if (!next || next === fv(res[1].record, '次回商談日', '')) return null;
      return api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: no, record: { 次回商談日: { value: next } } });
    }).catch(function () { return null; });
  }

  // day: 訪問した日(省略で日本時間の今日)。carry: 日付を変えて開き直すときに引き継ぐ入力
  function openVisitDialog(ctx, day, carry) {
    var r = ctx.record, data = ctx.data, props = data.dealProps || {};
    var custNo = fv(r, '顧客No', '') || fv(r, '$id', '');
    var company = fv(r, '会社名', '');
    var me = kintone.getLoginUser();
    var today = day || workDay();
    var open = openDeals(data.deals);
    // スケジュールを見られない人は予定なしとして扱う
    api('/k/v1/records', 'GET', { app: SCHEDULE_APP_ID, fields: ['$id', '件名', '開始日時', '案件No', '内容'],
      query: '顧客No = "' + custNo + '" and 元予定No = "" and 種類 in ("訪問") and 実施状況 in ("予定") and 参加者 in (LOGINUSER()) and ' +
        TD().dayQuery('開始日時', today) + ' order by 開始日時 asc limit 5' })
      .then(function (resp) { return resp.records; }).catch(function () { return []; })
      .then(function (plans) { showVisitDialog(plans); });

    function showVisitDialog(plans) {
      var hasNext = !!r['次回連絡日'];
      var bg = el('div', { className: 'chub-bg' });
      var m = el('div', { className: 'chub-modal' });
      m.innerHTML = '<h3>🚶 訪問を記録</h3><div class="chub-sub">' + esc(company) + ' ・ ' + esc(me.name) + '(活動履歴に1件残ります)</div>' +
        '<label style="margin-top:0">訪問した日</label><input type="date" class="v-date"><div class="chub-sub v-date-note" style="margin:4px 0 0;color:#b45309"></div>' +
        (plans.length ? '<label>' + dLabel(today) + 'の訪問予定</label><select class="v-plan"></select>' +
          '<div class="chub-sub v-plan-note" style="margin:6px 0 0"></div>' : '') +
        '<label>案件</label><select class="v-deal"></select>' +
        '<div class="chub-row2 v-deal-box"><div><label>商談フェーズ</label><select class="v-phase"></select></div>' +
        '<div><label>確度</label><select class="v-kakudo"></select></div></div>' +
        '<label>報告(話した内容・先方の反応・次の約束)</label><textarea class="v-memo"></textarea>' +
        (hasNext ? '<label>次回連絡日(また連絡するとき)</label><input type="date" class="v-next">' : '') +
        '<div class="chub-btns"><button type="button" class="v-cancel">キャンセル</button><button type="button" class="primary v-save">保存</button></div>';
      bg.appendChild(m);
      document.body.appendChild(bg);
      var $ = function (c) { return m.querySelector(c); };
      if (hasNext && fv(r, '次回連絡日', '')) $('.v-next').value = fv(r, '次回連絡日', '');
      if (carry) {
        $('.v-memo').value = carry.memo || '';
        if (hasNext && carry.next !== undefined) $('.v-next').value = carry.next;
      }
      $('.v-date').value = today;
      dateNote($('.v-date'), $('.v-date-note'));
      // 日付を変えたら、その日の訪問予定で選び直せるように開き直す(書いた報告は引き継ぐ)
      function reopen(v) {
        var keep = { memo: $('.v-memo').value, next: hasNext ? $('.v-next').value : undefined };
        if (bg.parentNode) document.body.removeChild(bg);
        openVisitDialog(ctx, v, keep);
      }
      // キーボードで打ち終わるまで待つ(2026-10-25 P1。1文字目で開き直して違う日になっていた)
      TD().onDateCommit($('.v-date'), function (v) { if (v && v !== today) reopen(v); }, [$('.v-save'), $('.v-cancel')]);

      var dealSel = $('.v-deal');
      dealSel.appendChild(el('option', { value: '' }, '(案件なし)'));
      open.forEach(function (d) {
        dealSel.appendChild(el('option', { value: d.$id.value }, esc((fv(d, '提案商品', '') || '商品未選択') + ' / ' + (fv(d, '商談フェーズ', '') || 'フェーズ未入力') + '(案件No.' + d.$id.value + ')')));
      });
      function dealOf(id) { return data.deals.filter(function (d) { return d.$id.value === String(id); })[0] || null; }
      function fill(sel, code, fallback, cur) {
        sel.innerHTML = '';
        sel.appendChild(el('option', { value: '' }, '(未選択)'));
        optionsOf(props, code, fallback).forEach(function (v) { var o = el('option', { value: v }, esc(v)); if (v === cur) o.selected = true; sel.appendChild(o); });
      }
      function loadDeal() {
        var d = dealOf(dealSel.value);
        $('.v-deal-box').style.display = d ? '' : 'none';
        fill($('.v-phase'), '商談フェーズ', ['商談予定', '提案中', '内示', '受注', '失注', '保留/中止'], d ? fv(d, '商談フェーズ', '') : '');
        fill($('.v-kakudo'), '確度', ['100%', '80%', '60%', '40%', '20%'], d ? fv(d, '確度', '') : '');
      }
      function setDeal(id) {
        // 終了した案件の予定などで候補に無いときは、案件の欄を足して選べるようにする
        if (id && !dealSel.querySelector('option[value="' + id + '"]') && dealOf(id)) {
          dealSel.appendChild(el('option', { value: String(id) }, esc((fv(dealOf(id), '提案商品', '') || '商品未選択') + ' / ' + fv(dealOf(id), '商談フェーズ', '') + '(案件No.' + id + ')')));
        }
        dealSel.value = id && dealSel.querySelector('option[value="' + id + '"]') ? String(id) : (open.length === 1 ? open[0].$id.value : '');
        loadDeal();
      }
      dealSel.addEventListener('change', loadDeal);

      var planSel = $('.v-plan');
      function planOf(id) { return plans.filter(function (p) { return p.$id.value === id; })[0] || null; }
      if (planSel) {
        plans.forEach(function (p) {
          planSel.appendChild(el('option', { value: p.$id.value }, esc(dtLabel(fv(p, '開始日時', '')) + ' ' + fv(p, '件名', ''))));
        });
        planSel.appendChild(el('option', { value: '' }, '予定とは別の訪問(突発)'));
        var onPlan = function () {
          var p = planOf(planSel.value);
          $('.v-plan-note').textContent = p ? 'この予定の訪問として記録し、予定を「完了」にします(スケジュールの「✅ 訪問完了」と同じです)。' : '予定とは別の訪問として記録します。予定はそのまま残ります。';
          setDeal(p ? fv(p, '案件No', '') : '');
        };
        planSel.addEventListener('change', onPlan);
        onPlan();
      } else {
        setDeal('');
      }

      function close() { if (bg.parentNode) document.body.removeChild(bg); }
      $('.v-cancel').addEventListener('click', close);
      $('.v-save').addEventListener('click', function () {
        // 日付を打ってすぐ保存を押したときは、その日の予定で開き直してから保存してもらう(開いた日の予定で記録しないように)
        var v = $('.v-date').value;
        if (!v) { alert('訪問した日を入れてください'); return; }
        if (v !== today) {
          alert('訪問した日を変えたので、その日の訪問予定で開き直します。内容を確かめて、もう一度「保存」を押してください。');
          reopen(v);
          return;
        }
        var memo = $('.v-memo').value.trim();
        if (!memo) { alert('報告を書いてください(一言でもかまいません)'); return; }
        // 案件があるときは確度を必須に(2026-10-20)。// 失注・保留/中止にしたときは確度は要らない
        if (dealOf(dealSel.value) && !$('.v-kakudo').value && ['失注', '保留/中止'].indexOf($('.v-phase').value) < 0) {
          alert('案件の「確度」を選んでください(商談の手応え。迷ったら低めで構いません)');
          return;
        }
        var plan = planSel ? planOf(planSel.value) : null;
        var deal = dealOf(dealSel.value);
        var msgs = [];
        var upd = {};
        if (deal && $('.v-phase').value && $('.v-phase').value !== fv(deal, '商談フェーズ', '')) {
          upd.商談フェーズ = { value: $('.v-phase').value };
          setWonDate(upd, deal, $('.v-phase').value, today); // 訪問した日を受注日に
        }
        // 受注日は実際に受注した日。未来の日付は入れない(2026-10-25 P1)
        if (upd.受注日 && today > workDay()) {
          alert('受注にするときは、訪問した日が受注日になります。受注日に未来の日付は入れられません。訪問した日を確かめてください。');
          return;
        }
        var btn = this;
        btn.disabled = true;
        if (deal && $('.v-kakudo').value && $('.v-kakudo').value !== fv(deal, '確度', '')) upd.確度 = { value: $('.v-kakudo').value };
        var next = hasNext ? $('.v-next').value : '';
        var actId = null;
        (Object.keys(upd).length ? api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: deal.$id.value, record: upd }).then(function () {
          msgs.push('案件の' + Object.keys(upd).join('・') + 'を更新しました。');
        }) : kintone.Promise.resolve()).then(function () {
          // 対応種別: この会社で初めての商談なら「商談（初回）」(スケジュールの訪問完了と同じ決め方)
          return api('/k/v1/records', 'GET', { app: ACTIVITY_APP_ID, fields: ['$id'],
            query: '顧客No = "' + custNo + '" and 対応種別 in ("商談（初回）", "商談（2回目以降）") limit 1' });
        }).then(function (resp) {
          var body = plan ? fv(plan, '内容', '').replace(/\(案件管理の次回商談日から自動作成\)/g, '').trim() : '';
          var act = {
            タイトル: { value: '訪問: ' + company }, 対応日付: { value: today },
            対応者: { value: [{ code: me.code }] }, 対応種別: { value: resp.records.length ? '商談（2回目以降）' : '商談（初回）' },
            内容: { value: memo + (body ? '\n\n【予定のメモ】' + body : '') + (plan ? '\n\n(スケジュールNo.' + plan.$id.value + ' から作成)' : '') },
            会社名: { value: company }
          };
          if (deal) act.案件No = { value: String(deal.$id.value) };
          return api('/k/v1/record', 'POST', { app: ACTIVITY_APP_ID, record: act });
        }).then(function (resp) {
          actId = resp.id;
          msgs.push('活動履歴に記録しました。');
          if (!plan) return null;
          return api('/k/v1/record', 'PUT', { app: SCHEDULE_APP_ID, id: plan.$id.value, record: { 実施状況: { value: '完了' }, 活動履歴No: { value: String(actId) } } })
            .then(function () {
              msgs.push('予定(' + dtLabel(fv(plan, '開始日時', '')) + ')を完了にしました。');
              return syncDealNext(fv(plan, '案件No', ''));
            });
        }).then(function () {
          if (!hasNext || next === fv(r, '次回連絡日', '')) return null;
          return api('/k/v1/record', 'PUT', { app: CUSTOMER_APP_ID, id: custNo, record: { 次回連絡日: { value: next || null } } });
        }).then(function () {
          close();
          alert('記録しました。\n' + msgs.join('\n'));
          location.reload();
        }).catch(function (err) {
          btn.disabled = false;
          alert('記録できませんでした。' + (msgs.length ? '\n(ここまでは済んでいます: ' + msgs.join(' ') + ')' : '') + (err && err.message ? '\n' + err.message : ''));
        });
      });
    }
  }

  // ---------- 💼 案件を作る・進める ----------
  function openDealDialog(ctx, target) {
    var r = ctx.record, data = ctx.data, props = data.dealProps;
    var open = openDeals(data.deals);
    var bg = el('div', { className: 'chub-bg' });
    var m = el('div', { className: 'chub-modal' });
    m.innerHTML = '<h3>💼 案件を作る・進める</h3><div class="chub-sub">' + esc(fv(r, '会社名', '')) + '</div>' +
      '<label>どの案件?</label><select class="d-target"></select>' +
      '<div class="chub-row2"><div><label>提案商品</label><select class="d-item"></select></div>' +
      '<div><label>商談フェーズ</label><select class="d-phase"></select></div></div>' +
      '<div class="chub-row2"><div><label>確度</label><select class="d-kakudo"></select></div>' +
      '<div></div></div>' +
      '<label>商談担当者(商談に行く人。押すたびに選ぶ/外す。何人でも)</label><div class="chub-chips d-users"></div>' +
      '<label>次回商談日(入れるとスケジュールにも入ります)</label><input type="datetime-local" class="d-next">' +
      '<div class="chub-row2"><div><label>受注予定日</label><input type="date" class="d-due"></div>' +
      '<div><label>売上(円)</label><input type="number" class="d-amount" min="0" step="1"></div></div>' +
      '<div class="d-won-box" style="display:none"><label>受注日(実際に受注した日)</label><input type="date" class="d-won">' +
      '<div class="chub-sub d-won-note" style="margin:4px 0 0"></div></div>' +
      '<div class="chub-sub" style="margin-top:10px">見積書の作成・契約書の添付は <span class="d-open"></span> から。</div>' +
      '<div class="chub-btns"><button type="button" class="d-cancel">キャンセル</button><button type="button" class="primary d-save">保存</button></div>';
    bg.appendChild(m);
    document.body.appendChild(bg);

    var tSel = m.querySelector('.d-target');
    var all = data.deals;
    var closedDeals = all.filter(function (d) { return CLOSED.indexOf(fv(d, '商談フェーズ', '')) >= 0; });
    function dealOption(d) {
      return el('option', { value: d.$id.value }, esc((fv(d, '提案商品', '') || '商品未選択') + ' / ' + (fv(d, '商談フェーズ', '') || 'フェーズ未入力') + '(案件No.' + d.$id.value + ')'));
    }
    open.forEach(function (d) { tSel.appendChild(dealOption(d)); });
    tSel.appendChild(el('option', { value: '' }, '＋ 新しい案件を作る'));
    // 受注・失注・保留/中止の案件も直せるように、下に分けて出す
    if (closedDeals.length) {
      var grp = el('optgroup', { label: '終了した案件(受注・失注・保留/中止)' });
      closedDeals.forEach(function (d) { grp.appendChild(dealOption(d)); });
      tSel.appendChild(grp);
    }
    if (target) tSel.value = target.$id.value; else if (!open.length) tSel.value = '';

    function fill(sel, code, fallback, cur, blank) {
      sel.innerHTML = '';
      if (blank) sel.appendChild(el('option', { value: '' }, '(未選択)'));
      optionsOf(props, code, fallback).forEach(function (v) { var o = el('option', { value: v }, esc(v)); if (v === cur) o.selected = true; sel.appendChild(o); });
    }
    var me = kintone.getLoginUser();
    var picker = null;
    function load() {
      var d = all.filter(function (x) { return x.$id.value === tSel.value; })[0] || null;
      fill(m.querySelector('.d-item'), '提案商品', ['RIDE CAST(タクシー動画広告)', 'MEO代行', 'その他'], d ? fv(d, '提案商品', '') : 'MEO代行', true);
      fill(m.querySelector('.d-phase'), '商談フェーズ', ['商談予定', '提案中', '内示', '受注', '失注', '保留/中止'], d ? fv(d, '商談フェーズ', '') : '商談予定', true);
      fill(m.querySelector('.d-kakudo'), '確度', ['100%', '80%', '60%', '40%', '20%'], d ? fv(d, '確度', '') : '', true);
      m.querySelector('.d-next').value = d ? localInput(fv(d, '次回商談日', '')) : '';
      m.querySelector('.d-due').value = d ? fv(d, '受注予定日', '') : '';
      m.querySelector('.d-amount').value = d ? fv(d, '売上', '') : '';
      m.querySelector('.d-open').innerHTML = d ? '<a href="' + dealUrl(d.$id.value) + '">案件の画面</a>' : '保存後の案件の画面';
      // 今の商談担当者(新しい案件なら自分)を選んだ状態にする
      var cur = d ? fv(d, '商談担当者', []) : [{ code: me.code, name: me.name }]; // 既存の案件は今の担当者のまま(空なら空)
      picker = userPicker(m.querySelector('.d-users'), cur);
      return d;
    }
    var current = load();
    // 受注にするとき(受注日がまだ無い案件)だけ受注日を聞く。初期値は日本時間の今日、何日の受注かを常に出す(2026-10-25 P1)
    var wonIn = m.querySelector('.d-won');
    wonIn.value = workDay();
    dateNote(wonIn, m.querySelector('.d-won-note'));
    function needWonDate() {
      var probe = {};
      setWonDate(probe, current, m.querySelector('.d-phase').value, 'x');
      return !!probe.受注日;
    }
    function toggleWon() { m.querySelector('.d-won-box').style.display = needWonDate() ? '' : 'none'; }
    m.querySelector('.d-phase').addEventListener('change', toggleWon);
    toggleWon();
    tSel.addEventListener('change', function () { current = load(); toggleWon(); });

    function close() { if (bg.parentNode) document.body.removeChild(bg); }
    m.querySelector('.d-cancel').addEventListener('click', close);
    m.querySelector('.d-save').addEventListener('click', function () {
      var btn = this;
      var item = m.querySelector('.d-item').value;
      var phase = m.querySelector('.d-phase').value;
      if (!phase) { alert('商談フェーズを選んでください'); return; }
      // 受注日は必須・未来の日付は不可(2026-10-25 P1。空のまま今日を入れて保存することはしない)
      if (needWonDate() && !wonIn.value) { alert('受注日を入力してください(実際に受注した日)'); return; }
      if (needWonDate() && wonIn.value > workDay()) { alert('受注日が未来の日付です。実際に受注した日を選んでください'); return; }
      var next = fromLocalInput(m.querySelector('.d-next').value);
      var amount = m.querySelector('.d-amount').value;
      var picked = picker ? picker.get() : [];
      var rec = {
        提案商品: { value: item }, 商談フェーズ: { value: phase }, 確度: { value: m.querySelector('.d-kakudo').value },
        次回商談日: { value: next || null }, 受注予定日: { value: m.querySelector('.d-due').value || null },
        売上: { value: amount === '' ? null : amount }, 商談担当者: { value: users(picked) }
      };
      setWonDate(rec, current, phase, wonIn.value);
      var prev = current ? fv(current, '次回商談日', '') : '';
      var custNo = fv(r, '顧客No', '') || fv(r, '$id', '');
      btn.disabled = true;
      var p;
      if (current) {
        p = api('/k/v1/record', 'PUT', { app: DEAL_APP_ID, id: current.$id.value, record: rec }).then(function () { return current.$id.value; });
      } else {
        rec.会社名 = { value: fv(r, '会社名', '') };
        rec.主担当 = { value: [{ code: me.code }] };
        p = api('/k/v1/record', 'POST', { app: DEAL_APP_ID, record: rec }).then(function (resp) { return resp.id; });
      }
      p.then(function (dealNo) {
        if (!next || (prev && new Date(prev).getTime() === new Date(next).getTime())) return '';
        return pushToSchedule(dealNo, { 会社名: fv(r, '会社名', ''), 提案商品: item, 顧客No_: custNo, 商談担当者: picked, 主担当: [me], 次回商談日: next }, prev);
      }).then(function (msg) {
        close();
        alert('案件を保存しました。' + (msg ? '\n' + msg : ''));
        location.reload();
      }).catch(function (err) {
        btn.disabled = false;
        alert('保存できませんでした。' + (err && err.message ? '\n' + err.message : ''));
      });
    });
  }

  // ---------- 📅 予定を入れる ----------
  function openSchedule(ctx) {
    var r = ctx.record;
    var open = openDeals(ctx.data.deals);
    var s = new Date();
    s.setMinutes(0, 0, 0);
    s.setHours(s.getHours() + 1);
    var me = kintone.getLoginUser();
    var prefill = {
      start: toKintoneDT(s), end: toKintoneDT(new Date(s.getTime() + 3600000)), allDay: false,
      user: { code: me.code, name: me.name }, title: '訪問: ' + fv(r, '会社名', ''), type: '訪問',
      custNo: fv(r, '顧客No', '') || fv(r, '$id', '')
    };
    if (open.length === 1) prefill.dealNo = open[0].$id.value;
    try { sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill)); } catch (e) { /* 自動入力なしで開く */ }
    location.href = IS_MOBILE ? '/k/m/' + SCHEDULE_APP_ID + '/edit' : '/k/' + SCHEDULE_APP_ID + '/edit';
  }

  // ---------- 📍 Googleマップからお店を登録(一覧画面) ----------
  // Googleマップで見つけたお店を、顧客登録+架電の記録(または訪問の記録)まで続けて行う。
  // 訪問は「🚶 訪問を記録」と同じ処理を使う(今日の訪問予定の完了・商談(初回)の判定を二重に持たない)。
  // 読み取りは利用者が貼り付けた文字だけ(GoogleのAPIで取った値は規約で30日を超えて保存できないため、APIは使わない)。
  var LEAD_APP_ID = 29;
  var QUICK_MODE_KEY = 'chub-quick-mode';   // 前回選んだ「架電/訪問」(人ごと・端末ごと)
  var OPEN_VISIT_KEY = 'chub-open-visit';   // 登録直後に顧客画面で訪問の記録を開く印
  function loadQuickMode() { try { return localStorage.getItem(QUICK_MODE_KEY) === 'visit' ? 'visit' : 'call'; } catch (e) { return 'call'; } }
  function saveQuickMode(v) { try { localStorage.setItem(QUICK_MODE_KEY, v); } catch (e) { /* 次回は架電から */ } }
  // 読み取り・重複チェックは customize-maps-paste.js(ネタリストと共用)。ボタンを押したときに参照する
  function MP() {
    if (!window.TaimeiMapsPaste) throw new Error('customize-maps-paste.js が読み込まれていません');
    return window.TaimeiMapsPaste;
  }
  function digits(s) { return MP().digits(s); }
  function toWideAddr(s) { return MP().toWideAddr(s); }
  function findSame(app, name, phone) { return MP().findSame(app, name, phone); }

  // ネタに履歴・担当者・予定があるか(あればネタリストの「顧客管理へ登録」で履歴ごと移してもらう)
  function leadHasHistory(lead) {
    var rows = fv(lead, '架電履歴', []).filter(function (row) { return fv(row.value, '履歴結果', '') || fv(row.value, '履歴メモ', ''); });
    if (rows.length || fv(lead, '担当者氏名', '')) return kintone.Promise.resolve(true);
    return api('/k/v1/records', 'GET', { app: SCHEDULE_APP_ID, query: 'ネタNo = "' + lead.$id.value + '" limit 1', fields: ['$id'] })
      .then(function (r) { return r.records.length > 0; }).catch(function () { return false; });
  }

  function leadUrl(id) { return IS_MOBILE ? '/k/m/' + LEAD_APP_ID + '/show?record=' + id : '/k/' + LEAD_APP_ID + '/show#record=' + id; }
  function custUrl(id) { return IS_MOBILE ? '/k/m/' + CUSTOMER_APP_ID + '/show?record=' + id : '/k/' + CUSTOMER_APP_ID + '/show#record=' + id; }

  function openQuickRegister() {
    var props = {};
    var bg = el('div', { className: 'chub-bg' });
    var m = el('div', { className: 'chub-modal', style: 'max-width:520px' });
    m.innerHTML = '<h3>📍 Googleマップからお店を登録</h3>' +
      '<label style="margin-top:0">このお店に</label><div class="chub-chips q-mode">' +
      '<button type="button" class="chub-chip" data-mode="call">📞 架電した</button>' +
      '<button type="button" class="chub-chip" data-mode="visit">🚶 訪問した</button></div>' +
      '<div class="chub-sub">Googleマップでお店を開き、店名〜電話番号の部分をコピー(スマホは「共有」→コピー)して貼り付けると読み取ります。手で入れてもかまいません。</div>' +
      '<textarea class="q-paste" placeholder="ここに貼り付け(URLだけでも可)" style="min-height:64px"></textarea><div class="q-note chub-sub" style="margin:6px 0 0"></div>' +
      '<label>会社名・店名(必須)</label><input type="text" class="q-name">' +
      '<div class="chub-row2"><div><label>電話番号</label><input type="tel" class="q-phone"></div><div><label>大分類</label><select class="q-cat"></select></div></div>' +
      '<label>中分類(大分類を選ぶと候補が出ます)</label><select class="q-sub"></select>' +
      '<div class="chub-row2"><div><label>〒</label><input type="text" class="q-zip"></div><div><label>都道府県</label><select class="q-pref"></select></div></div>' +
      '<label>住所</label><input type="text" class="q-addr">' +
      '<label>GoogleマップのURL(あれば)</label><input type="url" class="q-url">' +
      '<div class="q-dup"></div><div class="q-call"></div>' +
      '<div class="q-visit-note chub-sub" style="display:none;margin-top:10px">登録すると顧客の画面が開き、続けて「🚶 訪問を記録」が開きます(今日の訪問予定があれば、その予定の訪問として記録できます)。</div>' +
      '<div class="chub-btns"><button type="button" class="q-cancel">キャンセル</button><button type="button" class="primary q-save">登録して記録</button></div>';
    bg.appendChild(m);
    document.body.appendChild(bg);
    var $ = function (c) { return m.querySelector(c); };
    var form = null, hasNextField = true;
    var lead = null, leadBlocked = false, custHit = null;
    var mode = loadQuickMode();
    function setMode(v) {
      mode = v;
      Array.prototype.forEach.call(m.querySelectorAll('.q-mode .chub-chip'), function (b) {
        b.className = 'chub-chip' + (b.getAttribute('data-mode') === v ? ' on' : '');
      });
      $('.q-call').style.display = v === 'call' ? '' : 'none';
      $('.q-visit-note').style.display = v === 'visit' ? '' : 'none';
      $('.q-save').textContent = v === 'call' ? '登録して架電を記録' : '登録して訪問を記録';
    }
    Array.prototype.forEach.call(m.querySelectorAll('.q-mode .chub-chip'), function (b) {
      b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); saveQuickMode(mode); });
    });
    setMode(mode);

    api('/k/v1/app/form/fields', 'GET', { app: CUSTOMER_APP_ID }).then(function (r) {
      props = r.properties;
      hasNextField = !!props['次回連絡日'];
      [['q-cat', '大分類', ''], ['q-pref', '都道府県', '北海道']].forEach(function (x) {
        var sel = $('.' + x[0]);
        if (x[1] === '大分類') sel.appendChild(el('option', { value: '' }, '(未選択)'));
        optionsOf(props, x[1], x[1] === '都道府県' ? ['北海道'] : []).forEach(function (v) {
          var o = el('option', { value: v }, esc(v)); if (v === x[2]) o.selected = true; sel.appendChild(o);
        });
      });
    }).catch(function () { $('.q-pref').appendChild(el('option', { value: '北海道' }, '北海道')); }).then(function () {
      // 中分類は分類マスタ(30)から大分類で絞って取得し、ルックアップ「中分類選択」にキーを入れる(レコード画面の「取得」と同じ結果)
      MP().bindMinor($('.q-cat'), $('.q-sub'));
      return api('/k/v1/app/form/fields', 'GET', { app: DEAL_APP_ID }).then(function (r) { return r.properties; }).catch(function () { return {}; });
    }).then(function (dealProps) {
      form = buildCallForm({ open: [], dealProps: dealProps, hasNextField: hasNextField, nextValue: '' });
      $('.q-call').appendChild(form.el);
    });

    function fillIfEmpty(cls, v) { if (v && !$(cls).value) $(cls).value = v; }
    // URLだけ貼られたときはリンク先から店名、位置から住所を補う(customize-maps-paste.js の parseAsync)
    var pasteSeq = 0;
    function applyParsed() {
      var my = ++pasteSeq;
      var note = $('.q-note');
      note.textContent = '読み取り中…';
      MP().parseAsync($('.q-paste').value).then(function (p) {
        if (my !== pasteSeq) return; // 貼り直されたら古い結果は使わない
        ['.q-name', '.q-phone', '.q-zip', '.q-addr', '.q-url'].forEach(function (c) { $(c).value = ''; });
        fillIfEmpty('.q-name', p.name); fillIfEmpty('.q-phone', p.phone); fillIfEmpty('.q-zip', p.zip);
        fillIfEmpty('.q-addr', p.addr); fillIfEmpty('.q-url', p.url);
        if (p.pref) $('.q-pref').value = p.pref;
        note.textContent = p.note || '';
        note.style.color = p.fromUrl || !p.note ? '#64748b' : '#b91c1c';
        checkDup();
      });
    }
    $('.q-paste').addEventListener('input', applyParsed);

    var dupTimer = null, dupSeq = 0;
    function checkDup() {
      clearTimeout(dupTimer);
      dupTimer = setTimeout(runDup, 400);
    }
    function runDup() {
      var name = $('.q-name').value.trim(), phone = $('.q-phone').value.trim();
      var seq = ++dupSeq;
      lead = null; leadBlocked = false; custHit = null;
      var box = $('.q-dup');
      if (!name && digits(phone).length < 9) { box.innerHTML = ''; return kintone.Promise.resolve(); }
      return kintone.Promise.all([findSame(CUSTOMER_APP_ID, name, phone), findSame(LEAD_APP_ID, name, phone)]).then(function (res) {
        if (seq !== dupSeq) return null;
        if (res[0].length) {
          custHit = res[0][0];
          box.innerHTML = '<div class="chub-apo" style="border-color:#fca5a5;background:#fef2f2;color:#b91c1c">顧客管理に同じお店があります: <a href="' + custUrl(custHit.$id.value) + '">No.' + esc(custHit.$id.value) + ' ' + esc(fv(custHit, '会社名', '')) + '</a><br>そちらを開いて「📞 架電を記録」で記録してください。</div>';
          return null;
        }
        if (!res[1].length) { box.innerHTML = ''; return null; }
        lead = res[1][0];
        return leadHasHistory(lead).then(function (has) {
          if (seq !== dupSeq) return;
          leadBlocked = has;
          box.innerHTML = has
            ? '<div class="chub-apo" style="border-color:#fcd34d;background:#fffbeb;color:#92400e">ネタリストに同じお店があり、架電履歴・担当者・予定が付いています: <a href="' + leadUrl(lead.$id.value) + '">ネタNo.' + esc(lead.$id.value) + '</a><br>ネタリストの画面の「顧客管理へ登録」で履歴ごと移してから、顧客管理で記録してください。</div>'
            : '<div class="chub-apo">ネタリストに同じお店があります(<a href="' + leadUrl(lead.$id.value) + '">ネタNo.' + esc(lead.$id.value) + '</a>)。登録すると顧客管理へ<b>移します</b>(空欄はネタの内容で埋め、ネタ側は削除)。</div>';
        });
      });
    }
    $('.q-name').addEventListener('input', checkDup);
    $('.q-phone').addEventListener('input', checkDup);

    function close() { if (bg.parentNode) document.body.removeChild(bg); }
    $('.q-cancel').addEventListener('click', close);
    $('.q-save').addEventListener('click', function () {
      var btn = this;
      var name = $('.q-name').value.trim();
      if (!name) { alert('会社名・店名を入れてください'); return; }
      if (!form) return;
      var isVisit = mode === 'visit';
      var call = isVisit ? null : form.read();
      if (!isVisit && !call) return;
      btn.disabled = true;
      var msgs = [];
      var newId = null;
      clearTimeout(dupTimer);
      runDup().then(function () {
        if (custHit) throw new Error('顧客管理に同じお店があります(No.' + custHit.$id.value + ')。そちらで記録してください。');
        if (lead && leadBlocked) throw new Error('ネタリストのネタNo.' + lead.$id.value + 'から「顧客管理へ登録」で移してください。');
        var rec = {
          会社名: { value: name }, 顧客ランク: { value: 'D' },
          顧客情報メモ欄: { value: (isVisit ? '訪問' : '架電') + 'で登録(Googleマップから' + (lead ? '・ネタNo.' + lead.$id.value + 'より移動' : '') + ')。顧客ランクは仮置きのD。' }
        };
        var vals = {
          電話番号: $('.q-phone').value.trim() || (lead ? fv(lead, '電話番号', '') : ''),
          郵便番号: $('.q-zip').value.trim() || (lead ? fv(lead, '郵便番号', '') : ''),
          都道府県: $('.q-pref').value,
          住所: toWideAddr($('.q-addr').value.trim()) || (lead ? fv(lead, '市区町村', '') + fv(lead, '丁目番地等', '') : ''),
          大分類: $('.q-cat').value || (lead ? fv(lead, '大分類', '') : ''),
          中分類選択: $('.q-sub').value || (lead && !$('.q-cat').value ? fv(lead, '中分類選択', '') : ''),
          GoogleマップURL: $('.q-url').value.trim() || (lead ? fv(lead, 'GoogleマップURL', '') : '')
        };
        // 中分類(表示用)はルックアップの写し先。中分類選択が無いネタだけ、文字のまま移す
        if (lead && !vals.中分類選択) vals.中分類 = fv(lead, '中分類', '');
        if (lead) ['業種メモ', '営業時間', '定休日', '緯度', '経度'].forEach(function (k) { vals[k] = fv(lead, k, ''); });
        if (hasNextField && call && call.next) vals.次回連絡日 = call.next;
        Object.keys(vals).forEach(function (k) { if (vals[k] !== '' && (props[k] || !Object.keys(props).length)) rec[k] = { value: vals[k] }; });
        return api('/k/v1/record', 'POST', { app: CUSTOMER_APP_ID, record: rec });
      }).then(function (resp) {
        newId = resp.id;
        msgs.push('顧客管理に登録しました(No.' + newId + ')。');
        if (isVisit) {
          // 訪問の記録は顧客画面の「🚶 訪問を記録」で行う(開いたら自動で出す)
          try { sessionStorage.setItem(OPEN_VISIT_KEY, String(newId)); } catch (e) { msgs.push('顧客の画面で「🚶 訪問を記録」を押して記録してください。'); }
          return null;
        }
        call.custNo = newId;
        call.company = name;
        call.hasNextField = false; // 次回連絡日は登録時に入れた
        return recordCall(call, msgs);
      }).then(function () {
        if (!lead) return null;
        return api('/k/v1/records', 'DELETE', { app: LEAD_APP_ID, ids: [lead.$id.value] }).then(function () {
          msgs.push('ネタリストのネタNo.' + lead.$id.value + 'は顧客管理へ移したので削除しました。');
        }).catch(function () {
          msgs.push('ネタリストのネタNo.' + lead.$id.value + 'は削除できなかったので、メモに印を付けました。');
          return api('/k/v1/record', 'PUT', { app: LEAD_APP_ID, id: lead.$id.value, record: {
            メモ: { value: (fv(lead, 'メモ', '') ? fv(lead, 'メモ', '') + '\n' : '') + '顧客管理No.' + newId + 'へ登録済み(' + ymd(new Date()) + ')' } } }).catch(function () { return null; });
        });
      }).then(function () {
        close();
        alert('登録しました。\n' + msgs.join('\n') + (isVisit ? '\n続けて訪問の内容を記録してください。' : ''));
        location.href = custUrl(newId);
      }).catch(function (err) {
        btn.disabled = false;
        alert((newId ? '途中で止まりました。' : '登録できませんでした。') + (msgs.length ? '\n(ここまでは済んでいます: ' + msgs.join(' ') + ')' : '') + (err && err.message ? '\n' + err.message : ''));
        if (newId) location.href = custUrl(newId);
      });
    });
  }

  kintone.events.on(['app.record.index.show', 'mobile.app.record.index.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    if (Number(event.appId) !== CUSTOMER_APP_ID) return event;
    injectStyle();
    var old = document.getElementById('chub-quick');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.getHeaderMenuSpaceElement();
    if (!space) return event;
    var b = el('button', { type: 'button', id: 'chub-quick' }, '📍 Googleマップからお店を登録');
    b.style.cssText = 'padding:6px 14px;border-radius:4px;border:1px solid #2563eb;background:#2563eb;color:#fff;cursor:pointer;font-size:13px;margin-right:8px;' +
      (IS_MOBILE ? 'display:block;width:calc(100% - 24px);margin:8px 12px;padding:12px 14px;font-size:15px;' : '');
    b.addEventListener('click', openQuickRegister);
    if (IS_MOBILE) space.appendChild(b); else space.insertBefore(b, space.firstChild);
    return event;
  });

  // ---------- 表示 ----------
  function placeRoot() {
    var old = document.getElementById(ROOT_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var space = null;
    try {
      space = IS_MOBILE ? kintone.mobile.app.record.getSpaceElement(SPACE_ID) : kintone.app.record.getSpaceElement(SPACE_ID);
    } catch (e) { space = null; }
    if (!space) space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement();
    if (!space) return null;
    var root = el('div', { id: ROOT_ID });
    space.appendChild(root);
    return root;
  }

  kintone.events.on(['app.record.detail.show', 'mobile.app.record.detail.show'], function (event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    if (Number(event.appId) !== CUSTOMER_APP_ID) return event;
    injectStyle();
    var root = placeRoot();
    if (!root) return event;
    root.innerHTML = '<div class="chub-muted">読み込み中…</div>';
    var r = event.record;
    var custNo = fv(r, '顧客No', '') || event.recordId;
    var openVisit = false;
    try {
      openVisit = sessionStorage.getItem(OPEN_VISIT_KEY) === String(event.recordId);
      if (openVisit) sessionStorage.removeItem(OPEN_VISIT_KEY);
    } catch (e) { openVisit = false; }
    loadAll(custNo).then(function (data) {
      var ctx = { record: r, data: data };
      render(root, ctx);
      if (openVisit) openVisitDialog(ctx); // 「📍 Googleマップからお店を登録」で訪問を選んで登録した直後
    }).catch(function () {
      root.innerHTML = '<div class="chub-muted">作業パネルを読み込めませんでした。</div>';
    });
    return event;
  });
})();
