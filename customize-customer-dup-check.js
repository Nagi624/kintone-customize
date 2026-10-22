/*
 * 顧客管理18の追加画面(＋・複製)で、ネタリスト29・顧客管理18に同じお店がないか確かめる  PC/スマホ両対応(2026-10-22)
 *
 * 「📍 Googleマップからお店を登録」(customize-customer-hub.js)・ネタリストの貼り付け登録(customize-lead-paste.js)と同じ決まり:
 *  - 同じお店 = 会社名が同じ、または電話番号の数字が同じ(判定は customize-maps-paste.js の findSame。同じアプリに登録が必要)
 *  - 顧客管理に同じお店がある → 保存させず、そちらを案内
 *  - ネタリストにあり、架電履歴・担当者・予定が付いている → 保存させず、ネタの「顧客管理へ登録」(履歴ごと移す)を案内
 *  - ネタリストにあり、何も付いていない → 確認のうえ顧客管理へ移す(空欄はネタの内容で埋め、保存後にネタを削除。削除できなければネタのメモに印)
 * 入力中は会社名・電話番号を入れた時点で画面の上に知らせる。保存時にもう一度調べ直す。
 */
(function () {
  'use strict';

  var CUSTOMER_APP_ID = 18;
  var LEAD_APP_ID = 29;
  var SCHEDULE_APP_ID = 34;
  var BOX_ID = 'cust-dup-box';
  var IS_MOBILE = false;
  var pendingLead = null; // 保存後に移すネタ {lead, fillMinor}

  function MP() { return window.TaimeiMapsPaste; }
  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function api(path, method, params) { return kintone.api(kintone.api.url(path, true), method, params); }
  function recUrl(app, id) { return IS_MOBILE ? '/k/m/' + app + '/show?record=' + id : '/k/' + app + '/show#record=' + id; }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // customize-customer-hub.js の leadHasHistory と同じ(履歴ごと移すべきネタか)
  function leadHasHistory(lead) {
    var rows = fv(lead, '架電履歴', []).filter(function (row) { return fv(row.value, '履歴結果', '') || fv(row.value, '履歴メモ', ''); });
    if (rows.length || fv(lead, '担当者氏名', '')) return kintone.Promise.resolve(true);
    return api('/k/v1/records', 'GET', { app: SCHEDULE_APP_ID, query: 'ネタNo = "' + lead.$id.value + '" limit 1', fields: ['$id'] })
      .then(function (r) { return r.records.length > 0; }).catch(function () { return false; });
  }

  // 結果 {cust, lead, leadBlocked}。調べられないとき(共通部品が無い等)は何も無し扱い
  function check(record) {
    var name = String(fv(record, '会社名', '')).trim();
    var phone = String(fv(record, '電話番号', '')).trim();
    if (!MP() || (!name && MP().digits(phone).length < 9)) return kintone.Promise.resolve({});
    return kintone.Promise.all([MP().findSame(CUSTOMER_APP_ID, name, phone), MP().findSame(LEAD_APP_ID, name, phone)]).then(function (res) {
      if (res[0].length) return { cust: res[0][0] };
      if (!res[1].length) return {};
      var lead = res[1][0];
      return leadHasHistory(lead).then(function (has) { return { lead: lead, leadBlocked: has }; });
    });
  }

  function leadLabel(lead) { return 'ネタNo.' + lead.$id.value + ' ' + fv(lead, '会社名', ''); }

  // ---------- 入力中の知らせ ----------
  function boxEl() {
    var box = document.getElementById(BOX_ID);
    if (box) return box;
    var space = null;
    try { space = IS_MOBILE ? kintone.mobile.app.getHeaderSpaceElement() : kintone.app.record.getHeaderMenuSpaceElement(); } catch (e) { space = null; }
    if (!space) return null;
    box = document.createElement('div');
    box.id = BOX_ID;
    box.style.cssText = 'margin:6px ' + (IS_MOBILE ? '12px' : '0') + ';font-size:13px;line-height:1.6;';
    space.appendChild(box);
    return box;
  }
  function show(html, tone) {
    var box = boxEl();
    if (!box) return;
    var c = { red: 'border:1px solid #fca5a5;background:#fef2f2;color:#b91c1c', amber: 'border:1px solid #fcd34d;background:#fffbeb;color:#92400e',
      blue: 'border:1px solid #93c5fd;background:#eff6ff;color:#1e3a8a' }[tone];
    box.innerHTML = html ? '<div style="padding:8px 12px;border-radius:6px;' + c + '">' + html + '</div>' : '';
  }

  var seq = 0;
  function refresh(record) {
    var my = ++seq;
    check(record).then(function (r) {
      if (my !== seq) return;
      if (r.cust) {
        show('顧客管理に同じお店があります: <a href="' + recUrl(CUSTOMER_APP_ID, r.cust.$id.value) + '">No.' + esc(r.cust.$id.value) + ' ' + esc(fv(r.cust, '会社名', '')) +
          '</a><br>このままでは保存できません。そちらを開いて記録してください。', 'red');
      } else if (r.lead && r.leadBlocked) {
        show('ネタリストに同じお店があり、架電履歴・担当者・予定が付いています: <a href="' + recUrl(LEAD_APP_ID, r.lead.$id.value) + '">' + esc(leadLabel(r.lead)) +
          '</a><br>このままでは保存できません。ネタリストの画面の「顧客管理へ登録」で履歴ごと移してください。', 'amber');
      } else if (r.lead) {
        show('ネタリストに同じお店があります(<a href="' + recUrl(LEAD_APP_ID, r.lead.$id.value) + '">' + esc(leadLabel(r.lead)) +
          '</a>)。保存すると顧客管理へ<b>移します</b>(空欄はネタの内容で埋め、ネタ側は削除)。', 'blue');
      } else {
        show('', 'blue');
      }
    }).catch(function () { /* 調べられなくても入力は止めない */ });
  }

  // ---------- 保存時 ----------
  // 空欄だけネタの内容で埋める(ルックアップの中分類選択は保存後にREST APIで入れる。APIなら取得まで行われる)
  function fillFromLead(record, lead) {
    var vals = {
      電話番号: fv(lead, '電話番号', ''),
      郵便番号: fv(lead, '郵便番号', ''),
      都道府県: fv(lead, '都道府県', ''),
      住所: fv(lead, '市区町村', '') + fv(lead, '丁目番地等', ''),
      大分類: fv(lead, '大分類', ''),
      Webサイト: fv(lead, 'Webサイト', ''),
      GoogleマップURL: fv(lead, 'GoogleマップURL', ''),
      業種メモ: fv(lead, '業種確認メモ', ''),
      営業時間: fv(lead, '営業時間', ''),
      定休日: fv(lead, '定休日', '')
    };
    Object.keys(vals).forEach(function (k) {
      if (record[k] && !record[k].value && vals[k]) record[k].value = vals[k];
    });
    if (record['顧客情報メモ欄']) {
      var memo = record['顧客情報メモ欄'].value || '';
      record['顧客情報メモ欄'].value = (memo ? memo + '\n' : '') + 'ネタNo.' + lead.$id.value + 'より移動(' + ymd(new Date()) + ')';
    }
  }

  function onSubmit(event) {
    pendingLead = null;
    var record = event.record;
    return check(record).then(function (r) {
      if (r.cust) {
        event.error = '顧客管理に同じお店があります(No.' + r.cust.$id.value + ' ' + fv(r.cust, '会社名', '') + ')。そちらで記録してください。';
        return event;
      }
      if (r.lead && r.leadBlocked) {
        event.error = 'ネタリストに同じお店(' + leadLabel(r.lead) + ')があり、架電履歴・担当者・予定が付いています。ネタリストの画面の「顧客管理へ登録」で履歴ごと移してください。';
        return event;
      }
      if (r.lead) {
        var ok = window.confirm('ネタリストに同じお店があります(' + leadLabel(r.lead) + ')。\n\n' +
          'OKを押すと、このお店を顧客管理へ移します。\n・空欄はネタの内容で埋めます\n・保存後、ネタリスト側は削除します\n\nキャンセルすると保存しません。');
        if (!ok) {
          event.error = '保存を取りやめました(ネタリストの' + leadLabel(r.lead) + 'と同じお店です)。';
          return event;
        }
        pendingLead = { lead: r.lead, fillMinor: !fv(record, '中分類選択', '') && !fv(record, '中分類', '') };
        fillFromLead(record, r.lead);
      }
      return event;
    });
  }

  function onSuccess(event) {
    var p = pendingLead;
    pendingLead = null;
    if (!p) return event;
    var lead = p.lead;
    var newId = event.recordId;
    var put = kintone.Promise.resolve();
    if (p.fillMinor) {
      var rec = {};
      if (fv(lead, '中分類選択', '')) rec['中分類選択'] = { value: fv(lead, '中分類選択', '') };
      else if (fv(lead, '中分類', '')) rec['中分類'] = { value: fv(lead, '中分類', '') }; // 中分類選択が無いネタだけ文字のまま
      if (Object.keys(rec).length) put = api('/k/v1/record', 'PUT', { app: CUSTOMER_APP_ID, id: newId, record: rec }).catch(function () { return null; });
    }
    return put.then(function () {
      return api('/k/v1/records', 'DELETE', { app: LEAD_APP_ID, ids: [lead.$id.value] }).catch(function () {
        alert('顧客管理には登録しましたが、ネタリストの' + leadLabel(lead) + 'を削除できませんでした。ネタのメモに印を付けます。');
        return api('/k/v1/record', 'PUT', { app: LEAD_APP_ID, id: lead.$id.value, record: {
          メモ: { value: (fv(lead, 'メモ', '') ? fv(lead, 'メモ', '') + '\n' : '') + '顧客管理No.' + newId + 'へ登録済み(' + ymd(new Date()) + ')' } } }).catch(function () { return null; });
      });
    }).then(function () { return event; });
  }

  function onShow(event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    pendingLead = null;
    var old = document.getElementById(BOX_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (fv(event.record, '会社名', '') || fv(event.record, '電話番号', '')) refresh(event.record); // 複製のとき
    return event;
  }
  function onChange(event) {
    IS_MOBILE = event.type.indexOf('mobile.') === 0;
    refresh(event.record);
    return event;
  }

  kintone.events.on(['app.record.create.show', 'mobile.app.record.create.show'], onShow);
  kintone.events.on(['app.record.create.change.会社名', 'app.record.create.change.電話番号',
    'mobile.app.record.create.change.会社名', 'mobile.app.record.create.change.電話番号'], onChange);
  kintone.events.on(['app.record.create.submit', 'mobile.app.record.create.submit'], onSubmit);
  kintone.events.on(['app.record.create.submit.success', 'mobile.app.record.create.submit.success'], onSuccess);
})();
