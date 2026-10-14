window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  var state = null;
  var snapshotToken = null;
  var busy = false;
  var api = null;

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

  // 缺陷 #14：3P 插件的 console.log 不进 UXPLogs（真机实测 com.ecom.psimage 命中 0），编排层的失败原文
  // 只活在面板里 —— 用户关掉面板就永久丢失。故每一行都无条件转写进插件调试日志 ecom-debug.log。
  // ★ 转发方式：整体委托给 Ecom.ps.log。它内部已经 panelLog(...)（转发到 ui.mount 注册的 sink）
  //   + 落盘（ps.js:198-206），所以这里【不再】直接调 api.setLog —— 否则同一行会在面板出现两次。
  function log(level, text) {
    var psMod = mod("ps");
    if (psMod && typeof psMod.log === "function") {
      try {
        psMod.log(level, text);
        return;
      } catch (ePsLog) { /* ps.log 自身出错时退回面板/console，绝不让日志把主流程带崩 */ }
    }
    var target = api || (window.Ecom && window.Ecom.ui);
    if (target && typeof target.setLog === "function") {
      target.setLog({ time: nowTime(), level: level, text: text });
      return;
    }
    try {
      if (typeof console !== "undefined" && console.log) console.log("[" + level + "] " + text);
    } catch (e) { }
  }

  function mod(name) {
    var m = window.Ecom && window.Ecom[name];
    return m && typeof m === "object" ? m : null;
  }

  async function call(fn) {
    try {
      var res = await fn();
      if (!res || typeof res !== "object") return { ok: false, error: "模块未返回统一信封对象" };
      if (res.ok === undefined) return { ok: false, error: "模块返回缺少 ok 字段" };
      return res;
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  }

  function require3(name, fn) {
    var m = mod(name);
    if (!m || typeof m[fn] !== "function") return { ok: false, error: "模块未加载：Ecom." + name + "." + fn };
    return null;
  }

  function round3(v) {
    return Math.round(Number(v) * 1000) / 1000;
  }

  function effectiveHex() {
    if (typeof state.customHex === "string" && /^#[0-9A-Fa-f]{6}$/.test(state.customHex)) return state.customHex.toUpperCase();
    var colors = state.colors || [];
    for (var i = 0; i < colors.length; i++) {
      if (colors[i].id === state.selectedColorId) return String(colors[i].hex).toUpperCase();
    }
    return colors.length ? String(colors[0].hex).toUpperCase() : "#FFFFFF";
  }

  function baseSizeOf(s) {
    var sizes = s.sizes || [];
    for (var i = 0; i < sizes.length; i++) {
      if (sizes[i].id === s.baseSizeId) return sizes[i].w;
    }
    var max = 0;
    for (var j = 0; j < sizes.length; j++) {
      if (sizes[j].enabled && sizes[j].w > max) max = sizes[j].w;
    }
    return max || 1600;
  }

  function enabledSizes() {
    var out = [];
    var sizes = state.sizes || [];
    for (var i = 0; i < sizes.length; i++) {
      if (sizes[i].enabled) out.push({ w: sizes[i].w, h: sizes[i].h, label: sizes[i].label });
    }
    return out;
  }

  function activeLayerId() {
    try {
      var r = window.Ecom.ps && typeof window.Ecom.ps.require === "function" ? window.Ecom.ps.require() : null;
      var app = r && r.app;
      var doc = app && app.activeDocument;
      var layers = doc && doc.activeLayers;
      if (layers && layers.length) return layers[0].id;
    } catch (e) {
      log("warn", "读取当前图层 id 失败：" + errText(e));
    }
    return null;
  }

  // ★ 真机事故（09:32:43）：同一次一键里，抠图建好的蒙版落在图层「背景」，紧接着接地投影却按图层顺序
  //   选了「图层 0」(id=3) —— 各步骤各自解析主体层，选到的不是同一个图层，用户看到的效果就是
  //   「抠了图但蒙版好像没应用」。现在这一次流程只解析一次，抠图/边缘净化/投影/构图全部复用同一个 id。
  var runSubject = null;
  async function resolveRunSubject() {
    if (runSubject) return runSubject;
    var r = null;
    try {
      r = await window.Ecom.ps.findSubjectLayer({});
    } catch (e) {
      log("warn", "主体层解析抛错：" + errText(e));
    }
    if (r && r.ok && r.data && typeof r.data.id === "number") {
      runSubject = { id: r.data.id, name: r.data.name || "?", kind: r.data.kind || "?" };
      log("info", "主体层锁定：「" + runSubject.name + "」(id=" + runSubject.id + "，kind=" + runSubject.kind + ") —— 抠图/边缘净化/投影/构图本轮流用这一层");
      return runSubject;
    }
    var fb = activeLayerId();
    runSubject = { id: fb, name: "?", kind: "?" };
    log("warn", "主体层解析失败" + (r && r.error ? "（" + r.error + "）" : "") + "，退回当前图层 id=" + fb);
    return runSubject;
  }
  function forgetRunSubject() { runSubject = null; }

  // 排查用：把顶层图层的 id/名称/类型/可见性一次写进日志 —— 「主体是哪个图层」不该每轮靠猜
  //（09:32 那次正因两个步骤选到不同图层，从单条日志里根本看不出来）。
  function logLayerInventory() {
    try {
      var r = window.Ecom.ps && typeof window.Ecom.ps.require === "function" ? window.Ecom.ps.require() : null;
      var doc = r && r.app && r.app.activeDocument;
      var layers = (doc && doc.layers) || [];
      var parts = [];
      for (var i = 0; i < layers.length && i < 12; i++) {
        var l = layers[i];
        parts.push("「" + (l.name || "?") + "」id=" + l.id + " kind=" + (l.kind || "?") + (l.visible === false ? "(隐藏)" : ""));
      }
      log("info", "[图层清单] 顶层 " + layers.length + " 个：" + (parts.length ? parts.join(" / ") : "（空）"));
    } catch (e) {
      log("warn", "[图层清单] 读取失败：" + errText(e));
    }
  }

  // ★ 真机事实（09:22/09:32 日志）：removeBackground 是延迟命令，PS 随后会忙十几秒，
  //   抠图后立刻回读蒙版必然被拒（命令"获取"当前不可用）→ 面板只能显示「待确认」，
  //   用户看到的就是「显示已应用、其实没有蒙版」。流程跑到收尾已经过去好几秒，
  //   再回读一次就能把「待确认」升级成确定结论 —— 这一步只为人看，不改变流程成败。
  async function verifyMaskAtEnd() {
    var subj = runSubject;
    if (!subj || typeof subj.id !== "number") return;
    var r = await call(function () { return window.Ecom.ps.getUserMaskCoverage(subj.id, 4000); });
    if (!r.ok) {
      log("warn", "[蒙版核对] 读不到（" + r.error + "）→ 请直接看图层面板「" + subj.name + "」的蒙版缩览图");
      return;
    }
    var d = r.data || {};
    var covTxt = (d.coverage === null || d.coverage === undefined) ? "未知" : (Math.round(Number(d.coverage) * 1000) / 10 + "%");
    var maskTxt = d.hasMask === true ? "有" : (d.verdictUncertain ? "读不到（PS 仍忙）" : "无");
    log(d.hasMask === true ? "info" : "warn",
      "[蒙版核对] 图层「" + subj.name + "」id=" + subj.id + " 蒙版=" + maskTxt + " 非零占比=" + covTxt);
  }

  function summarize(key, res) {
    var d = (res && res.data) || {};
    if (key === "cutout") {
      if (d.applyMaskStep === true) {
        if (d.applied) return "已应用图层蒙版（烘焙进像素：蒙版缩览图消失，主体外为真透明）";
        if (d.reason === "failed") return "烘焙失败（已跳过，流程继续；可在 PS 里手动「图层>图层蒙版>应用」）：" + (d.error || "");
        return "未烘焙（" + (d.reason === "no-mask" ? "该图层没有蒙版" : "抠图区未勾选「应用图层蒙版」") + "）";
      }
      // ★ 第 7 轮（用户 m02731）：主结论改看「主体像素 alpha」这个硬证据；蒙版状态读不稳就不当主结论。
      //   alphaCoverage===null 是「量不出来」，不是 0%（旧写法 Number(null)||0 会显示成 0%）。
      var alphaTxt = (typeof d.alphaCoverage === "number")
        ? (Math.round(Number(d.alphaCoverage) * 1000) / 10 + "%")
        : "未测出";
      var t2 = "图层「" + (d.layerName || "?") + "」已抠图（主体像素占比 " + alphaTxt + (d.alphaSource === "mask" ? "，按蒙版像素" : "") + "）";
      if (d.maskVerified) t2 += "；蒙版=" + (d.maskApplied === false ? "已建好但已停用" : "已应用");
      else t2 += "；蒙版状态未能回读确认（不影响抠图结果）";
      t2 += "；method=" + (d.method || "?") + (d.usedFallback ? "（含回退）" : "");
      return t2;
    }
    if (key === "refine") {
      return "羽化=" + d.feather + "px 已应用=" + (d.applied ? "是" : "否") + " 原有蒙版=" + (d.hadMask ? "是" : "否");
    }
    if (key === "backdrop" || key === "shadow") {
      return "图层「" + (d.layerName || "?") + "」 id=" + d.layerId;
    }
    if (key === "adjust") {
      var applied = (d.applied || []).length;
      var skipped = (d.skipped || []).length;
      var failed = (d.failureDetail || []).length;
      var text = "已应用 " + applied + " 项 / 跳过 " + skipped + " 项 / 失败 " + failed + " 项";
      if (failed) text += "；首个失败：" + d.failureDetail[0].key + " → " + d.failureDetail[0].error;
      // 用户口径（m02477）：调色只作用于选中的主体层 —— 面板必须能看出剪贴成没成
      text += d.clipToSubject ? "；已剪贴到主体层（只影响主体）" : "；未剪贴（会影响主体下方所有图层）";
      if (d.clipNote) text += "：" + d.clipNote;
      return text;
    }
    if (key === "compose") {
      var moved = d.movedTo || {};
      return "基准=" + d.baseSize + " 主体=" + d.subjectPx + "px 缩放=" + round3(d.scale) +
        " 位移=(" + moved.x + "," + moved.y + ")";
    }
    if (key === "export") {
      var files = (d.files || []).length;
      var failures = (d.failures || []).length;
      var t = "目录=" + (d.outputDir || "?") + " 命名=" + (d.naming || "?") + " 成功=" + files + " 个 失败=" + failures + " 个";
      if (failures) t += "；首个失败：" + (d.failures[0].size || "?") + " → " + d.failures[0].error;
      return t;
    }
    return "完成";
  }

  function composeCenter() {
    // v3：center 默认开。store.load() 已为老存档补出 compose，这里再兜一层，
    // 万一 state 被改坏也只是退回默认值，不让整个面板抛异常。
    return !(state.compose && state.compose.center === false);
  }

  // v6：抠图后是否自动应用蒙版（默认开）。同上兜一层，老存档 / state 被改坏都退回默认。
  function cutoutAutoMask() {
    return !(state.cutout && state.cutout.autoMask === false);
  }

  function setLogPathSafe(p) {
    if (api && typeof api.setLogPath === "function") api.setLogPath(p);
  }

  // 面板日志区显示调试日志文件路径：3P 插件的 console.log 不进 UXPLogs_*.log，
  // 用户关掉面板后错误原文只剩这个文件，必须让他知道去哪儿取。
  function initLogPath() {
    var psMod = mod("ps");
    if (!psMod || typeof psMod.logFilePath !== "function") {
      setLogPathSafe(null);
      return;
    }
    call(function () { return psMod.logFilePath(); }).then(function (res) {
      var p = res.ok && res.data ? res.data.path : null;
      var ok = typeof p === "string" && p.replace(/\s+/g, "") !== "";
      setLogPathSafe(ok ? p : null);
      if (!ok) log("warn", "[日志] 未取到落盘路径：" + (res.error || "模块未返回 path"));
    }).catch(function (e) {
      setLogPathSafe(null);
      log("warn", "[日志] 取落盘路径异常：" + errText(e));
    });
  }

  async function stepCutout() {
    var miss = require3("cutout", "remove");
    if (miss) return miss;
    var subj = await resolveRunSubject();
    var res = await call(function () {
      return window.Ecom.cutout.remove({
        contract: state.edge.contract,
        feather: state.edge.feather,
        autoMask: cutoutAutoMask(),
        subjectLayerId: subj.id,
        subjectLayerName: subj.name,
        subjectLayerKind: subj.kind
      });
    });
    // ★ 真机 13:56:01 定案：抠图链里的 rasterizeLayer 会给图层换 id（「背景」id=1 → 「图层 0」id=2），
    //   cutout.remove() 内部已改用新 id，但编排层的 runSubject 还抱着旧 id —— 紧接着的边缘净化于是拿
    //   id=1 + 名字「背景」（PS 已改名「图层 0」）去读蒙版，自愈也无从下手，全报 Unknown layer。
    //   ⇒ 抠图一结束就把编排层的主体换成抠图回报的那一层，后续步骤（边缘净化/投影/构图）才对得上。
    try {
      if (res && res.ok && res.data && typeof res.data.layerId === "number" && res.data.layerId !== subj.id) {
        log("warn", "抠图后主体换了图层：编排层锁定 id " + subj.id + "（「" + subj.name + "」）→ id " + res.data.layerId +
          "（「" + (res.data.layerName || "?") + "」）→ 后续步骤改用新图层");
        runSubject = { id: res.data.layerId, name: res.data.layerName || subj.name, kind: subj.kind };
      }
    } catch (e) { log("warn", "采纳抠图后的新主体失败（后续步骤可能仍用旧 id）：" + errText(e)); }
    return res;
  }

  async function stepRefine() {
    var miss = require3("cutout", "refine");
    if (miss) return miss;
    var subj = await resolveRunSubject();
    return await call(function () {
      return window.Ecom.cutout.refine({
        feather: state.edge.feather,
        subjectLayerId: subj.id,
        subjectLayerName: subj.name,
        subjectLayerKind: subj.kind
      });
    });
  }

  async function stepBackdrop() {
    var miss = require3("backdrop", "setSolid");
    if (miss) return miss;
    return await call(function () {
      return window.Ecom.backdrop.setSolid({ hex: effectiveHex() });
    });
  }

  // ★ 真机事故（09:22:14）：一键流程里 backdrop 刚建好纯色「背景」填充层（它自动成为当前图层），
  //   紧接着 stepShadow 用 activeLayerId() 取到的是【背景层 id=4】→ dropShadow 被加到背景层上，
  //   日志原文「阴影：主体层 id=4 已设 dropShadow」；而用户单独点这一步（当前图层是主体）时是 id=3。
  //   投影必须打在主体上：从文档顶层往下找第一个既不是组、也不是纯色填充层的图层。
  function shadowSubjectId() {
    try {
      var r = window.Ecom.ps && typeof window.Ecom.ps.require === "function" ? window.Ecom.ps.require() : null;
      var app = r && r.app;
      var doc = app && app.activeDocument;
      var layers = doc && doc.layers;
      if (layers && layers.length) {
        for (var i = 0; i < layers.length; i++) {
          var l = layers[i];
          if (!l) continue;
          var kind = l.kind === undefined || l.kind === null ? "" : String(l.kind);
          if (kind === "group" || kind === "solidColor" || kind === "solid") continue;
          if (typeof l.id === "number") {
            log("info", "投影目标：按图层顺序选到「" + (l.name || "?") + "」(id=" + l.id + "，kind=" + kind + ")");
            return l.id;
          }
        }
      }
    } catch (e) {
      log("warn", "按图层顺序找主体层失败，退回当前图层：" + errText(e));
    }
    return activeLayerId();
  }

  async function stepShadow() {
    var miss = require3("backdrop", "addShadow");
    if (miss) return miss;
    var subj = await resolveRunSubject();
    var id = (subj && typeof subj.id === "number") ? subj.id : shadowSubjectId();
    log("info", "投影目标：图层「" + (subj && subj.name ? subj.name : "?") + "」id=" + id + "（本次流程锁定的主体层）");
    if (id === null) return { ok: false, error: "取不到当前图层 id，无法生成投影（app.activeDocument.activeLayers 为空）" };
    return await call(function () {
      return window.Ecom.backdrop.addShadow({
        opacity: state.shadow.opacity,
        blur: state.shadow.blur,
        offsetY: state.shadow.offsetY,
        color: state.shadow.color,
        subjectLayerId: id
      });
    });
  }

  // 纯函数（无副作用，便于 node 单测）：是否存在至少一个 enabled === true 且 auto === true 的项。
  // 用途：analysis 落空时，只有「全是手动值」才允许继续；只要还剩启用中的自动项，
  // computeAuto(null) 就会按契约把 8 项全部返回 0，套用出去等于图没变却报成功。
  function hasEnabledAutoItem(items) {
    if (!items || typeof items !== "object") return false;
    for (var k in items) {
      var it = items[k];
      if (it && it.enabled === true && it.auto === true) return true;
    }
    return false;
  }

  async function stepAdjust() {
    var analysis = null;
    var failText = null;
    if (mod("analyze") && typeof window.Ecom.analyze.subject === "function") {
      var an = await call(function () { return window.Ecom.analyze.subject(); });
      if (an.ok) {
        // ★ 空值必须归一成 null：undefined 会绕过下面的拒绝判定，又退化回「静默套用全 0」
        analysis = an.data || null;
        if (analysis === null) failText = "主体统计模块返回了空结果";
      } else {
        failText = an.error;
      }
    } else {
      failText = "模块未加载 Ecom.analyze.subject";
    }
    api.setAnalysis(analysis);
    if (analysis === null && hasEnabledAutoItem(state.adjust && state.adjust.items)) {
      // 缺陷 #11：静默套用全 0 比直接拒绝更坏 —— 用户看到「调色完成…失败 0 项」却完全没变。
      // 这里不调用 adjust.apply，失败原文随 error 一起交给编排层落盘（面板 + ecom-debug.log）。
      return { ok: false, error: "主体统计失败，自动调色无法计算：" + (failText || "未取得统计值") };
    }
    if (analysis === null) {
      // 全是手动值：可以照常应用，但统计失败这件事仍要留痕
      log("error", "[调色] 主体统计失败（当前没有启用中的自动项，按手动值继续）；失败原文：" + (failText || "未取得统计值"));
    }
    var miss = require3("adjust", "apply");
    if (miss) return miss;
    return await call(function () {
      return window.Ecom.adjust.apply({
        items: state.adjust.items,
        analysis: analysis,
        subjectLayerId: subjIdForWait(),
        subjectLayerName: (runSubject && runSubject.name) || null
      });
    });
  }

  async function stepCompose() {
    var miss = require3("compose", "normalize");
    if (miss) return miss;
    return await call(function () {
      return window.Ecom.compose.normalize({
        baseSize: baseSizeOf(state),
        marginPercent: state.marginPercent,
        // 不能按名排除「背景」：PS 中文版把单层图片的像素层默认命名为「背景」，会误伤用户的画面层；
        // 插件自建的背景层是 solidColor，已被 compose 内部的 kind 过滤挡掉。
        excludeLayerNames: ["阴影"],
        center: composeCenter()
      });
    });
  }

  async function stepExport() {
    var miss = require3("export", "run");
    if (miss) return miss;
    var sizes = enabledSizes();
    if (!sizes.length) return { ok: false, error: "没有勾选任何导出尺寸，请先在「尺寸」区勾选至少一项" };
    return await call(async function () {
      var res = await window.Ecom.export.run({
        sizes: sizes,
        quality: state.export.quality,
        format: state.export.format,
        outputDir: state.export.outputDir,
        overwrite: state.export.overwrite === true
      });
      // ★ 第 10 轮（用户 m03326「打开输出目录无法打开文件夹」）：未设置输出目录时面板根本不知道落在哪。
      //   导出结果里带着真实目录 → 记下来（持久化），供「打开输出目录」使用。
      if (res && res.ok && res.data && res.data.outputDir) {
        state.export.lastDir = String(res.data.outputDir);
        window.Ecom.store.save(state);
      }
      return res;
    });
  }

  // ★ 用户 m03873：抠图/边缘净化建的蒙版最后【烘焙进像素】（PS 的 图层>图层蒙版>应用）。
  //   放在「边缘净化」之后：羽化改的是蒙版，先烘焙羽化就没对象了。
  //   开关沿用「抠图」区的勾选框（state.cutout.autoMask），key 用 cutout 以便跟抠图模块一起被跳过。
  async function stepApplyMask() {
    var miss = require3("cutout", "applyMask");
    if (miss) return miss;
    if (!cutoutAutoMask()) {
      log("info", "应用蒙版：抠图区未勾选「应用图层蒙版」→ 保留可编辑蒙版，跳过烘焙");
      return { ok: true, data: { applyMaskStep: true, applied: false, reason: "disabled-by-setting" } };
    }
    var subj = await resolveRunSubject();
    var res = await call(function () {
      return window.Ecom.cutout.applyMask({
        subjectLayerId: subj.id,
        subjectLayerName: subj.name,
        subjectLayerKind: subj.kind
      });
    });
    // ★ 真机教训（14:33）：烘焙失败不该掐死整条一键流程 —— 蒙版还在、图照样能用，只是没烘焙。
    //   ⇒ warn + 继续，面板写「烘焙失败（流程继续）」，用户可手动「图层>图层蒙版>应用」。
    if (res && res.ok === false) {
      log("warn", "应用蒙版失败（不中断流程，继续后续步骤）：" + (res.error || ""));
      return { ok: true, data: { applyMaskStep: true, applied: false, reason: "failed", error: String(res.error || ""), layerId: subj.id } };
    }
    return res;
  }

  var FLOW = [
    { key: "cutout", label: "抠图", run: stepCutout },
    { key: "refine", label: "边缘净化", run: stepRefine },
    { key: "cutout", label: "应用蒙版", run: stepApplyMask },
    { key: "backdrop", label: "背景", run: stepBackdrop },
    { key: "shadow", label: "接地投影", run: stepShadow },
    { key: "adjust", label: "调色", run: stepAdjust },
    { key: "compose", label: "尺寸构图", run: stepCompose },
    { key: "export", label: "导出", run: stepExport }
  ];

  function flowEntry(key) {
    for (var i = 0; i < FLOW.length; i++) if (FLOW[i].key === key) return FLOW[i];
    return null;
  }

  function mergeState(patch) {
    var next = {};
    var k;
    for (k in state) next[k] = state[k];
    for (k in patch) next[k] = patch[k];
    state = next;
    window.Ecom.store.save(state);
    api.refresh(state);
  }

  function setState(next) {
    state = next;
    window.Ecom.store.save(state);
    api.refresh(state);
  }

  // 等宿主空闲时用当前锁定的主体层 id 当探针对象（探针只要求「整层 get 能成功」，与图层本身无关）
  function subjIdForWait() {
    return (runSubject && typeof runSubject.id === "number") ? runSubject.id : null;
  }

  async function onRunAll() {
    if (busy) return;
    busy = true;
    api.setBusy(true, "一键生成全部：执行中…");
    try {
      log("info", "=== 一键全流程开始 ===");
      forgetRunSubject();
      logLayerInventory();
      // 若上一次流程刚跑过抠图，PS 可能仍在忙（延迟命令）→ 先等宿主空闲。
      // 不这样做的话连「回退快照」都会记不上（用户日志里就出现过「没有可用的回退快照」）。
      var preIdle = await call(function () { return window.Ecom.ps.waitHostIdle(null, 30000); });
      if (!preIdle.ok) {
        log("warn", "[等待] Photoshop 尚在忙（" + preIdle.error + "）→ 继续执行；若本步失败，请稍等几秒再重试");
      } else if (preIdle.data && preIdle.data.waitedMs > 0) {
        log("info", "[等待] ok · 等上一次运算结束用了 " + preIdle.data.waitedMs + "ms");
      }
      if (!enabledSizes().length) {
        log("error", "没有勾选任何导出尺寸，已停止。请在「尺寸」区勾选至少一项。");
        return;
      }
      var snap = await call(function () { return window.Ecom.ps.snapshot(); });
      if (snap.ok) {
        snapshotToken = snap.data && snap.data.token;
        log("info", "[快照] ok · 回退点已记录（第 1 步之前）");
      } else {
        snapshotToken = null;
        log("warn", "[快照] fail · 回退功能本次不可用：" + snap.error);
      }
      for (var i = 0; i < FLOW.length; i++) {
        var step = FLOW[i];
        if (!state.moduleEnabled[step.key]) {
          // 用户 m03712：「有时候我还想看看效果再导出」→ 导出这步的跳过要说清去哪儿手动导。
          if (step.key === "export") {
            log("info", "[导出] 已按「一键完成后自动导出」开关跳过 —— 先在 PS 里看效果，满意后在「导出」区点「导出」");
          } else {
            log("info", "[" + step.label + "] 已按模块开关跳过");
          }
          continue;
        }
        var res = await step.run();
        if (res.ok) {
          log("info", "[" + step.label + "] ok · " + summarize(step.key, res));
          // ★ 真机定案（09:46 / 09:55 两轮日志）：removeBackground 是延迟命令，之后的 1~3 分钟里 PS 会把
          //   描述符通道整条锁死（读被拒「获取」、写被拒「设置」）—— 09:46 那次紧接的边缘净化被拒而停；
          //   09:55 那次更是在这里白等了两个 72s（cutout.remove() 里已等过一次，这里又等一次）。
          //   → 等待只保留 cutout.remove() 里那一处（settleHost，预算 300s），这里不再重复等。
        } else {
          log("error", "[" + step.label + "] fail · " + res.error);
          log("error", "已停止后续步骤（" + step.label + " 失败）。可用「回退」恢复到执行前状态。");
          return;
        }
      }
      await verifyMaskAtEnd();
      log("info", "=== 一键全流程完成 ===");
    } finally {
      busy = false;
      api.setBusy(false, "");
    }
  }

  async function onRunModule(key) {
    if (busy) return;
    var step = flowEntry(key);
    if (!step) {
      log("error", "未知模块：" + key);
      return;
    }
    busy = true;
    api.setBusy(true, step.label + "：执行中…");
    try {
      forgetRunSubject();
      var res = await step.run();
      if (res.ok) log("info", "[" + step.label + "] ok · " + summarize(key, res));
      else log("error", "[" + step.label + "] fail · " + res.error);
    } finally {
      busy = false;
      api.setBusy(false, "");
    }
  }

  async function onRestore() {
    if (busy) return;
    if (!snapshotToken) {
      log("error", "没有可用的回退快照（快照在「一键生成全部」开始时创建）。");
      return;
    }
    busy = true;
    api.setBusy(true, "回退中…");
    try {
      var res = await call(function () { return window.Ecom.ps.restore(snapshotToken); });
      if (res.ok) log("info", "[回退] ok · 已回到一键执行前的历史状态");
      else log("error", "[回退] fail · " + res.error);
    } finally {
      busy = false;
      api.setBusy(false, "");
    }
  }

  async function onPickColor() {
    var res = await call(function () { return window.Ecom.ps.pickColor(); });
    if (!res.ok) {
      log("warn", "[取色] fail · " + res.error);
      return;
    }
    var hex = res.data && res.data.hex;
    if (!hex) {
      log("warn", "[取色] 未返回 hex");
      return;
    }
    mergeState({ customHex: String(hex).toUpperCase() });
    log("info", "[取色] 已选自定义色 " + String(hex).toUpperCase());
  }

  function onStateChange(patch) {
    if (!patch || typeof patch !== "object") return;
    mergeState(patch);
  }

  function onAddSize(spec) {
    var res = window.Ecom.store.addSizePreset(state, spec);
    if (!res.ok) {
      log("error", "[尺寸] 新增失败：" + res.error);
      return;
    }
    setState(res.state);
    log("info", "[尺寸] 已新增 " + spec.w + "×" + spec.h + "（默认勾选）");
  }

  function onRemoveSize(id) {
    var res = window.Ecom.store.removeSizePreset(state, id);
    if (!res.ok) {
      log("error", "[尺寸] 删除失败：" + res.error);
      return;
    }
    setState(res.state);
    log("info", "[尺寸] 已删除 " + id);
  }

  function onAddColor(spec) {
    var res = window.Ecom.store.setColor(state, spec);
    if (!res.ok) {
      log("error", "[色板] 新增失败：" + res.error);
      return;
    }
    var next = res.state;
    var added = next.colors[next.colors.length - 1];
    next.selectedColorId = added.id;
    next.customHex = null;
    setState(next);
    log("info", "[色板] 已新增「" + added.name + "」" + added.hex);
  }

  function onRemoveColor(id) {
    var res = window.Ecom.store.removeColor(state, id);
    if (!res.ok) {
      log("error", "[色板] 删除失败：" + res.error);
      return;
    }
    setState(res.state);
    log("info", "[色板] 已删除 " + id);
  }

  function onExportPresets() {
    var res = window.Ecom.store.exportPresets(state);
    if (!res.ok) {
      log("error", "[预设] 导出失败：" + res.error);
      return;
    }
    api.setPresetText(res.data.json);
    log("info", "[预设] 已生成 JSON（" + res.data.json.length + " 字符），可复制文本框内容另存为 .json 文件");
  }

  function onImportPresets() {
    var text = api.getPresetText();
    var res = window.Ecom.store.importPresets(state, text);
    if (!res.ok) {
      log("error", "[预设] 导入失败：" + res.error);
      return;
    }
    setState(res.state);
    log("info", "[预设] 导入成功，界面与已保存状态已同步更新");
  }

  // ★ 第 10 轮（用户 m03326）：旧写法只认 state.export.outputDir，而现在「未设置」时导出会落在原图同目录——于是按钮永远什么都不做。
  //   现在的优先级：手动设置的输出目录 → 上次导出的目录（lastDir）→ 当前文档所在目录；openPath 被拒就用 openExternal(file:///) 重试。
  function openExternalDir(dir, sh) {
    try {
      var url = "file:///" + String(dir).replace(/\\/g, "/").replace(/^\//, "");
      var p2 = sh.openExternal(url);
      if (p2 && typeof p2.then === "function") {
        p2.then(function () { log("info", "[输出目录] 已用 openExternal 打开：" + url); },
               function (e) { log("warn", "[输出目录] openExternal 也失败：" + errText(e) + "；请手动打开：" + dir); });
      } else {
        log("info", "[输出目录] 已用 openExternal 请求打开：" + url);
      }
    } catch (e3) {
      log("warn", "[输出目录] openExternal 异常：" + errText(e3) + "；请手动打开：" + dir);
    }
  }

  function currentDocDir() {
    try {
      var modsD = window.Ecom.ps && typeof window.Ecom.ps.require === "function" ? window.Ecom.ps.require() : null;
      var doc = modsD && modsD.app && modsD.app.activeDocument;
      var p = doc && doc.path ? String(doc.path) : "";
      var cut = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
      if (cut > 2) return p.slice(0, cut);
    } catch (eD) { /* 读不到就返回空 */ }
    return "";
  }

  // ★ 用户 m04355「导出加一个选择目录的选项」。宿主模块只经 ps.require()（INTERFACE §0），所以选择器本身放在 ps.pickFolder。
  async function onPickOutputDir() {
    var ps = window.Ecom.ps;
    if (!ps || typeof ps.pickFolder !== "function") {
      log("warn", "选择输出目录失败：宿主模块未就绪（ps.pickFolder 缺失）");
      return;
    }
    var res = await ps.pickFolder("userDesktop");
    if (!res || !res.ok) {
      log("warn", "选择输出目录失败：" + ((res && res.error) || "未知错误"));
      return;
    }
    if (res.data && res.data.cancelled) {
      log("info", "选择输出目录：已取消");
      return;
    }
    var next = {};
    for (var k in state.export) {
      if (Object.prototype.hasOwnProperty.call(state.export, k)) next[k] = state.export[k];
    }
    next.outputDir = res.data.path;
    onStateChange({ export: next });
    log("info", "输出目录已选择：" + res.data.path + "（后续导出与「一键完成后自动导出」都写到这里）");
  }

  function onOpenOutputDir() {
    var dir = state.export.outputDir || state.export.lastDir || currentDocDir();
    if (!dir) {
      log("warn", "还没有可打开的目录：请先完成一次导出，或在「导出」区手动设置输出目录。");
      return;
    }
    try {
      // 访问宿主模块的唯一出口是 ps.require()（INTERFACE §0）；本文件不得直接 require 宿主模块
      var mods2 = window.Ecom.ps && typeof window.Ecom.ps.require === "function" ? window.Ecom.ps.require() : null;
      var uxp = mods2 && mods2.uxp;
      var sh = uxp && uxp.shell;
      if (sh && typeof sh.openPath === "function") {
        // ★ Adobe 官方文档（UXP「Launch External Processes」）定死了两件事：
        //   ① openPath 成功时 resolve 空串、失败时 resolve 错误文本（不是只有 reject）；
        //   ② 打开【文件夹】要求 manifest 的 requiredPermissions.launchProcess.extensions 里含 ""，
        //      而改 manifest 必须「完全退出 PS 再重开」才生效。
        //   旧代码两件都没做 → 真机 13:32:13 报「Extension "" is not accepted for the path …」后还去试 file://（必败）。
        var pr = sh.openPath(dir, "电商图片制作：打开导出的图片所在文件夹");
        if (pr && typeof pr.then === "function") {
          pr.then(function (res) {
            if (res) {
              log("warn", "[输出目录] openPath 返回失败：" + res +
                "（打开文件夹需要 manifest.requiredPermissions.launchProcess.extensions 含 \"\"，且改后要完全退出 PS 重开）；请手动打开：" + dir);
            } else {
              log("info", "[输出目录] 已打开文件夹：" + dir);
            }
          }, function (e) {
            log("warn", "[输出目录] openPath 被拒：" + errText(e) + "；请手动打开：" + dir);
          });
        } else {
          log("info", "[输出目录] 已请求打开：" + dir);
        }
        return;
      }
    } catch (e2) {
      // 宿主没有 uxp.shell 时走下面的降级路径
    }
    log("warn", "[输出目录] 当前环境不支持 uxp.shell.openPath，请手动打开：" + dir);
  }

  function boot() {
    state = window.Ecom.store.load();
    api = window.Ecom.ui.mount({
      state: state,
      on: {
        onRunAll: onRunAll,
        onRunModule: onRunModule,
        onRestore: onRestore,
        onStateChange: onStateChange,
        onPickColor: onPickColor,
        onAddSize: onAddSize,
        onRemoveSize: onRemoveSize,
        onAddColor: onAddColor,
        onRemoveColor: onRemoveColor,
        onImportPresets: onImportPresets,
        onExportPresets: onExportPresets,
        onOpenOutputDir: onOpenOutputDir,
        onPickOutputDir: onPickOutputDir
      }
    });
    log("info", "面板已就绪（状态版本 v" + state.version + "）");
    initLogPath();
  }

  // 测试接缝：index.js 是 IIFE，闭包内的纯函数在 node 里不可达；只把无副作用的那一个挂出来，
  // 不暴露任何编排能力（运行时行为不受影响）。
  window.Ecom.orchestrator = { hasEnabledAutoItem: hasEnabledAutoItem };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
