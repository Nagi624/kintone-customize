/*
 * 営業道場(app40) — 営業教育資料「MEO商談の型と空気感」(社内マニュアル33のレコード15)を練習し、段位で育成する画面
 * PC: カスタマイズ一覧「道場」(<div id="sales-dojo-root"></div>) / スマホ: 一覧「道場(スマホ)」(レコード番号 = 0)のヘッダー
 * メニュー: 段位(ホーム) / 商談クイズ / 切り返しノック / 空気感トレーニング(マイクで間と速さを測る。録音は保存しない) / コーチ画面
 * 1回の練習=このアプリに1レコード(kind で種類を分ける)。段位は練習記録に加え、実戦のデータ
 * (架電トラブル道場38・ネタリスト29の架電履歴とアポ獲得者・活動履歴17の架電・案件19・スケジュール34の同席)とコーチの認定レコードから計算する。
 * 認定レコード(kind=段位認定)は作成者が COACHES のものだけ有効。個人ランキングは出さない(コーチ画面だけ全員の進み具合を見る)。
 * PREVIEW_USERS に人を並べると、その人だけに表示し他の人には「準備中」と出す(null で全員に表示)
 * 問題・お手本を直すときは、営業フォルダ/営業教育資料/MEO商談の型と空気感.md とそろえる。
 */
(function () {
  'use strict';

  var APP_ID = 40;
  var MANUAL_RECORD = 15;
  var PC_VIEW = '道場';
  var MOBILE_VIEW = '道場(スマホ)';
  var TAKEI = 'takeitomoharu.taimeis@outlook.jp';
  var COACHES = ['taimei.sol@gmail.com', TAKEI];
  var TRAINEES = [
    { code: 'satot.biz@gmail.com', name: '佐藤 達也' },
    { code: 'mii-.-.-mii3160@ezweb.ne.jp', name: '渡邉 美穂' },
    { code: 'nm7karusyu@gmail.com', name: '渡邉 純樹' },
    { code: 'kanoyama1123@gmail.com', name: '山岸 花音' }
  ];
  var PREVIEW_USERS = null; // 2026-10-11 全員公開。試験公開に戻すときは ['taimei.sol@gmail.com', TAKEI]

  // 段位の条件(仮。数字はここで調整する)
  var REQ = { calls: 50, apo: 2, knock: 50, sit: 3, deals: 3, won: 1 };

  var IS_MOBILE = false, ROOT = null, ME = null, TIMER = null;
  var RECS = [];      // このアプリの全記録
  var CALLDOJO = [];  // 架電トラブル道場(38)の全記録
  var REAL = null;    // 実戦データ { code: {calls, apo, deals, won, sit} }
  var PLAY = null, TAB = 'home';

  // ---------- 商談クイズの問題(録音11・録音10から。店名・人名は伏せる) ----------
  // q7は2026-10-21追加(録音10)。既存の進み具合を変えないよう、q7はいつでも挑戦でき、総合試験の条件(q1〜q6)には入れない
  var STAGES = [
    { id: 'q1', no: 1, name: '雑談で空気を作る', icon: '☕', desc: '売り込まずに打ち解ける。本題への入り方', limit: 30 },
    { id: 'q2', no: 2, name: 'ほめる・聞く', icon: '👂', desc: '相手の努力を認め、悩みに先回りする', limit: 30 },
    { id: 'q3', no: 3, name: '提案は数字で物語る', icon: '📈', desc: '駅の人数×毎日2人。数字は自分で調べる', limit: 30 },
    { id: 'q4', no: 4, name: '断りを受け止めて返す', icon: '🤝', desc: '「考えたい」「自分でできる」への返し', limit: 30 },
    { id: 'q5', no: 5, name: '金額は空気で伝える', icon: '🤫', desc: '声を落とす・言ったら黙る・高いものを外す', limit: 30 },
    { id: 'q6', no: 6, name: '温度を測って次回を決める', icon: '📅', desc: '「何%ですか?」と、その場での次回アポ', limit: 30 },
    { id: 'q7', no: 7, name: '先に信頼を作る', icon: '🔑', desc: '【新】一緒に画面を見て無料で教える。営業疲れの相手に効く入り方', limit: 30 },
    { id: 'final', no: 8, name: '総合試験', icon: '🏆', desc: '全問からランダム10問・1問20秒', limit: 20, count: 10 }
  ];
  var REVIEW = { id: 'review', no: 0, name: '苦手の復習', icon: '🩹', desc: '最後に間違えた問題だけ', limit: 30 };

  var Q = [
    { id: 'q1-1', st: 'q1', who: '場面', say: 'お店に入ると、とても良い香りがする。', ask: '最初のひとことは?',
      o: [['すごく良い香りですね。今、炊いてらっしゃるんですか?', 100], ['本日はMEOのご提案で参りました。早速ですが…', 30], ['名刺を渡して、すぐ資料を広げる。', 0]],
      exp: '最初の数分は売り込まない。お店で感じたことを素直に言葉にすると、相手の表情がゆるみます。' },
    { id: 'q1-2', st: 'q1', who: 'オーナー', say: '最新情報に写真を載せると、なぜか切れちゃうのよ。', ask: '商談と関係ない相談。どうする?',
      o: [['一緒に画面を見て原因を考える。分からなければ持ち帰る。', 100], ['それは後にして、まずご提案をさせてください。', 0], ['たぶんiPhoneのせいです、と言い切る。', 30]],
      exp: '相手の困りごとに乗るのが一番の雑談。根拠のない言い切りは信頼を下げます。' },
    { id: 'q1-3', st: 'q1', who: 'あなた', say: '写真が切れる原因が、その場では分からない。', ask: 'どう言う?',
      o: [['適当なことはさすがに言えないので、調べて分かり次第お知らせします。', 100], ['それっぽい理由を答えておく。', 0], ['分からないです、で終わる。', 30]],
      exp: '持ち帰ると信頼が上がり、次に連絡する理由にもなります(技12)。' },
    { id: 'q1-4', st: 'q1', who: 'オーナー', say: '(旅行先で撮った写真を見せながら)夜は全然きれいに撮れなかったの。', ask: 'どう返す?',
      o: [['写真をほめて、相手の話が広がる質問をする。', 100], ['へえ、と流して本題へ。', 30], ['自分の旅行の話を長く続ける。', 30]],
      exp: '雑談の主役は相手。ほめて、聞いて、広げます。' },
    { id: 'q1-5', st: 'q1', who: 'あなた', say: '雑談が10分ほど続いた。そろそろ本題に入りたい。', ask: 'どう入る?',
      o: [['話がひと区切りしたところで一呼吸おき、「少しお話をさせていただけたらと思うんですけど」と切り替える。', 100], ['相手の話をさえぎって「では本題ですが」。', 0], ['相手が飽きるまで雑談を続ける。', 30]],
      exp: '録音では本題の直前に約2秒の沈黙があり、そこから声が一段大きくなっていました(技1)。' },
    { id: 'q1-6', st: 'q1', who: 'あなた', say: '雑談のときの話す速さ。', ask: 'どれがよい?',
      o: [['ゆっくりめ(1分240字くらい)。相手のペースに合わせる。', 100], ['早口で、たくさん情報を伝える。', 0], ['説明のときと同じテンポで話す。', 50]],
      exp: '雑談は商談の中で一番ゆっくり(約240字/分)。説明は約340字/分とテンポを上げます。' },
    { id: 'q2-1', st: 'q2', who: '場面', say: 'お店のGoogleマップを見ると、最新情報がこまめに更新されている。', ask: 'どう切り出す?',
      o: [['最新情報をすごく細かく更新されていますね。書いてある言葉が多いほど、検索に引っかかりやすくなるんです。', 100], ['更新はされていますが、これでは足りません。', 0], ['何も触れず、自社サービスの説明を始める。', 30]],
      exp: 'できていることを先に認め、その努力が意味を持つ理由を教えます。' },
    { id: 'q2-2', st: 'q2', who: 'オーナー', say: '言葉が多いほどいいってこと? ハッシュタグじゃなくて?', ask: 'どう答える?',
      o: [['おっしゃるとおりです。ハッシュタグだけでなく、商品名やオンラインショップのような言葉も検索に引っかかります。', 100], ['そうです、とだけ答える。', 30], ['検索の仕組みを専門用語で詳しく説明する。', 30]],
      exp: '相手のお店の言葉を例にすると、一気に自分ごとになります。' },
    { id: 'q2-3', st: 'q2', who: 'オーナー', say: 'でも口コミって、Googleマップでどうやって増やすの?', ask: 'どう返す?',
      o: [['ありがとうございます、待ってました。(と歓迎して具体的な方法を話す)', 100], ['それはご契約後にご説明します。', 0], ['お客さんにお願いするしかないですね。', 30]],
      exp: '質問は興味のサイン。うれしさを言葉にして歓迎します(技11)。' },
    { id: 'q2-4', st: 'q2', who: 'あなた', say: '口コミを増やす方法を説明する。', ask: 'どれを勧める?',
      o: [['お願いするだけでは増えにくいので、アンケート形式にして答えやすくする。', 100], ['口コミを書いてくれたら割引、で一気に増やす。', 0], ['知り合いに書いてもらう。', 0]],
      exp: '口コミの見返りに割引などをするのはGoogleの規約で禁止されています。知り合いに書いてもらうのも同じくNGです。' },
    { id: 'q2-5', st: 'q2', who: '場面', say: '事前に調べたら、インスタはあるが、Googleマップにオンラインショップが載っていなかった。', ask: 'どう伝える?',
      o: [['事前に少し調べさせてもらったんですが、ここにオンラインショップを載せると、見に来た人が自然にそちらへ流れます。', 100], ['黙っておいて、契約後に直す。', 30], ['設定が足りていませんね、と指摘だけする。', 30]],
      exp: '下調べは「相手の得」として伝えると、準備してきた誠実さも伝わります。' },
    { id: 'q2-6', st: 'q2', who: 'オーナー', say: 'Googleマップは6〜7年前から、自分でやってるのよ。', ask: 'どう返す?',
      o: [['10年近くお店を続けられるのは本当にすごいことです。(と認めて、地域のお客様の話へ)', 100], ['でも今のやり方だと、効果は出ていませんよね。', 0], ['聞き流して料金の話に進む。', 0]],
      exp: '続けてきたことへの敬意が先。否定から入ると、その後の提案は聞いてもらえません。' },
    { id: 'q3-1', st: 'q3', who: 'あなた', say: 'Googleマップのメリットを伝える。', ask: 'どう伝える?',
      o: [['6つ程度にまとめ、相手のお店の写真や口コミに当てはめながら話す。', 100], ['思いつく限り全部話す。', 30], ['メリットは言わず、料金から話す。', 0]],
      exp: '一般論ではなく「このお店ならここが効く」に置きかえるのがコツです。' },
    { id: 'q3-2', st: 'q3', who: 'あなた', say: 'お店の前の人の流れを伝えたい。', ask: 'どう言う?',
      o: [['最寄り駅の乗降客〇万人のうち、毎日2人に興味を持ってもらいませんか。', 100], ['Googleマップで集客が何倍にもなります。', 0], ['たくさんの人に見てもらえますよ。', 30]],
      exp: '大きな数字の中の小さな目標にすると、ハードルが下がります(技7)。効果の断定はNGです。' },
    { id: 'q3-3', st: 'q3', who: 'オーナー', say: 'その乗降客の数って、どこの数字?', ask: '答えられるようにするには?',
      o: [['訪問前に、最寄り駅の公表データ(交通局・JRなど)を自分で調べ、出典を言えるようにしておく。', 100], ['前の商談で使った数字をそのまま使う。', 0], ['だいたいの感覚で言う。', 0]],
      exp: '数字はその店だけのもの。訪問先ごとに自分で調べます。' },
    { id: 'q3-4', st: 'q3', who: 'あなた', say: 'お店の客単価を知りたい。', ask: 'どうする?',
      o: [['お客様お一人あたり、だいたいおいくらぐらいですか?とその場で聞く。', 100], ['業界の平均を調べて決めつける。', 30], ['聞かずに先へ進む。', 0]],
      exp: '客単価×毎日2人×営業日数で、相手と一緒に月の売上を計算できます。' },
    { id: 'q3-5', st: 'q3', who: 'あなた', say: '事例を話す。', ask: 'どれがよい?',
      o: [['当社が実際に担当しているお店の実績を、お店が特定されないように話す。', 100], ['聞いたことのある他社の成功例を、自社の事例のように話す。', 0], ['どのお店も4〜7倍になります、と言う。', 0]],
      exp: '事例は自社の実績だけ。出典を言えない数字・加工した数字は使いません。' },
    { id: 'q3-6', st: 'q3', who: 'あなた', say: '「人数×単価」の計算を見せる場面。', ask: '話し方は?',
      o: [['テンポよく、話のヤマは区切らずに一気に話す。', 100], ['一文ごとに長い間を取る。', 30], ['雑談と同じゆっくりペース。', 50]],
      exp: '録音では、説明は約340字/分で一番速く、「〇万人のうち2人」はほぼ間を空けずに話していました(技2)。' },
    { id: 'q4-1', st: 'q4', who: 'オーナー', say: 'もう少し考えてもいいですか?', ask: 'どう返す?',
      o: [['もちろんです。今日初めてお会いしたばかりなので。', 100], ['今決めていただかないと…', 0], ['何が引っかかっていますか?と問い詰める。', 30]],
      exp: '迷われたら一回下げる。録音では約1秒置いて「もちろんです」と返していました(技4)。' },
    { id: 'q4-2', st: 'q4', who: 'オーナー', say: '自分でもできるのに、お金をかけるのはもったいないかな。', ask: 'どう返す?',
      o: [['おっしゃる通りです。ただ、オーナー様はほかのお仕事が多くて、途中で手が回らなくなる方がとても多いんです。', 100], ['素人では無理ですよ。', 0], ['では無料でやり方だけお教えします。', 30]],
      exp: '反論は、まず認めてから返します(技5)。' },
    { id: 'q4-3', st: 'q4', who: 'オーナー', say: '代表(主人)や税理士さんに相談しないと。', ask: 'どう返す?',
      o: [['もちろんです。ご相談しやすいように、次回、年間スケジュールと料金の明細をお持ちします。', 100], ['奥様の判断で決めていただけませんか。', 0], ['では、決まったらご連絡ください。', 30]],
      exp: '相談相手に見せやすい材料を約束すれば、次回の訪問につながります。' },
    { id: 'q4-4', st: 'q4', who: 'オーナー', say: '前に広告の営業で、だまされた気分になったことがあるのよ。', ask: 'どう返す?',
      o: [['共感し、自分の失敗経験も話したうえで、仕組みの違いを説明する。', 100], ['うちは違います、安心してください、とだけ言う。', 30], ['その会社の悪口で盛り上がる。', 0]],
      exp: '録音では、自分もインフルエンサー施策で反響がなかった経験を話して共感を得ていました。' },
    { id: 'q4-5', st: 'q4', who: 'オーナー', say: 'この前、別の会社からもGoogleマップの営業が来たのよ。', ask: 'どう返す?',
      o: [['他社さんのことは悪く言いたくないですけど、と前置きし、仕組みの違いだけを説明する。', 100], ['あそこは詐欺みたいなものですよ。', 0], ['うちの方が安いです、と値段で勝負する。', 30]],
      exp: '他社の悪口は言わない。違いだけを伝えます。' },
    { id: 'q4-6', st: 'q4', who: 'オーナー', say: '広告ってお金をかけても続かないでしょ。', ask: 'どう返す?',
      o: [['広告は期間が終わると止まりますが、口コミはずっとお店に残る資産になります。', 100], ['広告より絶対に効果があります。', 0], ['では広告も一緒にやりましょう。', 30]],
      exp: '「資産」という言い方で、広告との違いを伝えます。「絶対」は断定なのでNG。' },
    { id: 'q5-1', st: 'q5', who: 'あなた', say: '月額の金額を伝える。', ask: '声と話し方は?',
      o: [['声を少し落として、淡々と言う。', 100], ['申し訳なさそうに、小声の早口で言う。', 30], ['勢いよく明るく言い切り、すぐ次の話に移る。', 30]],
      exp: '録音では、金額の場面が商談の中で一番声が小さく、落ち着いていました(技3)。' },
    { id: 'q5-2', st: 'q5', who: '場面', say: '金額を言った。相手が黙った。', ask: 'どうする?',
      o: [['1.5〜2秒は自分から話さず、相手の反応を待つ。', 100], ['すぐ「高いですよね、でも…」と沈黙を埋める。', 0], ['すぐに値引きを提案する。', 0]],
      exp: '金額のあとの沈黙は、相手が考えている時間。録音では1.3〜1.8秒の間がありました。空気感トレーニングで練習できます。' },
    { id: 'q5-3', st: 'q5', who: '場面', say: 'プランが下・中・上の3つある。このお店には下のプランで十分。', ask: 'どう話す?',
      o: [['上のプランは正直お勧めしていません、と自分から外す。', 100], ['一番高いプランから勧める。', 30], ['3つを同じ熱量で説明する。', 30]],
      exp: '必要ないものを自分から外すと、「売り込まない人」として信頼されます(技6)。' },
    { id: 'q5-4', st: 'q5', who: 'オーナー', say: 'もう少し安くならない?', ask: '(値引きのルールができるまでは)どうする?',
      o: [['私の判断ではお約束できないので、確認してご連絡します。(竹井に相談)', 100], ['その場で自分の判断で値引きを約束する。', 0], ['無理です、と即答する。', 30]],
      exp: '値引きの範囲はルール作成中です。それまでは持ち帰って竹井に相談します。' },
    { id: 'q5-5', st: 'q5', who: 'あなた', say: '条件の話に入る前。', ask: 'どんな前置きをする?',
      o: [['ここからは〇〇様と僕とのお話になってきます。', 100], ['上司には内緒ですけど…', 0], ['前置きなしで数字を並べる。', 50]],
      exp: '一対一の話だと伝えると、空気が変わります(技8)。会社を下げるうそはNGです。' },
    { id: 'q5-6', st: 'q5', who: 'あなた', say: 'これ以上は条件を出せない。', ask: 'どう伝える?',
      o: [['正直、これが今出せる精一杯です、と気持ちを込めて伝える。', 100], ['今決めないと値上がりします。', 0], ['黙って書類を片付ける。', 0]],
      exp: '終わりを示すと、相手も判断しやすくなります(技9)。事実でない「値上がり」で急がせるのはNGです。' },
    { id: 'q6-1', st: 'q6', who: 'あなた', say: '説明がひととおり終わった。', ask: '次のひとことは?',
      o: [['今、可能性は何%ぐらいですか?', 100], ['ご契約いただけますか?といきなり迫る。', 30], ['では、ご検討ください。と帰る。', 0]],
      exp: '温度を数字で聞くと、相手も答えやすく、次の一手が決まります(技10)。' },
    { id: 'q6-2', st: 'q6', who: 'オーナー', say: '(可能性は)ちょっとしかないです。', ask: 'どう受ける?',
      o: [['ゼロじゃないんですね、良かったです。', 100], ['なぜですか?と問い詰める。', 30], ['がっかりした顔をする。', 0]],
      exp: '小さな返事でも前向きに受けると、空気が明るいまま次につながります。' },
    { id: 'q6-3', st: 'q6', who: 'オーナー', say: '検討しますね。', ask: 'どうする?',
      o: [['その場で次回の日時を決める。', 100], ['また連絡します、で帰る。', 30], ['いつ決まりますか?と期限を迫る。', 30]],
      exp: '「検討します」で終わらせず、次に会う日を決めて帰ります。' },
    { id: 'q6-4', st: 'q6', who: 'オーナー', say: 'その週は出張で、戻ってからも忙しいのよね。', ask: 'どう返す?',
      o: [['夜でも、すき間の30分でも伺えます。', 100], ['では空いたらご連絡ください。', 30], ['自分の都合のいい日だけ提示する。', 30]],
      exp: '候補を広げると、相手は断る理由がなくなります。' },
    { id: 'q6-5', st: 'q6', who: 'あなた', say: '次回の約束ができた。', ask: '最後に何を伝える?',
      o: [['次回は年間スケジュールと料金の明細をお持ちします、と持ってくるものを伝える。', 100], ['何も言わずに帰る。', 30], ['次回までに決めておいてください、と宿題を出す。', 30]],
      exp: '次回の中身が分かると、相手も準備や相談がしやすくなります。' },
    { id: 'q6-6', st: 'q6', who: 'オーナー', say: 'こんなに長く話したのに、断ったらどうしようって思ってるのよ(笑)', ask: 'どう返す?',
      o: [['大丈夫です、またお伺いしますね、と笑顔で軽く受ける。', 100], ['ぜひ決めてください、と押す。', 30], ['真顔で黙る。', 0]],
      exp: '相手の気まずさを軽くしてあげると、次回も気持ちよく会ってもらえます。' },
    { id: 'q7-1', st: 'q7', who: 'あなた', say: '明日、飲食店に初めて商談へ行く。', ask: '前の日にやっておくことは?',
      o: [['お店のGoogleマップを見て、「売り切れが分からない」「駐車場の案内がない」など、その店だけの課題を2〜3個見つけておく。', 100], ['資料を印刷しておけば十分。', 30], ['前の商談で使った数字と課題を、そのまま話せるようにしておく。', 0]],
      exp: 'その店だけの課題を見せると「うちのために調べてくれた」と伝わり、提案が自分ごとになります。かけた手間が見えると、提案の価値も高く感じてもらえます。' },
    { id: 'q7-2', st: 'q7', who: '場面', say: '席に着いた。オーナーは営業を何度も受けていて、少し身構えている。', ask: '最初にどうする?',
      o: [['お店のGoogleマップを一緒に開き、横に並んで見ながら、自分でもできるやり方を無料で教える。', 100], ['すぐに料金表を出して説明を始める。', 0], ['会社の実績を長く話して安心してもらう。', 30]],
      exp: '営業慣れした人は「売り込まれている」と感じた瞬間に身構えます。先に役に立つと「話くらいは聞こう」になり、横に並んで同じ画面を見ると「一緒に調べる仲間」の形になります。' },
    { id: 'q7-3', st: 'q7', who: 'あなた', say: '無料でできるやり方を一通り教え終わった。ここから有料サービスの話をしたい。', ask: 'どう切り替える?',
      o: [['「ここまでが無料でできるところです。ここからは有料のお話になります」とはっきり線を引く。', 100], ['有料とは言わず、自然な流れで料金の話に入る。', 30], ['「実は…」と申し訳なさそうに切り出す。', 30]],
      exp: '隠されると人は疑いますが、自分から言う人は「隠さない人」と感じてもらえます。線を引くことが誠実さの証拠になります。' },
    { id: 'q7-4', st: 'q7', who: 'オーナー', say: 'あなたの会社、聞いたことないけど大丈夫?', ask: 'どう返す?',
      o: [['7月にできたばかりの新しい会社です。だからこそお客様が大量にいるわけではなく、一店一店連絡を取りながら丁寧にできます。', 100], ['大手さんとも取引があるので大丈夫です、と根拠なく言う。', 0], ['話をそらして、サービスの説明を続ける。', 30]],
      exp: '弱点を自分から先に言う人は信用されます。そのうえで「だから丁寧にできる」と強みに言い換えます。事実でない実績で安心させるのはNGです。' },
    { id: 'q7-5', st: 'q7', who: 'オーナー', say: '実は今、別の会社と月額で契約してるのよ。効いてるのかよく分からないけど。', ask: 'どう返す?',
      o: [['契約の期間や内容は一度確認しておくと安心です、と相手の立場で助言する。他社の悪口は言わない。', 100], ['すぐ解約して、うちに切り替えましょう。', 0], ['その会社はやめた方がいいですよ。', 0]],
      exp: '自分の得にならない助言をする人は、特に信頼されます。録音10ではここで「業者」から「相談相手」に変わり、このあと本音が出ました。' },
    { id: 'q7-6', st: 'q7', who: 'オーナー', say: '実は、奥さんがやっているネイルのお店もあるのよ。', ask: 'どう返す?',
      o: [['そちらの写真もすごく綺麗なので、埋もれているのはもったいないです。2店舗まとめた形も考えられるので、条件は確認してお持ちします。', 100], ['では2店舗目は半額にします、とその場で約束する。', 0], ['今日は1店舗のお話だけにしましょう。', 30]],
      exp: '相手の良いところを「もったいない」と提案の理由にすると、押し売りに見えません。録音10は手間に合わせた2店舗の価格で内諾を取りましたが、値引きルールができるまでは条件は竹井に確認してから伝えます。' }
  ];

  // ---------- 切り返しノック ----------
  var KNOCK = [
    { id: 'k01', say: 'もう少し考えてもいいですか?', ans: 'もちろんです。今日初めてお会いしたばかりなので。ご検討しやすいように、次回は年間のスケジュールをお持ちしますね。', tip: '一回下げる。約1秒置いてから、ゆっくり' },
    { id: 'k02', say: '自分でもできるのに、もったいないかな。', ans: 'おっしゃる通りです。ただ、オーナー様はほかのお仕事が多くて、途中で手が回らなくなる方がとても多いんです。そこを毎月一緒に見ていくのが僕らの役目です。', tip: 'まず認める' },
    { id: 'k03', say: '主人(代表)に相談しないと決められないの。', ans: 'もちろんです。ご相談しやすいように、次回、年間スケジュールと料金の明細をお持ちします。', tip: '相談相手に見せる材料を約束する' },
    { id: 'k04', say: '税理士さんに「そんなの効果あるの?」って言われそう。', ans: '確かに、数字で見えないと判断しにくいですよね。毎月、表示回数や経路検索の数をお見せしますので、それを見ていただければと思います。', tip: '数字で見えることを伝える' },
    { id: 'k05', say: '前に広告の営業で、だまされた気分になったの。', ans: 'それは嫌な思いをされましたね。実は僕も以前、広告に頼って反響がなかったことがあるんです。だからこそ、お店に残るものをおすすめしています。', tip: '共感+自分の失敗談' },
    { id: 'k06', say: 'この前、別の会社からも同じような営業が来たわ。', ans: '他社さんのことは悪く言いたくないですけど、仕組みの違いだけご説明させてください。', tip: '悪口は言わない' },
    { id: 'k07', say: '広告ってお金をかけても続かないでしょ。', ans: 'おっしゃる通り、広告は期間が終わると止まります。Googleマップの口コミは、ずっとお店に残る資産になるんです。', tip: '「資産」で伝える' },
    { id: 'k08', say: '冬はお客さんが来ないから、今始めても…', ans: '分かります。だからこそ、お客様が動き出す時期に目につく状態にしておくのがおすすめです。始める時期は一緒に決めましょう。', tip: '季節に合わせた始め方を一緒に考える' },
    { id: 'k09', say: 'こういうのにお金をかけたことがないのよ。', ans: '初めてだと不安ですよね。まずは毎日2人、新しいお客様に来ていただくことを目標に、数字を見ながら進めていきます。', tip: 'ハードルを下げる' },
    { id: 'k10', say: 'それ、本当に効果あるの?', ans: '順位はGoogleが決めるので、必ずとはお約束できません。ただ、改善できる点と、実際に担当しているお店の数字はお見せできます。', tip: '断定しない。正直に' },
    { id: 'k11', say: 'インスタをやってるから十分よ。', ans: 'インスタもすごく良いですね。Googleマップと連携させると、インスタを見た方が実際にお店へ来る道筋まで作れるんです。', tip: '否定せず、つなげる' },
    { id: 'k12', say: '口コミなんて自然に増えるでしょ。', ans: '書いてくださいとお願いするだけだと、なかなか増えないんです。答えやすい形にしてあげると、ぐっと増えやすくなります。', tip: '見返り(割引)はGoogleの規約違反。言わない' },
    { id: 'k13', say: '月3万円はちょっと高いわね。', ans: '(声を落として)そうですよね。お客様お一人あたり、だいたいおいくらぐらいですか?…毎日2人の新しいお客様で考えると、こうなります。', tip: '金額の話は淡々と。単価から一緒に計算' },
    { id: 'k14', say: '1年は長いなあ。', ans: 'Googleマップは3か月ですぐ結果が出るものではなく、1年かけて育てていくものなんです。毎月の数字を一緒に見ながら進めます。', tip: '理由を短く' },
    { id: 'k15', say: 'もう少し安くならない?', ans: '私の判断ではお約束できないので、確認してご連絡しますね。', tip: '値引きルールができるまでは持ち帰る' },
    { id: 'k16', say: 'うちは常連さんだけで十分なのよ。', ans: '常連さんに愛されているのが伝わります。その常連さんも、最初は新規のお客様だったと思うんです。新しい出会いを少しずつ増やしませんか。', tip: 'ほめてから広げる' },
    { id: 'k17', say: 'ネットのことはよく分からないのよね。', ans: '大丈夫です。難しい設定は僕らが全部やりますので、お店の写真や近況を教えていただくだけで大丈夫です。', tip: '相手の負担を減らす' },
    { id: 'k18', say: 'Googleマップでお店を探す人なんているの?', ans: '近くで何かを探すとき、地図で調べる方はとても多いです。最近はAIの検索でも、Googleマップの情報がもとになっていることが多いんです。', tip: '身近な場面で話す' },
    { id: 'k19', say: '近所の〇〇さんもやってるの?', ans: '個別のお店のことはお話しできないんですが、同じ業種の事例ならご紹介できます。', tip: 'ほかの店のことは話さない' },
    { id: 'k20', say: '資料だけ置いていって。', ans: 'ありがとうございます。資料だけだと分かりにくいところもあるので、5分だけポイントをお伝えしてもいいですか?難しければ、改めてお伺いする日を決めさせてください。', tip: '次の約束につなぐ' },
    { id: 'k21', say: '今、忙しいのよ。', ans: '失礼しました。改めます。何曜日の何時ごろでしたら、少しお時間ありますか?', tip: 'すぐ引いて、日時だけ決める' },
    { id: 'k22', say: '考えておくから、また連絡するわ。', ans: 'ありがとうございます。今、可能性は何%ぐらいですか?…では、〇日ごろに一度、ご様子を伺ってもよろしいですか?', tip: '温度を聞いて、次の日を決める' },
    // k23〜k27は2026-10-21追加(録音10)
    { id: 'k23', say: '業者さんが多すぎて、もう疲れちゃって。', ans: 'そうですよね、毎週のように来ますよね。今日は売り込みというより、まずお店のマップを一緒に見させてください。ご自身でできることは無料でお伝えします。', tip: '警戒を認めて、先に役に立つ' },
    { id: 'k24', say: '最新情報なんて全然やれてないのよ、恥ずかしいけど。', ans: 'ご自身でちゃんとやれている方は、ほとんどいないんです。皆さん本業でお忙しいので当然です。きちんとやると1〜2時間かかりますから、そこを僕らが代わりにやります。', tip: '相手のせいにしない(原因は忙しさ)' },
    { id: 'k25', say: '聞いたことない会社ね。', ans: '7月にできたばかりの新しい会社なんです。だからこそ、一店一店連絡を取りながら丁寧にやらせていただけます。', tip: '弱点を先に言い、強みに言い換える' },
    { id: 'k26', say: '今、別の会社と月額で契約してるのよ。', ans: 'そうなんですね。契約の期間や内容は、一度確認しておくと安心だと思います。そのうえで、見直すときに比べていただければ十分です。', tip: '自分の得より相手の得。悪口は言わない' },
    { id: 'k27', say: 'Googleマップって、経営者が自分でやるものでしょ?', ans: 'もちろんご自身でもできます。ただ、経営者の方の時間はとても価値が高いので、その時間は本業に使っていただいて、マップは僕らに任せていただく方がお店のためになると思うんです。', tip: '費用を「時間を買うお金」に変える' }
  ];

  // ---------- 空気感トレーニングの台本 ----------
  var PAUSE_LINES = [
    'サポートの料金は、月額3万3千円です。',
    '1年間、毎月の数字を一緒に見させていただきます。',
    '正直、これが今出せる精一杯です。',
    '今、可能性は何%ぐらいですか?',
    'ここからは、〇〇様と僕とのお話になってきます。'
  ];
  var SPEED_LINES = [
    { id: 'chat', name: '雑談', min: 210, max: 270, text: 'すごく良い香りですね。入り口からもう良い香りがしていて、思わず深呼吸しちゃいました。今、炊いてらっしゃるんですか。' },
    { id: 'pitch', name: '説明', min: 310, max: 370, text: '最寄り駅の乗降客は一日三万人ほどいます。その中から毎日二人だけ、新しいお客様に来ていただく。お客様お一人あたり三千円なら、それだけで月に十八万円ほどの売上になります。' }
  ];

  // ---------- 共通 ----------
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fv(r, code, fb) { return r && r[code] && r[code].value !== undefined && r[code].value !== null ? r[code].value : fb; }
  function num(r, code) { var n = Number(fv(r, code, 0)); return isNaN(n) ? 0 : n; }
  function ids(r, code) { return String(fv(r, code, '')).split(/[\s,]+/).filter(Boolean); }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function creator(r) { var c = fv(r, '作成者', null); return c ? c.code : ''; }
  function starText(n) { var s = ''; for (var i = 0; i < 3; i++) s += i < n ? '★' : '☆'; return s; }
  function starsOf(c, t) { var r = t ? c / t : 0; return r >= 1 ? 3 : r >= 0.8 ? 2 : r >= 0.6 ? 1 : 0; }
  function manualUrl() { return IS_MOBILE ? '/k/m/33/show?record=' + MANUAL_RECORD : '/k/33/show#record=' + MANUAL_RECORD; }
  function isCoach(code) { return COACHES.indexOf(code) >= 0; }
  function stageById(id) { return id === 'review' ? REVIEW : STAGES.filter(function (s) { return s.id === id; })[0]; }
  function stageByName(n) { return STAGES.concat([REVIEW]).filter(function (s) { return s.name === n; })[0]; }
  function hasUser(list, code) { return (list || []).some(function (u) { return u && u.code === code; }); }
  function quoteList(codes) { return codes.map(function (c) { return '"' + c.replace(/"/g, '\\"') + '"'; }).join(','); }

  function getAll(app, query, fields) {
    var out = [];
    function page(offset) {
      return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', { app: app, query: query + ' limit 500 offset ' + offset, fields: fields })
        .then(function (resp) { out = out.concat(resp.records || []); return (resp.records || []).length === 500 ? page(offset + 500) : out; });
    }
    return page(0);
  }
  function save(rec) {
    return kintone.api(kintone.api.url('/k/v1/record', true), 'POST', { app: APP_ID, record: rec }).then(function (resp) {
      var copy = { $id: { value: resp.id }, 作成者: { value: { code: ME.code, name: ME.name } }, 作成日時: { value: new Date().toISOString() } };
      Object.keys(rec).forEach(function (k) { copy[k] = rec[k]; });
      RECS.push(copy);
      return resp;
    });
  }
  function recOf(code, kind) { return RECS.filter(function (r) { return creator(r) === code && (!kind || fv(r, 'kind', '') === kind); }); }

  // ---------- 段位 ----------
  function quizBest(code) {
    var best = {};
    recOf(code, '商談クイズ').forEach(function (r) {
      var st = stageByName(fv(r, 'stage', '')); if (!st) return;
      best[st.id] = Math.max(best[st.id] || 0, num(r, 'stars'));
    });
    return best;
  }
  function callDojoClear(code) {
    var need = ['受付・不在をさばく', '断り・怒りに向き合う', 'うそをつかない・誤解させない', '記録と報告'], ok = {};
    CALLDOJO.forEach(function (r) { if (creator(r) === code && num(r, 'stars') >= 2) ok[fv(r, 'stage', '')] = true; });
    return need.filter(function (n) { return ok[n]; }).length;
  }
  function knockCount(code) { return recOf(code, '切り返しノック').reduce(function (s, r) { return s + num(r, 'total'); }, 0); }
  function kuukiPass(code) {
    var p = { pause: false, speed: false };
    recOf(code, '空気感トレーニング').forEach(function (r) {
      if (num(r, 'stars') < 2) return;
      if (fv(r, 'stage', '') === '金額のあとの間') p.pause = true;
      if (fv(r, 'stage', '') === '話す速さ') p.speed = true;
    });
    return p;
  }
  function certified(code, rank) {
    return RECS.some(function (r) {
      return fv(r, 'kind', '') === '段位認定' && isCoach(creator(r)) && hasUser(fv(r, 'target_user', []), code) && fv(r, 'rank', '') === rank;
    });
  }

  // 条件ごとに {label, cur, need, done, how}
  function rankInfo(code) {
    var real = (REAL && REAL[code]) || { calls: 0, apo: 0, deals: 0, won: 0, sit: 0 };
    var qb = quizBest(code), kp = kuukiPass(code);
    function q(list) { return list.filter(function (i) { return (qb[i] || 0) >= 2; }).length; }
    function item(label, cur, need, how) { return { label: label, cur: cur, need: need, done: cur >= need, how: how || '' }; }
    var levels = [
      { name: '初段', title: 'アポ取り', icon: '📞', items: [
        item('架電トラブル道場 ステージ1〜4を★2', callDojoClear(code), 4),
        item('架電・飛び込みの記録(担当が自分)', real.calls, REQ.calls, 'ネタリストの「架電を記録」・顧客管理の「📞 架電を記録」で記録したもの'),
        item('アポ獲得', real.apo, REQ.apo, 'ネタリスト・案件の「アポ獲得者」が自分') ] },
      { name: '二段', title: '商談', icon: '🤝', items: [
        item('商談クイズ ステージ1〜3を★2', q(['q1', 'q2', 'q3']), 3),
        item('切り返しノック(累計の本数)', knockCount(code), REQ.knock),
        item('竹井の商談に同席', real.sit, REQ.sit, 'スケジュールの訪問予定に、竹井と自分が参加者で入っているもの'),
        item('コーチの認定', certified(code, '二段') ? 1 : 0, 1, '同席の様子を見て、竹井・長家が認定') ] },
      { name: '三段', title: 'クロージング', icon: '🎯', items: [
        item('商談クイズ ステージ4〜6と総合試験を★2', q(['q4', 'q5', 'q6', 'final']), 4),
        item('空気感トレーニング合格(間・速さ)', (kp.pause ? 1 : 0) + (kp.speed ? 1 : 0), 2),
        item('自分が商談担当の案件', real.deals, REQ.deals, '案件管理の「商談担当者」が自分(商談予定を除く)'),
        item('受注', real.won, REQ.won),
        item('コーチの認定', certified(code, '三段') ? 1 : 0, 1, '竹井・長家が認定') ] },
      { name: '四段', title: '交渉', icon: '👑', locked: true, items: [] }
    ];
    levels.forEach(function (l) { l.done = !l.locked && l.items.every(function (i) { return i.done; }); });
    var rank = 0;
    for (var i = 0; i < levels.length; i++) { if (levels[i].done) rank = i + 1; else break; }
    return { levels: levels, rank: rank, rankName: rank ? levels[rank - 1].name + '「' + levels[rank - 1].title + '」' : '見習い' };
  }

  function loadReal(codes) {
    var res = {};
    codes.forEach(function (c) { res[c] = { calls: 0, apo: 0, deals: 0, won: 0, sit: 0 }; });
    var list = quoteList(codes);
    var p1 = getAll(29, '履歴担当 in (' + list + ') or アポ獲得者 in (' + list + ')', ['$id', '架電履歴', 'アポ獲得者']).then(function (rs) {
      rs.forEach(function (r) {
        fv(r, '架電履歴', []).forEach(function (row) {
          (fv(row.value, '履歴担当', []) || []).forEach(function (u) { if (res[u.code]) res[u.code].calls++; });
        });
        (fv(r, 'アポ獲得者', []) || []).forEach(function (u) { if (res[u.code]) res[u.code].apo++; });
      });
    });
    var p2 = getAll(19, 'アポ獲得者 in (' + list + ') or 商談担当者 in (' + list + ')', ['$id', 'アポ獲得者', '商談担当者', '商談フェーズ']).then(function (rs) {
      rs.forEach(function (r) {
        (fv(r, 'アポ獲得者', []) || []).forEach(function (u) { if (res[u.code]) res[u.code].apo++; });
        var ph = fv(r, '商談フェーズ', '');
        (fv(r, '商談担当者', []) || []).forEach(function (u) {
          if (!res[u.code]) return;
          if (ph && ph !== '商談予定') res[u.code].deals++;
          if (ph === '受注') res[u.code].won++;
        });
      });
    });
    // 顧客管理の「📞 架電を記録」は活動履歴17に架電として残る(2026-10-16。種別の値は2026-10-21に「電話」→「架電」、古い値も数える)
    var p4 = getAll(17, '対応種別 in ("架電", "電話") and 対応者 in (' + list + ')', ['$id', '対応者']).then(function (rs) {
      rs.forEach(function (r) { (fv(r, '対応者', []) || []).forEach(function (u) { if (res[u.code]) res[u.code].calls++; }); });
    });
    var p3 = getAll(34, '種類 in ("訪問") and 参加者 in ("' + TAKEI + '") and 開始日時 < NOW()', ['$id', '参加者']).then(function (rs) {
      rs.forEach(function (r) { (fv(r, '参加者', []) || []).forEach(function (u) { if (res[u.code] && u.code !== TAKEI) res[u.code].sit++; }); });
    });
    // 見られないアプリがあっても、ほかの集計は続ける
    return Promise.all([p1, p2, p3, p4].map(function (p) {
      return p.catch(function (e) { if (window.console) console.warn('営業道場: 実戦データの一部を読めませんでした', e); });
    })).then(function () { REAL = res; });
  }

  // ---------- 画面 ----------
  var CSS = [
    '.sd{font-family:"Hiragino Kaku Gothic ProN","Meiryo",sans-serif;color:#2c3e50;max-width:980px;margin:0 auto;padding:12px 16px 32px;box-sizing:border-box}',
    '.sd *{box-sizing:border-box}',
    '.sd-hero{background:linear-gradient(135deg,#4a2c6f,#7b4fa8);color:#fff;border-radius:14px;padding:14px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
    '.sd-hero h2{margin:0;font-size:20px}.sd-hero p{margin:4px 0 0;font-size:13px;opacity:.9}',
    '.sd-rank{margin-left:auto;background:rgba(255,255,255,.15);border-radius:10px;padding:8px 14px;font-size:13px}.sd-rank b{font-size:18px;display:block}',
    '.sd-tabs{display:flex;gap:6px;margin:12px 0;flex-wrap:wrap}',
    '.sd-tab{border:0;border-radius:999px;padding:8px 14px;font-size:13px;cursor:pointer;background:#f0ebf6;color:#4a2c6f;font-weight:bold}',
    '.sd-tab.on{background:#7b4fa8;color:#fff}',
    '.sd-h{font-size:15px;font-weight:bold;margin:16px 0 8px}',
    '.sd-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}',
    '.sd-card{border:1px solid #e3dcec;border-radius:12px;padding:12px;background:#fff}',
    '.sd-card.click{cursor:pointer}.sd-card.click:hover{box-shadow:0 4px 12px rgba(74,44,111,.15)}',
    '.sd-card.lock{background:#f6f4f9;color:#9a92a6;cursor:default}',
    '.sd-card .t{font-weight:bold;font-size:14px}.sd-card .d{font-size:12px;color:#6b5e7b;margin:4px 0 8px;min-height:32px}',
    '.sd-card .s{color:#f39c12;font-size:16px;letter-spacing:2px}.sd-card .m{font-size:11px;color:#8a8096}',
    '.sd-lv{border:1px solid #e3dcec;border-radius:12px;padding:12px;margin-bottom:10px;background:#fff}',
    '.sd-lv.done{background:#f3fbf5;border-color:#bfe5c9}.sd-lv.cur{border:2px solid #7b4fa8}.sd-lv.lock{background:#f6f4f9;color:#9a92a6}',
    '.sd-lv .lt{font-weight:bold;font-size:15px;margin-bottom:6px}',
    '.sd-it{display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0}',
    '.sd-it .ck{width:20px;text-align:center}.sd-it .lb{flex:1}.sd-it .pg{width:110px;height:6px;background:#eee;border-radius:3px;overflow:hidden}',
    '.sd-it .pg i{display:block;height:100%;background:#7b4fa8}.sd-it .ct{width:64px;text-align:right;font-size:12px;color:#6b5e7b}',
    '.sd-btn{display:inline-block;border:0;border-radius:8px;padding:10px 16px;font-size:14px;cursor:pointer;background:#7b4fa8;color:#fff;font-weight:bold;margin:2px}',
    '.sd-btn.sub{background:#f0ebf6;color:#4a2c6f}.sd-btn.ok{background:#27ae60}.sd-btn.mid{background:#f39c12}.sd-btn.ng{background:#e74c3c}.sd-btn[disabled]{opacity:.5;cursor:default}',
    '.sd-top{display:flex;align-items:center;gap:10px;font-size:13px;flex-wrap:wrap}.sd-top .sc{margin-left:auto;font-weight:bold;color:#4a2c6f}',
    '.sd-time{height:6px;background:#eee;border-radius:3px;margin:8px 0 14px;overflow:hidden}.sd-time i{display:block;height:100%;background:#27ae60}',
    '.sd-scene{background:#f7f3fb;border-radius:14px;padding:14px}.sd-who{font-size:12px;color:#6b5e7b;margin-bottom:4px}',
    '.sd-say{background:#fff;border:1px solid #e0d6ec;border-radius:4px 14px 14px 14px;padding:10px 14px;font-size:16px;display:inline-block;max-width:100%}',
    '.sd-ask{font-weight:bold;margin:14px 0 8px}',
    '.sd-opt{display:block;width:100%;text-align:left;border:2px solid #e3dcec;background:#fff;border-radius:10px;padding:11px 14px;margin:0 0 8px;font-size:14px;cursor:pointer;color:#2c3e50;line-height:1.5}',
    '.sd-opt:hover{border-color:#7b4fa8}.sd-opt.ok{border-color:#27ae60;background:#eafaf1}.sd-opt.half{border-color:#f39c12;background:#fef5e7}.sd-opt.ng{border-color:#e74c3c;background:#fdedec}',
    '.sd-fb{border-radius:10px;padding:12px 14px;margin:8px 0 12px;font-size:14px;line-height:1.6}.sd-fb.ok{background:#eafaf1}.sd-fb.half{background:#fef5e7}.sd-fb.ng{background:#fdedec}',
    '.sd-ans{background:#fff;border-left:4px solid #7b4fa8;border-radius:6px;padding:10px 14px;margin:10px 0;font-size:15px;line-height:1.7}',
    '.sd-tip{font-size:12px;color:#7b4fa8;font-weight:bold}',
    '.sd-big{font-size:46px;font-weight:bold;color:#7b4fa8;text-align:center;margin:10px 0}',
    '.sd-meter{height:14px;background:#eee;border-radius:7px;overflow:hidden;margin:8px 0}.sd-meter i{display:block;height:100%;background:#27ae60;transition:width .05s}',
    '.sd-res{text-align:center}.sd-res .st{font-size:42px;color:#f39c12;letter-spacing:6px}.sd-res .pt{font-size:26px;font-weight:bold;color:#4a2c6f}',
    '.sd-note{font-size:12px;color:#8a8096}',
    '.sd-tbl{border-collapse:collapse;width:100%;font-size:12px}.sd-tbl th,.sd-tbl td{border:1px solid #e3dcec;padding:6px;text-align:center}.sd-tbl th{background:#f7f3fb}',
    '.sd-pop{display:inline-block;animation:sdpop .5s}@keyframes sdpop{0%{transform:scale(.5);opacity:0}70%{transform:scale(1.15)}100%{transform:scale(1);opacity:1}}',
    '.sd-m{padding:8px 10px 24px}.sd-m .sd-rank{margin-left:0;width:100%}.sd-m .sd-grid{grid-template-columns:1fr}.sd-m .sd-it .pg{width:60px}'
  ].join('\n');

  function shell(html) {
    var tabs = [['home', '🥋 段位'], ['quiz', '📝 商談クイズ'], ['knock', '🥊 切り返しノック'], ['kuuki', '🎙️ 空気感']];
    if (isCoach(ME.code)) tabs.push(['coach', '👥 コーチ']);
    var info = rankInfo(ME.code);
    ROOT.innerHTML = '<div class="sd' + (IS_MOBILE ? ' sd-m' : '') + '">'
      + '<div class="sd-hero"><div><h2>🥋 営業道場</h2><p>竹井の商談から学ぶ、MEO商談の型と空気感。</p></div>'
      + '<div class="sd-rank">いまの段位<b>' + esc(info.rankName) + '</b></div></div>'
      + '<div class="sd-tabs">' + tabs.map(function (t) { return '<button class="sd-tab' + (TAB === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + '</button>'; }).join('') + '</div>'
      + '<div id="sd-body">' + html + '</div>'
      + '<p class="sd-note" style="margin-top:16px">📖 教材: <a href="' + manualUrl() + '" target="_blank" rel="noopener">社内マニュアル「MEO商談の型と空気感」</a></p></div>';
    ROOT.querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { go(b.getAttribute('data-tab')); }); });
  }
  function stopTimer() { if (TIMER) { clearInterval(TIMER); TIMER = null; } }
  function go(tab) {
    stopTimer(); stopMic(); PLAY = null; TAB = tab;
    ({ home: renderHome, quiz: renderQuizHome, knock: renderKnockHome, kuuki: renderKuukiHome, coach: renderCoach })[tab]();
  }

  // ---------- 段位(ホーム) ----------
  function levelHtml(lv, i, info) {
    var cls = lv.locked ? ' lock' : lv.done ? ' done' : (i === info.rank ? ' cur' : '');
    var h = '<div class="sd-lv' + cls + '"><div class="lt">' + lv.icon + ' ' + lv.name + '「' + lv.title + '」'
      + (lv.done ? ' ✅' : lv.locked ? ' 🔒' : i === info.rank ? ' ← いまここを目指す' : '') + '</div>';
    if (lv.locked) return h + '<div class="sd-note">値引きのルールが決まったら開きます(金額交渉を任せる段位)</div></div>';
    lv.items.forEach(function (it) {
      var pct = Math.min(100, Math.round(it.cur / it.need * 100));
      h += '<div class="sd-it"><span class="ck">' + (it.done ? '✅' : '⬜') + '</span><span class="lb">' + esc(it.label)
        + (it.how ? '<br><span class="sd-note">' + esc(it.how) + '</span>' : '') + '</span>'
        + '<span class="pg"><i style="width:' + pct + '%"></i></span><span class="ct">' + Math.min(it.cur, it.need) + ' / ' + it.need + '</span></div>';
    });
    return h + '</div>';
  }
  function renderHome() {
    var info = rankInfo(ME.code);
    var h = '<p style="font-size:13px;margin:0 0 10px">練習(クイズ・ノック・空気感)と実戦(架電・アポ・同席・受注)の両方で段位が上がります。条件は自動で数えています。</p>';
    info.levels.forEach(function (lv, i) { h += levelHtml(lv, i, info); });
    h += '<p class="sd-note">架電トラブル道場は <a href="' + (IS_MOBILE ? '/k/m/38/' : '/k/38/') + '" target="_blank" rel="noopener">こちら</a>。条件の数字は試行中のため、今後変わることがあります。</p>';
    shell(h);
  }

  // ---------- 商談クイズ ----------
  function quizState() {
    var best = {}, top = {}, last = {};
    recOf(ME.code, '商談クイズ').forEach(function (r) {
      var st = stageByName(fv(r, 'stage', ''));
      if (st) { best[st.id] = Math.max(best[st.id] || 0, num(r, 'stars')); top[st.id] = Math.max(top[st.id] || 0, num(r, 'score')); }
      ids(r, 'right_ids').forEach(function (id) { last[id] = true; });
      ids(r, 'wrong_ids').forEach(function (id) { last[id] = false; });
    });
    return { best: best, top: top, weak: Q.filter(function (q) { return last[q.id] === false; }) };
  }
  function renderQuizHome() {
    var S = quizState(), best = S.best;
    var allClear = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'].every(function (i) { return (best[i] || 0) >= 2; });
    var h = '<div class="sd-grid">';
    STAGES.forEach(function (s, i) {
      var locked = s.id === 'final' ? !allClear : s.id === 'q7' ? false : (i > 0 && (best[STAGES[i - 1].id] || 0) < 2);
      var n = s.count || Q.filter(function (q) { return q.st === s.id; }).length;
      h += '<div class="sd-card ' + (locked ? 'lock' : 'click') + '" data-stage="' + s.id + '"><div class="t">' + s.icon + ' '
        + (s.id === 'final' ? '' : 'ステージ' + s.no + ' ') + esc(s.name) + (locked ? ' 🔒' : '') + '</div>'
        + '<div class="d">' + esc(locked ? (s.id === 'final' ? 'ステージ1〜6を★2以上でクリアすると挑戦できます' : '前のステージを★2以上でクリアすると開きます') : s.desc) + '</div>'
        + '<div class="s">' + starText(best[s.id] || 0) + '</div><div class="m">' + n + '問・1問' + s.limit + '秒'
        + (S.top[s.id] ? '　ベスト ' + S.top[s.id].toLocaleString() + '点' : '　未挑戦') + '</div></div>';
    });
    h += '</div><div style="margin-top:12px">' + (S.weak.length ? '<button class="sd-btn" data-stage="review">🩹 苦手の復習(' + S.weak.length + '問)</button>'
      : '<span class="sd-note">間違えたままの問題はありません。</span>') + '</div>';
    shell(h);
    ROOT.querySelectorAll('[data-stage]').forEach(function (el) {
      if (el.classList.contains('lock')) return;
      el.addEventListener('click', function () { startQuiz(el.getAttribute('data-stage')); });
    });
  }
  function startQuiz(id) {
    var s = stageById(id), list;
    if (id === 'review') list = quizState().weak;
    else if (id === 'final') list = shuffle(Q).slice(0, s.count);
    else list = Q.filter(function (q) { return q.st === id; });
    if (!list.length) return go('quiz');
    PLAY = { stage: s, list: shuffle(list), i: 0, score: 0, combo: 0, right: [], wrong: [], log: [], started: Date.now() };
    quizQuestion();
  }
  function quizQuestion() {
    var P = PLAY, q = P.list[P.i], s = P.stage, plain = q.who === '場面' || q.who === 'あなた';
    var opts = shuffle(q.o.map(function (o) { return { t: o[0], p: o[1] }; }));
    var h = '<div class="sd-top"><button class="sd-btn sub" id="sd-quit" style="padding:6px 10px;font-size:12px">← やめる</button><span>' + s.icon + ' ' + esc(s.name) + '</span><span>' + (P.i + 1) + ' / ' + P.list.length + '問</span>'
      + (P.combo >= 2 ? '<span style="color:#e67e22;font-weight:bold">🔥' + P.combo + '連続</span>' : '') + '<span class="sc">' + P.score.toLocaleString() + '点</span></div>'
      + '<div class="sd-time"><i id="sd-tbar" style="width:100%"></i></div>'
      + '<div class="sd-scene"><div class="sd-who">' + esc(q.who) + '</div><div class="sd-say">' + (plain ? '' : '「') + esc(q.say) + (plain ? '' : '」') + '</div></div>'
      + '<div class="sd-ask">' + esc(q.ask) + '</div>' + opts.map(function (o, n) { return '<button class="sd-opt" data-n="' + n + '">' + esc(o.t) + '</button>'; }).join('')
      + '<div id="sd-after"></div>';
    shell(h);
    document.getElementById('sd-quit').addEventListener('click', function () { if (window.confirm('途中でやめると記録されません。やめますか?')) go('quiz'); });
    var t0 = Date.now(), limit = s.limit * 1000;
    ROOT.querySelectorAll('.sd-opt').forEach(function (b) {
      b.addEventListener('click', function () { quizAnswer(q, opts, Number(b.getAttribute('data-n')), (Date.now() - t0) / 1000); });
    });
    TIMER = setInterval(function () {
      var left = Math.max(0, limit - (Date.now() - t0)), bar = document.getElementById('sd-tbar');
      if (bar) { bar.style.width = (left / limit * 100) + '%'; bar.style.background = left < limit * 0.3 ? '#e74c3c' : '#27ae60'; }
      if (left <= 0) quizAnswer(q, opts, -1, s.limit);
    }, 100);
  }
  function quizAnswer(q, opts, n, sec) {
    stopTimer();
    var P = PLAY; if (!P || P.answered === P.i) return;
    P.answered = P.i;
    var s = P.stage, ch = n >= 0 ? opts[n] : null, p = ch ? ch.p : 0, best = p === 100;
    var bonus = best ? Math.round(Math.max(0, s.limit - sec) / s.limit * 50) : 0;
    P.combo = best ? P.combo + 1 : 0;
    var mult = best ? 1 + Math.min(P.combo - 1, 5) * 0.1 : 1, gain = Math.round((p + bonus) * mult);
    P.score += gain; (best ? P.right : P.wrong).push(q.id); P.log.push({ q: q, best: best });
    ROOT.querySelectorAll('.sd-opt').forEach(function (b, k) {
      b.disabled = true;
      if (opts[k].p === 100) b.classList.add('ok'); else if (k === n) b.classList.add(opts[k].p > 0 ? 'half' : 'ng');
    });
    var sc = ROOT.querySelector('.sd-top .sc'); if (sc) sc.textContent = P.score.toLocaleString() + '点';
    var cls = best ? 'ok' : p > 0 ? 'half' : 'ng';
    var head = n < 0 ? '⏰ 時間切れ' : best ? '⭕ ベスト!' : p > 0 ? '🔺 惜しい!' : '❌ それはNG';
    var last = P.i === P.list.length - 1;
    document.getElementById('sd-after').innerHTML = '<div class="sd-fb ' + cls + '"><b class="sd-pop">' + head + '</b> <span class="sd-note">+' + gain + '点</span><br>' + esc(q.exp) + '</div>'
      + '<button class="sd-btn" id="sd-next">' + (last ? '結果を見る' : '次の問題へ →') + '</button>';
    document.getElementById('sd-next').addEventListener('click', function () { if (last) quizFinish(); else { P.i++; quizQuestion(); } });
  }
  function quizFinish() {
    var P = PLAY, s = P.stage, total = P.list.length, correct = P.right.length, stars = starsOf(correct, total);
    var before = rankInfo(ME.code).rank;
    var h = '<div class="sd-res"><div>' + s.icon + ' ' + esc(s.name) + '</div><div class="st sd-pop">' + starText(stars) + '</div>'
      + '<div class="pt">' + P.score.toLocaleString() + '点</div><p>' + correct + ' / ' + total + '問 ベスト</p>'
      + '<div id="sd-save" class="sd-note">記録しています…</div><div id="sd-rankup"></div>';
    var miss = P.log.filter(function (l) { return !l.best; });
    if (miss.length) h += '<div style="text-align:left"><div class="sd-h">もう一度確認</div><ul style="font-size:13px">' + miss.map(function (l) {
      var b = l.q.o.filter(function (o) { return o[1] === 100; })[0];
      return '<li>' + esc(l.q.say) + ' → <b>' + esc(b ? b[0] : '') + '</b></li>';
    }).join('') + '</ul></div>';
    h += '<button class="sd-btn" id="sd-again">もう一度</button> <button class="sd-btn sub" id="sd-back">ステージ選択へ</button></div>';
    shell(h);
    document.getElementById('sd-again').addEventListener('click', function () { startQuiz(s.id); });
    document.getElementById('sd-back').addEventListener('click', function () { go('quiz'); });
    finishSave({ kind: { value: '商談クイズ' }, stage: { value: s.name }, score: { value: String(P.score) }, correct: { value: String(correct) },
      total: { value: String(total) }, stars: { value: String(stars) }, seconds: { value: String(Math.round((Date.now() - P.started) / 1000)) },
      right_ids: { value: P.right.join(',') }, wrong_ids: { value: P.wrong.join(',') } }, before);
  }
  function finishSave(rec, before) {
    save(rec).then(function () {
      var el = document.getElementById('sd-save'); if (el) el.textContent = '✔ 記録しました';
      var after = rankInfo(ME.code), ru = document.getElementById('sd-rankup');
      var badge = ROOT.querySelector('.sd-rank b'); if (badge) badge.textContent = after.rankName;
      if (ru && after.rank > before) ru.innerHTML = '<p class="sd-pop" style="font-size:18px;font-weight:bold;color:#7b4fa8">🎉 昇段!' + esc(after.rankName) + 'になりました</p>';
    }).catch(function (e) {
      var el = document.getElementById('sd-save'); if (el) el.innerHTML = '<span style="color:#c0392b">記録の保存に失敗しました(' + esc(e && e.message || e) + ')</span>';
    });
  }

  // ---------- 切り返しノック ----------
  function renderKnockHome() {
    var done = knockCount(ME.code);
    var h = '<p style="font-size:13px;margin:0">お客様の断り文句が出ます。<b>10秒以内に、声に出して</b>返してみてください。そのあとお手本と比べて、自分で採点します。</p>'
      + '<p class="sd-note">これまでのノック: ' + done + '本(二段の条件は' + REQ.knock + '本)</p>'
      + '<div class="sd-grid"><div class="sd-card click" data-n="5"><div class="t">🥊 5本ノック</div><div class="d">すき間時間に</div></div>'
      + '<div class="sd-card click" data-n="10"><div class="t">🥊🥊 10本ノック</div><div class="d">いつもの練習</div></div>'
      + '<div class="sd-card click" data-n="' + KNOCK.length + '"><div class="t">🔥 全' + KNOCK.length + '本ノック</div><div class="d">通しで全部</div></div></div>';
    shell(h);
    ROOT.querySelectorAll('[data-n]').forEach(function (el) { el.addEventListener('click', function () { startKnock(Number(el.getAttribute('data-n'))); }); });
  }
  function startKnock(n) {
    PLAY = { list: shuffle(KNOCK).slice(0, n), i: 0, rate: [], started: Date.now() };
    knockCard();
  }
  function knockCard() {
    var P = PLAY, k = P.list[P.i];
    var h = '<div class="sd-top"><span>🥊 切り返しノック</span><span>' + (P.i + 1) + ' / ' + P.list.length + '本</span></div>'
      + '<div class="sd-scene" style="margin-top:10px"><div class="sd-who">お客様</div><div class="sd-say">「' + esc(k.say) + '」</div></div>'
      + '<div id="sd-k"><div class="sd-big" id="sd-cnt">10</div><p style="text-align:center;margin:0">声に出して返してみよう</p>'
      + '<div style="text-align:center;margin-top:10px"><button class="sd-btn sub" id="sd-show">返せた!お手本を見る</button></div></div>';
    shell(h);
    var t0 = Date.now();
    function show() {
      stopTimer();
      document.getElementById('sd-k').innerHTML = '<div class="sd-ans">' + esc(k.ans) + '<br><span class="sd-tip">💡 ' + esc(k.tip) + '</span></div>'
        + '<p style="text-align:center;margin:6px 0">自分の返しはどうだった?</p><div style="text-align:center">'
        + '<button class="sd-btn ok" data-r="3">◎ 言えた</button><button class="sd-btn mid" data-r="2">○ だいたい</button><button class="sd-btn ng" data-r="1">△ 詰まった</button></div>';
      ROOT.querySelectorAll('[data-r]').forEach(function (b) {
        b.addEventListener('click', function () {
          P.rate.push({ id: k.id, r: Number(b.getAttribute('data-r')) });
          if (P.i < P.list.length - 1) { P.i++; knockCard(); } else knockFinish();
        });
      });
    }
    document.getElementById('sd-show').addEventListener('click', show);
    TIMER = setInterval(function () {
      var left = Math.max(0, 10 - Math.floor((Date.now() - t0) / 1000)), el = document.getElementById('sd-cnt');
      if (el) el.textContent = left;
      if (left <= 0) show();
    }, 200);
  }
  function knockFinish() {
    var P = PLAY, total = P.rate.length;
    var good = P.rate.filter(function (x) { return x.r === 3; }), bad = P.rate.filter(function (x) { return x.r === 1; });
    var stars = starsOf(good.length, total), before = rankInfo(ME.code).rank;
    var h = '<div class="sd-res"><div>🥊 切り返しノック</div><div class="st sd-pop">' + starText(stars) + '</div><div class="pt">◎ ' + good.length + ' / ' + total + '本</div>'
      + '<div id="sd-save" class="sd-note">記録しています…</div><div id="sd-rankup"></div>';
    if (bad.length) h += '<div style="text-align:left"><div class="sd-h">詰まったもの(お手本)</div><ul style="font-size:13px">' + bad.map(function (x) {
      var k = KNOCK.filter(function (y) { return y.id === x.id; })[0];
      return '<li>「' + esc(k.say) + '」→ ' + esc(k.ans) + '</li>';
    }).join('') + '</ul></div>';
    h += '<button class="sd-btn" id="sd-again">もう一度</button> <button class="sd-btn sub" id="sd-back">戻る</button></div>';
    shell(h);
    document.getElementById('sd-again').addEventListener('click', function () { startKnock(total); });
    document.getElementById('sd-back').addEventListener('click', function () { go('knock'); });
    finishSave({ kind: { value: '切り返しノック' }, stage: { value: total + '本ノック' }, score: { value: String(P.rate.reduce(function (s, x) { return s + x.r; }, 0) * 10) },
      correct: { value: String(good.length) }, total: { value: String(total) }, stars: { value: String(stars) },
      seconds: { value: String(Math.round((Date.now() - P.started) / 1000)) },
      right_ids: { value: good.map(function (x) { return x.id; }).join(',') }, wrong_ids: { value: bad.map(function (x) { return x.id; }).join(',') } }, before);
  }

  // ---------- マイク ----------
  var MIC = null;
  function startMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !(window.AudioContext || window.webkitAudioContext)) {
      return Promise.reject(new Error('このブラウザではマイクが使えません'));
    }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      var Ctx = window.AudioContext || window.webkitAudioContext, ctx = new Ctx();
      var src = ctx.createMediaStreamSource(stream), an = ctx.createAnalyser();
      an.fftSize = 2048; src.connect(an);
      MIC = { ctx: ctx, stream: stream, an: an, buf: new Float32Array(an.fftSize), thr: -45 };
      // ボタンを押してから時間がたつと、音の処理が止まった状態で作られることがある(特にスマホ)ので明示的に動かす
      return (ctx.state === 'suspended' && ctx.resume ? ctx.resume() : Promise.resolve()).then(function () { return MIC; });
    });
  }
  function stopMic() {
    if (!MIC) return;
    try { MIC.stream.getTracks().forEach(function (t) { t.stop(); }); MIC.ctx.close(); } catch (e) { /* 何もしない */ }
    MIC = null;
  }
  function micDb() {
    MIC.an.getFloatTimeDomainData(MIC.buf);
    var s = 0; for (var i = 0; i < MIC.buf.length; i++) s += MIC.buf[i] * MIC.buf[i];
    return 20 * Math.log10(Math.sqrt(s / MIC.buf.length) + 1e-6);
  }
  // 周りの静かさを1秒測り、声とみなす大きさ(しきい値)を決める
  function calibrate() {
    return new Promise(function (resolve) {
      var v = [], t0 = Date.now();
      var iv = setInterval(function () {
        v.push(micDb());
        if (Date.now() - t0 >= 1000) {
          clearInterval(iv); v.sort(function (a, b) { return a - b; });
          MIC.thr = Math.min(-20, Math.max(-50, v[Math.floor(v.length / 2)] + 12));
          resolve(MIC.thr);
        }
      }, 50);
    });
  }
  function micError(e) {
    return '<p style="color:#c0392b">マイクを使えませんでした(' + esc(e && e.message || e) + ')。</p>'
      + '<p class="sd-note">ブラウザでマイクの使用を「許可」してください。PCはChrome/Edge、スマホはSafari/Chromeのブラウザで開いてください(kintoneのスマホアプリでは使えないことがあります)。</p>';
  }

  // ---------- 空気感トレーニング ----------
  function renderKuukiHome() {
    var kp = kuukiPass(ME.code);
    var h = '<p style="font-size:13px;margin:0">マイクで「間」と「話す速さ」を測ります。<b>録音は保存しません</b>(その場で数字を測るだけ)。静かな場所で、ふだんの声で話してください。</p>'
      + '<div class="sd-grid" style="margin-top:10px">'
      + '<div class="sd-card click" data-k="pause"><div class="t">🤫 金額のあとの間' + (kp.pause ? ' ✅' : '') + '</div><div class="d">セリフを言ったら、お客様が答えるまで黙って待つ(5回)。先に話したら負け。</div><div class="m">合格: 5回中4回</div></div>'
      + '<div class="sd-card click" data-k="speed"><div class="t">⏱️ 話す速さ' + (kp.speed ? ' ✅' : '') + '</div><div class="d">雑談はゆっくり(210〜270字/分)、説明はテンポよく(310〜370字/分)。</div><div class="m">合格: 2本とも目標内</div></div></div>'
      + '<p class="sd-note" style="margin-top:10px">目安は竹井の商談録音から測った数字です(雑談 約240字/分・説明 約340字/分・金額のあとに1.3〜1.8秒の間)。</p>';
    shell(h);
    ROOT.querySelectorAll('[data-k]').forEach(function (el) { el.addEventListener('click', function () { el.getAttribute('data-k') === 'pause' ? startPause() : startSpeed(); }); });
  }

  function startPause() {
    shell('<p>マイクの準備をしています…</p>');
    startMic().then(function () {
      shell('<p>周りの音を測っています。1秒だけ静かにしてください…</p>');
      return calibrate();
    }).then(function () {
      PLAY = { lines: shuffle(PAUSE_LINES), i: 0, res: [], started: Date.now() };
      pauseRound();
    }).catch(function (e) { stopMic(); shell(micError(e)); });
  }
  function pauseRound() {
    var P = PLAY, line = P.lines[P.i];
    var wait = 1.5 + Math.random() * 2; // お客様が答えるまでの秒数(1.5〜3.5秒)
    var h = '<div class="sd-top"><span>🤫 金額のあとの間</span><span>' + (P.i + 1) + ' / ' + P.lines.length + '回</span></div>'
      + '<div class="sd-ans" style="font-size:18px">「' + esc(line) + '」</div>'
      + '<p id="sd-st" style="text-align:center;font-weight:bold">👄 声を落として、淡々と言ってください</p>'
      + '<div class="sd-meter"><i id="sd-lv" style="width:0"></i></div><div id="sd-pr" style="text-align:center"></div>';
    shell(h);
    var state = 'wait', voiceMs = 0, silStart = 0, t = Date.now();
    TIMER = setInterval(function () {
      var db = micDb(), now = Date.now(), loud = db > MIC.thr, lv = document.getElementById('sd-lv'), st = document.getElementById('sd-st');
      if (lv) lv.style.width = Math.max(0, Math.min(100, (db + 60) * 2)) + '%';
      if (state === 'wait') {
        voiceMs = loud ? voiceMs + 50 : 0;
        if (voiceMs >= 150) { state = 'speak'; if (st) st.textContent = '🗣️ 話しています…言い終わったら黙って待つ'; }
      } else if (state === 'speak') {
        if (!loud) { if (!silStart) silStart = now; if (now - silStart >= 500) { state = 'silent'; if (st) st.textContent = '🤫 そのまま…お客様が答えるまで待って'; } }
        else silStart = 0;
      } else if (state === 'silent') {
        var gap = (now - silStart) / 1000;
        var pr = document.getElementById('sd-pr'); if (pr) pr.innerHTML = '<span class="sd-big" style="font-size:32px">' + gap.toFixed(1) + '秒</span>';
        if (loud) { voiceMs += 50; if (voiceMs >= 150) return pauseResult(false, gap - 0.15, wait); } else voiceMs = 0;
        if (gap >= wait) return pauseResult(true, gap, wait);
      }
      if (now - t > 20000 && state === 'wait') { stopTimer(); if (st) st.textContent = '声が聞こえませんでした。もう一度どうぞ'; setTimeout(pauseRound, 1500); }
    }, 50);
  }
  function pauseResult(ok, gap, wait) {
    stopTimer();
    var P = PLAY; P.res.push({ ok: ok, gap: Math.round(gap * 10) / 10 });
    var reply = ['うーん…そうですね。', 'なるほど…', 'ちょっと考えますね。', 'そっか…'][Math.floor(Math.random() * 4)];
    var h = '<div class="sd-top"><span>🤫 金額のあとの間</span><span>' + P.res.length + ' / ' + P.lines.length + '回</span></div>'
      + (ok ? '<div class="sd-scene" style="margin:10px 0"><div class="sd-who">お客様</div><div class="sd-say">「' + esc(reply) + '」</div></div>'
        + '<div class="sd-fb ok"><b class="sd-pop">⭕ 待てました!</b> ' + gap.toFixed(1) + '秒、相手が話すまで黙れました。</div>'
        : '<div class="sd-fb ng"><b class="sd-pop">❌ 先に話してしまいました</b> ' + Math.max(0, gap).toFixed(1) + '秒で話し始めました(お客様は' + wait.toFixed(1) + '秒後に答えるところでした)。</div>')
      + '<button class="sd-btn" id="sd-next">' + (P.res.length < P.lines.length ? '次へ →' : '結果を見る') + '</button>';
    shell(h);
    document.getElementById('sd-next').addEventListener('click', function () {
      if (P.res.length < P.lines.length) { P.i++; pauseRound(); } else pauseFinish();
    });
  }
  function pauseFinish() {
    stopMic();
    var P = PLAY, okN = P.res.filter(function (r) { return r.ok; }).length, total = P.res.length;
    var stars = okN >= 5 ? 3 : okN >= 4 ? 2 : okN >= 3 ? 1 : 0, before = rankInfo(ME.code).rank;
    shell('<div class="sd-res"><div>🤫 金額のあとの間</div><div class="st sd-pop">' + starText(stars) + '</div><div class="pt">' + okN + ' / ' + total + '回 待てた</div>'
      + '<p class="sd-note">黙れた秒数: ' + P.res.map(function (r) { return (r.ok ? '⭕' : '❌') + r.gap + '秒'; }).join('　') + '</p>'
      + '<div id="sd-save" class="sd-note">記録しています…</div><div id="sd-rankup"></div>'
      + '<button class="sd-btn" id="sd-again">もう一度</button> <button class="sd-btn sub" id="sd-back">戻る</button></div>');
    document.getElementById('sd-again').addEventListener('click', startPause);
    document.getElementById('sd-back').addEventListener('click', function () { go('kuuki'); });
    finishSave({ kind: { value: '空気感トレーニング' }, stage: { value: '金額のあとの間' }, score: { value: String(okN * 100) }, correct: { value: String(okN) },
      total: { value: String(total) }, stars: { value: String(stars) }, seconds: { value: String(Math.round((Date.now() - P.started) / 1000)) },
      detail: { value: JSON.stringify(P.res) } }, before);
  }

  function countChars(s) { return s.replace(/[\s、。,.!?！？「」]/g, '').length; }
  function startSpeed() {
    shell('<p>マイクの準備をしています…</p>');
    startMic().then(function () {
      shell('<p>周りの音を測っています。1秒だけ静かにしてください…</p>');
      return calibrate();
    }).then(function () {
      PLAY = { i: 0, res: [], started: Date.now() };
      speedRound();
    }).catch(function (e) { stopMic(); shell(micError(e)); });
  }
  function speedRound() {
    var P = PLAY, L = SPEED_LINES[P.i];
    var h = '<div class="sd-top"><span>⏱️ 話す速さ</span><span>' + (P.i + 1) + ' / ' + SPEED_LINES.length + '本</span></div>'
      + '<p style="margin:10px 0 4px"><b>' + esc(L.name) + '</b>のつもりで読んでください(目標 ' + L.min + '〜' + L.max + '字/分)</p>'
      + '<div class="sd-ans" style="font-size:17px">' + esc(L.text) + '</div>'
      + '<p id="sd-st" style="text-align:center;font-weight:bold">🎙️ 読み始めてください(読み終わって1.5秒黙ると自動で止まります)</p>'
      + '<div class="sd-meter"><i id="sd-lv" style="width:0"></i></div>'
      + '<div style="text-align:center"><button class="sd-btn sub" id="sd-stop">読み終わった</button></div>';
    shell(h);
    var first = 0, lastVoice = 0, voiceMs = 0;
    function end() {
      stopTimer();
      if (!first || lastVoice - first < 1500) { var st = document.getElementById('sd-st'); if (st) st.textContent = '声が短すぎました。もう一度どうぞ'; setTimeout(speedRound, 1200); return; }
      var sec = (lastVoice - first) / 1000, cpm = Math.round(countChars(L.text) / (sec / 60));
      var ok = cpm >= L.min && cpm <= L.max;
      P.res.push({ id: L.id, cpm: cpm, ok: ok });
      var msg = ok ? '⭕ ちょうどいい速さです' : cpm < L.min ? '🐢 少しゆっくりすぎます' : '🐇 少し速すぎます';
      shell('<div class="sd-top"><span>⏱️ 話す速さ</span></div><div class="sd-big">' + cpm + '<span style="font-size:18px">字/分</span></div>'
        + '<div class="sd-fb ' + (ok ? 'ok' : 'half') + '"><b>' + msg + '</b>(' + esc(L.name) + 'の目標 ' + L.min + '〜' + L.max + '字/分・' + sec.toFixed(1) + '秒)</div>'
        + '<button class="sd-btn" id="sd-next">' + (P.i < SPEED_LINES.length - 1 ? '次へ →' : '結果を見る') + '</button> <button class="sd-btn sub" id="sd-retry">読み直す</button>');
      document.getElementById('sd-retry').addEventListener('click', function () { P.res.pop(); speedRound(); });
      document.getElementById('sd-next').addEventListener('click', function () { if (P.i < SPEED_LINES.length - 1) { P.i++; speedRound(); } else speedFinish(); });
    }
    document.getElementById('sd-stop').addEventListener('click', end);
    TIMER = setInterval(function () {
      var db = micDb(), now = Date.now(), loud = db > MIC.thr, lv = document.getElementById('sd-lv');
      if (lv) lv.style.width = Math.max(0, Math.min(100, (db + 60) * 2)) + '%';
      if (loud) { voiceMs += 50; if (voiceMs >= 150) { if (!first) first = now - 150; lastVoice = now; } } else voiceMs = 0;
      if (first && now - lastVoice >= 1500) end();
    }, 50);
  }
  function speedFinish() {
    stopMic();
    var P = PLAY, okN = P.res.filter(function (r) { return r.ok; }).length, total = P.res.length;
    var stars = okN === total ? 3 : okN > 0 ? 1 : 0, before = rankInfo(ME.code).rank;
    shell('<div class="sd-res"><div>⏱️ 話す速さ</div><div class="st sd-pop">' + starText(stars) + '</div><div class="pt">' + okN + ' / ' + total + '本 目標内</div>'
      + '<p class="sd-note">' + P.res.map(function (r) { var L = SPEED_LINES.filter(function (x) { return x.id === r.id; })[0]; return (r.ok ? '⭕' : '🔺') + L.name + ' ' + r.cpm + '字/分'; }).join('　') + '</p>'
      + '<div id="sd-save" class="sd-note">記録しています…</div><div id="sd-rankup"></div>'
      + '<button class="sd-btn" id="sd-again">もう一度</button> <button class="sd-btn sub" id="sd-back">戻る</button></div>');
    document.getElementById('sd-again').addEventListener('click', startSpeed);
    document.getElementById('sd-back').addEventListener('click', function () { go('kuuki'); });
    finishSave({ kind: { value: '空気感トレーニング' }, stage: { value: '話す速さ' }, score: { value: String(okN * 100) }, correct: { value: String(okN) },
      total: { value: String(total) }, stars: { value: String(stars) }, seconds: { value: String(Math.round((Date.now() - P.started) / 1000)) },
      detail: { value: JSON.stringify(P.res) } }, before);
  }

  // ---------- コーチ画面(竹井・長家だけ) ----------
  function renderCoach() {
    var h = '<p style="font-size:13px;margin:0 0 8px">育成メンバーの進み具合です(この画面はコーチだけに表示)。同席・受注などの実戦の条件を満たしたら、様子を見て認定してください。</p>'
      + '<table class="sd-tbl"><tr><th>メンバー</th><th>段位</th><th>初段</th><th>二段</th><th>三段</th><th>最後の練習</th><th>認定</th></tr>';
    TRAINEES.forEach(function (t) {
      var info = rankInfo(t.code), mine = recOf(t.code), lastAt = mine.length ? fv(mine[mine.length - 1], '作成日時', '') : '';
      function cnt(i) { var l = info.levels[i]; return l.items.filter(function (x) { return x.done; }).length + '/' + l.items.length; }
      var btn = ['二段', '三段'].filter(function (r) { return !certified(t.code, r); }).map(function (r) {
        return '<button class="sd-btn sub" style="padding:4px 8px;font-size:12px" data-cert="' + r + '" data-code="' + esc(t.code) + '" data-name="' + esc(t.name) + '">' + r + 'を認定</button>';
      }).join('');
      h += '<tr><td>' + esc(t.name) + '</td><td><b>' + esc(info.rankName) + '</b></td><td>' + cnt(0) + '</td><td>' + cnt(1) + '</td><td>' + cnt(2) + '</td>'
        + '<td>' + (lastAt ? new Date(lastAt).toLocaleDateString('ja-JP') : 'まだ') + '</td><td>' + (btn || '済') + '</td></tr>';
    });
    h += '</table>';
    TRAINEES.forEach(function (t) {
      var info = rankInfo(t.code);
      h += '<details style="margin-top:8px"><summary style="cursor:pointer;font-weight:bold">' + esc(t.name) + ' の条件の内訳</summary>'
        + info.levels.map(function (lv, i) { return levelHtml(lv, i, info); }).join('') + '</details>';
    });
    shell(h);
    ROOT.querySelectorAll('[data-cert]').forEach(function (b) {
      b.addEventListener('click', function () {
        var rank = b.getAttribute('data-cert'), code = b.getAttribute('data-code'), name = b.getAttribute('data-name');
        if (!window.confirm(name + ' さんを「' + rank + '」の条件「コーチの認定」で認定します。よろしいですか?')) return;
        b.disabled = true;
        save({ kind: { value: '段位認定' }, stage: { value: rank + 'の認定' }, target_user: { value: [{ code: code }] }, rank: { value: rank } })
          .then(renderCoach).catch(function (e) { b.disabled = false; window.alert('認定を保存できませんでした: ' + (e && e.message || e)); });
      });
    });
  }

  // ---------- 起動 ----------
  var CSS_DONE = false;
  function start(container) {
    ROOT = container;
    if (!CSS_DONE && !document.getElementById('sales-dojo-css')) {
      var st = document.createElement('style'); st.id = 'sales-dojo-css'; st.textContent = CSS; document.head.appendChild(st); CSS_DONE = true;
    }
    ME = kintone.getLoginUser();
    if (PREVIEW_USERS && PREVIEW_USERS.indexOf(ME.code) < 0) {
      ROOT.innerHTML = '<div class="sd' + (IS_MOBILE ? ' sd-m' : '') + '"><div class="sd-hero"><div><h2>🥋 営業道場</h2><p>ただいま準備中です。公開までもうしばらくお待ちください。</p></div></div></div>';
      return;
    }
    ROOT.innerHTML = '<div class="sd"><p class="sd-note">読み込み中…</p></div>';
    var codes = isCoach(ME.code) ? TRAINEES.map(function (t) { return t.code; }).concat([ME.code]) : [ME.code];
    Promise.all([
      getAll(APP_ID, 'order by レコード番号 asc', ['$id', '作成者', '作成日時', 'kind', 'stage', 'score', 'correct', 'total', 'stars', 'right_ids', 'wrong_ids', 'target_user', 'rank']).then(function (r) { RECS = r; }),
      getAll(38, 'order by レコード番号 asc', ['$id', '作成者', 'stage', 'stars']).then(function (r) { CALLDOJO = r; }).catch(function () { CALLDOJO = []; }),
      loadReal(codes)
    ]).then(function () { go(TAB); }).catch(function (e) {
      ROOT.innerHTML = '<div class="sd"><p style="color:#c0392b">記録を読み込めませんでした: ' + esc(e && e.message || e) + '</p></div>';
    });
  }

  kintone.events.on('app.record.index.show', function (event) {
    IS_MOBILE = false;
    if (event.viewName !== PC_VIEW) { stopTimer(); stopMic(); return event; }
    var el = document.getElementById('sales-dojo-root');
    if (el) start(el);
    return event;
  });

  kintone.events.on('mobile.app.record.index.show', function (event) {
    IS_MOBILE = true;
    var space = kintone.mobile.app.getHeaderSpaceElement();
    var old = document.getElementById('sales-dojo-m-root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    if (event.viewName !== MOBILE_VIEW || !space) { stopTimer(); stopMic(); return event; }
    var el = document.createElement('div'); el.id = 'sales-dojo-m-root';
    space.appendChild(el);
    start(el);
    return event;
  });
})();
