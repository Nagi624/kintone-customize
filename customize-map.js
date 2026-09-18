/**
 * 顧客管理アプリ用 地図表示カスタマイズ
 * - 一覧画面に「地図で表示」ボタンを追加
 * - 緯度・経度が入っている全レコードを地図上にピン表示
 * - ピンの色は「顧客ランク」で色分け(S=紫/A=赤/B=オレンジ/C=青/D=グレー)
 * - 顧客ランクのチェックボックスで表示/非表示をフィルタ可能
 * - 「90日以上未接触の顧客のみ表示」チェックで、活動履歴(アプリ17)に基づき
 *   直近90日以内の対応記録が無い顧客だけに絞り込み表示できる(放置顧客の掘り起こし用)
 * - ピンをクリックすると会社名・大分類・中分類・顧客ランク・最終接触日を表示し、レコード詳細へのリンクを出す
 * - 新規登録・住所変更時に、都道府県+住所からOpenStreetMap Nominatim(無料)で
 *   自動的に緯度・経度を計算して保存する(手動でのジオコーディング作業が不要)
 * - PC(デスクトップ)・スマートフォンブラウザの両方で地図を表示可能
 *   (customize.jsonのdesktop/mobile両方にこのファイルを登録すること)
 *
 * 利用ライブラリ: Leaflet.js (無料・APIキー不要、CDN経由で読み込み)
 */
(function () {
  "use strict";

  console.log(
    "[customer-map] SCRIPT TOP LEVEL EXECUTING url=" + location.href +
    " readyState=" + document.readyState +
    " kintone.app=" + typeof kintone.app +
    " kintone.mobile=" + typeof kintone.mobile +
    " kintone.events=" + typeof kintone.events
  );

  var APP_ID_CUSTOMER = (function () {
    // PC版のAPIを優先して試し、使えない場合だけモバイル版のAPIにフォールバックする
    // (kintone.mobile/kintone.app自体はどちらの環境でも「存在する」ことがあり、
    //  かつ例外を投げずにundefinedを返すこともあるため、例外の有無だけでなく
    //  戻り値そのものが取得できたかどうかも確認する)
    try {
      var idFromApp = kintone.app.getId();
      if (idFromApp) return idFromApp;
    } catch (e) {
      // ignore
    }
    try {
      var idFromMobile = kintone.mobile.app.getId();
      if (idFromMobile) return idFromMobile;
    } catch (e) {
      // ignore
    }
    return null;
  })(); // このアプリ自身のID

  console.log("[customer-map] APP_ID_CUSTOMER=" + APP_ID_CUSTOMER);
  var APP_ID_ACTIVITY = "17"; // 活動履歴
  var STALE_DAYS_THRESHOLD = 90;
  var RANK_COLOR = { A: "#e53935", B: "#fb8c00", C: "#1e88e5", D: "#757575" };
  var mapInstance = null;
  var allRecords = []; // フェッチ済みの全レコードをキャッシュ(フィルタ時に再取得しない)
  var checkedRanks = {}; // rankごとのチェック状態
  var lastActivityByCustomerNo = {}; // 顧客No -> 最終対応日付(Dateオブジェクト)
  var showStaleOnly = false;

  function daysSince(date) {
    return Math.floor((Date.now() - date.getTime()) / 86400000);
  }

  function isStaleCustomer(rec) {
    var customerNo = fv(rec, "顧客No", "");
    var last = lastActivityByCustomerNo[customerNo];
    if (!last) return true; // 活動履歴が1件も無い
    return daysSince(last) >= STALE_DAYS_THRESHOLD;
  }

  function fv(record, code, fallback) {
    return record && record[code] && record[code].value != null ? record[code].value : fallback !== undefined ? fallback : "";
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function buildMapContainer(isMobile) {
    var wrapper = document.createElement("div");
    wrapper.id = "customer-map-wrapper";
    wrapper.style.display = "none";
    wrapper.style.marginBottom = "12px";

    var filterBar = document.createElement("div");
    filterBar.id = "customer-map-filter";
    filterBar.style.cssText = isMobile
      ? "font-size:14px;margin-bottom:8px;color:#444;padding:0 8px;"
      : "font-size:12px;margin-bottom:6px;color:#444;";

    Object.keys(RANK_COLOR).forEach(function (rank) {
      checkedRanks[rank] = true;
      var label = document.createElement("label");
      label.style.cssText = "display:inline-block;margin-right:14px;cursor:pointer;";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.rank = rank;
      cb.style.marginRight = "4px";
      if (isMobile) {
        cb.style.width = "16px";
        cb.style.height = "16px";
        cb.style.verticalAlign = "middle";
      }
      cb.addEventListener("change", function () {
        checkedRanks[rank] = cb.checked;
        applyFilterAndRender();
      });

      var swatch = document.createElement("span");
      swatch.style.cssText =
        "display:inline-block;width:10px;height:10px;border-radius:50%;background:" +
        RANK_COLOR[rank] +
        ";margin:0 4px;vertical-align:middle;";

      label.appendChild(cb);
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(rank + "ランク"));
      filterBar.appendChild(label);
    });

    var staleLabel = document.createElement("label");
    staleLabel.style.cssText = "display:inline-block;margin-left:4px;cursor:pointer;color:#c62828;font-weight:bold;";
    var staleCb = document.createElement("input");
    staleCb.type = "checkbox";
    staleCb.checked = false;
    staleCb.style.marginRight = "4px";
    if (isMobile) {
      staleCb.style.width = "16px";
      staleCb.style.height = "16px";
      staleCb.style.verticalAlign = "middle";
    }
    staleCb.addEventListener("change", function () {
      showStaleOnly = staleCb.checked;
      applyFilterAndRender();
    });
    staleLabel.appendChild(staleCb);
    staleLabel.appendChild(document.createTextNode("🔴 " + STALE_DAYS_THRESHOLD + "日以上未接触の顧客のみ表示"));
    filterBar.appendChild(staleLabel);

    var mapDiv = document.createElement("div");
    mapDiv.id = "customer-map";
    mapDiv.style.width = "100%";
    mapDiv.style.height = isMobile ? "65vh" : "520px";
    mapDiv.style.border = "1px solid #ccc";
    mapDiv.style.borderRadius = "4px";

    if (isMobile) {
      wrapper.style.padding = "0 4px";
    }

    wrapper.appendChild(filterBar);
    wrapper.appendChild(mapDiv);
    return wrapper;
  }

  function fetchAllRecordsWithCoords() {
    var params = {
      app: APP_ID_CUSTOMER,
      query: '緯度 != "" and 経度 != "" limit 500',
      fields: ["$id", "会社名", "大分類", "中分類", "顧客ランク", "都道府県", "住所", "緯度", "経度", "顧客No"],
    };
    return kintone.api(kintone.api.url("/k/v1/records", true), "GET", params);
  }

  function fetchAllActivities() {
    return kintone.api(kintone.api.url("/k/v1/records", true), "GET", {
      app: APP_ID_ACTIVITY,
      query: "顧客No != \"\" limit 500",
      fields: ["顧客No", "対応日付"],
    });
  }

  function buildLastActivityMap(activityRecords) {
    var map = {};
    activityRecords.forEach(function (rec) {
      var customerNo = fv(rec, "顧客No", "");
      var dateStr = fv(rec, "対応日付", "");
      if (!customerNo || !dateStr) return;
      var date = new Date(dateStr);
      if (!map[customerNo] || date > map[customerNo]) {
        map[customerNo] = date;
      }
    });
    return map;
  }

  function applyFilterAndRender() {
    var filtered = allRecords.filter(function (rec) {
      var rank = fv(rec, "顧客ランク", "");
      var rankOk = checkedRanks[rank] !== false; // ランク未設定は常に表示
      var staleOk = !showStaleOnly || isStaleCustomer(rec);
      return rankOk && staleOk;
    });
    renderMap(filtered);
  }

  function renderMap(records) {
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    mapInstance = L.map("customer-map").setView([36.2048, 138.2529], 6); // 日本全体が入るデフォルト位置

    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル(国土地理院)</a>',
    }).addTo(mapInstance);

    var bounds = [];

    records.forEach(function (rec) {
      var lat = parseFloat(fv(rec, "緯度", ""));
      var lon = parseFloat(fv(rec, "経度", ""));
      if (isNaN(lat) || isNaN(lon)) return;

      var rank = fv(rec, "顧客ランク", "");
      var color = RANK_COLOR[rank] || "#43a047";

      var marker = L.circleMarker([lat, lon], {
        radius: 9,
        color: "#333",
        weight: 1,
        fillColor: color,
        fillOpacity: 0.85,
      }).addTo(mapInstance);

      var recordId = fv(rec, "$id", "");
      var recordUrl = location.protocol + "//" + location.host + "/k/" + APP_ID_CUSTOMER + "/show#record=" + recordId;

      var lastActivity = lastActivityByCustomerNo[fv(rec, "顧客No", "")];
      var lastActivityText = lastActivity
        ? lastActivity.toLocaleDateString("ja-JP") + "(" + daysSince(lastActivity) + "日前)"
        : "活動履歴なし";
      var staleTag = isStaleCustomer(rec)
        ? ' <span style="color:#c62828;font-weight:bold;">[' + STALE_DAYS_THRESHOLD + "日以上未接触]</span>"
        : "";

      var popupHtml =
        '<div style="font-size:13px;line-height:1.6">' +
        "<strong>" + escapeHtml(fv(rec, "会社名", "") || "(会社名未入力)") + "</strong><br>" +
        "業種: " + escapeHtml(fv(rec, "大分類", "") || "-") +
        (fv(rec, "中分類", "") && fv(rec, "中分類", "") !== "-" ? " / " + escapeHtml(fv(rec, "中分類", "")) : "") + "<br>" +
        "顧客ランク: " + escapeHtml(rank || "-") + "<br>" +
        "最終接触: " + escapeHtml(lastActivityText) + staleTag + "<br>" +
        "住所: " + escapeHtml(fv(rec, "都道府県", "") + fv(rec, "住所", "")) + "<br>" +
        '<a href="' + recordUrl + '" target="_blank" rel="noopener">レコードを開く &gt;</a>' +
        "</div>";

      marker.bindPopup(popupHtml);
      bounds.push([lat, lon]);
    });

    if (bounds.length > 0) {
      mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 });
    }
  }

  // ---- 住所からの自動ジオコーディング(登録・編集時) ----

  var originalAddressOnEdit = null; // 編集画面を開いた時点の「都道府県+住所」(変更検知用)

  function buildAddressText(record) {
    var pref = fv(record, "都道府県", "");
    var addr = fv(record, "住所", "");
    return (pref + addr).trim();
  }

  function fetchGeocode(addressText) {
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timeoutId = controller
      ? setTimeout(function () {
          controller.abort();
        }, 8000)
      : null;
    var url =
      "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=jp&q=" +
      encodeURIComponent(addressText);

    return fetch(url, {
      headers: { "Accept-Language": "ja" },
      signal: controller ? controller.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) {
          throw new Error("ジオコーディングAPIエラー: HTTP " + res.status);
        }
        return res.json();
      })
      .then(function (json) {
        if (json && json.length > 0) {
          return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon) };
        }
        return null;
      })
      .finally(function () {
        if (timeoutId) clearTimeout(timeoutId);
      });
  }

  function maybeGeocodeOnSave(event, isNewRecord) {
    var record = event.record;
    var addressText = buildAddressText(record);

    if (!addressText) {
      return event; // 都道府県・住所がどちらも未入力ならスキップ
    }

    var hasCoords = record["緯度"].value !== "" && record["経度"].value !== "";
    var addressChanged = isNewRecord ? true : addressText !== originalAddressOnEdit;

    if (hasCoords && !addressChanged) {
      return event; // 住所が変わっておらず座標も既にある場合は上書きしない(手動修正を尊重)
    }

    return fetchGeocode(addressText)
      .then(function (result) {
        if (result) {
          record["緯度"].value = result.lat;
          record["経度"].value = result.lon;
        } else {
          console.warn("ジオコーディング結果が見つかりませんでした: " + addressText);
        }
        return event;
      })
      .catch(function (err) {
        // ジオコーディングに失敗しても保存自体は止めない(地図表示は目安機能のため)
        console.error("ジオコーディングに失敗しました(保存は続行します):", err);
        return event;
      });
  }

  kintone.events.on("app.record.create.show", function (event) {
    originalAddressOnEdit = null;
    return event;
  });

  kintone.events.on("app.record.edit.show", function (event) {
    originalAddressOnEdit = buildAddressText(event.record);
    return event;
  });

  kintone.events.on("app.record.create.submit", function (event) {
    return maybeGeocodeOnSave(event, true);
  });

  kintone.events.on("app.record.edit.submit", function (event) {
    return maybeGeocodeOnSave(event, false);
  });

  function makeToggleButton() {
    var btn = document.createElement("button");
    btn.id = "customer-map-toggle-btn";
    btn.type = "button";
    btn.textContent = "地図で表示";
    btn.style.cssText =
      "margin-right:8px;padding:6px 14px;border-radius:4px;border:1px solid #3498db;" +
      "background:#3498db;color:#fff;cursor:pointer;font-size:13px;";
    return btn;
  }

  function wireToggleButton(btn, mapWrapper) {
    var shown = false;
    btn.addEventListener("click", function () {
      shown = !shown;
      mapWrapper.style.display = shown ? "block" : "none";
      btn.textContent = shown ? "地図を閉じる" : "地図で表示";
      if (shown) {
        btn.disabled = true;
        Promise.all([fetchAllRecordsWithCoords(), fetchAllActivities()])
          .then(function (results) {
            allRecords = results[0].records;
            lastActivityByCustomerNo = buildLastActivityMap(results[1].records);
            applyFilterAndRender();
          })
          .catch(function (err) {
            console.error(err);
            alert("地図データの取得に失敗しました。詳細はコンソールを確認してください。");
          })
          .finally(function () {
            btn.disabled = false;
          });
      }
    });
  }

  function setupMapUiDesktop() {
    if (typeof kintone.app === "undefined" || typeof kintone.app.getHeaderMenuSpaceElement !== "function") {
      console.log("[customer-map] desktop API not available (kintone.app.getHeaderMenuSpaceElement is not a function)");
      return false;
    }
    var headerSpace = kintone.app.getHeaderMenuSpaceElement();
    console.log("[customer-map] desktop headerSpace:", headerSpace);
    if (!headerSpace) return false;

    var btn = makeToggleButton();
    headerSpace.appendChild(btn);

    var mapWrapper = buildMapContainer(false);
    var listSpace = kintone.app.getHeaderSpaceElement();
    if (listSpace) {
      listSpace.parentNode.insertBefore(mapWrapper, listSpace.nextSibling);
    }

    wireToggleButton(btn, mapWrapper);
    return true;
  }

  function setupMapUiMobile() {
    console.log(
      "[customer-map] mobile check: kintone.mobile=",
      typeof kintone.mobile,
      "app=",
      typeof (kintone.mobile && kintone.mobile.app),
      "getHeaderSpaceElement=",
      typeof (kintone.mobile && kintone.mobile.app && kintone.mobile.app.getHeaderSpaceElement)
    );
    if (typeof kintone.mobile === "undefined" || typeof kintone.mobile.app === "undefined" ||
      typeof kintone.mobile.app.getHeaderSpaceElement !== "function") {
      return false;
    }
    var headerSpace = kintone.mobile.app.getHeaderSpaceElement();
    console.log("[customer-map] mobile headerSpace:", headerSpace);
    if (!headerSpace) return false;

    var btn = makeToggleButton();
    btn.style.width = "100%";
    btn.style.padding = "10px 14px";
    btn.style.marginRight = "0";
    btn.style.marginBottom = "6px";

    var mapWrapper = buildMapContainer(true);

    headerSpace.appendChild(btn);
    headerSpace.appendChild(mapWrapper);

    wireToggleButton(btn, mapWrapper);
    return true;
  }

  function trySetup(fn) {
    try {
      return !!fn();
    } catch (e) {
      console.warn("地図UIのセットアップに失敗しました(別方式を試します):", e);
      return false;
    }
  }

  function attemptSetup() {
    if (document.getElementById("customer-map-toggle-btn")) {
      return true; // 既に設置済み
    }
    if (trySetup(setupMapUiDesktop)) {
      return true;
    }
    return trySetup(setupMapUiMobile);
  }

  // kintoneの"app.record.index.show"イベントに頼る方式(念のため残す。再描画時の再設置用)
  kintone.events.on("app.record.index.show", function (event) {
    console.log("[customer-map] app.record.index.show fired. location=", location.href);
    attemptSetup();
    return event;
  });

  // 上記イベントが発火しない画面(実機のモバイルブラウザ版で確認)向けに、
  // ページ読み込み後、ボタンの設置場所が使えるようになるまで一定間隔でリトライする
  (function pollForSetup() {
    var attempts = 0;
    var maxAttempts = 20; // 500ms x 20 = 最大10秒リトライ
    var timer = setInterval(function () {
      attempts++;
      var done = attemptSetup();
      console.log("[customer-map] poll attempt " + attempts + " done=" + done);
      if (done || attempts >= maxAttempts) {
        clearInterval(timer);
      }
    }, 500);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        attemptSetup();
      });
    }
  })();
})();
