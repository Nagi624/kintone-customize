/**
 * 見込み客リストアプリ用 地図表示カスタマイズ
 * - 一覧画面に「地図で表示」ボタンを追加
 * - 緯度・経度が入っている全レコードを地図上にピン表示(500件超も全件取得)
 * - ピンの色は「大分類」で色分け(医療・健康・介護/住まい/旅行・宿泊/グルメ/美容・ファッション/
 *   自動車・バイク/暮らし/ショッピング/ペット/趣味/教育・習い事/公共機関・団体/レジャー・スポーツ/
 *   冠婚葬祭・イベント/交通/その他)
 * - 大分類のチェックボックスで表示/非表示をフィルタ可能
 * - 「対象外(業種不一致/廃業・閉店/移転)を除いて表示」チェックで、確認ステータスが
 *   稼働中/不明以外(=営業対象として有効でないと判明済み)の企業を除外できる
 * - ピンをクリックすると会社名・業種・確認ステータス・確認者・対応状況・電話番号を表示し、レコード詳細へのリンクを出す
 * - 新規登録・住所変更時に、都道府県+市区町村+丁目番地等からOpenStreetMap Nominatim(無料)で
 *   自動的に緯度・経度を計算して保存する(手動でのジオコーディング作業が不要)
 *   ※ ただしkintone REST API経由での一括登録(bulk import)ではこのイベントは発火しないため、
 *      一括登録時は別途スクリプト側で緯度・経度を計算してから登録すること
 * - PC(デスクトップ)・スマートフォンブラウザの両方で地図を表示可能
 *   (customize.jsonのdesktop/mobile両方にこのファイルを登録すること。
 *    mobile側はkintoneのFILEアップロードが読み込まれないため、GitHub+jsDelivr(SHA指定)経由でホスティングすること)
 *
 * 利用ライブラリ: Leaflet.js (無料・APIキー不要、CDN経由で読み込み)
 */
(function () {
  "use strict";

  var APP_ID_LEADS = (function () {
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
  })();

  var CATEGORY_COLOR = {
    "医療・健康・介護": "#e53935",
    "住まい": "#6d4c41",
    "旅行・宿泊": "#039be5",
    "グルメ": "#fb8c00",
    "美容・ファッション": "#d81b60",
    "自動車・バイク": "#3949ab",
    "暮らし": "#c0ca33",
    "ショッピング": "#8e24aa",
    "ペット": "#43a047",
    "趣味": "#ffb300",
    "教育・習い事": "#00897b",
    "公共機関・団体": "#546e7a",
    "レジャー・スポーツ": "#f4511e",
    "冠婚葬祭・イベント": "#5e35b1",
    "交通": "#1e88e5",
    "その他": "#757575",
  };
  var EXCLUDABLE_STATUSES = { "業種不一致": true, "廃業・閉店": true, "移転": true };

  var mapInstance = null;
  var allRecords = [];
  var checkedCategories = {};
  var hideClosed = false;

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
    wrapper.id = "leads-map-wrapper";
    wrapper.style.display = "none";
    wrapper.style.marginBottom = "12px";

    var filterBar = document.createElement("div");
    filterBar.id = "leads-map-filter";
    filterBar.style.cssText = isMobile
      ? "font-size:14px;margin-bottom:8px;color:#444;padding:0 8px;"
      : "font-size:12px;margin-bottom:6px;color:#444;";

    Object.keys(CATEGORY_COLOR).forEach(function (category) {
      checkedCategories[category] = true;
      var label = document.createElement("label");
      label.style.cssText = "display:inline-block;margin-right:14px;cursor:pointer;";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = true;
      cb.dataset.category = category;
      cb.style.marginRight = "4px";
      if (isMobile) {
        cb.style.width = "16px";
        cb.style.height = "16px";
        cb.style.verticalAlign = "middle";
      }
      cb.addEventListener("change", function () {
        checkedCategories[category] = cb.checked;
        applyFilterAndRender();
      });

      var swatch = document.createElement("span");
      swatch.style.cssText =
        "display:inline-block;width:10px;height:10px;border-radius:50%;background:" +
        CATEGORY_COLOR[category] +
        ";margin:0 4px;vertical-align:middle;";

      label.appendChild(cb);
      label.appendChild(swatch);
      label.appendChild(document.createTextNode(category));
      filterBar.appendChild(label);
    });

    var closedLabel = document.createElement("label");
    closedLabel.style.cssText = "display:inline-block;margin-left:4px;cursor:pointer;color:#c62828;font-weight:bold;";
    var closedCb = document.createElement("input");
    closedCb.type = "checkbox";
    closedCb.checked = false;
    closedCb.style.marginRight = "4px";
    if (isMobile) {
      closedCb.style.width = "16px";
      closedCb.style.height = "16px";
      closedCb.style.verticalAlign = "middle";
    }
    closedCb.addEventListener("change", function () {
      hideClosed = closedCb.checked;
      applyFilterAndRender();
    });
    closedLabel.appendChild(closedCb);
    closedLabel.appendChild(document.createTextNode("🚫 対象外(業種不一致/廃業/移転)を除いて表示"));
    filterBar.appendChild(closedLabel);

    var mapDiv = document.createElement("div");
    mapDiv.id = "leads-map";
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
    var fields = [
      "$id", "会社名", "大分類", "中分類", "都道府県", "市区町村", "丁目番地等",
      "電話番号", "確認ステータス", "業種確認メモ", "確認者", "対応状況", "緯度", "経度",
    ];
    var pageSize = 500;
    var results = [];

    function fetchPage(offset) {
      return kintone.api(kintone.api.url("/k/v1/records", true), "GET", {
        app: APP_ID_LEADS,
        query: '緯度 != "" and 経度 != "" limit ' + pageSize + " offset " + offset,
        fields: fields,
      }).then(function (resp) {
        results = results.concat(resp.records);
        if (resp.records.length === pageSize) {
          return fetchPage(offset + pageSize);
        }
        return results;
      });
    }

    return fetchPage(0);
  }

  function applyFilterAndRender() {
    var filtered = allRecords.filter(function (rec) {
      var category = fv(rec, "大分類", "");
      var categoryOk = checkedCategories[category] !== false;
      var status = fv(rec, "確認ステータス", "");
      var closedOk = !hideClosed || !EXCLUDABLE_STATUSES[status];
      return categoryOk && closedOk;
    });
    renderMap(filtered);
  }

  function renderMap(records) {
    if (mapInstance) {
      mapInstance.remove();
      mapInstance = null;
    }
    mapInstance = L.map("leads-map").setView([43.0621, 141.3544], 11); // 札幌市中心をデフォルト位置に

    L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank">地理院タイル(国土地理院)</a>',
    }).addTo(mapInstance);

    var bounds = [];

    records.forEach(function (rec) {
      var lat = parseFloat(fv(rec, "緯度", ""));
      var lon = parseFloat(fv(rec, "経度", ""));
      if (isNaN(lat) || isNaN(lon)) return;

      var category = fv(rec, "大分類", "");
      var subCategory = fv(rec, "中分類", "");
      var color = CATEGORY_COLOR[category] || "#757575";
      var status = fv(rec, "確認ステータス", "");

      var marker = L.circleMarker([lat, lon], {
        radius: 9,
        color: "#333",
        weight: 1,
        fillColor: color,
        fillOpacity: EXCLUDABLE_STATUSES[status] ? 0.35 : 0.85,
      }).addTo(mapInstance);

      var recordId = fv(rec, "$id", "");
      var recordUrl = location.protocol + "//" + location.host + "/k/" + APP_ID_LEADS + "/show#record=" + recordId;
      var tel = fv(rec, "電話番号", "");
      var statusTag = EXCLUDABLE_STATUSES[status]
        ? ' <span style="color:#c62828;font-weight:bold;">[' + escapeHtml(status) + "]</span>"
        : "";

      var popupHtml =
        '<div style="font-size:13px;line-height:1.6">' +
        "<strong>" + escapeHtml(fv(rec, "会社名", "") || "(会社名未入力)") + "</strong>" + statusTag + "<br>" +
        "業種: " + escapeHtml(category || "-") + (subCategory && subCategory !== "-" ? " / " + escapeHtml(subCategory) : "") + "<br>" +
        "確認ステータス: " + escapeHtml(status || "-") +
        "(" + escapeHtml(fv(rec, "業種確認メモ", "") || "-") + ")<br>" +
        "確認者: " + escapeHtml(fv(rec, "確認者", "") || "-") + "<br>" +
        "対応状況: " + escapeHtml(fv(rec, "対応状況", "") || "-") + "<br>" +
        (tel ? "電話: " + escapeHtml(tel) + "<br>" : "") +
        "住所: " + escapeHtml(fv(rec, "都道府県", "") + fv(rec, "市区町村", "") + fv(rec, "丁目番地等", "")) + "<br>" +
        '<a href="' + recordUrl + '" target="_blank" rel="noopener">レコードを開く &gt;</a>' +
        "</div>";

      marker.bindPopup(popupHtml);
      bounds.push([lat, lon]);
    });

    if (bounds.length > 0) {
      mapInstance.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 });
    }
  }

  // ---- 住所からの自動ジオコーディング(kintone画面からの登録・編集時のみ有効) ----

  var originalAddressOnEdit = null;

  function buildAddressText(record) {
    var pref = fv(record, "都道府県", "");
    var city = fv(record, "市区町村", "");
    var street = fv(record, "丁目番地等", "");
    return (pref + city + street).trim();
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
      return event;
    }

    var hasCoords = record["緯度"].value !== "" && record["経度"].value !== "";
    var addressChanged = isNewRecord ? true : addressText !== originalAddressOnEdit;

    if (hasCoords && !addressChanged) {
      return event;
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
    btn.id = "leads-map-toggle-btn";
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
        fetchAllRecordsWithCoords()
          .then(function (records) {
            allRecords = records;
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
      return false;
    }
    var headerSpace = kintone.app.getHeaderMenuSpaceElement();
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
    if (typeof kintone.mobile === "undefined" || typeof kintone.mobile.app === "undefined" ||
      typeof kintone.mobile.app.getHeaderSpaceElement !== "function") {
      return false;
    }
    var headerSpace = kintone.mobile.app.getHeaderSpaceElement();
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
    if (document.getElementById("leads-map-toggle-btn")) {
      return true;
    }
    if (trySetup(setupMapUiDesktop)) {
      return true;
    }
    return trySetup(setupMapUiMobile);
  }

  kintone.events.on("app.record.index.show", function (event) {
    attemptSetup();
    return event;
  });

  (function pollForSetup() {
    var attempts = 0;
    var maxAttempts = 20;
    var timer = setInterval(function () {
      attempts++;
      var done = attemptSetup();
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
