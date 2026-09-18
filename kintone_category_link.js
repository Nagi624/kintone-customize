(function () {
  'use strict';

  const categoryMap = {
    '医療・健康・介護': [
      '眼科', '触血・血液センター', '産婦人科・助産所', '歯科・矯正歯科', '耳鼻科',
      '診療所・医院', '接骨院', '総合病院', '皮膚科', '美容・形成・泌尿器科',
      'その他医療機関', '薬', 'あん摩・はり・きゅう・接骨・柔道整復', '医療機器',
      '健康グッズ', '介護・福祉', 'リハビリテーション', 'その他'
    ],
    '住まい': [
      'エクステリア', '家具・インテリア', '家電', '住まいのクリーニング',
      '設計・工事・施工', '燃料', '不動産', '防犯・防火', 'リフォーム', 'その他'
    ],
    '旅行・宿泊': [
      '観光・温泉', 'ホテル・ペンション', 'モーテル・ラブホテル', '旅館・民宿',
      '旅行業・代理店', 'その他'
    ],
    'グルメ': [
      '居酒屋', 'ダイニングバー', '創作料理', '和食', '洋食', 'イタリアン・フレンチ',
      '中華', '焼肉・韓国料理', 'アジアン', '各国料理', 'カラオケ・パーティ',
      'バー・カクテル', 'ラーメン', 'お好み焼き・もんじゃ・鉄板焼', 'カフェ・スイーツ',
      'ファーストフード', 'キャバクラ等接待のある店舗', '屋形船', 'その他'
    ],
    '美容・ファッション': [
      'エステティックサロン', 'ネイル', 'リラク（レイキ）', 'リラク（レイキ以外）', 'コスメ',
      '美容院・理容店', '毛髪業', 'アクセサリー（開運商品）', 'アクセサリー（開運商品以外）',
      '貸衣裳', '靴・かばん・小物', '制服・作業服', '洋服', '和服',
      'カイロプラクティック・整体・各種療法', 'その他'
    ],
    '自動車・バイク': [
      'カー用品', '自動車販売', '中古車買取', 'レンタカー・リース', 'バイク中古・買取',
      'バイク販売', 'バイク用品', 'ガソリンスタンド', '車検・整備・修理',
      '洗車・コーティング', '駐車場・パーキング', 'その他'
    ],
    '暮らし': ['-'],
    'ショッピング': [
      'アウトレットモール', 'お菓子・スイーツ', '贈り物・みやげ', 'おもちゃ・ゲーム',
      'コンビニ・スーパー・デパート', '酒・飲料品', 'CD・DVD・ビデオ・レコード',
      '食料品', '生活用品', '通販', '個人輸入', '文房具', 'ベビー・子ども用品',
      '本', 'リサイクルショップ・金券ショップ', 'ネットワークビジネス', 'たばこ店', 'その他'
    ],
    'ペット': ['動物病院・獣医師', 'ペットショップ', 'ペット美容院・ペットホテル・調教師', 'その他'],
    '趣味': ['-'],
    '教育・習い事': ['-'],
    '公共機関・団体': ['-'],
    'レジャー・スポーツ': ['-'],
    '冠婚葬祭・イベント': ['-'],
    '交通': ['-'],
    'その他': ['-']
  };

  function setMiddleCategoryChoices(largeCategory) {
    const elem = kintone.app.record.getFieldElement('中分類');
    if (!elem) return;

    const options = (categoryMap[largeCategory] || ['-']).map(function (label) {
      return { label: label, value: label };
    });

    elem.setChoices(options);
  }

  kintone.events.on(['app.record.create.show', 'app.record.edit.show'], function (event) {
    const record = event.record;
    const largeCategory = record['大分類'] && record['大分類'].value;
    if (largeCategory) {
      setMiddleCategoryChoices(largeCategory);
    }
    return event;
  });

  kintone.events.on(['app.record.create.change.大分類', 'app.record.edit.change.大分類'], function (event) {
    const largeCategory = event.record['大分類'] && event.record['大分類'].value;
    if (largeCategory) {
      setMiddleCategoryChoices(largeCategory);
      if (event.record['中分類']) {
        const validValues = (categoryMap[largeCategory] || ['-']);
        const currentValue = event.record['中分類'].value;
        if (currentValue && validValues.indexOf(currentValue) === -1) {
          event.record['中分類'].value = '-';
        }
      }
    }
    return event;
  });
})();
