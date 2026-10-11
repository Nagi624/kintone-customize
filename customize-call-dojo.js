/*
 * 架電トラブル道場(app38) — 架電トラブル対策マニュアル(社内マニュアル33のレコード14)をクイズで練習する画面
 * PC: カスタマイズ一覧「道場」(<div id="dojo-root"></div>) / スマホ: 一覧「道場(スマホ)」(レコード番号 = 0)のヘッダー
 * 1回プレイするごとにこのアプリへ1レコード(ステージ・スコア・正解/不正解の問題番号)を保存し、
 * 進み具合・レベル・バッジ・チームの挑戦状況はそのレコードから計算する(個人ランキングは出さない)。
 * PREVIEW_USERS に人を並べると、その人だけに表示し他の人には「準備中」と出す(null で全員に表示)
 * 問題を直すときは、マニュアル(追加項目/add_manual_call_trouble.py)の内容とそろえる。
 */
(function () {
  'use strict';

  var APP_ID = 38;
  var MANUAL_RECORD = 14;
  var PC_VIEW = '道場';
  var MOBILE_VIEW = '道場(スマホ)';
  var PREVIEW_USERS = ['taimei.sol@gmail.com', 'takeitomoharu.taimeis@outlook.jp']; // 試験公開中。全員公開時は null

  var IS_MOBILE = false;
  var ROOT = null;
  var ME = null;
  var RECORDS = [];      // このアプリの全プレイ記録(古い順)
  var PLAY = null;       // 進行中のプレイ
  var TIMER = null;

  // ---------- 問題 ----------
  // p: 100=ベスト / 50・30=惜しい / 0=NG。解説(exp)は答えたあとに出す
  var STAGES = [
    { id: 's1', no: 1, name: '受付・不在をさばく', icon: '☎️', desc: '受付ブロック・不在・忙しいの切り抜け方', limit: 30 },
    { id: 's2', no: 2, name: '断り・怒りに向き合う', icon: '🛡️', desc: '「結構です」「二度とかけるな」怒鳴られたとき', limit: 30 },
    { id: 's3', no: 3, name: 'うそをつかない・誤解させない', icon: '⚖️', desc: 'Googleの者?必ず1位?—正直に答える', limit: 30 },
    { id: 's4', no: 4, name: '記録と報告', icon: '📝', desc: 'ネタリストへの残し方と、報告のタイミング', limit: 30 },
    { id: 'final', no: 5, name: '総合試験', icon: '🏆', desc: '全問からランダム10問・1問20秒', limit: 20, count: 10 }
  ];
  var REVIEW = { id: 'review', no: 0, name: '苦手の復習', icon: '🩹', desc: '最後に間違えた問題だけをもう一度', limit: 30 };

  var Q = [
    // ステージ1
    { id: 's1-1', st: 's1', who: '受付', say: '営業のお電話でしたら、お断りしております。', ask: 'どう返す?',
      o: [['承知しました。ご担当の方にお渡しする資料だけお送りしてもよろしいでしょうか。難しければ失礼いたします。', 100],
          ['そうおっしゃらずに、5分だけ社長さんにおつなぎいただけませんか。', 0],
          ['社長さんとは以前お話ししたことがありまして…(実際は話していない)', 0],
          ['何も言わずに電話を切る。', 30]],
      exp: '用件を1回だけ短く伝え、それでも断られたら引くのが基本。うそでつなぐと、つながってもすぐ信用を失います。' },
    { id: 's1-2', st: 's1', who: 'お店の方', say: '今ちょっと忙しいんだけど。', ask: 'どうする?',
      o: [['失礼しました。何時ごろでしたらご都合よろしいでしょうか。', 100],
          ['1分で終わりますので!と話し続ける。', 0],
          ['「ではまたかけます」とだけ言って切る。', 50]],
      exp: '忙しいときに用件を話しても聞いてもらえません。都合のよい日時を聞いて、次回架電予定日に入れれば次につながります。' },
    { id: 's1-3', st: 's1', who: '受付', say: '担当の者は外出しております。', ask: 'どう返す?',
      o: [['何時ごろお戻りでしょうか。ご担当の方のお名前を伺ってもよろしいですか。', 100],
          ['では折り返しをお願いします、と自分の番号だけ伝える。', 50],
          ['ご担当の方の携帯番号を教えていただけますか。', 0]],
      exp: '戻りの時間と担当者名が分かれば、次は名指しでかけられます。折り返し待ちは来ないことが多く、個人の携帯番号は聞き出しません。' },
    { id: 's1-4', st: 's1', who: '受付', say: 'どういったご用件でしょうか?', ask: '最初のひとことは?',
      o: [['〇〇(会社名)の△△です。お店のGoogleマップでの見え方について、ご案内のお電話です。', 100],
          ['社長さんに直接お話ししたいことがありまして。', 0],
          ['大事なお話なので、責任者の方をお願いします。', 0]],
      exp: '会社名・名前・用件を最初に短く。用件をぼかすほど怪しまれ、受付で止まりやすくなります。' },
    { id: 's1-5', st: 's1', who: '受付', say: '伝えておきますので、ご用件をどうぞ。', ask: '何を伝える?',
      o: [['会社名・名前・用件をひとこと・こちらからかけ直す日時。', 100],
          ['サービスの内容と料金を、できるだけ詳しく説明する。', 30],
          ['「直接お話ししたいので結構です」と断る。', 30]],
      exp: '伝言は短いほど正しく伝わります。「明日11時ごろ改めてお電話します」と、こちらからかける日時を添えましょう。' },
    { id: 's1-6', st: 's1', who: 'ネタリスト', say: '「電話のおすすめ時間帯」は10〜11時の美容室。今は12時半。', ask: 'どうする?',
      o: [['おすすめ時間帯が合うほかのお店を先にかけ、この店は明日の10時台にかける。', 100],
          ['気にせず今すぐかける。', 30],
          ['確実にいる閉店後の21時ごろにかける。', 0]],
      exp: 'お店の忙しい時間・早朝・夜はかけません。おすすめ時間帯は、記録からつながりやすい時間を自動で出しています。' },
    // ステージ2
    { id: 's2-1', st: 's2', who: 'お店の方', say: '結構です。', ask: '名乗った直後に言われた。どうする?',
      o: [['お時間いただきありがとうございました。失礼いたします。', 100],
          ['なぜですか?どこが合わないですか?と理由を聞き続ける。', 0],
          ['無言で切る。', 30]],
      exp: '断られたら丁寧に終えるのが当社のルール。感じよく終えた相手は、時期を変えれば話を聞いてくれることもあります。' },
    { id: 's2-2', st: 's2', who: 'お店の方', say: '二度とかけてくるな!', ask: 'どうする?',
      o: [['大変失礼いたしました。今後お電話はいたしません。', 100],
          ['理由だけでも教えていただけますか。', 0],
          ['上の者に確認しますので少々お待ちください、と保留にする。', 0]],
      exp: 'すぐにお詫びして終えます。記録は「失注」、メモの先頭に【架電お断り】。社内の誰もかけないようにするためです。' },
    { id: 's2-3', st: 's2', who: 'お店の方', say: '(大声で)何度言ったら分かるんだ!ふざけるな!', ask: '怒鳴られ続けている。どうする?',
      o: [['お詫びを1回伝え「失礼いたします」と切る。その日のうちに竹井か長家へ報告。', 100],
          ['「こちらも仕事なので」と言い返す。', 0],
          ['相手の気が済むまで、30分でも黙って聞き続ける。', 30]],
      exp: '言い返さない。ただし我慢し続ける必要もありません。こちらから切ってよく、そのあと必ず報告してください。' },
    { id: 's2-4', st: 's2', who: 'お店の方', say: 'しつこい。消費者センターに言うからな。', ask: 'どうする?',
      o: [['お詫びし、今後かけないことを伝える。会社名・連絡先を聞かれたら正直に答え、すぐ報告。', 100],
          ['「どうぞご自由に」と返す。', 0],
          ['会社名を言わずに急いで切る。', 0]],
      exp: '会社名を隠すと、かえって問題が大きくなります。誠実に対応し、その日のうちに竹井か長家へ報告します。' },
    { id: 's2-5', st: 's2', who: 'お店の方', say: 'さっきも別の人から同じ電話が来たんだけど?', ask: 'どう返す?',
      o: [['大変失礼いたしました。社内で共有し、重ねてお電話しないようにいたします。', 100],
          ['別の部署の者だと思います、とごまかして話を続ける。', 0],
          ['そうでしたか、と気にせず説明を始める。', 0]],
      exp: '社内の重複電話はお客様に一番嫌がられます。お詫びして記録・報告。かける前に架電履歴を見る習慣で防げます。' },
    { id: 's2-6', st: 's2', who: 'あなた', say: 'きつい断られ方が続いて、気持ちが落ち込んできた…', ask: 'どうする?',
      o: [['1分休んで記録を書いてから次へ。続くようなら竹井か長家に話す。', 100],
          ['すぐ次の電話をかけて、勢いで忘れる。', 50],
          ['誰にも言わず、その日はもう電話しない。', 30]],
      exp: '断られるのは相手の都合やタイミングで、あなたの価値とは関係ありません。ひとりで抱えないのもルールのうちです。' },
    // ステージ3
    { id: 's3-1', st: 's3', who: 'お店の方', say: 'あなた、Googleの人?', ask: 'どう答える?',
      o: [['いいえ、Googleの者ではございません。〇〇の△△です。Googleマップでの集客をお手伝いしている会社です。', 100],
          ['はい、Google関係の者です。', 0],
          ['はっきり答えず、そのまま説明を進める。', 0]],
      exp: 'Googleの者・Google公認と受け取られる言い方は禁止。誤解されたら、はっきり否定して名乗り直します。' },
    { id: 's3-2', st: 's3', who: 'お店の方', say: 'これをやったら、必ず1位になるの?', ask: 'どう答える?',
      o: [['順位はGoogleが決めるため保証はできません。改善できる点と、これまでの事例をご説明します。', 100],
          ['はい、必ず1位になります!', 0],
          ['たぶん大丈夫だと思います。', 30]],
      exp: '効果の断定はうそになります。「保証できない」と正直に言ったうえで、できることを具体的に伝えましょう。' },
    { id: 's3-3', st: 's3', who: 'お店の方', say: '今日決めたら安くしてくれる?', ask: 'どう答える?',
      o: [['料金は料金表のとおりです。特別な条件は私の判断ではお約束できないので、確認してご連絡します。', 100],
          ['今日だけ半額にします!(決められていない)', 0],
          ['今決めないと枠が埋まってしまいます。(事実ではない)', 0]],
      exp: '値引きの約束も、事実でない理由で急がせるのもNG。約束してしまったら、すぐ竹井か長家へ報告します。' },
    { id: 's3-4', st: 's3', who: 'お店の方', say: '近所の〇〇美容室もやってるの?', ask: 'どう答える?',
      o: [['個別のお店のことはお話しできませんが、同じ業種の事例ならご紹介できます。', 100],
          ['はい、〇〇さんもご契約いただいています。', 0],
          ['このあたりのお店はみんなやってますよ。', 0]],
      exp: 'ほかのお店・お客様の名前や契約は話しません。あなたのお店のことも同じように守っています、という信頼につながります。' },
    { id: 's3-5', st: 's3', who: 'お店の方', say: 'どこでこの番号を知ったの?', ask: 'どう答える?',
      o: [['Googleマップなど、公開されているお店の情報を拝見してお電話しました。', 100],
          ['お客様からのご紹介です。(実際は違う)', 0],
          ['それはお答えできません。', 30]],
      exp: '正直に答えれば、ほとんどの方は納得されます。ごまかすと「やっぱり怪しい」と思われます。' },
    { id: 's3-6', st: 's3', who: 'お店の方', say: 'Googleから警告が来てるって、本当なの?', ask: '相手が勘違いしている。どうする?',
      o: [['私どもはGoogleではないので、警告については分かりかねます。お店の情報で直せる点があればご案内します。', 100],
          ['はい、このままだと表示されなくなりますよ。', 0],
          ['勘違いはそのままにして、話を進める。', 0]],
      exp: '相手の誤解に乗るのは、うそをつくのと同じです。誤解は必ずその場で解きます。' },
    // ステージ4
    { id: 's4-1', st: 's4', who: 'ネタリスト', say: '担当者が不在。「明日の午前に戻る」と言われた。', ask: 'どう記録する?',
      o: [['結果「不通・不在」、次回架電予定日=明日、メモに担当者名。', 100],
          ['覚えておけばいいので記録しない。', 0],
          ['結果「失注」にする。', 0]],
      exp: '次回架電予定日を入れると、その日の「今日の架電リスト」に上がってきます。記録しないと誰にも引き継げません。' },
    { id: 's4-2', st: 's4', who: 'ネタリスト', say: '「二度とかけないで」と言われた。', ask: 'どう記録する?',
      o: [['結果「失注」、メモの先頭に【架電お断り】、次回架電予定日は空。', 100],
          ['結果「架電済み」、次回架電予定日を1か月後に。', 0],
          ['気まずいので記録しない。', 0]],
      exp: '「失注」はリストに上がらなくなり、【架電お断り】でほかの人も一目で分かります。記録が無いと、別の人がまたかけてしまいます。' },
    { id: 's4-3', st: 's4', who: 'あなた', say: 'これから架電リストの1件目にかける。', ask: 'かける前に見ることは?',
      o: [['架電履歴(直近の結果・【架電お断り】の有無)と、顧客管理にすでにいないか。', 100],
          ['何も見ずに、リストの上から順にかける。', 0],
          ['お店のホームページだけ見る。', 30]],
      exp: '断られた相手や取引中のお客様への新規営業電話は、トラブルの元。10秒の確認で防げます。' },
    { id: 's4-4', st: 's4', who: 'あなた', say: 'クレームの電話を受けて、内容をメモした。', ask: 'どう報告する?',
      o: [['そのお店のネタリストのコメントに経緯を書き、竹井か長家を宛先(@)にして、その日のうちに知らせる。', 100],
          ['来週の会議で話す。', 30],
          ['自分で対応できたので、誰にも言わない。', 0]],
      exp: 'コメント+宛先指定なら、記録と報告が一度で済みます。報告は責めるためではなく、同じことを繰り返さないための情報です。' },
    { id: 's4-5', st: 's4', who: 'お店の方', say: '資料を送っておいて。', ask: 'どうする?',
      o: [['送り先と宛名を確認して送る。結果「ネタ」、メモに送り先と送った日、次回架電予定日も入れる。', 100],
          ['資料を送って終わりにする。', 30],
          ['送り先を確認せず、代表のメールアドレスに送る。', 30]],
      exp: '「届きましたか」の確認電話が次の会話のきっかけ。次回架電予定日を入れておけば忘れません。' },
    { id: 's4-6', st: 's4', who: 'あなた', say: 'つい「今日なら値引きします」と言ってしまった…', ask: 'どうする?',
      o: [['すぐに竹井か長家へ報告し、ネタリストのメモにも残す。', 100],
          ['なかったことにして黙っておく。', 0],
          ['自分の判断で、値引きした見積書を作る。', 0]],
      exp: '早く報告すれば、会社としてお客様に正しく対応できます。黙っているのが一番の問題になります。' }
  ];

  var LEVELS = [[0, '見習い'], [500, '新人'], [1500, '一人前'], [3000, '頼れる先輩'], [5000, '架電マスター']];

  // ---------- 共通 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fv(r, code, fb) { return r && r[code] && r[code].value !== undefined && r[code].value !== null ? r[code].value : fb; }
  function num(r, code) { var n = Number(fv(r, code, 0)); return isNaN(n) ? 0 : n; }
  function ids(r, code) { return String(fv(r, code, '')).split(/[\s,]+/).filter(Boolean); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function stageById(id) { return id === 'review' ? REVIEW : STAGES.filter(function (s) { return s.id === id; })[0]; }
  function stageByName(name) { var all = STAGES.concat([REVIEW]); return all.filter(function (s) { return s.name === name; })[0]; }
  function creatorCode(r) { var c = fv(r, '作成者', null); return c ? c.code : ''; }
  function creatorName(r) { var c = fv(r, '作成者', null); return c ? c.name : ''; }
  function manualUrl() { return IS_MOBILE ? '/k/m/33/show?record=' + MANUAL_RECORD : '/k/33/show#record=' + MANUAL_RECORD; }
  function starText(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < n ? '★' : '☆'; return s; }
  function starsOf(correct, total) { var r = total ? correct / total : 0; return r >= 1 ? 3 : r >= 0.8 ? 2 : r >= 0.6 ? 1 : 0; }

  function fetchAll() {
    var out = [];
    function page(offset) {
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', {
        app: APP_ID, query: 'order by レコード番号 asc limit 500 offset ' + offset,
        fields: ['$id', '作成者', '作成日時', 'stage', 'score', 'correct', 'total', 'stars', 'right_ids', 'wrong_ids']
      }).then(function (resp) {
        out = out.concat(resp.records || []);
        if ((resp.records || []).length === 500) return page(offset + 500);
        return out;
      });
    }
    return page(0);
  }

  // ---------- 集計 ----------
  function myStats() {
    var mine = RECORDS.filter(function (r) { return creatorCode(r) === ME.code; });
    var best = {};   // stageId -> {stars, score}
    var last = {};   // 問題ID -> 最後の正誤
    var xp = 0, days = {}, perfect = false, reviewClear = false;
    mine.forEach(function (r) {
      var st = stageByName(fv(r, 'stage', ''));
      var sc = num(r, 'score'), stars = num(r, 'stars');
      xp += sc;
      if (st) {
        var b = best[st.id] || { stars: 0, score: 0, plays: 0 };
        best[st.id] = { stars: Math.max(b.stars, stars), score: Math.max(b.score, sc), plays: b.plays + 1 };
        if (st.id === 'review' && num(r, 'total') > 0 && num(r, 'correct') === num(r, 'total')) reviewClear = true;
      }
      if (num(r, 'total') > 0 && num(r, 'correct') === num(r, 'total') && st && st.id !== 'review') perfect = true;
      ids(r, 'right_ids').forEach(function (id) { last[id] = true; });
      ids(r, 'wrong_ids').forEach(function (id) { last[id] = false; });
      var t = fv(r, '作成日時', '');
      if (t) days[ymd(new Date(t))] = true;
    });
    var weak = Q.filter(function (q) { return last[q.id] === false; });
    // 連続日数: 今日(まだなら昨日)からさかのぼる
    var d = new Date(), streak = 0;
    if (!days[ymd(d)]) d.setDate(d.getDate() - 1);
    while (days[ymd(d)]) { streak++; d.setDate(d.getDate() - 1); }
    var maxStreak = 0, run = 0, keys = Object.keys(days).sort(), prev = null;
    keys.forEach(function (k) {
      var cur = new Date(k + 'T00:00:00');
      run = prev && (cur - prev) / 86400000 === 1 ? run + 1 : 1;
      maxStreak = Math.max(maxStreak, run); prev = cur;
    });
    var lv = 0;
    LEVELS.forEach(function (l, i) { if (xp >= l[0]) lv = i; });
    var cleared = function (id) { return best[id] && best[id].stars >= 2; };
    var allClear = ['s1', 's2', 's3', 's4'].every(cleared);
    var badges = [
      { icon: '🎓', name: '初挑戦', on: mine.length > 0 },
      { icon: '💯', name: '満点', on: perfect },
      { icon: '🔥', name: '3日連続', on: maxStreak >= 3 },
      { icon: '🏅', name: '全ステージクリア', on: allClear },
      { icon: '👑', name: '総合試験★3', on: best.final && best.final.stars >= 3 },
      { icon: '🩹', name: '苦手克服', on: reviewClear }
    ];
    return { plays: mine.length, best: best, weak: weak, xp: xp, streak: streak, lv: lv, cleared: cleared, allClear: allClear, badges: badges };
  }

  function teamStats() {
    var now = new Date(), monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
    var week = {}, users = {}, answered = 0, clearMap = {};
    RECORDS.forEach(function (r) {
      var code = creatorCode(r); if (!code) return;
      users[code] = creatorName(r);
      answered += num(r, 'total');
      if (new Date(fv(r, '作成日時', 0)) >= monday) week[code] = true;
      var st = stageByName(fv(r, 'stage', ''));
      if (st && /^s\d$/.test(st.id) && num(r, 'stars') >= 2) { clearMap[code] = clearMap[code] || {}; clearMap[code][st.id] = true; }
    });
    var allClear = Object.keys(clearMap).filter(function (c) { return Object.keys(clearMap[c]).length === 4; })
      .map(function (c) { return users[c]; });
    return { players: Object.keys(users).length, week: Object.keys(week).length, answered: answered, allClear: allClear };
  }

  // ---------- 画面 ----------
  var CSS = [
    '.dj{font-family:"Hiragino Kaku Gothic ProN","Meiryo",sans-serif;color:#2c3e50;max-width:960px;margin:0 auto;padding:12px 16px 32px;box-sizing:border-box}',
    '.dj *{box-sizing:border-box}',
    '.dj-hero{background:linear-gradient(135deg,#1f3b73,#2f6fb3);color:#fff;border-radius:14px;padding:16px 18px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}',
    '.dj-hero h2{margin:0;font-size:20px}.dj-hero p{margin:4px 0 0;font-size:13px;opacity:.9}',
    '.dj-lv{margin-left:auto;background:rgba(255,255,255,.14);border-radius:10px;padding:10px 14px;min-width:230px}',
    '.dj-lv b{font-size:16px}.dj-bar{height:8px;background:rgba(255,255,255,.25);border-radius:4px;margin-top:6px;overflow:hidden}',
    '.dj-bar i{display:block;height:100%;background:#ffd166;border-radius:4px}',
    '.dj-badges{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0}',
    '.dj-badge{font-size:12px;padding:4px 10px;border-radius:999px;background:#eef2f7;color:#9aa5b1}',
    '.dj-badge.on{background:#fff4d6;color:#8a5a00;font-weight:bold}',
    '.dj-h{font-size:15px;font-weight:bold;margin:18px 0 8px}',
    '.dj-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}',
    '.dj-card{border:1px solid #dfe6ee;border-radius:12px;padding:12px;background:#fff;cursor:pointer;transition:transform .1s}',
    '.dj-card:hover{transform:translateY(-2px);box-shadow:0 4px 12px rgba(31,59,115,.12)}',
    '.dj-card.lock{cursor:default;background:#f5f7fa;color:#9aa5b1}.dj-card.lock:hover{transform:none;box-shadow:none}',
    '.dj-card .t{font-weight:bold;font-size:14px}.dj-card .d{font-size:12px;color:#5d6d7e;margin:4px 0 8px;min-height:32px}',
    '.dj-card .s{color:#f39c12;font-size:16px;letter-spacing:2px}.dj-card .m{font-size:11px;color:#7f8c8d}',
    '.dj-row{display:flex;gap:10px;flex-wrap:wrap}',
    '.dj-panel{flex:1;min-width:240px;border:1px solid #dfe6ee;border-radius:12px;padding:12px;background:#fbfcfe}',
    '.dj-team{display:flex;gap:8px;flex-wrap:wrap}.dj-team div{flex:1;min-width:80px;text-align:center;background:#fff;border-radius:8px;padding:8px}',
    '.dj-team b{display:block;font-size:20px;color:#1f3b73}.dj-team span{font-size:11px;color:#7f8c8d}',
    '.dj-btn{display:inline-block;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;background:#2f6fb3;color:#fff;font-weight:bold}',
    '.dj-btn.sub{background:#eef2f7;color:#2c3e50}.dj-btn[disabled]{opacity:.5;cursor:default}',
    '.dj-top{display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap}',
    '.dj-top .sc{margin-left:auto;font-weight:bold;color:#1f3b73}.dj-combo{color:#e67e22;font-weight:bold}',
    '.dj-time{height:6px;background:#eef2f7;border-radius:3px;margin:8px 0 14px;overflow:hidden}.dj-time i{display:block;height:100%;background:#27ae60;transition:width .1s linear}',
    '.dj-scene{background:#f4f8fc;border-radius:14px;padding:14px}',
    '.dj-who{font-size:12px;color:#5d6d7e;margin-bottom:4px}.dj-who:before{content:"📞 "}',
    '.dj-say{background:#fff;border:1px solid #d6e2ee;border-radius:4px 14px 14px 14px;padding:10px 14px;font-size:16px;display:inline-block;max-width:100%}',
    '.dj-ask{font-weight:bold;margin:14px 0 8px}',
    '.dj-opt{display:block;width:100%;text-align:left;border:2px solid #dfe6ee;background:#fff;border-radius:10px;padding:11px 14px;margin:0 0 8px;font-size:14px;cursor:pointer;color:#2c3e50;line-height:1.5}',
    '.dj-opt:hover{border-color:#2f6fb3}.dj-opt.ok{border-color:#27ae60;background:#eafaf1}.dj-opt.half{border-color:#f39c12;background:#fef5e7}.dj-opt.ng{border-color:#e74c3c;background:#fdedec}',
    '.dj-opt[disabled]{cursor:default}',
    '.dj-fb{border-radius:10px;padding:12px 14px;margin:8px 0 12px;font-size:14px;line-height:1.6}',
    '.dj-fb.ok{background:#eafaf1}.dj-fb.half{background:#fef5e7}.dj-fb.ng{background:#fdedec}.dj-fb b{font-size:16px}',
    '.dj-pop{display:inline-block;animation:djpop .5s}@keyframes djpop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.2)}100%{transform:scale(1);opacity:1}}',
    '.dj-res{text-align:center;padding:10px 0}.dj-res .big{font-size:44px;color:#f39c12;letter-spacing:6px}',
    '.dj-res .pt{font-size:28px;font-weight:bold;color:#1f3b73}.dj-res p{margin:6px 0}',
    '.dj-list{text-align:left;font-size:13px;margin:12px 0;padding:0 0 0 18px}.dj-list li{margin:4px 0}',
    '.dj-note{font-size:12px;color:#7f8c8d}',
    '.dj-m .dj-hero{padding:12px}.dj-m .dj-lv{margin-left:0;min-width:0;width:100%}.dj-m .dj-grid{grid-template-columns:1fr}',
    '.dj-m{padding:8px 10px 24px}.dj-m .dj-say{font-size:15px}'
  ].join('\n');

  function injectCss() {
    if (document.getElementById('dojo-css')) return;
    var st = document.createElement('style'); st.id = 'dojo-css'; st.textContent = CSS; document.head.appendChild(st);
  }

  function shell(html) { ROOT.innerHTML = '<div class="dj' + (IS_MOBILE ? ' dj-m' : '') + '">' + html + '</div>'; }

  function renderHome() {
    stopTimer(); PLAY = null;
    var me = myStats(), team = teamStats();
    var lvName = LEVELS[me.lv][1], next = LEVELS[me.lv + 1];
    var pct = next ? Math.round((me.xp - LEVELS[me.lv][0]) / (next[0] - LEVELS[me.lv][0]) * 100) : 100;
    var h = '<div class="dj-hero"><div><h2>📞 架電トラブル道場</h2><p>電話の「困った」を、選んで覚える。1回3〜5分。</p></div>'
      + '<div class="dj-lv"><div>Lv.' + (me.lv + 1) + ' <b>' + esc(lvName) + '</b>' + (me.streak ? ' 　🔥' + me.streak + '日連続' : '') + '</div>'
      + '<div class="dj-bar"><i style="width:' + pct + '%"></i></div>'
      + '<div style="font-size:11px;margin-top:4px">経験値 ' + me.xp.toLocaleString() + (next ? ' / 次のレベルまで ' + (next[0] - me.xp).toLocaleString() : '(最高レベル)') + '</div></div></div>';
    h += '<div class="dj-badges">' + me.badges.map(function (b) {
      return '<span class="dj-badge' + (b.on ? ' on' : '') + '">' + b.icon + ' ' + esc(b.name) + '</span>';
    }).join('') + '</div>';
    h += '<div class="dj-h">ステージ</div><div class="dj-grid">';
    STAGES.forEach(function (s, i) {
      var b = me.best[s.id];
      var locked = s.id === 'final' ? !me.allClear : (i > 0 && !me.cleared(STAGES[i - 1].id));
      var lockMsg = s.id === 'final' ? 'ステージ1〜4を★2以上でクリアすると挑戦できます' : '前のステージを★2以上でクリアすると開きます';
      var n = s.count || Q.filter(function (q) { return q.st === s.id; }).length;
      h += '<div class="dj-card' + (locked ? ' lock' : '') + '" data-stage="' + s.id + '">'
        + '<div class="t">' + s.icon + ' ' + (s.id === 'final' ? '' : 'ステージ' + s.no + ' ') + esc(s.name) + (locked ? ' 🔒' : '') + '</div>'
        + '<div class="d">' + esc(locked ? lockMsg : s.desc) + '</div>'
        + '<div class="s">' + starText(b ? b.stars : 0) + '</div>'
        + '<div class="m">' + n + '問・1問' + s.limit + '秒' + (b ? '　ベスト ' + b.score.toLocaleString() + '点' : '　未挑戦') + '</div></div>';
    });
    h += '</div>';
    h += '<div class="dj-row" style="margin-top:14px"><div class="dj-panel"><div class="dj-h" style="margin-top:0">🩹 苦手の復習</div>'
      + (me.weak.length ? '<p style="font-size:13px;margin:0 0 8px">最後に間違えた問題が <b>' + me.weak.length + '問</b> あります。</p><button class="dj-btn" data-stage="review">復習する</button>'
        : '<p class="dj-note" style="margin:0">' + (me.plays ? '間違えたままの問題はありません。すばらしい!' : 'ステージに挑戦すると、間違えた問題がここに集まります。') + '</p>')
      + '</div><div class="dj-panel"><div class="dj-h" style="margin-top:0">👥 みんなの挑戦</div><div class="dj-team">'
      + '<div><b>' + team.week + '</b><span>今週挑戦した人</span></div>'
      + '<div><b>' + team.allClear.length + '</b><span>全ステージクリア</span></div>'
      + '<div><b>' + team.answered.toLocaleString() + '</b><span>みんなで解いた問題</span></div></div>'
      + (team.allClear.length ? '<p style="font-size:12px;margin:8px 0 0">🏅 クリアおめでとう: ' + team.allClear.map(esc).join('、') + '</p>' : '')
      + '</div></div>';
    h += '<p class="dj-note" style="margin-top:14px">📖 答えの根拠は <a href="' + manualUrl() + '" target="_blank" rel="noopener">社内マニュアル「架電トラブル対策マニュアル」</a> にまとまっています。'
      + ' 点数は「ベストの答え100点+早押しボーナス(最大50)」×連続正解ボーナス。★2(8割)以上でクリアです。</p>';
    shell(h);
    ROOT.querySelectorAll('[data-stage]').forEach(function (el) {
      if (el.classList.contains('lock')) return;
      el.addEventListener('click', function () { startPlay(el.getAttribute('data-stage')); });
    });
  }

  function startPlay(stageId) {
    var s = stageById(stageId), list;
    if (stageId === 'review') list = myStats().weak;
    else if (stageId === 'final') list = shuffle(Q).slice(0, s.count);
    else list = Q.filter(function (q) { return q.st === stageId; });
    if (!list.length) return renderHome();
    PLAY = { stage: s, list: shuffle(list), i: 0, score: 0, combo: 0, right: [], wrong: [], started: Date.now(), log: [] };
    renderQuestion();
  }

  function stopTimer() { if (TIMER) { clearInterval(TIMER); TIMER = null; } }

  function renderQuestion() {
    var P = PLAY, q = P.list[P.i], s = P.stage;
    var opts = shuffle(q.o.map(function (o, k) { return { t: o[0], p: o[1], k: k }; }));
    var h = '<div class="dj-top"><button class="dj-btn sub" data-act="quit" style="padding:6px 10px;font-size:12px">← やめる</button>'
      + '<span>' + s.icon + ' ' + esc(s.name) + '</span><span>' + (P.i + 1) + ' / ' + P.list.length + '問</span>'
      + (P.combo >= 2 ? '<span class="dj-combo">🔥' + P.combo + '連続</span>' : '')
      + '<span class="sc">' + P.score.toLocaleString() + '点</span></div>'
      + '<div class="dj-time"><i id="dj-tbar" style="width:100%"></i></div>'
      + '<div class="dj-scene"><div class="dj-who">' + esc(q.who) + '</div><div class="dj-say">「' + esc(q.say) + '」</div></div>'
      + '<div class="dj-ask">' + esc(q.ask) + '</div><div id="dj-opts">'
      + opts.map(function (o, n) { return '<button class="dj-opt" data-n="' + n + '">' + esc(o.t) + '</button>'; }).join('')
      + '</div><div id="dj-after"></div>';
    shell(h);
    ROOT.querySelector('[data-act="quit"]').addEventListener('click', function () {
      if (window.confirm('途中でやめると、このプレイは記録されません。やめますか?')) renderHome();
    });
    var t0 = Date.now(), limit = s.limit * 1000;
    ROOT.querySelectorAll('.dj-opt').forEach(function (b) {
      b.addEventListener('click', function () { answer(q, opts, Number(b.getAttribute('data-n')), (Date.now() - t0) / 1000); });
    });
    stopTimer();
    TIMER = setInterval(function () {
      var left = Math.max(0, limit - (Date.now() - t0)), bar = document.getElementById('dj-tbar');
      if (bar) { bar.style.width = (left / limit * 100) + '%'; bar.style.background = left < limit * 0.3 ? '#e74c3c' : '#27ae60'; }
      if (left <= 0) answer(q, opts, -1, s.limit);
    }, 100);
  }

  function answer(q, opts, n, sec) {
    stopTimer();
    var P = PLAY;
    if (!P || P.answered === P.i) return;
    var s = P.stage;
    P.answered = P.i;
    var chosen = n >= 0 ? opts[n] : null, p = chosen ? chosen.p : 0, best = p === 100;
    var bonus = best ? Math.round(Math.max(0, s.limit - sec) / s.limit * 50) : 0;
    P.combo = best ? P.combo + 1 : 0;
    var mult = best ? 1 + Math.min(P.combo - 1, 5) * 0.1 : 1;
    var gain = Math.round((p + bonus) * mult);
    P.score += gain;
    (best ? P.right : P.wrong).push(q.id);
    P.log.push({ q: q, best: best, p: p });
    var scEl = ROOT.querySelector('.dj-top .sc');
    if (scEl) scEl.textContent = P.score.toLocaleString() + '点';
    ROOT.querySelectorAll('.dj-opt').forEach(function (b, k) {
      b.disabled = true;
      if (opts[k].p === 100) b.classList.add('ok');
      else if (k === n) b.classList.add(opts[k].p > 0 ? 'half' : 'ng');
    });
    var cls = best ? 'ok' : p > 0 ? 'half' : 'ng';
    var head = n < 0 ? '⏰ 時間切れ' : best ? '⭕ ベストな対応!' : p > 0 ? '🔺 惜しい!もっと良い対応があります' : '❌ それはNGです';
    var detail = best ? '+' + gain + '点(基本100' + (bonus ? '+早押し' + bonus : '') + (mult > 1 ? '、' + P.combo + '連続×' + mult.toFixed(1) : '') + ')'
      : (gain ? '+' + gain + '点' : '0点');
    var last = P.i === P.list.length - 1;
    document.getElementById('dj-after').innerHTML = '<div class="dj-fb ' + cls + '"><b class="dj-pop">' + head + '</b> <span class="dj-note">' + detail + '</span><br>'
      + esc(q.exp) + '</div><button class="dj-btn" data-act="next">' + (last ? '結果を見る' : '次の問題へ →') + '</button>';
    ROOT.querySelector('[data-act="next"]').addEventListener('click', function () {
      if (last) finish(); else { P.i++; renderQuestion(); }
    });
    var after = document.getElementById('dj-after');
    if (after && after.scrollIntoView) after.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function finish() {
    var P = PLAY, s = P.stage, total = P.list.length, correct = P.right.length;
    var before = myStats();
    var stars = starsOf(correct, total);
    var sec = Math.round((Date.now() - P.started) / 1000);
    var rank = stars === 3 ? '完璧です!この対応ならどんな電話も怖くありません。' : stars === 2 ? 'クリア!あと少しで満点です。' : stars === 1 ? 'あと一歩。解説を読んでもう一度!' : 'まずはマニュアルを読んでから再挑戦しましょう。';
    var h = '<div class="dj-res"><div style="font-size:14px">' + s.icon + ' ' + esc(s.name) + '</div>'
      + '<div class="big dj-pop">' + starText(stars) + '</div>'
      + '<div class="pt">' + P.score.toLocaleString() + '点</div>'
      + '<p>' + correct + ' / ' + total + '問 ベストな対応(' + Math.round(correct / total * 100) + '%)・' + sec + '秒</p>'
      + '<p style="font-weight:bold">' + rank + '</p><div id="dj-save" class="dj-note">記録を保存しています…</div><div id="dj-new"></div>';
    var miss = P.log.filter(function (l) { return !l.best; });
    if (miss.length) {
      h += '<div style="text-align:left;margin-top:12px"><div class="dj-h">もう一度確認したい問題</div><ul class="dj-list">'
        + miss.map(function (l) {
          var bestOpt = l.q.o.filter(function (o) { return o[1] === 100; })[0];
          return '<li>「' + esc(l.q.say) + '」→ <b>' + esc(bestOpt ? bestOpt[0] : '') + '</b></li>';
        }).join('') + '</ul></div>';
    }
    h += '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:12px">'
      + '<button class="dj-btn" data-act="again">もう一度</button><button class="dj-btn sub" data-act="home">ステージ選択へ</button>'
      + '<a class="dj-btn sub" style="text-decoration:none" href="' + manualUrl() + '" target="_blank" rel="noopener">📖 マニュアル</a></div></div>';
    shell(h);
    ROOT.querySelector('[data-act="again"]').addEventListener('click', function () { startPlay(s.id); });
    ROOT.querySelector('[data-act="home"]').addEventListener('click', renderHome);
    var rec = {
      stage: { value: s.name }, score: { value: String(P.score) }, correct: { value: String(correct) },
      total: { value: String(total) }, stars: { value: String(stars) }, seconds: { value: String(sec) },
      right_ids: { value: P.right.join(',') }, wrong_ids: { value: P.wrong.join(',') }
    };
    kintone.api(kintone.api.url('/k/v1/record', true), 'POST', { app: APP_ID, record: rec }).then(function (resp) {
      RECORDS.push({
        $id: { value: resp.id }, 作成者: { value: { code: ME.code, name: ME.name } }, 作成日時: { value: new Date().toISOString() },
        stage: rec.stage, score: rec.score, correct: rec.correct, total: rec.total, stars: rec.stars, right_ids: rec.right_ids, wrong_ids: rec.wrong_ids
      });
      var after = myStats(), msgs = [];
      if (after.lv > before.lv) msgs.push('🎉 レベルアップ!Lv.' + (after.lv + 1) + '「' + LEVELS[after.lv][1] + '」になりました');
      after.badges.forEach(function (b, k) { if (b.on && !before.badges[k].on) msgs.push('🏷️ バッジ獲得: ' + b.icon + ' ' + b.name); });
      if (s.id !== 'final' && s.id !== 'review' && stars >= 2 && !before.cleared(s.id)) {
        var idx = STAGES.indexOf(s), nx = STAGES[idx + 1];
        if (nx && (nx.id !== 'final' || after.allClear)) msgs.push('🔓 「' + nx.name + '」が開きました');
      }
      var el = document.getElementById('dj-save'); if (el) el.textContent = '✔ 記録しました(経験値 +' + P.score.toLocaleString() + ')';
      var nw = document.getElementById('dj-new');
      if (nw && msgs.length) nw.innerHTML = msgs.map(function (m) { return '<p class="dj-pop" style="font-weight:bold;color:#8a5a00">' + esc(m) + '</p>'; }).join('');
    }).catch(function (e) {
      var el = document.getElementById('dj-save');
      if (el) el.innerHTML = '<span style="color:#c0392b">記録の保存に失敗しました。通信状態を確かめて、もう一度挑戦してください。(' + esc(e && e.message || e) + ')</span>';
    });
  }

  function start(container) {
    ROOT = container;
    injectCss();
    ME = kintone.getLoginUser();
    if (PREVIEW_USERS && PREVIEW_USERS.indexOf(ME.code) < 0) {
      shell('<div class="dj-hero"><div><h2>📞 架電トラブル道場</h2><p>ただいま準備中です。公開までもうしばらくお待ちください。</p></div></div>');
      return;
    }
    shell('<p class="dj-note">読み込み中…</p>');
    fetchAll().then(function (recs) { RECORDS = recs; renderHome(); }).catch(function (e) {
      shell('<p style="color:#c0392b">記録を読み込めませんでした: ' + esc(e && e.message || e) + '</p>');
    });
  }

  kintone.events.on('app.record.index.show', function (event) {
    IS_MOBILE = false;
    if (event.viewName !== PC_VIEW) { stopTimer(); return event; }
    var el = document.getElementById('dojo-root');
    if (el) start(el);
    return event;
  });

  kintone.events.on('mobile.app.record.index.show', function (event) {
    IS_MOBILE = true;
    var space = kintone.mobile.app.getHeaderSpaceElement();
    var old = document.getElementById('dojo-m-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (event.viewName !== MOBILE_VIEW || !space) { stopTimer(); return event; }
    var el = document.createElement('div'); el.id = 'dojo-m-root';
    space.appendChild(el);
    start(el);
    return event;
  });
})();
