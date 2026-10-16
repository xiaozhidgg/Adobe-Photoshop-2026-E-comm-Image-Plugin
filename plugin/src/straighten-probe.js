window.Ecom = window.Ecom || {};

// 只读探针（摆正）：取像素 → 数学分析 → 「应用后回读」验证变换是否真生效 → 只写日志，不改画面。
//
// 冻结接口：window.Ecom.straightenProbe = { run }
//   run() → { ok:true, data:{ lines:string[], summary:object } } | { ok:false, error:string }
//
// 只读边界（硬）：
//   · 对**用户文档**只用只读接口：activeDoc / getSubjectPixels({applyAlpha:false}) / log / probe / require
//   · 不 duplicate 用户文档、不在用户文档上建图层/变换/保存/导出/改选区/改历史
//   · 唯一被写的是探针自己的临时文档「dsh-straighten-probe」（64x64 白底）：在里面 newPlacedLayer 出智能对象、
//     施加 transform 旋转（用于证明命令真生效）；finally 里 close(saving:"no")，再回读文档列表证明用户文档未被改动
//
// 依赖 straighten.js（冻结签名，由他人实现，本文件不实现也不修改）：
//   buildForegroundMask(pixels, width, height, opts); analyzeMask(mask, width, height, opts)
(function () {
  "use strict";

  var DOC_NAME = "dsh-straighten-probe";
  var DOC_SIZE = 64;              // 临时靶子文档边长（px @72dpi，1pt=1px）
  var DOC_RES = 72;
  var PROBE_MAX_DIM = 1024;

  // ★ 可用性判据（真机取证：docs/PROBE-straighten.md 与 verify/out/probe5-extendscript.log）：
  //   executeAction / batchPlay 的**异常文本没有判别力** —— 正对照 trim（真实事件，typeID=1953655149='trim'）
  //   与负对照 dshBogusEventNameA(4153) 的报错一字不差（-25920「命令"<未知的>"当前不可用」）。
  //   执行侧唯一可信的判据是「应用后回读」：命令真执行了，bounds / filterFX 才会变。
  //   UXP 侧拿不到 stringIDToTypeID（ps.js 只暴露 action.batchPlay / core.executeAsModal），
  //   故本文件不推断「名字是否注册」，只如实记录：应用结果 + 回读结果 + 原始错误文本。
  var ROT_ANGLE_DEG = 5;
  var ROT_VARIANTS = ["withCenter", "bare"];     // transform+angle(QCSAverage) / transform+angle

  // 只登记原始错误、不判可用性的候选（含已知不可调用的 cameraRaw* 作对照）
  var NAME_SWEEP = [
    "lensCorrection", "adaptiveWideAngle", "cameraRaw", "cameraRawFilter",
    "perspective", "distort", "upright"
  ];

  var CONTAINERS = ["data", "analysis", "result", "report", "stats", "metrics"];

  function errText(e) { return e && e.message ? String(e.message) : String(e); }

  function safeJson(ps, v, cap) {
    if (ps && typeof ps.safeJson === "function") return ps.safeJson(v, cap || 400);
    try {
      var t = JSON.stringify(v);
      return t === undefined ? String(v) : t;
    } catch (e) { return String(v); }
  }

  function say(ctx, level, text) {
    var s = String(text);
    ctx.lines.push("[" + String(level) + "] " + s);
    ctx.ps.log(level, s);
  }

  // 逐条证据行：走 ps.probe（console + 面板 + 落盘 ecom-debug.log 三通道）
  function probeLine(ctx, label, value) {
    var text = typeof value === "string" ? value : safeJson(ctx.ps, value, 600);
    ctx.lines.push("探测 " + label + " = " + text);
    ctx.ps.probe(label, value);
  }

  function fnum(v, digits) {
    var n = Number(v);
    if (!isFinite(n)) return "null";
    var p = Math.pow(10, digits === undefined ? 3 : digits);
    return String(Math.round(n * p) / p);
  }

  function render(ctx, v) {
    if (v === null || v === undefined) return "null";
    if (typeof v === "number") return fnum(v, 3);
    if (typeof v === "string" || typeof v === "boolean") return String(v);
    return safeJson(ctx.ps, v, 400);
  }

  // 字段名漂移防御：straighten.js 与本文件并行开发，取值时同时看常见的包装层
  function containersOf(obj) {
    var out = [obj];
    for (var i = 0; i < CONTAINERS.length; i++) {
      var v = obj ? obj[CONTAINERS[i]] : null;
      if (v && typeof v === "object") out.push(v);
    }
    return out;
  }

  function field(obj, keys) {
    var cs = containersOf(obj);
    for (var ci = 0; ci < cs.length; ci++) {
      for (var i = 0; i < keys.length; i++) {
        var v = cs[ci][keys[i]];
        if (v !== undefined && v !== null) return v;
      }
    }
    return null;
  }

  // 打开中的文档列表（只读 DOM 访问；ps.js 已用 m.app.activeDocument，同一条通道）
  function docList(ps) {
    try {
      var m = ps.require();
      var docs = m.app.documents;
      var out = [];
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        out.push({ id: d.id, name: String(d.title || d.name || "") });
      }
      return { ok: true, docs: out };
    } catch (e) {
      return { ok: false, error: errText(e) };
    }
  }

  function docListText(res) {
    if (!res || !res.ok) return "读取失败（" + ((res && res.error) || "unknown") + "）";
    var names = [];
    for (var i = 0; i < res.docs.length; i++) names.push(res.docs[i].name + "#" + res.docs[i].id);
    return names.length ? names.join("、") : "（无）";
  }

  // 建临时靶子文档的描述符 —— 真机失败后改成宿主自带形态。
  // ★ 硬证据（本机读出，不是推测）：D:\software\Adobe Photoshop 2026\Required\UXP\photoshop.js 里
  //   Photoshop.prototype.createDocument 的实现即 batchPlay(makeDocument({mode,width,height,resolution,fill,…}))，
  //   而 makeDocument 产出的是
  //     { _obj:"make", new:{ _obj:"document",
  //         mode:{_class:<mode>}, width:{_unit:"distanceUnit",_value:<w>}, height:{_unit:"distanceUnit",_value:<h>},
  //         resolution:{_unit:"densityUnit",_value:<res>}, fill:{_enum:"fill",_value:<fill>}, …其余键 } }
  //   ——【没有 _target，也没有 using】，mode 的默认值是字符串 "RGBColorMode"。
  //   （同函数还把 width/height 按 72/resolution 换算后当 distanceUnit 传，说明该单位下 72dpi 时 1pt=1px。）
  // ★ 失败记录：原先手写的 {_obj:"make",_target:[{_ref:"document"}],using:{…}}（ExtendScript 风格）
  //   真机返回「无法完成请求，因为程序错误。」（2026-10-16 10:05:38 / 10:05:55 两轮各一次，两轮都因此整体跳过应用后回读）。
  function hostShapedNewDocDescriptor() {
    return {
      _obj: "make",
      new: {
        _obj: "document",
        name: DOC_NAME,
        mode: { _class: "RGBColorMode" },
        width: { _unit: "distanceUnit", _value: DOC_SIZE },
        height: { _unit: "distanceUnit", _value: DOC_SIZE },
        resolution: { _unit: "densityUnit", _value: DOC_RES },
        fill: { _enum: "fill", _value: "white" }
      }
    };
  }

  // 旧写法只作为对照保留（已知在本 build 失败），用于把「换形态是否真的解决了问题」证成因果。
  function legacyNewDocDescriptor() {
    return {
      _obj: "make",
      _target: [{ _ref: "document" }],
      using: {
        _obj: "document",
        name: DOC_NAME,
        mode: { _enum: "documentMode", _value: "RGBColor" },
        width: { _unit: "pixelsUnit", _value: DOC_SIZE },
        height: { _unit: "pixelsUnit", _value: DOC_SIZE },
        resolution: { _unit: "densityUnit", _value: DOC_RES },
        fill: { _enum: "fill", _value: "white" }
      }
    };
  }

  // 三条路径依次尝试，每条都把原始返回/错误写进日志；按「活动文档名==DOC_NAME 且 id!=用户文档」命中即停。
  async function createTempDoc(ctx) {
    var ps = ctx.ps;
    var userDocId = ctx.userDocId;

    async function activeIsTemp() {
      var t = await ps.activeDoc();
      var hit = !!(t && t.ok && t.data && Number(t.data.id) !== Number(userDocId) && String(t.data.name) === DOC_NAME);
      return { hit: hit, got: t && t.ok ? (t.data.name + "#" + t.data.id) : ("读取失败：" + ((t && t.error) || "unknown")) };
    }

    function rawErr(mk) {
      if (!mk || !mk.ok) return "抛错：" + ((mk && mk.error) || "unknown");
      var err = ps.firstErrorItem ? ps.firstErrorItem(mk.data.results) : null;
      if (!err) return "无错误项";
      return "错误项：" + (ps.describeErrorItem ? ps.describeErrorItem(err) : safeJson(ps, err, 300));
    }

    var ladder = [
      {
        name: "app.createDocument（宿主 DOM API）",
        run: async function () {
          var m = ps.require ? ps.require() : null;
          if (!m || !m.app || typeof m.app.createDocument !== "function") {
            return { ok: false, detail: "宿主未提供 app.createDocument（typeof=" + (m && m.app ? typeof m.app.createDocument : "无 app") + "）" };
          }
          var r = await ps.modal("电商图片制作 · 建临时靶子文档", async function () {
            return await m.app.createDocument({
              mode: "RGBColorMode", width: DOC_SIZE, height: DOC_SIZE,
              resolution: DOC_RES, fill: "white", name: DOC_NAME
            });
          });
          return { ok: !!r.ok, detail: r.ok ? ("返回 " + (r.data ? ("Document#" + r.data.id) : "null")) : ("抛错：" + r.error) };
        }
      },
      {
        name: "batchPlay make/new（宿主同形描述符）",
        run: async function () {
          var mk = await ps.runRaw([hostShapedNewDocDescriptor()]);
          return { ok: !!(mk && mk.ok && !(ps.firstErrorItem ? ps.firstErrorItem(mk.data.results) : null)), detail: rawErr(mk) };
        }
      },
      {
        name: "batchPlay make/using（旧 ExtendScript 风格，对照）",
        run: async function () {
          var mk = await ps.runRaw([legacyNewDocDescriptor()]);
          return { ok: !!(mk && mk.ok && !(ps.firstErrorItem ? ps.firstErrorItem(mk.data.results) : null)), detail: rawErr(mk) };
        }
      }
    ];

    for (var i = 0; i < ladder.length; i++) {
      var step = ladder[i];
      var res;
      try { res = await step.run(); }
      catch (e) { res = { ok: false, detail: "抛异常：" + errText(e) }; }
      var chk = await activeIsTemp();
      say(ctx, chk.hit ? "info" : "warn",
        "建临时文档 · 路径 " + (i + 1) + "/" + ladder.length + "「" + step.name + "」→ " +
        (res.ok ? "调用未报错" : "失败") + "；" + res.detail + "；活动文档=" + chk.got + (chk.hit ? "（已建好）" : "（没建出来）"));
      if (chk.hit) {
        ctx.summary.tempDocStrategy = step.name;
        return true;
      }
    }
    return false;
  }

  function closeDocDescriptor(id) {
    return {
      _obj: "close",
      _target: [{ _ref: "document", _id: id }],
      saving: { _enum: "saveOptions", _value: "no" }
    };
  }

  // ------------------------------------------------------------------
  // 主流程（清理由 run() 的 finally 保证，这里只负责取证）
  // ------------------------------------------------------------------
  async function collect(ctx) {
    var ps = ctx.ps;

    // ---- 1. 文档：只读 ----
    var doc = await ps.activeDoc();
    if (!doc || !doc.ok) {
      say(ctx, "error", "无活动文档：" + ((doc && doc.error) || "unknown"));
      return { ok: false, error: "无活动文档：" + ((doc && doc.error) || "unknown") };
    }
    var ud = doc.data || {};
    ctx.userDocId = ud.id;
    ctx.userDocName = ud.name;
    var before = docList(ps);
    ctx.docsBefore = before;
    say(ctx, "info", "活动文档：" + ud.name + "（id=" + ud.id + "，" + ud.width + "x" + ud.height +
      "，resolution=" + ud.resolution + "）");
    say(ctx, "info", "探针前打开的文档：" + docListText(before));

    // ---- 2. 取像素：只读调用，绝不写入活动文档 ----
    var px = await ps.getSubjectPixels({ applyAlpha: false, maxDim: PROBE_MAX_DIM });
    if (!px || !px.ok) {
      say(ctx, "error", "取像素失败（只读调用）：" + ((px && px.error) || "unknown"));
      return { ok: false, error: "取像素失败：" + ((px && px.error) || "unknown") };
    }
    var pd = px.data || {};
    var W = Number(pd.width) || 0;
    var H = Number(pd.height) || 0;
    var pixels = pd.rgba || pd.buffer || pd.raw || pd.data || null;
    ctx.summary.alphaMaskCoverage = (pd.alphaMaskCoverage === undefined ? null : pd.alphaMaskCoverage);
    probeLine(ctx, "pixels", {
      size: W + "x" + H,
      channels: pd.channels,
      len: pixels ? pixels.length : 0,
      docSize: pd.docWidth + "x" + pd.docHeight,
      hasAlphaMask: !!pd.alphaMask,
      alphaMaskCoverage: (pd.alphaMaskCoverage === undefined ? null : pd.alphaMaskCoverage)
    });

    // ---- 3. 数学分析：只调用 straighten.js 的两个冻结函数 ----
    var st = (window.Ecom && window.Ecom.straighten) || null;
    if (!st || typeof st.buildForegroundMask !== "function" || typeof st.analyzeMask !== "function") {
      ctx.summary.warnings.push("Ecom.straighten 未加载或缺 buildForegroundMask / analyzeMask ⇒ 数学分析跳过（事件名探测照常）");
      say(ctx, "error", ctx.summary.warnings[ctx.summary.warnings.length - 1]);
    } else if (!pixels || !W || !H) {
      ctx.summary.warnings.push("像素不可用（len=" + (pixels ? pixels.length : 0) + "，w=" + W + "，h=" + H + "）⇒ 数学分析跳过");
      say(ctx, "error", ctx.summary.warnings[ctx.summary.warnings.length - 1]);
    } else {
      await analyze(ctx, st, pixels, W, H, pd);
    }

    // ---- 4. 应用后回读（唯一可信判据）：只在自建临时文档里做 ----
    await probeApplyAndReadback(ctx);

    return { ok: true };
  }

  async function analyze(ctx, st, pixels, W, H, pd) {
    // 真实形状（读 plugin/src/straighten.js:62-121 / 145-257 核实）：
    //   buildForegroundMask(pixels,width,height,opts) → { ok:true, mode:"alpha"|"bgThreshold",
    //       mask:Uint8Array(w*h) 0/1, width, height, bg, coverage }；失败 → { ok:false, ..., error }
    //   analyzeMask(mask,width,height,opts) → { ok:true, coverage, areaPx, centroid, thetaDeg,
    //       minRect:{cx,cy,w,h,thetaDeg}, edges:{top,right,bottom,left}, edgeRmsPct,
    //       quad:{topW,botW,leftH,rightH}, perspective:{widthRatio,heightRatio,maxDeviation},
    //       verdict:"skip"|"micro"|"confirm", notes }；失败 → { ok:false, reason, coverage, areaPx, notes }
    // opts 只传 channels（3|4）——straighten.js:64 用它选 alpha / bgThreshold 分支，其余键它不读。
    var bcore = null;
    try {
      bcore = await st.buildForegroundMask(pixels, W, H, { channels: pd.channels });
    } catch (e) {
      say(ctx, "error", "buildForegroundMask 抛异常：" + errText(e));
      return;
    }
    if (!bcore || typeof bcore !== "object") {
      say(ctx, "error", "buildForegroundMask 未返回对象：" + render(ctx, bcore));
      return;
    }
    if (bcore.ok === false) {
      say(ctx, "error", "buildForegroundMask 返回 ok:false：" + String(bcore.error || bcore.reason || "无原因"));
      return;
    }
    var mask = bcore.mask || null;
    var mode = field(bcore, ["mode", "foregroundMode", "maskMode"]);
    var coverage = field(bcore, ["coverage", "fgCoverage", "maskCoverage"]);
    ctx.summary.mode = (mode === null ? null : String(mode));
    ctx.summary.coverage = (coverage === null ? null : Number(coverage));
    probeLine(ctx, "mask.mode", mode === null ? "未回填" : String(mode));
    probeLine(ctx, "mask.coverage", coverage === null ? "未回填" : fnum(coverage, 4));
    probeLine(ctx, "mask.bg", render(ctx, field(bcore, ["bg", "background"])));
    if (!mask || typeof mask.length !== "number") {
      say(ctx, "error", "buildForegroundMask 未返回 mask（keys=" + Object.keys(bcore).join(",") + "）⇒ 数学分析跳过");
      return;
    }

    var acore = null;
    try {
      acore = await st.analyzeMask(mask, W, H, {});
    } catch (e) {
      say(ctx, "error", "analyzeMask 抛异常：" + errText(e));
      return;
    }
    if (!acore || typeof acore !== "object") {
      say(ctx, "error", "analyzeMask 未返回对象：" + render(ctx, acore));
      return;
    }
    if (acore.ok === false) {
      say(ctx, "error", "analyzeMask 返回 ok:false：" + String(acore.reason || acore.error || "无原因") +
        "（coverage=" + render(ctx, acore.coverage) + "，areaPx=" + render(ctx, acore.areaPx) +
        "，notes=" + render(ctx, acore.notes) + "）");
      ctx.summary.warnings.push("analyzeMask ok:false：" + String(acore.reason || acore.error || "无原因"));
      return;
    }
    ctx.summary.mathRan = true;

    var theta = field(acore, ["thetaDeg", "theta", "angleDeg"]);
    var minRect = field(acore, ["minRect", "rect", "bounds", "bbox"]);
    var edges = field(acore, ["edges", "edgeCount", "edgePoints"]);
    var edgeRms = field(acore, ["edgeRmsPct", "rmsPct", "edgeRms"]);
    var persp = field(acore, ["perspective", "persp"]);
    var maxDev = field(persp, ["maxDeviation", "deviation"]);
    var verdict = field(acore, ["verdict", "judgement", "decision"]);
    var quad = field(acore, ["quad", "corners"]);
    var centroid = field(acore, ["centroid", "center"]);
    var notes = field(acore, ["notes", "warnings", "reasons"]);

    probeLine(ctx, "straighten.thetaDeg", (theta === null ? "null" : fnum(theta, 2)));
    probeLine(ctx, "straighten.minRect", render(ctx, minRect));
    probeLine(ctx, "straighten.centroid", render(ctx, centroid));
    probeLine(ctx, "straighten.coverage", render(ctx, field(acore, ["coverage"])) +
      " / areaPx=" + render(ctx, field(acore, ["areaPx"])));
    probeLine(ctx, "straighten.edges", render(ctx, edges));
    probeLine(ctx, "straighten.edgeRmsPct", (edgeRms === null ? "null" : fnum(edgeRms, 3)));
    probeLine(ctx, "straighten.quad", render(ctx, quad));
    probeLine(ctx, "straighten.perspective", render(ctx, persp) +
      " · maxDeviation=" + (maxDev === null ? "null" : fnum(maxDev, 4)));
    probeLine(ctx, "straighten.verdict", render(ctx, verdict));
    probeLine(ctx, "straighten.notes", render(ctx, notes));
    probeLine(ctx, "straighten.keys", Object.keys(acore).join(","));

    ctx.summary.analysis = {
      thetaDeg: (theta === null ? null : Number(theta)),
      edgeRmsPct: (edgeRms === null ? null : Number(edgeRms)),
      perspectiveMaxDeviation: (maxDev === null ? null : Number(maxDev)),
      verdict: (verdict === null ? null : String(verdict))
    };
    say(ctx, "info", "紧凑判定：θ=" + (theta === null ? "null" : fnum(theta, 2) + "°") +
      " · 边缘残差=" + (edgeRms === null ? "null" : fnum(edgeRms, 3) + "%") +
      " · 透视偏差=" + (maxDev === null ? "null" : fnum(maxDev, 4)) +
      " · mask=" + String(ctx.summary.mode) +
      "(" + (ctx.summary.coverage === null ? "null" : fnum(ctx.summary.coverage, 4)) + ") → " +
      (verdict === null ? "无结论" : String(verdict)));
  }

  // ------------------------------------------------------------------
  // 应用后回读（唯一可信判据）
  // ------------------------------------------------------------------
  function rectOf(obj) {
    if (!obj) return null;
    var r = obj.bounds || obj.boundsNoEffects || null;
    if (!r || typeof r !== "object") return null;
    function val(k) {
      var x = r[k];
      return (x && typeof x === "object") ? Number(x._value) : Number(x);
    }
    var o = { left: val("left"), top: val("top"), right: val("right"), bottom: val("bottom") };
    if (!isFinite(o.left) || !isFinite(o.top) || !isFinite(o.right) || !isFinite(o.bottom)) return null;
    return o;
  }

  function rectText(r) { return r ? ("L" + r.left + " T" + r.top + " R" + r.right + " B" + r.bottom) : "null"; }

  function sameRect(a, b) {
    if (!a || !b) return false;
    return a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;
  }

  // 只读回读活动图层边界
  async function readBounds(ctx) {
    var res = await ctx.ps.runRaw([{
      _obj: "get",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }],
      _options: { dialogOptions: "dontDisplay" }
    }]);
    if (!res || !res.ok) return { ok: false, error: String((res && res.error) || "unknown") };
    var items = (res.data && res.data.results) || [];
    var r = rectOf(items[0]);
    return r ? { ok: true, rect: r } : { ok: false, error: "返回里没有 bounds：" + safeJson(ctx.ps, items[0], 200) };
  }

  function rotDescriptor(kind) {
    var d = {
      _obj: "transform",
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
    };
    if (kind === "withCenter") d.freeTransformCenterState = { _enum: "quadCenterState", _value: "QCSAverage" };
    d.angle = { _unit: "angleUnit", _value: ROT_ANGLE_DEG };
    return d;
  }

  // 单发一次描述符：不重试、原样保留 PS 错误文本
  async function applyOnce(ctx, desc) {
    try {
      var res = await ctx.ps.runRaw([desc]);
      if (!res || !res.ok) return { ok: false, raw: String((res && res.error) || "unknown") };
      var items = (res.data && res.data.results) || [];
      var bad = ctx.ps.firstErrorItem ? ctx.ps.firstErrorItem(items) : null;
      if (bad) {
        var msg = (bad.message === undefined ? "" : String(bad.message));
        var num = (bad.number === undefined || bad.number === null ? "" : " num=" + String(bad.number));
        return { ok: false, raw: msg + num };
      }
      return { ok: true, raw: safeJson(ctx.ps, items, 300) };
    } catch (e) {
      return { ok: false, raw: "抛异常：" + errText(e) };
    }
  }

  async function probeApplyAndReadback(ctx) {
    var ps = ctx.ps;
    say(ctx, "info", "判定规则（写进日志便于复核）：异常文本**无判别力**（正对照 trim 与负对照 bogus 报错一字不差）；" +
      "唯一可信判据＝应用后回读 bounds 是否变化。");
    say(ctx, "info", "旋转候选：" + ROT_VARIANTS.join("、") + "，角度=" + ROT_ANGLE_DEG + "°（应用后回读 bounds）");
    say(ctx, "info", "只登记原始错误的候选（空参，不作可用性结论）：" + NAME_SWEEP.join("、"));

    // 建自己的临时文档当靶子：空参调用有极小概率真的执行，绝不能拿用户的图当靶子
    var created = await createTempDoc(ctx);
    if (!created) {
      say(ctx, "error", "三条路径都没建出临时文档（每条的原始返回见上面）⇒ 应用后回读与候选探测整体跳过");
      ctx.summary.warnings.push("临时文档创建失败 ⇒ 应用后回读与候选探测整体跳过（不在用户文档上做任何调用）");
      return;
    }

    // 从此刻起临时文档已存在 ⇒ 后面无论走哪条路径退出，finally 都按名字兜底关掉它
    ctx.tempDocPendingName = DOC_NAME;

    // 靶子确认：活动文档必须是刚建的临时文档（不是用户文档）才允许继续
    var t = await ps.activeDoc();
    var isTempActive = !!(t && t.ok && t.data && Number(t.data.id) !== Number(ctx.userDocId) &&
      String(t.data.name) === DOC_NAME);
    if (!isTempActive) {
      say(ctx, "error", "临时文档未成为活动文档（实得：" + (t && t.ok ? t.data.name + "#" + t.data.id : "读取失败") +
        "）⇒ 跳过全部探测，避免在用户文档上做任何调用");
      ctx.summary.warnings.push("临时文档未成为活动文档 ⇒ 应用后回读与候选探测整体跳过");
      return;
    }
    ctx.tempDocId = t.data.id;
    ctx.summary.tempDocCreated = true;
    say(ctx, "info", "临时靶子文档已就绪：" + t.data.name + "#" + t.data.id + "（所有调用只作用在它上面）");

    // ---- (a) 变换：应用 → 回读 bounds ----
    var pl = await applyOnce(ctx, { _obj: "newPlacedLayer" });
    if (!pl.ok) {
      say(ctx, "error", "newPlacedLayer 失败（原始）：" + pl.raw + " ⇒ 旋转回读跳过（候选探测照常）");
      ctx.summary.warnings.push("newPlacedLayer 失败 ⇒ 旋转应用后回读跳过");
    } else {
      var b0 = await readBounds(ctx);
      say(ctx, "info", "旋转前 bounds：" + (b0.ok ? rectText(b0.rect) : "读取失败：" + b0.error));
      for (var i = 0; i < ROT_VARIANTS.length; i++) {
        var kind = ROT_VARIANTS[i];
        var ap = await applyOnce(ctx, rotDescriptor(kind));
        var b1 = await readBounds(ctx);
        var changed = !!(b0.ok && b1.ok && !sameRect(b0.rect, b1.rect));
        var trial = {
          variant: kind,
          applied: ap.ok,
          changed: changed,
          before: b0.ok ? rectText(b0.rect) : ("读取失败：" + b0.error),
          after: b1.ok ? rectText(b1.rect) : ("读取失败：" + b1.error),
          raw: ap.raw
        };
        probeLine(ctx, "transform." + kind, trial);
        say(ctx, "info", "旋转候选 " + kind + " → 应用" + (ap.ok ? "成功" : "失败") + "；回读 changed=" + changed +
          "；原始=" + ap.raw);
        ctx.summary.rotationTrials.push(trial);
        if (ap.ok && changed) {
          ctx.summary.rotation = { variant: kind, before: trial.before, after: trial.after };
          break;
        }
      }
      if (!ctx.summary.rotation) {
        ctx.summary.warnings.push("旋转变换未在回读里生效（" + ROT_VARIANTS.join("、") + " 都 changed=false）");
      }
    }

    // ---- (b) 候选事件名：只登记原始错误，不判可用性 ----
    for (var j = 0; j < NAME_SWEEP.length; j++) {
      var name = NAME_SWEEP[j];
      var r2 = await applyOnce(ctx, { _obj: name });
      probeLine(ctx, "event." + name, { threw: !r2.ok, raw: r2.raw });
      ctx.summary.events[name] = { threw: !r2.ok, raw: r2.raw };
      say(ctx, "info", "候选 " + name + "（空参）→ " + (r2.ok ? "无异常" : "抛错") + "；原始=" + r2.raw +
        "｜注意：异常文本无判别力，本行不作可用性结论");
    }
  }

  async function closeTempDoc(ctx) {
    var ps = ctx.ps;

    // 先按 id 关；没有 id 时按名字找（兜住「建了但活动文档没切过去」）
    if (ctx.tempDocId === null && ctx.tempDocPendingName) {
      var list = docList(ps);
      if (list.ok) {
        for (var i = 0; i < list.docs.length; i++) {
          if (list.docs[i].name === ctx.tempDocPendingName) ctx.tempDocId = list.docs[i].id;
        }
      }
    }
    if (ctx.tempDocId === null) return;

    try {
      var cl = await ps.runRaw([closeDocDescriptor(ctx.tempDocId)]);
      if (!cl || !cl.ok) {
        ctx.summary.tempDocCloseError = String((cl && cl.error) || "unknown");
        say(ctx, "error", "临时文档关闭失败（原始错误）：" + ctx.summary.tempDocCloseError);
      } else {
        var clErr = ps.firstErrorItem ? ps.firstErrorItem(cl.data.results) : null;
        if (clErr) {
          ctx.summary.tempDocCloseError = (ps.describeErrorItem ? ps.describeErrorItem(clErr) : safeJson(ps, clErr, 300));
          say(ctx, "error", "临时文档关闭返回错误项（原始）：" + ctx.summary.tempDocCloseError);
        } else {
          ctx.summary.tempDocClosed = true;
          say(ctx, "info", "临时文档已关闭（不保存）：" + DOC_NAME + "#" + ctx.tempDocId);
        }
      }
    } catch (e) {
      ctx.summary.tempDocCloseError = errText(e);
      say(ctx, "error", "临时文档关闭抛异常：" + ctx.summary.tempDocCloseError);
    }
  }

  async function reportAfter(ctx) {
    var ps = ctx.ps;
    var after = docList(ps);
    ctx.summary.docsAfter = after.ok ? after.docs : [];
    say(ctx, "info", "探针后打开的文档：" + docListText(after));
    if (!after.ok) {
      ctx.summary.warnings.push("关闭后文档列表读取失败 ⇒ 未能证明用户文档未被改动");
      return;
    }
    var leftovers = [];
    for (var i = 0; i < after.docs.length; i++) {
      if (after.docs[i].name === DOC_NAME) leftovers.push(after.docs[i].name + "#" + after.docs[i].id);
    }
    if (leftovers.length) {
      ctx.summary.warnings.push("临时文档仍打开：" + leftovers.join("、") + "（需人工关闭）");
      say(ctx, "error", ctx.summary.warnings[ctx.summary.warnings.length - 1]);
    }
    var userStill = false;
    for (var j = 0; j < after.docs.length; j++) {
      if (Number(after.docs[j].id) === Number(ctx.userDocId)) userStill = true;
    }
    ctx.summary.userDocStillOpen = userStill;
    say(ctx, "info", "用户文档" + (userStill ? "仍打开且未被写入" : "已不在打开列表（异常，需人工确认）") +
      "；本次探针只调用 read-only 接口，未做 duplicate / save / 建图层。");
  }

  // ------------------------------------------------------------------
  // 入口
  // ------------------------------------------------------------------
  async function run() {
    var ps = (function () {
      var m = window.Ecom && window.Ecom.ps;
      return (m && typeof m.log === "function" && typeof m.getSubjectPixels === "function") ? m : null;
    })();
    if (!ps) return { ok: false, error: "Ecom.ps 未加载（ps.js 未就绪）" };

    var lines = [];
    var ctx = {
      ps: ps,
      lines: lines,
      userDocId: null,
      userDocName: null,
      docsBefore: null,
      tempDocId: null,
      tempDocPendingName: null,
      summary: {
        ok: true,
        userId: null,
        userName: null,
        docsBefore: [],
        docsAfter: [],
        tempDocCreated: false,
        tempDocClosed: null,
        tempDocCloseError: null,
        userDocStillOpen: null,
        mode: null,
        coverage: null,
        alphaMaskCoverage: null,
        mathRan: false,
        analysis: null,
        eventRule: "异常文本无判别力（正对照 trim 与负对照 bogus 报错一字相同）；唯一可信判据＝应用后回读 bounds 是否变化",
        rotation: null,
        rotationTrials: [],
        events: {},
        warnings: []
      }
    };

    say(ctx, "info", "=== 只读探针（摆正）开始 ===");
    var inner = null;
    try {
      inner = await collect(ctx);
    } catch (e) {
      inner = { ok: false, error: "探针异常：" + errText(e) };
      say(ctx, "error", inner.error);
    } finally {
      try { await closeTempDoc(ctx); } catch (eC) { say(ctx, "error", "清理阶段异常：" + errText(eC)); }
      try { await reportAfter(ctx); } catch (eR) { say(ctx, "error", "回读阶段异常：" + errText(eR)); }
    }

    ctx.summary.userId = ctx.userDocId;
    ctx.summary.userName = ctx.userDocName;
    ctx.summary.docsBefore = (ctx.docsBefore && ctx.docsBefore.ok) ? ctx.docsBefore.docs : [];
    ctx.summary.ok = !!(inner && inner.ok);
    say(ctx, "info", "=== 只读探针结束 ===");

    if (!inner || !inner.ok) return { ok: false, error: (inner && inner.error) || "unknown" };
    return { ok: true, data: { lines: lines, summary: ctx.summary } };
  }

  window.Ecom.straightenProbe = { run: run };
})();
