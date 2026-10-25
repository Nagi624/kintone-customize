/*
 * 業務日の共通部品(window.TaimeiDate)  PC/スマホ両対応(2026-10-25 作成、P1 日付の正常化)
 *
 * 会社の日付ルール(C:\AIFolder\company-os\docs\rules\business-date.md):
 *  - 日本時間(Asia/Tokyo)に固定。端末(PC・スマホ)のタイムゾーンに関係なく同じ日付になる
 *    (new Date の getHours/getDate は端末の時間帯で読むので使わず、+9時間して getUTC* で読む。営業日報32の取り込みと同じ方法)
 *  - 業務日は 0:00:00〜23:59:59。業務データ(架電・訪問・案件・受注など)の日付の初期値は「日本時間の今日」。
 *    朝6時前でも前日にしない。前の日の分は、利用者が日付欄で選ぶ(確認表示 dateNote / renderNote)
 *  - 日付欄をキーボードで打ち終わるまで待ってから「日付が変わった」とする(onDateCommit)
 *
 * 使う側: 顧客管理18 customize-customer-hub.js、案件管理19・ネタリスト29 customize-schedule-links.js、
 *   ネタリスト29 customize-lead-paste.js、案件管理19 customize-deal-won-date.js。
 * 使う側はボタンを押したときなどに window.TaimeiDate を見るので、登録順は問わない(customize-maps-paste.js と同じ方式)。
 * 参照実装とテスト: C:\AIFolder\company-os\tests\date\
 */
(function () {
  'use strict';

  var JST_OFFSET = 9 * 60 * 60 * 1000;
  var WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'];

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmt(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }

  // 日時(kintone の UTC 文字列 …Z、+09:00 付き、ミリ秒)→ 日本時間の { date: 'YYYY-MM-DD', hour, minute }
  function ofIso(t) {
    var d = new Date((typeof t === 'number' ? t : Date.parse(t)) + JST_OFFSET);
    return { date: fmt(d), hour: d.getUTCHours(), minute: d.getUTCMinutes() };
  }

  // 日本時間の今日(業務データの日付の初期値)
  function today() { return ofIso(Date.now()).date; }
  // 日本時間の今の時刻 'HH:MM'(ネタリストの架電履歴の「時刻」に入れる)
  function nowHm() { var n = ofIso(Date.now()); return pad(n.hour) + ':' + pad(n.minute); }

  // 'YYYY-MM-DD' の日付計算(UTC の暦で行い、端末の時間帯を持ち込まない)
  function addDays(s, n) {
    var p = s.split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + n));
    return fmt(d);
  }

  // 時刻を含む欄(作成日時・開始日時など)を、日本時間のその日 0:00 以上・翌日 0:00 未満で絞る kintone の条件
  function dayQuery(field, s) {
    return field + ' >= "' + s + 'T00:00:00+09:00" and ' + field + ' < "' + addDays(s, 1) + 'T00:00:00+09:00"';
  }

  // 日時が日本時間でその日か
  function isOnDate(t, s) { return !!t && ofIso(t).date === s; }

  // 日本時間の午前/午後(12:00 から午後)
  function ampm(t) { return ofIso(t).hour < 12 ? '午前' : '午後'; }

  // '10/26(月)'
  function label(s) {
    var p = s.split('-');
    var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
    return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + '(' + WEEKDAYS[d.getUTCDay()] + ')';
  }

  // 業務日の確認表示(決定1・案A)。何日の業務として記録するのかを常に言葉で示す。日付は変えない
  // pastExtra: 過去の日のときに足す一言(例: 時刻は空になります)
  function dateNote(s, pastExtra) {
    if (!isDate(s)) return { level: 'error', text: '日付を選んでください(実際に業務を行った日)。' };
    var t = today();
    if (s === t) return { level: 'today', text: '今日 ' + label(s) + ' の業務として記録します。前の日の分なら、日付を実際に行った日に変えてください。' };
    if (s < t) return { level: 'past', text: '⚠ ' + label(s) + ' の業務として記録します(今日ではありません)。日報も ' + label(s) + ' の日報に入ります。' + (pastExtra || '') };
    return { level: 'error', text: '⚠ 未来の日付(' + label(s) + ')になっています。実際に業務を行った日を選んでください。' };
  }
  var NOTE_COLORS = { today: '#1d4ed8', past: '#b45309', error: '#b91c1c' };
  // 表示用の要素に確認表示を入れる
  function renderNote(el, s, pastExtra) {
    if (!el) return;
    var n = dateNote(s, pastExtra);
    el.textContent = n.text;
    el.style.color = NOTE_COLORS[n.level];
    el.style.fontWeight = n.level === 'today' ? 'normal' : 'bold';
    el.setAttribute('data-level', n.level);
  }

  // 日付欄の「決まった」を fn(値) で知らせる(訪問の記録で、日付を変えたらその日の予定で開き直すのに使う)。
  // PC でキーボードから打つと、年・月・日の1か所を打つたびに change が出る(「2」を打った時点で 2月 として出る)ため、
  // キーボードで打っている間は待ち、欄から離れたとき・Enter のときに知らせる。カレンダー・スマホの日付選択は change ですぐ知らせる。
  // ignore: 欄から離れた先がこの中の要素(保存・キャンセルのボタン)なら知らせない(押したボタンの処理に任せる)
  function onDateCommit(input, fn, ignore) {
    var typing = false;
    var last = input.value;
    function commit() {
      typing = false;
      if (input.value === last) return;
      last = input.value;
      fn(input.value);
    }
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commit(); return; }
      if (e.key !== 'Tab' && e.key !== 'Shift') typing = true;
    });
    input.addEventListener('change', function () { if (!typing) commit(); });
    input.addEventListener('blur', function (e) {
      if (!typing) return;
      if (ignore && e.relatedTarget && ignore.indexOf(e.relatedTarget) >= 0) { typing = false; return; }
      commit();
    });
  }

  window.TaimeiDate = {
    today: today, nowHm: nowHm, ofIso: ofIso, addDays: addDays, dayQuery: dayQuery,
    isOnDate: isOnDate, ampm: ampm, label: label, dateNote: dateNote, renderNote: renderNote,
    onDateCommit: onDateCommit
  };
})();
