/*
 * Googleマップからコピーした文字の読み取り・重複チェック(共通部品)  PC/スマホ両対応(2026-10-16)
 *
 * 顧客管理18の「📞 Googleマップから電話先を登録」(customize-customer-hub.js)と
 * ネタリスト29の「📋 Googleマップから貼り付けて登録」(customize-lead-paste.js)が使う。
 * window.TaimeiMapsPaste に置くだけで、画面には何もしない。使う側は呼び出すとき(ボタンを押したとき)に参照するので、
 * customize.json の並び順はどちらが先でもよい。
 *
 * 読み取りは利用者が貼り付けた文字だけ。GoogleのAPIで取った値は規約で30日を超えて保存できないため、APIは使わない。
 */
(function () {
  'use strict';

  var PREFS = /^(北海道|東京都|京都府|大阪府|.{2,3}県)/;

  function fv(obj, code, fallback) {
    return obj && obj[code] && obj[code].value !== undefined && obj[code].value !== null ? obj[code].value : fallback;
  }
  function digits(s) { return String(s || '').normalize('NFKC').replace(/\D/g, ''); }
  // 住所の数字・ハイフンを全角に(顧客管理・ネタリストの住所の書き方にそろえる。英字はビル名を壊さないよう変えない)
  function toWideAddr(s) {
    return String(s || '').replace(/[0-9]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 0xFEE0); }).replace(/-/g, '－');
  }

  // Googleマップの画面からコピーした文字・アプリの「共有」の文字から、店名・電話・〒・都道府県・住所・URLを取り出す
  function parse(text) {
    var out = { name: '', phone: '', zip: '', pref: '', addr: '', url: '' };
    // 判定はNFKC(全角数字・記号を半角に)で行い、店名だけは元の表記のまま使う
    var raw = String(text || '');
    var t = raw.normalize('NFKC');
    var um = t.match(/https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\S*/);
    if (um) out.url = um[0];
    var rawLines = raw.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(function (l) { return l && !/^https?:\/\//.test(l); });
    var lines = rawLines.map(function (l) { return l.normalize('NFKC').replace(/[−‐‑–—]/g, '-'); });
    lines.forEach(function (l) {
      var p = l.replace(/^電話番号[:：]?\s*/, '');
      if (!out.phone && /^(\+81[\s-]?|0)\d{1,4}[\s-]?\d{1,4}[\s-]?\d{3,4}$/.test(p)) {
        out.phone = p.replace(/^\+81[\s-]?/, '0').replace(/\s/g, '-');
        return;
      }
      var a = l.replace(/^(住所[:：]?\s*)?(日本、\s*)?/, '');
      if (!out.addr && (/〒\s*\d{3}-?\d{4}/.test(a) || PREFS.test(a) || /^[^\s]{1,8}市.+区/.test(a))) {
        var zm = a.match(/〒\s*(\d{3})-?(\d{4})\s*/);
        if (zm) { out.zip = zm[1] + '-' + zm[2]; a = a.replace(zm[0], ''); }
        var pm = a.match(PREFS);
        if (pm) { out.pref = pm[1]; a = a.slice(pm[1].length); }
        out.addr = a.trim();
      }
    });
    // 店名: 評価(4.3)・件数((120))・営業時間・電話・住所でない最初の行。無ければURLの /place/店名/ から
    lines.some(function (l, i) {
      if (/^[\d.,()（）\s★]+$/.test(l) || /営業|定休|時間|クチコミ|口コミ|件$|^〒|^日本、/.test(l)) return false;
      if (digits(l).length >= 9 && digits(l).length === l.replace(/[\s-]/g, '').length) return false;
      if (l === out.addr || PREFS.test(l) || l.indexOf(out.addr) >= 0 && out.addr) return false;
      out.name = rawLines[i].replace(/\s*[·・]\s*$/, '');
      return true;
    });
    if (!out.name && out.url) {
      var nm = out.url.match(/\/place\/([^/]+)/);
      if (nm) { try { out.name = decodeURIComponent(nm[1].replace(/\+/g, ' ')); } catch (e) { /* 読めなければ空のまま */ } }
    }
    return out;
  }

  // 都道府県を除いた住所を「市区町村」と「丁目番地等」に分ける(ネタリストの欄の分け方)
  // 例: 札幌市中央区南1条西5丁目 → 札幌市中央区 / 南１条西５丁目、江別市大麻1-2 → 江別市 / 大麻１－２
  function splitCity(addr) {
    var a = String(addr || '').trim();
    var m = a.match(/^(.+?市.+?区|.+?郡.+?[町村]|.+?[市区町村])/);
    if (!m) return { city: '', rest: toWideAddr(a) };
    return { city: m[1], rest: toWideAddr(a.slice(m[1].length).trim()) };
  }

  // 同じお店があるか(会社名の一致、または電話番号の数字の一致)。見られないアプリは「無し」扱い
  function findSame(app, name, phone) {
    var api = function (params) { return kintone.api(kintone.api.url('/k/v1/records', true), 'GET', params); };
    var qs = [];
    if (name) qs.push(api({ app: app, query: '会社名 = "' + name.replace(/"/g, '\\"') + '" limit 20' }));
    var d = digits(phone);
    if (d.length >= 9) qs.push(api({ app: app, query: '電話番号 like "' + d.slice(-4) + '" limit 200' }));
    return kintone.Promise.all(qs).then(function (res) {
      var seen = {}, out = [];
      res.forEach(function (r) {
        r.records.forEach(function (x) {
          var same = fv(x, '会社名', '') === name || (d.length >= 9 && digits(fv(x, '電話番号', '')) === d);
          if (same && !seen[x.$id.value]) { seen[x.$id.value] = 1; out.push(x); }
        });
      });
      return out;
    }).catch(function () { return []; });
  }

  // ---------- URLだけが貼られたとき(スマホのGoogleマップアプリの「共有」→「コピー」は短いURLしかコピーしない) ----------
  // 1. kintone.proxy でそのURLを1回開き(短縮URLの転送は kintone 側でたどられ、Googleマップのページが返る)、
  //    中の「…/maps/place/店名/@緯度,経度…」のURLだけを取り出す。ページの他の中身(電話・住所・評価など)は読まない
  // 2. 店名はそのURLから、住所は緯度経度から OpenStreetMap(Nominatim)で逆引きする(Googleの住所は使わない)。
  //    緯度経度は保存しない(座標は毎時の自動処理が住所から国土地理院で求め直す)。電話番号は取れないので手入力
  var PLACE_RE = /https:\/\/www\.google\.[a-z.]+\/maps\/place\/[^"'\\\s<>]+/;

  function fromPlaceUrl(u) {
    var out = { name: '', lat: null, lng: null };
    var m = u.match(/\/maps\/place\/([^/?]+)/);
    if (m) { try { out.name = decodeURIComponent(m[1].replace(/\+/g, ' ')); } catch (e) { /* 読めなければ空 */ } }
    var c = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) || u.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
    if (c) { out.lat = Number(c[1]); out.lng = Number(c[2]); }
    return out;
  }

  function resolvePlaceUrl(url) {
    if (PLACE_RE.test(url)) return kintone.Promise.resolve(url.match(PLACE_RE)[0]);
    if (!kintone.proxy) return kintone.Promise.resolve('');
    return kintone.proxy(url, 'GET', {}, {}).then(function (r) {
      var body = String(r[0] || '').replace(/\\u003d/g, '=').replace(/\\u0026/g, '&');
      var m = body.match(PLACE_RE);
      return m ? m[0] : '';
    }).catch(function () { return ''; });
  }

  // 緯度経度 → {zip, pref, city, rest}(OpenStreetMap。札幌の「南2条西6」は「南2条西6丁目」にする)
  function reverseAddress(lat, lng) {
    var url = 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ja&zoom=18&addressdetails=1&lat=' + lat + '&lon=' + lng;
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var a = j.address || {};
      var rest = a.neighbourhood || a.quarter || a.hamlet || '';
      if (/^[東西南北]\d+条[東西南北]?\d+$/.test(rest)) rest += '丁目';
      if (a.house_number) rest += a.house_number;
      return {
        zip: a.postcode || '', pref: a.province || a.state || '',
        city: (a.city || a.town || a.village || '') + (a.city_district || a.suburb || ''), rest: toWideAddr(rest)
      };
    }).catch(function () { return null; });
  }

  // 貼られた文字を読み、URLだけのときはリンク先から店名・住所を補う。戻り値は parse と同じ形 + {fromUrl, city, rest, note}
  function parseAsync(text) {
    var p = parse(text);
    var sc = splitCity(p.addr);
    p.city = sc.city; p.rest = sc.rest; p.fromUrl = false; p.note = '';
    if (!p.url || p.addr) return kintone.Promise.resolve(p);
    return resolvePlaceUrl(p.url).then(function (place) {
      if (!place) { p.note = 'URLから店名を読み取れませんでした。Googleマップで店名・住所を長押ししてコピーし、貼ってください。'; return p; }
      var f = fromPlaceUrl(place);
      if (!p.name || p.name === p.url) p.name = f.name;
      p.fromUrl = true;
      if (f.lat === null) return p;
      return reverseAddress(f.lat, f.lng).then(function (ad) {
        if (ad) {
          p.zip = p.zip || ad.zip; p.pref = p.pref || ad.pref; p.city = ad.city; p.rest = ad.rest;
          p.addr = ad.city + ad.rest;
        }
        p.note = 'URLから店名と住所(地図の位置から求めた目安。番地は入らないことがあります)を入れました。電話番号はGoogleマップで確認して入れてください。';
        return p;
      });
    });
  }

  window.TaimeiMapsPaste = { PREFS: PREFS, digits: digits, toWideAddr: toWideAddr, parse: parse, parseAsync: parseAsync, splitCity: splitCity, findSame: findSame };
})();
