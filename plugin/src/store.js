window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  var STORAGE_KEY = "ecom-plugin-state-v1";
  var HEX_RE = /^#[0-9A-Fa-f]{6}$/;
  var ADJUST_KEYS = ["saturation", "brightness", "temperature", "contrast", "whiteBalance", "exposure", "sharpness", "noise"];
  var noStorageWarned = false;
  var idSeq = 0;

  function errText(e) {
    return e && e.message ? e.message : String(e);
  }

  function logWarn(text) {
    try {
      if (window.Ecom && window.Ecom.ps && typeof window.Ecom.ps.log === "function") {
        window.Ecom.ps.log("warn", text);
        return;
      }
    } catch (e) {
      // ps 不可用时不能反过来报错
    }
    try {
      if (typeof console !== "undefined" && console.warn) console.warn("[ecom/store] " + text);
    } catch (e2) { }
  }

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }

  function isNum(v) {
    return typeof v === "number" && isFinite(v);
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function boolOf(v, dflt) {
    return typeof v === "boolean" ? v : dflt;
  }

  function getStorage() {
    try {
      if (typeof window !== "undefined" && window.localStorage) return window.localStorage;
    } catch (e) { }
    return null;
  }

  function newId(prefix) {
    idSeq += 1;
    return String(prefix || "id") + "-" + Date.now().toString(36) + "-" + idSeq.toString(36) + "-" + Math.floor(Math.random() * 46656).toString(36);
  }

  function defaults() {
    return {
      version: 1,
      colors: [
        { id: "c-white", name: "纯白", hex: "#FFFFFF" },
        { id: "c-lightgray", name: "浅灰", hex: "#F5F5F5" },
        { id: "c-ivory", name: "米白", hex: "#FAF7F2" },
        { id: "c-pink", name: "浅粉", hex: "#FDECEF" },
        { id: "c-blue", name: "浅蓝", hex: "#EAF2FB" },
        { id: "c-black", name: "黑", hex: "#000000" }
      ],
      selectedColorId: "c-white",
      customHex: "#F5F5F5",
      sizes: [
        { id: "s-800", w: 800, h: 800, label: "800×800", enabled: true, builtin: true },
        { id: "s-1254", w: 1254, h: 1254, label: "1254×1254", enabled: false, builtin: true },
        { id: "s-1600", w: 1600, h: 1600, label: "1600×1600", enabled: false, builtin: true }
      ],
      baseSizeId: null,
      marginPercent: 5,
      // v3 新增：是否把主体摆到画布正中央（传给 compose.normalize 的 center）
      compose: { center: true },
      // v6 新增：抠图后是否自动应用图层蒙版（关掉＝只算选区，蒙版由用户在图层面板手动添加）
      cutout: { autoMask: true },
      edge: { contract: 1, feather: 0.5 },
      shadow: { enabled: false, opacity: 30, blur: 40, offsetY: 12, color: "#000000" },
      adjust: {
        order: ADJUST_KEYS.slice(),
        items: {
          saturation: { enabled: true, auto: true, min: -100, max: 100, value: 0 },
          brightness: { enabled: true, auto: true, min: -100, max: 100, value: 0 },
          temperature: { enabled: true, auto: true, min: -100, max: 100, value: 0 },
          contrast: { enabled: true, auto: true, min: -100, max: 100, value: 0 },
          whiteBalance: { enabled: true, auto: true, min: -100, max: 100, value: 0 },
          exposure: { enabled: true, auto: true, min: -5, max: 5, value: 0 },
          sharpness: { enabled: false, auto: true, min: 0, max: 300, value: 80 },
          noise: { enabled: false, auto: true, min: 0, max: 100, value: 30 }
        }
      },
      moduleEnabled: {
        cutout: true, refine: true, straighten: false, backdrop: true, shadow: false,
        adjust: true, compose: true, export: true
      },
      export: { format: "jpg", quality: 12, outputDir: null, overwrite: false, lastDir: null }
    };
  }

  function validatePreset(raw) {
    if (!raw || typeof raw !== "object" || Object.prototype.toString.call(raw) === "[object Array]") return "顶层不是对象";
    if (raw.version !== undefined && !isNum(raw.version)) return "version 不是数字";
    var i, c, s;
    if (raw.colors !== undefined) {
      if (Object.prototype.toString.call(raw.colors) !== "[object Array]") return "colors 不是数组";
      for (i = 0; i < raw.colors.length; i++) {
        c = raw.colors[i];
        if (!c || typeof c !== "object") return "colors[" + i + "] 不是对象";
        if (typeof c.id !== "string" || !c.id) return "colors[" + i + "].id 非法";
        if (typeof c.name !== "string") return "colors[" + i + "].name 非法";
        if (typeof c.hex !== "string" || !HEX_RE.test(c.hex)) return "colors[" + i + "].hex 非法（需 #RRGGBB）";
      }
    }
    if (raw.sizes !== undefined) {
      if (Object.prototype.toString.call(raw.sizes) !== "[object Array]") return "sizes 不是数组";
      for (i = 0; i < raw.sizes.length; i++) {
        s = raw.sizes[i];
        if (!s || typeof s !== "object") return "sizes[" + i + "] 不是对象";
        if (typeof s.id !== "string" || !s.id) return "sizes[" + i + "].id 非法";
        if (!isNum(s.w) || s.w <= 0 || !isNum(s.h) || s.h <= 0) return "sizes[" + i + "] 宽高必须为正数";
      }
    }
    if (raw.edge !== undefined && (!raw.edge || typeof raw.edge !== "object")) return "edge 不是对象";
    if (raw.compose !== undefined && (!raw.compose || typeof raw.compose !== "object")) return "compose 不是对象";
    if (raw.shadow !== undefined && (!raw.shadow || typeof raw.shadow !== "object")) return "shadow 不是对象";
    if (raw.export !== undefined && (!raw.export || typeof raw.export !== "object")) return "export 不是对象";
    if (raw.moduleEnabled !== undefined && (!raw.moduleEnabled || typeof raw.moduleEnabled !== "object")) return "moduleEnabled 不是对象";
    if (raw.marginPercent !== undefined && !isNum(raw.marginPercent)) return "marginPercent 不是数字";
    if (raw.colors !== undefined && raw.colors.length === 0) return "colors 为空";
    if (raw.adjust !== undefined) {
      var a = raw.adjust;
      if (!a || typeof a !== "object") return "adjust 不是对象";
      if (a.order !== undefined && Object.prototype.toString.call(a.order) !== "[object Array]") return "adjust.order 不是数组";
      if (a.items !== undefined && (!a.items || typeof a.items !== "object")) return "adjust.items 不是对象";
    }
    var known = ["colors", "sizes", "baseSizeId", "marginPercent", "compose", "cutout", "edge", "shadow", "adjust", "moduleEnabled", "export", "selectedColorId", "customHex"];
    var found = false;
    for (i = 0; i < known.length; i++) {
      if (raw[known[i]] !== undefined) { found = true; break; }
    }
    if (!found) return "不含任何已知预设字段";
    return null;
  }

  function normColor(c) {
    var out = { id: c.id, name: c.name, hex: String(c.hex).toUpperCase() };
    if (c.builtin === true) out.builtin = true;
    else if (c.builtin === false) out.builtin = false;
    return out;
  }

  function normSize(s) {
    var w = Math.round(Number(s.w));
    var h = Math.round(Number(s.h));
    return {
      id: s.id,
      w: w,
      h: h,
      label: (typeof s.label === "string" && s.label) ? s.label : (w + "×" + h),
      enabled: boolOf(s.enabled, false),
      builtin: s.builtin === true
    };
  }

  function normAdjustItem(base, raw) {
    var value = Number(raw.value);
    if (!isFinite(value)) value = base.value;
    return {
      enabled: boolOf(raw.enabled, base.enabled),
      auto: boolOf(raw.auto, base.auto),
      min: base.min,
      max: base.max,
      value: clamp(value, base.min, base.max)
    };
  }

  function mergePreset(raw) {
    var out = defaults();
    var i, k;
    if (typeof raw.selectedColorId === "string") out.selectedColorId = raw.selectedColorId;
    if (raw.customHex === null || typeof raw.customHex === "string") out.customHex = raw.customHex;
    if (Object.prototype.toString.call(raw.colors) === "[object Array]" && raw.colors.length) {
      out.colors = [];
      for (i = 0; i < raw.colors.length; i++) out.colors.push(normColor(raw.colors[i]));
    }
    var selOk = false;
    for (i = 0; i < out.colors.length; i++) if (out.colors[i].id === out.selectedColorId) selOk = true;
    if (!selOk) out.selectedColorId = out.colors[0].id;

    if (Object.prototype.toString.call(raw.sizes) === "[object Array]") {
      out.sizes = [];
      for (i = 0; i < raw.sizes.length; i++) out.sizes.push(normSize(raw.sizes[i]));
    }
    if (raw.baseSizeId === null || typeof raw.baseSizeId === "string") out.baseSizeId = raw.baseSizeId;
    if (isNum(raw.marginPercent)) out.marginPercent = clamp(raw.marginPercent, 0, 40);
    // out 来自 defaults()，所以 v2 老存档（没有 compose 键）在这里被自动补全出 compose.center，
    // load() 读出的 state 一定带这个键，index.js 读 state.compose.center 不会抛 TypeError。
    if (raw.compose && typeof raw.compose === "object") {
      out.compose.center = boolOf(raw.compose.center, out.compose.center);
    }
    // v6：out 来自 defaults()，v5 及更老存档没有 cutout 键 → 在这里被补全出 cutout.autoMask，
    //   保证 index.js 读 state.cutout.autoMask 不会抛 TypeError。
    if (raw.cutout && typeof raw.cutout === "object") {
      out.cutout.autoMask = boolOf(raw.cutout.autoMask, out.cutout.autoMask);
    }

    if (raw.edge && typeof raw.edge === "object") {
      if (isNum(raw.edge.contract)) out.edge.contract = clamp(raw.edge.contract, 0, 100);
      if (isNum(raw.edge.feather)) out.edge.feather = clamp(raw.edge.feather, 0, 100);
    }
    if (raw.shadow && typeof raw.shadow === "object") {
      var sh = raw.shadow;
      out.shadow.enabled = boolOf(sh.enabled, out.shadow.enabled);
      if (isNum(sh.opacity)) out.shadow.opacity = clamp(sh.opacity, 0, 100);
      if (isNum(sh.blur)) out.shadow.blur = clamp(sh.blur, 0, 250);
      if (isNum(sh.offsetY)) out.shadow.offsetY = clamp(sh.offsetY, -300, 300);
      if (typeof sh.color === "string" && HEX_RE.test(sh.color)) out.shadow.color = sh.color.toUpperCase();
    }
    if (raw.moduleEnabled && typeof raw.moduleEnabled === "object") {
      for (k in out.moduleEnabled) {
        if (typeof raw.moduleEnabled[k] === "boolean") out.moduleEnabled[k] = raw.moduleEnabled[k];
      }
    }
    if (raw.adjust && typeof raw.adjust === "object") {
      var order = [];
      if (Object.prototype.toString.call(raw.adjust.order) === "[object Array]") {
        for (i = 0; i < raw.adjust.order.length; i++) {
          var key = raw.adjust.order[i];
          if (ADJUST_KEYS.indexOf(key) >= 0 && order.indexOf(key) < 0) order.push(key);
        }
      }
      for (i = 0; i < ADJUST_KEYS.length; i++) if (order.indexOf(ADJUST_KEYS[i]) < 0) order.push(ADJUST_KEYS[i]);
      out.adjust.order = order;
      var items = raw.adjust.items;
      if (items && typeof items === "object") {
        for (i = 0; i < ADJUST_KEYS.length; i++) {
          k = ADJUST_KEYS[i];
          if (items[k] && typeof items[k] === "object") out.adjust.items[k] = normAdjustItem(out.adjust.items[k], items[k]);
        }
      }
    }
    if (raw.export && typeof raw.export === "object") {
      if (raw.export.format === "jpg" || raw.export.format === "png") out.export.format = raw.export.format;
      if (isNum(raw.export.quality)) out.export.quality = clamp(raw.export.quality, 0, 12);
      if (raw.export.outputDir === null || typeof raw.export.outputDir === "string") out.export.outputDir = raw.export.outputDir;
      // ★ 第 7 轮（用户 m02731）：覆盖原文件开关
      if (typeof raw.export.overwrite === "boolean") out.export.overwrite = raw.export.overwrite;
  if (raw.export.lastDir === null || typeof raw.export.lastDir === "string") out.export.lastDir = raw.export.lastDir;
    }
    if (isNum(raw.version)) out.version = raw.version;
    return out;
  }

  var store = {
    STORAGE_KEY: STORAGE_KEY,
    defaults: defaults,
    newId: newId,

    load: function () {
      var raw = null;
      var ls = getStorage();
      if (!ls) {
        if (!noStorageWarned) {
          noStorageWarned = true;
          logWarn("localStorage 不可用，本次运行使用内存状态（设置不会持久化）");
        }
        return defaults();
      }
      try {
        raw = ls.getItem(STORAGE_KEY);
      } catch (e) {
        logWarn("读取本地存储失败：" + errText(e));
        return defaults();
      }
      if (!raw) return defaults();
      try {
        var parsed = JSON.parse(raw);
        var bad = validatePreset(parsed);
        if (bad) {
          logWarn("本地存储的结构不符（" + bad + "），改用默认设置");
          return defaults();
        }
        return mergePreset(parsed);
      } catch (e2) {
        logWarn("本地存储解析失败：" + errText(e2) + "，改用默认设置");
        return defaults();
      }
    },

    save: function (state) {
      var ls = getStorage();
      if (!ls) {
        if (!noStorageWarned) {
          noStorageWarned = true;
          logWarn("localStorage 不可用，设置不会持久化");
        }
        return;
      }
      try {
        ls.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        logWarn("保存设置失败：" + errText(e));
      }
    },

    isBuiltinColor: function (c) {
      return !(c && c.builtin === false);
    },

    isBuiltinSize: function (s) {
      return !!(s && s.builtin === true);
    },

    addSizePreset: function (state, spec) {
      try {
        if (!spec || typeof spec !== "object") return { ok: false, error: "尺寸参数缺失" };
        var w = Math.round(Number(spec.w));
        var h = Math.round(Number(spec.h));
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) return { ok: false, error: "宽高必须是正整数像素" };
        if (w > 20000 || h > 20000) return { ok: false, error: "宽高上限 20000px" };
        var next = clone(state);
        var label = (typeof spec.label === "string" && spec.label.replace(/\s+/g, "")) ? spec.label : (w + "×" + h);
        next.sizes.push({ id: newId("s"), w: w, h: h, label: label, enabled: true, builtin: false });
        return { ok: true, state: next };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },

    removeSizePreset: function (state, id) {
      try {
        var next = clone(state);
        var found = null;
        var i;
        for (i = 0; i < next.sizes.length; i++) if (next.sizes[i].id === id) found = next.sizes[i];
        if (!found) return { ok: false, error: "未找到 id 为 " + id + " 的尺寸" };
        if (found.builtin === true) return { ok: false, error: "内置尺寸不可删除：" + found.label };
        var keep = [];
        for (i = 0; i < next.sizes.length; i++) if (next.sizes[i].id !== id) keep.push(next.sizes[i]);
        next.sizes = keep;
        if (next.baseSizeId === id) next.baseSizeId = null;
        return { ok: true, state: next };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },

    setColor: function (state, spec) {
      try {
        if (!spec || typeof spec !== "object") return { ok: false, error: "色板参数缺失" };
        var hex = typeof spec.hex === "string" ? spec.hex.trim().toUpperCase() : "";
        if (hex.charAt(0) !== "#") hex = "#" + hex;
        if (!HEX_RE.test(hex)) return { ok: false, error: "颜色值非法（需 #RRGGBB）：" + spec.hex };
        var name = (typeof spec.name === "string" && spec.name.replace(/\s+/g, "")) ? spec.name : "自定义色";
        var next = clone(state);
        next.colors.push({ id: newId("c"), name: name, hex: hex, builtin: false });
        return { ok: true, state: next };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },

    removeColor: function (state, id) {
      try {
        var next = clone(state);
        var found = null;
        var i;
        for (i = 0; i < next.colors.length; i++) if (next.colors[i].id === id) found = next.colors[i];
        if (!found) return { ok: false, error: "未找到 id 为 " + id + " 的色板" };
        if (found.builtin !== false) return { ok: false, error: "内置色板不可删除：" + found.name };
        if (next.colors.length <= 1) return { ok: false, error: "至少保留一个色板" };
        var keep = [];
        for (i = 0; i < next.colors.length; i++) if (next.colors[i].id !== id) keep.push(next.colors[i]);
        next.colors = keep;
        if (next.selectedColorId === id) next.selectedColorId = keep[0].id;
        return { ok: true, state: next };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },

    exportPresets: function (state) {
      try {
        return { ok: true, data: { json: JSON.stringify(state, null, 2) } };
      } catch (e) {
        return { ok: false, error: errText(e) };
      }
    },

    importPresets: function (state, jsonString) {
      if (typeof jsonString !== "string" || !jsonString.replace(/\s+/g, "")) {
        return { ok: false, error: "预设内容为空" };
      }
      var parsed;
      try {
        parsed = JSON.parse(jsonString);
      } catch (e) {
        return { ok: false, error: "预设 JSON 解析失败：" + errText(e) };
      }
      var bad = validatePreset(parsed);
      if (bad) return { ok: false, error: "预设结构不符：" + bad };
      try {
        return { ok: true, state: mergePreset(parsed) };
      } catch (e2) {
        return { ok: false, error: "预设应用失败：" + errText(e2) };
      }
    }
  };

  window.Ecom.store = store;
})();
