window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  var HEX_RE = /^#[0-9A-Fa-f]{6}$/;
  var MAX_LOG = 200;
  var FALLBACK_ORDER = ["saturation", "brightness", "temperature", "contrast", "whiteBalance", "exposure", "sharpness", "noise"];
  var ADJUST_LABELS = {
    saturation: "饱和度",
    brightness: "亮度",
    temperature: "色温",
    contrast: "对比度",
    whiteBalance: "白平衡",
    exposure: "曝光补偿",
    sharpness: "锐化",
    noise: "降噪"
  };
  var ADJUST_STEP = { exposure: 0.1, sharpness: 1, noise: 1 };
  var current = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = String(text);
    return n;
  }

  function errText(e) {
    return e && e.message ? e.message : String(e);
  }

  function pad2(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function nowTime() {
    var d = new Date();
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function round2(v) {
    return Math.round(v * 100) / 100;
  }

  function clamp255(v) {
    var n = Math.round(v);
    return n < 0 ? 0 : (n > 255 ? 255 : n);
  }

  function toHex(r, g, b) {
    var parts = [r, g, b];
    var out = "#";
    for (var i = 0; i < 3; i++) {
      var s = clamp255(parts[i]).toString(16).toUpperCase();
      out += s.length < 2 ? "0" + s : s;
    }
    return out;
  }

  function signed(v) {
    var n = round2(v);
    return (n > 0 ? "+" : "") + n;
  }

  function createInstance(opts) {
    var on = (opts && opts.on) || {};
    var state = (opts && opts.state) || (window.Ecom.store ? window.Ecom.store.defaults() : {});
    var analysis = null;
    var analysisAttempted = false;   // 区分「还没统计」与「统计失败」（后者自动值会全为 0）
    var autoValues = {};
    var interactive = [];
    var adjustRows = {};
    var adjustSig = "";
    var busy = false;

    var rootEl = null;
    var statusText = null;
    var logBody = null;
    var colorGrid = null;
    var sizeList = null;
    var adjustBody = null;
    var adjustWarn = null;
    var statsLine = null;
    var baseHint = null;
    var hexInput = null;
    var colorName = null;
    var sizeW = null;
    var sizeH = null;
    var sizeLabel = null;
    var outDirText = null;
    var outDirInput = null;
    var logPathText = null;
    var presetBox = null;
    var btnDelColor = null;
    var qualityRange = null;
    var qualityVal = null;
    var formatSelect = null;
    var cbOverwrite = null;
    var featherRange = null;
    var featherVal = null;
    var contractInput = null;
    var marginRange = null;
    var marginVal = null;
    var shadowRefs = {};
    var inner = {};

    function fire(name, arg) {
      var fn = on[name];
      if (typeof fn !== "function") return;
      try {
        var r = fn(arg);
        if (r && typeof r.then === "function") {
          r.catch(function (e) {
            pushLog("error", "回调 " + name + " 失败：" + errText(e));
          });
        }
      } catch (e2) {
        pushLog("error", "回调 " + name + " 抛出异常：" + errText(e2));
      }
    }

    function reg(node) {
      interactive.push(node);
      if (busy) node.disabled = true;
      return node;
    }

    function regCheck(node) {
      return node;
    }

    function pushLog(level, text) {
      setLog({ time: nowTime(), level: level, text: text });
    }

    function setLog(entry) {
      if (!logBody) return;
      var e = entry || {};
      var line = el("div", "log-line log-" + (e.level || "info"));
      line.appendChild(el("span", "log-time", "[" + (e.time || nowTime()) + "] "));
      line.appendChild(el("span", "log-text", e.text === undefined ? "" : String(e.text)));
      logBody.appendChild(line);
      while (logBody.childNodes.length > MAX_LOG) logBody.removeChild(logBody.firstChild);
      logBody.scrollTop = logBody.scrollHeight;
    }

    function sec(title) {
      var s = el("div", "sec");
      s.appendChild(el("div", "sec-title", title));
      rootEl.appendChild(s);
      return s;
    }

    function button(parent, label, small) {
      var b = el("button", "btn" + (small ? " btn-small" : ""), label);
      reg(b);
      parent.appendChild(b);
      return b;
    }

    function checkboxRow(parent, label, checked, onChange) {
      var row = el("div", "check-row");
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!checked;
      cb.addEventListener("change", function () { onChange(!!cb.checked); });
      regCheck(cb);
      interactive.push(cb);
      if (busy) cb.disabled = true;
      var lb = el("label", "", label);
      row.appendChild(cb);
      row.appendChild(lb);
      parent.appendChild(row);
      return cb;
    }

    // ★ 用户 m03453（2026-10-16）：滑条右侧的数字改成「可点击输入的小框」——一直可编辑，
    //   回车/失焦生效，与滑条双向同步。按 Adobe 官方对数字输入的要求实现：
    //   非法输入回滚、越界夹到 min/max、对齐 step（避免滑条与数字显示不一致）。
    function snapNum(v, min, max, step) {
      var n = Number(v);
      if (!isFinite(n)) return null;
      if (min !== undefined && min !== null && min !== "") n = Math.max(Number(min), n);
      if (max !== undefined && max !== null && max !== "") n = Math.min(Number(max), n);
      var st = Number(step) || 0;
      if (st > 0) {
        n = Math.round(n / st) * st;
        n = Math.round(n * 1000) / 1000;  // 0.1/0.5 这类步长会留浮点尾巴（0.30000000000000004）
      }
      return n;
    }

    // 数字小框：{node, set(v), commit(v), rollback()}；commit 由调用方挂。
    function numBox(cls, min, max, step, title) {
      var inp = document.createElement("input");
      inp.type = "number";
      inp.className = cls;
      if (min !== undefined && min !== null && min !== "") inp.min = min;
      if (max !== undefined && max !== null && max !== "") inp.max = max;
      if (step !== undefined && step !== null && step !== "") inp.step = step;
      inp.title = title || "可直接输入数值；回车或失焦生效";
      var box = { node: inp, commit: null, rollback: null, last: null };
      var apply = function () {
        var v = snapNum(inp.value, min, max, step);
        if (v === null) { if (box.rollback) box.rollback(); return; }
        inp.value = v;                       // 顺手规范化显示
        if (v === box.last) return;          // 没变就不重复提交（回车后失焦会走两次）
        box.last = v;
        if (box.commit) box.commit(v);
      };
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); apply(); }
        else if (e.key === "Escape") { if (box.rollback) box.rollback(); }
      });
      inp.addEventListener("blur", function () { apply(); });
      box.set = function (v) { box.last = Number(v); inp.value = Number(v); };
      return box;
    }

    function sliderRow(parent, label, min, max, step, value, fmt, onCommit) {
      var row = el("div", "row");
      row.appendChild(el("span", "row-label", label));
      var range = document.createElement("input");
      range.type = "range";
      range.min = min;
      range.max = max;
      range.step = step;
      range.value = value;
      var box = numBox("row-num", min, max, step,
        "可直接输入数值；回车或失焦生效（范围 " + min + "~" + max + "，步长 " + step + "）");
      box.set(value);
      box.commit = function (v) { range.value = v; onCommit(v); };
      box.rollback = function () { box.set(Number(range.value)); };
      range.addEventListener("input", function () { box.set(Number(range.value)); });
      range.addEventListener("change", function () { onCommit(Number(range.value)); });
      reg(range);
      reg(box.node);
      row.appendChild(range);
      row.appendChild(box.node);
      parent.appendChild(row);
      // 兼容旧调用点：node＝滑条、value＝数字框元素、set()＝程序化同步两者（不触发 onCommit）
      return {
        node: range,
        value: box.node,
        fmt: fmt,
        set: function (v) { range.value = v; box.set(v); }
      };
    }

    function textRow(parent, label, value, placeholder, width) {
      var row = el("div", "row");
      row.appendChild(el("span", "row-label", label));
      var inp = document.createElement("input");
      inp.type = "text";
      inp.className = "text-input";
      inp.value = value === undefined || value === null ? "" : value;
      if (placeholder) inp.placeholder = placeholder;
      reg(inp);
      row.appendChild(inp);
      parent.appendChild(row);
      return inp;
    }

    function currentColor() {
      var colors = state.colors || [];
      var i;
      for (i = 0; i < colors.length; i++) if (colors[i].id === state.selectedColorId) return colors[i];
      return colors.length ? colors[0] : null;
    }

    function effectiveHex() {
      if (typeof state.customHex === "string" && HEX_RE.test(state.customHex)) return state.customHex.toUpperCase();
      var c = currentColor();
      return c && HEX_RE.test(c.hex) ? c.hex.toUpperCase() : "#FFFFFF";
    }

    function effectiveColorName() {
      if (typeof state.customHex === "string" && HEX_RE.test(state.customHex)) return "自定义 " + state.customHex.toUpperCase();
      var c = currentColor();
      return c ? c.name : "背景";
    }

    function baseSizeOf(s) {
      var sizes = s.sizes || [];
      var i;
      for (i = 0; i < sizes.length; i++) {
        if (sizes[i].id === s.baseSizeId) return sizes[i].w;
      }
      var max = 0;
      for (i = 0; i < sizes.length; i++) {
        if (sizes[i].enabled && sizes[i].w > max) max = sizes[i].w;
      }
      return max || 1600;
    }

    function mergeModules(key, value) {
      var m = {};
      var k;
      for (k in state.moduleEnabled) m[k] = state.moduleEnabled[k];
      m[key] = value;
      return m;
    }

    function patchShadow(key, value) {
      var s = {};
      var k;
      for (k in state.shadow) s[k] = state.shadow[k];
      s[key] = value;
      return { shadow: s };
    }

    // compose 是浅层合并的整块替换：必须提交完整对象，否则会抹掉 compose 的其他键
    function patchCompose(key, value) {
      var c = {};
      var k;
      for (k in state.compose) c[k] = state.compose[k];
      c[key] = value;
      return { compose: c };
    }

    // v6：cutout 同样是浅层合并 → 提交完整对象
    function patchCutout(key, value) {
      var c = {};
      var k;
      for (k in state.cutout) c[k] = state.cutout[k];
      c[key] = value;
      return { cutout: c };
    }

    function patchAdjust(key, changes) {
      var items = {};
      var k, f;
      for (k in state.adjust.items) {
        items[k] = {};
        for (f in state.adjust.items[k]) items[k][f] = state.adjust.items[k][f];
      }
      for (f in changes) items[key][f] = changes[f];
      return { adjust: { order: state.adjust.order.slice(), items: items } };
    }

    function build() {
      rootEl = document.getElementById("panel");
      if (!rootEl) {
        rootEl = el("div", "panel");
        document.body.appendChild(rootEl);
      }
      rootEl.className = "panel";
      while (rootEl.firstChild) rootEl.removeChild(rootEl.firstChild);

      var header = el("div", "panel-header");
      header.appendChild(el("div", "panel-title", "电商图片制作"));
      header.appendChild(el("div", "panel-sub", "抠图 · 换底 · 调色 · 改尺寸 · 导出"));
      rootEl.appendChild(header);

      var statusBar = el("div", "status-bar");
      statusText = el("span", "status-text", "就绪");
      statusBar.appendChild(statusText);
      rootEl.appendChild(statusBar);

      buildRun();
      buildCutout();
      buildRefine();
      buildStraighten();
      buildBackdrop();
      buildShadow();
      buildAdjust();
      buildSize();
      buildExport();
      buildPresets();
      buildLog();
    }

    function buildRun() {
      var s = sec("一键");
      var row = el("div", "row row-actions");
      var runAll = button(row, "一键生成全部");
      runAll.className = "btn btn-primary";
      runAll.addEventListener("click", function () { fire("onRunAll"); });
      var restore = button(row, "回退");
      restore.addEventListener("click", function () { fire("onRestore"); });
      s.appendChild(row);
      // ★ 用户 m03712：「一键完成加一个是否导出，有时候我还想看看效果再导出」
      //   直接绑既有的 moduleEnabled.export —— index.js 的一键循环本来就按模块开关跳过 export 步，
      //   所以这里不需要给流程加分支：不勾选＝跑完就停在 PS 里，看效果后再到「导出」区手动导出。
      inner.cbAutoExport = checkboxRow(s, "一键完成后自动导出（不勾选＝跑完停下，先看效果）",
        state.moduleEnabled.export !== false, function (v) {
          fire("onStateChange", { moduleEnabled: mergeModules("export", v) });
        });
      s.appendChild(el("div", "hint", "顺序：抠图 → 边缘净化 → 应用蒙版 → 自动摆正 → 背景 → 接地投影 → 调色 → 尺寸构图 → 导出。任一步失败即停止并记录原文错误（「自动摆正」是可选步骤：判为跳过 / 变换失败只写日志，不中断流程）。"));
      s.appendChild(el("div", "hint", "不勾选上一项＝一键跑完不导出：停在被处理的文档上，先在 PS 里看效果，满意了再去「导出」区点「导出」。"));
    }

    function buildCutout() {
      var s = sec("抠图");
      var cb = checkboxRow(s, "启用抠图模块（一键流程中执行）", state.moduleEnabled.cutout, function (v) {
        fire("onStateChange", { moduleEnabled: mergeModules("cutout", v) });
      });
      inner.cbCutout = cb;
      // v6（用户原话）：勾选＝抠完图自动应用蒙版；不勾选＝只抠图，不烘焙。
      // ★ m04531 澄清：不勾选只是【不烘焙】，蒙版本身照旧建好并保持启用（能看到抠图结果、可继续编辑）。
      inner.cbAutoMask = checkboxRow(s, "抠图后应用图层蒙版（烘焙进像素；不勾选＝只抠图不烘焙，蒙版建好并保持启用、可继续编辑）",
        state.cutout ? state.cutout.autoMask !== false : true, function (v) {
          fire("onStateChange", patchCutout("autoMask", v));
        });
      var row = el("div", "row row-actions");
      var b = button(row, "执行抠图");
      b.addEventListener("click", function () { fire("onRunModule", "cutout"); });
      s.appendChild(row);
      s.appendChild(el("div", "hint", "勾选（默认）：一键流程在「边缘净化」之后执行 PS 的「图层>图层蒙版>应用」—— 蒙版烘焙进像素，图层面板上的蒙版缩览图消失、主体外变成真透明。不勾选：只执行抠图不烘焙，蒙版照样建好并【保持启用】（画面立刻能看到抠图结果），方便用画笔继续修补；之后想烘焙，勾选本项重跑，或手动执行「图层>图层蒙版>应用」。"));
    }

    function buildStraighten() {
      var s = sec("自动摆正");
      inner.cbStraighten = checkboxRow(s, "启用自动摆正（只做小角度微调）", state.moduleEnabled.straighten, function (v) {
        fire("onStateChange", { moduleEnabled: mergeModules("straighten", v) });
      });
      var row = el("div", "row row-actions");
      var b = button(row, "执行自动摆正");
      b.addEventListener("click", function () { fire("onRunModule", "straighten"); });
      s.appendChild(row);
      s.appendChild(el("div", "hint", "默认关。只处理「拍歪了一点点」的平面产品：相对轴向倾斜 |tilt|<5° 且四边残差、透视偏差都干净时才自动转正；多个物体时逐物体各转各的。角度由像素自己算，转完重读像素复核；发现转反了会自动反向纠正（方向常量在 src/straighten-apply.js）。"));
      s.appendChild(el("div", "hint", "落在中间档（5°~15° 或残差不够干净）与「跳过」档（>15°、异形、斜放构图）时一律不动画面，只在日志写明角度与原因 —— 宁可漏转也不误转。"));
      s.appendChild(el("div", "hint", "只旋转主体层，不裁剪也不缩放：转后四角露出的透明区由后续「背景」步骤盖住。失败只写警告，不中断一键流程。"));

      // ★ 用户 m03453（2026-10-16）：手动「旋转图层」—— 整层转、按输入角度累加、角度会保存、与一键流程无关。
      var curAng = function () {
        return (state.straighten && typeof state.straighten.manualAngleDeg === "number") ? state.straighten.manualAngleDeg : 1;
      };
      var arow = el("div", "row");
      arow.appendChild(el("span", "row-label", "旋转角度 (°)"));
      var ang = numBox("row-num", null, null, 0.1, "输入要旋转的度数（正＝顺时针，不限制大小）；回车或失焦生效并保存");
      ang.set(curAng());
      ang.commit = function (v) { fire("onStateChange", { straighten: { manualAngleDeg: v } }); };
      ang.rollback = function () { ang.set(curAng()); };
      inner.angRotate = ang;
      arow.appendChild(ang.node);
      s.appendChild(arow);
      var mrow = el("div", "row row-actions");
      var mb = button(mrow, "旋转图层");
      mb.title = "按上面输入的度数把主体层整层旋转一次（正＝顺时针；每次点都累加；不参与一键全流程）";
      mb.addEventListener("click", function () { fire("onManualRotate", null); });
      s.appendChild(mrow);
      s.appendChild(el("div", "hint", "手动旋转：按输入角度把主体层【整层】转一次（多物体也一样整层转），正数＝顺时针，每次点都按该角度累加、角度会保存。点之前会自动解锁图层并取消选区（有选区时只会转选区内的像素），转完回读复核并写日志。一键全流程不含这一步。"));
    }

    function buildRefine() {
      var s = sec("边缘净化");
      inner.cbRefine = checkboxRow(s, "启用边缘净化模块", state.moduleEnabled.refine, function (v) {
        fire("onStateChange", { moduleEnabled: mergeModules("refine", v) });
      });
      var row = el("div", "row row-actions");
      var b = button(row, "执行边缘净化");
      b.addEventListener("click", function () { fire("onRunModule", "refine"); });
      s.appendChild(row);
      featherRange = sliderRow(s, "羽化 (px)", 0, 20, 0.1, state.edge.feather, function (v) { return round2(v); }, function (v) {
        fire("onStateChange", { edge: { contract: state.edge.contract, feather: v } });
      });
      var crow = el("div", "row");
      crow.appendChild(el("span", "row-label", "收缩 (px)"));
      contractInput = document.createElement("input");
      contractInput.type = "number";
      contractInput.className = "num-input";
      contractInput.min = 0;
      contractInput.max = 100;
      contractInput.step = 1;
      contractInput.value = state.edge.contract;
      contractInput.addEventListener("change", function () {
        var v = Number(contractInput.value);
        if (!isFinite(v)) { contractInput.value = state.edge.contract; return; }
        v = Math.max(0, Math.min(100, Math.round(v)));
        contractInput.value = v;
        fire("onStateChange", { edge: { contract: v, feather: state.edge.feather } });
      });
      reg(contractInput);
      crow.appendChild(contractInput);
      s.appendChild(crow);
      s.appendChild(el("div", "hint hint-strong", "「收缩」只在「一键抠图」时生效；单独点本按钮只做羽化。"));
      s.appendChild(el("div", "hint", "依据：PS 没有「蒙版收缩」API（只有羽化/密度），收缩只能作用于抠图产生的选区——时机在建蒙版之前，所以单跑边缘净化时无法收缩。"));
    }

    function buildBackdrop() {
      var s = sec("背景（纯色）");
      colorGrid = el("div", "color-grid");
      s.appendChild(colorGrid);

      var row = el("div", "row row-actions");
      var pick = button(row, "任意取色");
      pick.addEventListener("click", function () { fire("onPickColor"); });
      btnDelColor = button(row, "删除选中色板");
      btnDelColor.className = "btn btn-small btn-danger";
      btnDelColor.addEventListener("click", function () { fire("onRemoveColor", state.selectedColorId); });
      s.appendChild(row);

      var hexRow = el("div", "row");
      hexRow.appendChild(el("span", "row-label", "HEX"));
      hexInput = document.createElement("input");
      hexInput.type = "text";
      hexInput.className = "text-input";
      hexInput.placeholder = "#RRGGBB";
      hexInput.addEventListener("change", function () {
        var v = String(hexInput.value || "").trim().toUpperCase();
        if (v.charAt(0) !== "#") v = "#" + v;
        if (!HEX_RE.test(v)) {
          pushLog("warn", "颜色值非法（需 #RRGGBB）：" + hexInput.value);
          refreshAll();
          return;
        }
        fire("onStateChange", { customHex: v });
      });
      reg(hexInput);
      hexRow.appendChild(hexInput);
      s.appendChild(hexRow);

      var nameRow = el("div", "row");
      nameRow.appendChild(el("span", "row-label", "新色板名"));
      colorName = document.createElement("input");
      colorName.type = "text";
      colorName.className = "text-input";
      colorName.placeholder = "可留空";
      reg(colorName);
      nameRow.appendChild(colorName);
      s.appendChild(nameRow);

      var addRow = el("div", "row row-actions");
      var addColor = button(addRow, "把当前 HEX 存为色板");
      addColor.addEventListener("click", function () {
        var n = String(colorName.value || "").trim();
        fire("onAddColor", { name: n || "自定义色", hex: effectiveHex() });
      });
      s.appendChild(addRow);

      var modRow = el("div", "row row-actions");
      var applyBg = button(modRow, "只应用背景");
      applyBg.addEventListener("click", function () { fire("onRunModule", "backdrop"); });
      s.appendChild(modRow);

      s.appendChild(el("div", "hint", "HEX 框非空时优先于色板选择；点色板会清掉 HEX 框的自定义值。"));
    }

    function buildShadow() {
      var s = sec("接地投影");
      inner.cbShadow = checkboxRow(s, "启用接地投影", state.moduleEnabled.shadow, function (v) {
        var patch = { moduleEnabled: mergeModules("shadow", v) };
        patch.shadow = {};
        var k;
        for (k in state.shadow) patch.shadow[k] = state.shadow[k];
        patch.shadow.enabled = v;
        fire("onStateChange", patch);
      });
      shadowRefs.opacity = sliderRow(s, "不透明度 %", 0, 100, 1, state.shadow.opacity, function (v) { return Math.round(v); }, function (v) {
        fire("onStateChange", patchShadow("opacity", v));
      });
      shadowRefs.blur = sliderRow(s, "模糊 (px)", 0, 250, 1, state.shadow.blur, function (v) { return Math.round(v); }, function (v) {
        fire("onStateChange", patchShadow("blur", v));
      });
      shadowRefs.offsetY = sliderRow(s, "下移量 (px)", 0, 200, 1, state.shadow.offsetY, function (v) { return Math.round(v); }, function (v) {
        fire("onStateChange", patchShadow("offsetY", v));
      });
      var row = el("div", "row row-actions");
      var b = button(row, "只生成投影");
      b.addEventListener("click", function () { fire("onRunModule", "shadow"); });
      s.appendChild(row);
      s.appendChild(el("div", "hint", "投影以非破坏方式加在主体层上，不改写主体层像素：可在图层面板里直接关闭或删除它。注意 —— 若主体层还没有图层蒙版（未先执行抠图），投影会跟随整层像素范围而呈矩形，请先执行一键抠图。"));
    }

    function buildAdjust() {
      var s = sec("调色");
      statsLine = el("div", "stats-line", "主体统计：未采集（执行「调色」时会自动统计）");
      s.appendChild(statsLine);
      // 缺陷 #11：统计失败时自动值全部回退为 0，外观与「算出来就是 0」完全一样，必须显式提示
      adjustWarn = el("div", "hint hint-strong", "");
      adjustWarn.style.display = "none";
      s.appendChild(adjustWarn);
      adjustBody = el("div", "adjust-body");
      s.appendChild(adjustBody);
      var row = el("div", "row row-actions");
      var b = button(row, "执行调色");
      b.addEventListener("click", function () { fire("onRunModule", "adjust"); });
      s.appendChild(row);
      s.appendChild(el("div", "hint", "全部落成调整图层 / 智能滤镜，可单独关闭某一项验证原图未被破坏。"));
    }

    function buildSize() {
      var s = sec("尺寸");
      sizeList = el("div", "size-list");
      s.appendChild(sizeList);

      var r1 = el("div", "row");
      r1.appendChild(el("span", "row-label", "宽"));
      sizeW = document.createElement("input");
      sizeW.type = "number";
      sizeW.className = "num-input";
      sizeW.placeholder = "800";
      reg(sizeW);
      r1.appendChild(sizeW);
      r1.appendChild(el("span", "row-label", "高"));
      sizeH = document.createElement("input");
      sizeH.type = "number";
      sizeH.className = "num-input";
      sizeH.placeholder = "800";
      reg(sizeH);
      r1.appendChild(sizeH);
      s.appendChild(r1);

      var r2 = el("div", "row");
      r2.appendChild(el("span", "row-label", "标签"));
      sizeLabel = document.createElement("input");
      sizeLabel.type = "text";
      sizeLabel.className = "text-input";
      sizeLabel.placeholder = "可留空";
      reg(sizeLabel);
      r2.appendChild(sizeLabel);
      s.appendChild(r2);

      var r3 = el("div", "row row-actions");
      var add = button(r3, "新增自定义尺寸");
      add.addEventListener("click", function () {
        var w = Math.round(Number(sizeW.value));
        var h = Math.round(Number(sizeH.value));
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
          pushLog("warn", "请先填写合法的宽高（正整数像素）");
          return;
        }
        fire("onAddSize", { w: w, h: h, label: String(sizeLabel.value || "").trim() });
      });
      s.appendChild(r3);

      marginRange = sliderRow(s, "留白比例 %", 0, 30, 0.5, state.marginPercent, function (v) { return round2(v); }, function (v) {
        fire("onStateChange", { marginPercent: v });
      });
      inner.cbCenter = checkboxRow(s, "居中主体（改尺寸后摆到画布正中央）", state.compose ? state.compose.center !== false : true, function (v) {
        fire("onStateChange", patchCompose("center", v));
      });
      baseHint = el("div", "hint", "");
      s.appendChild(baseHint);
      var r4 = el("div", "row row-actions");
      var b = button(r4, "只执行尺寸构图");
      b.addEventListener("click", function () { fire("onRunModule", "compose"); });
      s.appendChild(r4);
    }

    function buildExport() {
      var s = sec("导出");
      var r1 = el("div", "row");
      r1.appendChild(el("span", "row-label", "格式"));
      formatSelect = document.createElement("select");
      var o1 = el("option", "", "JPG");
      o1.value = "jpg";
      var o2 = el("option", "", "PNG");
      o2.value = "png";
      formatSelect.appendChild(o1);
      formatSelect.appendChild(o2);
      formatSelect.addEventListener("change", function () {
        fire("onStateChange", { export: { format: formatSelect.value, quality: state.export.quality, outputDir: state.export.outputDir, overwrite: state.export.overwrite === true } });
      });
      reg(formatSelect);
      r1.appendChild(formatSelect);
      s.appendChild(r1);

      qualityRange = sliderRow(s, "质量", 0, 12, 1, state.export.quality, function (v) { return Math.round(v); }, function (v) {
        fire("onStateChange", { export: { format: state.export.format, quality: v, outputDir: state.export.outputDir, overwrite: state.export.overwrite === true } });
      });
      qualityVal = qualityRange.value;
      s.appendChild(el("div", "hint", "JPG 质量区间 0–12（PS 实测上限 12，超限会报「指定值大于最大允许值」）。PNG 忽略质量。"));
      cbOverwrite = checkboxRow(s, "覆盖原文件（同名直接写回原图，慎用）", state.export.overwrite === true, function (v) {
        fire("onStateChange", { export: { format: state.export.format, quality: state.export.quality, outputDir: state.export.outputDir, overwrite: v } });
      });
      s.appendChild(el("div", "hint", "不勾选＝导出到原图同一目录，文件名「原名-ps-1」，「1」按目录里已有文件顺延；勾选＝首个尺寸直接覆盖原图本身，其余尺寸仍用 -ps-N。"));
      // ★ 用户 m04355「导出加一个选择目录的选项」：手打/粘贴 + 系统文件夹选择器（ps.pickFolder → UXP getFolder），
      //   留空＝沿用「导出到原图同一目录」的旧行为（store 里 outputDir=null）。
      var rd = el("div", "row");
      rd.appendChild(el("span", "row-label", "输出目录"));
      outDirInput = document.createElement("input");
      outDirInput.type = "text";
      outDirInput.className = "text-input";
      outDirInput.placeholder = "未设置＝导出到原图同一目录";
      outDirInput.value = state.export.outputDir ? String(state.export.outputDir) : "";
      outDirInput.addEventListener("change", function () {
        var v = String(outDirInput.value || "").trim();
        fire("onStateChange", { export: { format: state.export.format, quality: state.export.quality, outputDir: v ? v : null, overwrite: state.export.overwrite === true } });
      });
      reg(outDirInput);
      rd.appendChild(outDirInput);
      var pickDir = button(rd, "选择…");
      pickDir.addEventListener("click", function () { fire("onPickOutputDir"); });
      var clearDir = button(rd, "清除", true);
      clearDir.title = "清除后＝导出到原图同一目录";
      clearDir.addEventListener("click", function () {
        fire("onStateChange", { export: { format: state.export.format, quality: state.export.quality, outputDir: null, overwrite: state.export.overwrite === true } });
      });
      s.appendChild(rd);
      s.appendChild(el("div", "hint", "「选择…」调系统文件夹选择器（Adobe UXP localFileSystem.getFolder）；目录不存在时导出会自动创建。留空＝导出到原图同一目录。"));
      outDirText = el("div", "out-dir", "");
      s.appendChild(outDirText);
      var r = el("div", "row row-actions");
      var open = button(r, "打开输出目录");
      open.addEventListener("click", function () { fire("onOpenOutputDir"); });
      var run = button(r, "只执行导出");
      run.addEventListener("click", function () { fire("onRunModule", "export"); });
      s.appendChild(r);
    }

    function buildPresets() {
      var s = sec("预设");
      var row = el("div", "row row-actions");
      var exp = button(row, "导出预设");
      exp.addEventListener("click", function () { fire("onExportPresets"); });
      var imp = button(row, "导入预设");
      imp.addEventListener("click", function () { fire("onImportPresets"); });
      s.appendChild(row);
      presetBox = document.createElement("textarea");
      presetBox.className = "preset-text";
      presetBox.placeholder = "导出后这里会显示 JSON；导入时把 JSON 粘贴到这里再点「导入预设」。";
      reg(presetBox);
      s.appendChild(presetBox);
    }

    function buildLog() {
      var s = sec("日志");
      logPathText = el("div", "out-dir", "日志文件：日志落盘不可用");
      s.appendChild(logPathText);
      logBody = el("div", "log-body");
      s.appendChild(logBody);
      var row = el("div", "row row-actions");
      var clr = button(row, "清空日志", true);
      clr.addEventListener("click", function () {
        while (logBody.firstChild) logBody.removeChild(logBody.firstChild);
      });
      // 只读探针（摆正）：只写日志、不改画面（后续「一键摆正」的取证前置）
      var probe = button(row, "探针（只读）", true);
      probe.title = "只读探针：取像素 → 数学分析 → 探测事件名可用性；只写日志，不改画面";
      probe.addEventListener("click", function () { fire("onRunProbe"); });
      s.appendChild(row);
    }

    function buildColorGrid() {
      if (!colorGrid) return;
      while (colorGrid.firstChild) colorGrid.removeChild(colorGrid.firstChild);
      var colors = state.colors || [];
      for (var i = 0; i < colors.length; i++) {
        (function (c) {
          var b = el("button", "swatch");
          b.style.backgroundColor = c.hex;
          b.title = c.name + " " + c.hex;
          if (c.id === state.selectedColorId) b.className = "swatch swatch-selected";
          b.addEventListener("click", function () {
            fire("onStateChange", { selectedColorId: c.id, customHex: null });
          });
          reg(b);
          colorGrid.appendChild(b);
        })(colors[i]);
      }
    }

    function buildSizeList() {
      if (!sizeList) return;
      while (sizeList.firstChild) sizeList.removeChild(sizeList.firstChild);
      var sizes = state.sizes || [];
      if (!sizes.length) {
        sizeList.appendChild(el("div", "hint", "没有尺寸预设，请先新增一个。"));
        return;
      }
      for (var i = 0; i < sizes.length; i++) {
        (function (s) {
          var row = el("div", "size-row");
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!s.enabled;
          cb.addEventListener("change", function () {
            var next = [];
            for (var k = 0; k < state.sizes.length; k++) {
              var item = state.sizes[k];
              next.push({ id: item.id, w: item.w, h: item.h, label: item.label, enabled: item.id === s.id ? !!cb.checked : !!item.enabled, builtin: item.builtin });
            }
            fire("onStateChange", { sizes: next });
          });
          reg(cb);
          row.appendChild(cb);
          row.appendChild(el("span", "size-label" + (s.enabled ? "" : " size-label-off"), s.label + "  " + s.w + "×" + s.h));
          var del = el("button", "btn btn-small btn-danger", "×");
          del.title = s.builtin ? "内置尺寸不可删除" : "删除该尺寸";
          del.disabled = !!s.builtin;
          del.addEventListener("click", function () { fire("onRemoveSize", s.id); });
          interactive.push(del);
          row.appendChild(del);
          sizeList.appendChild(row);
        })(sizes[i]);
      }
    }

    function setAdjustRow(key, item, r) {
      var range = r.range, num = r.num, tag = r.tag;
      r.cb.checked = !!item.enabled;
      r.mode.value = item.auto ? "auto" : "manual";
      var autoKnown = autoValues && autoValues[key] !== undefined && autoValues[key] !== null;
      var shown = item.auto ? (autoKnown ? autoValues[key] : item.value) : item.value;
      var suffix, cls;
      if (item.auto && !autoKnown) {
        // 统计失败时不能只显示 0：用户会把「没算出来」当成「算出来就是 0」
        suffix = (analysisAttempted && !analysis) ? " (不可用)" : " (待统计)";
        cls = "adj-num";
      } else if (item.auto) {
        suffix = " (自动)";
        cls = "adj-num adj-num-auto";
      } else {
        suffix = "";
        cls = "adj-num";
      }
      num.node.className = cls;
      num.set(round2(shown));   // 程序化同步：不触发 commit，也不会把自动项变成手动
      tag.textContent = suffix;
      range.min = item.min;
      range.max = item.max;
      range.value = shown;
    }

    function buildAdjustRows() {
      if (!adjustBody) return;
      while (adjustBody.firstChild) adjustBody.removeChild(adjustBody.firstChild);
      adjustRows = {};
      var order = (state.adjust && state.adjust.order) ? state.adjust.order : FALLBACK_ORDER;
      for (var i = 0; i < order.length; i++) {
        (function (key) {
          var item = state.adjust.items[key];
          if (!item) return;
          var row = el("div", "adj-row");
          var cb = document.createElement("input");
          cb.type = "checkbox";
          cb.checked = !!item.enabled;
          cb.title = "启用该调色项";
          cb.addEventListener("change", function () {
            fire("onStateChange", patchAdjust(key, { enabled: !!cb.checked }));
          });
          reg(cb);
          row.appendChild(cb);
          row.appendChild(el("span", "adj-name", ADJUST_LABELS[key] || key));

          var mode = document.createElement("select");
          mode.className = "adj-mode";
          var oa = el("option", "", "自动");
          oa.value = "auto";
          var om = el("option", "", "手动");
          om.value = "manual";
          mode.appendChild(oa);
          mode.appendChild(om);
          mode.value = item.auto ? "auto" : "manual";
          mode.addEventListener("change", function () {
            fire("onStateChange", patchAdjust(key, { auto: mode.value === "auto" }));
          });
          reg(mode);
          row.appendChild(mode);

          var range = document.createElement("input");
          range.type = "range";
          range.className = "adj-range";
          range.min = item.min;
          range.max = item.max;
          range.step = ADJUST_STEP[key] || 1;
          range.value = item.value;
          // ★ 用户 m03453：数字也做成可输入的小框（拖滑条＝手动；直接输数字同样算手动值）
          var tag = el("span", "adj-tag", "");
          var num = numBox("adj-num", item.min, item.max, ADJUST_STEP[key] || 1,
            "可直接输入数值；回车或失焦生效（算作手动值）");
          num.set(round2(item.value));
          num.commit = function (v) {
            num.node.className = "adj-num";
            tag.textContent = " (手动)";
            fire("onStateChange", patchAdjust(key, { auto: false, value: v }));
          };
          num.rollback = function () { num.set(Number(range.value)); };
          range.addEventListener("input", function () {
            num.node.className = "adj-num";
            num.set(round2(Number(range.value)));
            tag.textContent = " (手动)";
          });
          range.addEventListener("change", function () {
            fire("onStateChange", patchAdjust(key, { auto: false, value: Number(range.value) }));
          });
          reg(range);
          reg(num.node);
          row.appendChild(range);
          row.appendChild(num.node);
          row.appendChild(tag);
          adjustBody.appendChild(row);

          adjustRows[key] = { row: row, cb: cb, mode: mode, range: range, num: num, tag: tag };

          if (key === "noise") {
            adjustBody.appendChild(el("div", "hint", "降噪算法是「蒙尘与划痕」（dustAndScratches），不是 PS 的「减少杂色」——两者观感不同，请以此为准。"));
          }
        })(order[i]);
      }
    }

    function syncAdjustRows() {
      var order = (state.adjust && state.adjust.order) ? state.adjust.order : FALLBACK_ORDER;
      var sig = order.join("|");
      if (sig !== adjustSig) {
        adjustSig = sig;
        buildAdjustRows();
        return;
      }
      for (var i = 0; i < order.length; i++) {
        var key = order[i];
        var r = adjustRows[key];
        var item = state.adjust.items[key];
        if (!r || !item) continue;
        setAdjustRow(key, item, r);
      }
    }

    function updateStats() {
      if (!statsLine) return;
      var failed = analysisAttempted && !analysis;
      if (adjustWarn) {
        adjustWarn.textContent = "未取得主体统计 —— 只要有启用的自动项，本次调色会被拒绝、不会改动画面；请查看日志（面板 + 调试日志文件）里的失败原文";
        adjustWarn.style.display = (failed && state.moduleEnabled.adjust) ? "" : "none";
      }
      if (!analysis) {
        statsLine.textContent = failed
          ? "主体统计：未取得（失败；有启用的自动项时调色会被拒绝，未改动画面）"
          : "主体统计：未采集（执行「调色」时会自动统计；未抠图时统计整幅图）";
        return;
      }
      var a = analysis;
      var scope = a.scope === "subject" ? "主体" : "全图（未抠图）";
      statsLine.textContent = "主体统计[" + scope + "] 均值 " + toHex(a.meanR, a.meanG, a.meanB) +
        " · 亮度 " + round2((a.meanLuma || 0) * 100) + "%" +
        " · 饱和度 " + round2(a.meanSat || 0) +
        " · 色偏 R-G " + signed(a.castRG || 0) + " / B-G " + signed(a.castBG || 0) +
        " · 明暗范围 " + round2(a.dynamicRange || 0);
    }

    function computeAuto() {
      autoValues = {};
      if (!analysis) return;
      var m = window.Ecom && window.Ecom.adjust;
      if (!m || typeof m.computeAuto !== "function") return;
      try {
        var r = m.computeAuto(analysis, (state.adjust && state.adjust.order) || FALLBACK_ORDER);
        if (r && typeof r === "object") autoValues = r;
      } catch (e) {
        // 自动值只是显示提示，算不出来不影响手动滑杆
      }
    }

    function refreshAll() {
      if (!rootEl) return;
      var scrollTop = rootEl.scrollTop;

      if (inner.cbCutout) inner.cbCutout.checked = !!state.moduleEnabled.cutout;
      if (inner.cbAutoMask) inner.cbAutoMask.checked = state.cutout ? state.cutout.autoMask !== false : true;
      if (inner.cbRefine) inner.cbRefine.checked = !!state.moduleEnabled.refine;
      if (inner.cbStraighten) inner.cbStraighten.checked = !!state.moduleEnabled.straighten;
      if (inner.cbAutoExport) inner.cbAutoExport.checked = state.moduleEnabled.export !== false;
      if (inner.cbShadow) inner.cbShadow.checked = !!state.moduleEnabled.shadow;
      if (inner.cbCenter) inner.cbCenter.checked = state.compose ? state.compose.center !== false : true;

      if (featherRange) {
        featherRange.set(state.edge.feather);
      }
      if (inner.angRotate) {
        inner.angRotate.set((state.straighten && typeof state.straighten.manualAngleDeg === "number")
          ? state.straighten.manualAngleDeg : 1);
      }
      if (contractInput) contractInput.value = state.edge.contract;

      buildColorGrid();
      if (hexInput) hexInput.value = effectiveHex();
      if (btnDelColor) {
        var cur = currentColor();
        var builtin = !cur || window.Ecom.store.isBuiltinColor(cur);
        btnDelColor.disabled = busy || builtin;
        btnDelColor.title = builtin ? "内置色板不可删除" : "删除当前选中的色板";
      }

      if (shadowRefs.opacity) {
        shadowRefs.opacity.set(state.shadow.opacity);
      }
      if (shadowRefs.blur) {
        shadowRefs.blur.set(state.shadow.blur);
      }
      if (shadowRefs.offsetY) {
        shadowRefs.offsetY.set(state.shadow.offsetY);
      }

      updateStats();
      syncAdjustRows();

      buildSizeList();
      if (marginRange) {
        marginRange.set(state.marginPercent);
      }
      if (baseHint) {
        baseHint.textContent = "基准画布：" + baseSizeOf(state) + "px（勾选尺寸中最大者；留白比例相对它计算）";
      }

      if (formatSelect) formatSelect.value = state.export.format;
      if (qualityRange) {
        qualityRange.set(state.export.quality);
        var isPng = state.export.format === "png";
        qualityRange.node.disabled = busy || isPng;
      }
      if (cbOverwrite) cbOverwrite.checked = state.export.overwrite === true;
      if (outDirInput) outDirInput.value = state.export.outputDir ? String(state.export.outputDir) : "";
      if (outDirText) {
        outDirText.textContent = state.export.outputDir
          ? "输出目录：" + state.export.outputDir
          : "输出目录：未设置 → 导出到原图同一目录，文件名「原名-ps-N」";
      }

      rootEl.scrollTop = scrollTop;
    }

    var apiObj = {
      refresh: function (next) {
        if (next) state = next;
        refreshAll();
      },
      setBusy: function (flag, label) {
        busy = !!flag;
        interactive = interactive.filter(function (n) { return !!n.parentNode; });
        for (var i = 0; i < interactive.length; i++) {
          var n = interactive[i];
          if (busy) {
            n.__prevDisabled = !!n.disabled;
            n.disabled = true;
          } else {
            n.disabled = n.__prevDisabled === true;
            n.__prevDisabled = false;
          }
        }
        if (statusText) statusText.textContent = busy ? (label || "处理中…") : "就绪";
        if (rootEl) rootEl.className = busy ? "panel panel-busy" : "panel";
        if (!busy) refreshAll();
      },
      setLog: setLog,
      setAnalysis: function (data) {
        analysisAttempted = true;
        analysis = data || null;
        computeAuto();
        updateStats();
        syncAdjustRows();
      },
      // 调试日志文件路径：3P 插件的 console.log 不进 UXPLogs_*.log，
      // 用户需要知道去哪儿取错误原文（传 null 表示落盘不可用）
      setLogPath: function (p) {
        var path = (typeof p === "string" && p.replace(/\s+/g, "") !== "") ? p : null;
        if (!logPathText) return;
        logPathText.textContent = path
          ? "日志文件：" + path
          : "日志文件：日志落盘不可用（错误原文只在下方面板日志里）";
      },
      getPresetText: function () {
        return presetBox ? String(presetBox.value || "") : "";
      },
      setPresetText: function (text) {
        if (presetBox) presetBox.value = text === undefined || text === null ? "" : String(text);
      }
    };

    build();
    refreshAll();

    try {
      if (window.Ecom.ps && typeof window.Ecom.ps.setLogSink === "function") {
        window.Ecom.ps.setLogSink(function (level, text) {
          setLog({ time: nowTime(), level: level || "info", text: text });
        });
      }
    } catch (e) { }

    return apiObj;
  }

  var ui = {
    mount: function (opts) {
      current = createInstance(opts);
      return current;
    },
    refresh: function (s) { if (current) current.refresh(s); },
    setBusy: function (b, l) { if (current) current.setBusy(b, l); },
    setLog: function (e) { if (current) current.setLog(e); },
    setAnalysis: function (d) { if (current) current.setAnalysis(d); },
    setLogPath: function (p) { if (current) current.setLogPath(p); },
    getPresetText: function () { return current ? current.getPresetText() : ""; },
    setPresetText: function (t) { if (current) current.setPresetText(t); }
  };

  window.Ecom.ui = ui;
})();
