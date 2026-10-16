// Ecom.straightenApply —— 自动摆正（A 档）的应用侧：读像素 → 纯数学分析 → 只在「可微调」档旋转主体层。
// 依据 docs/PLAN-straighten.md §3.2（变换端）/ §4（流程位置）/ §5（风险与安全设计）。
// 检测数学与阈值全在 plugin/src/straighten.js（纯函数、不碰宿主）；本文件只做：取像素 → 判定 → 变换 → 回读。
// ★ 只做小角度微调：verdict 不是 "micro"（含 confirm / skip / 前景过少）时一律不动画面，只写日志。
// ★ 幂等：|θ| < NOOP_THETA_DEG 直接返回，不再重采样。
// ★ 方向不靠猜：转完重读像素再分析一次，只有「变好」才算成功；变差了才反向补一次（净效果＝另一个方向）；
//   没变化＝变换没生效，直接放弃（绝不盲目反向补，免得把图转到另一侧）。
//   真机唯一可信判据＝应用后回读（docs/PROBE-straighten.md §1.1 / §4）。
// ★ 本文件不碰 UI、不改 FLOW：流程接线在 plugin/index.js 的 stepStraighten，开关在 src/ui.js。
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  var DETECT_MAX_DIM = 1024;     // 与分析端同一采样上限
  var NOOP_THETA_DEG = 0.2;      // |θ| 小于它＝已经摆正，不动像素
  var MIN_IMPROVE_DEG = 0.05;    // 回读判据：|θ| 至少少这么多才算这次旋转有效
  var MAX_ROTATE_ATTEMPTS = 2;   // 第一次 +（仅在“反向生效”时才有的）方向纠正一次
  // PS 的 transform.angle 正值＝顺时针；本模块 θ 正值＝长轴【向右下】倾斜（图像坐标 y 向下）⇒ 取负号转回水平。
  var PS_ANGLE_SIGN = -1;

  function errText(e) {
    if (!e) return "unknown";
    return e.message ? String(e.message) : String(e);
  }

  function f2(n) { return Math.round(Number(n) * 100) / 100; }
  function f4(n) { return Math.round(Number(n) * 10000) / 10000; }

  function mods() {
    var ps = window.Ecom && window.Ecom.ps;
    var S = window.Ecom && window.Ecom.straighten;
    if (!ps) return { error: "缺少 Ecom.ps（src/ps.js 未加载）" };
    if (!S || typeof S.buildForegroundMask !== "function" || typeof S.analyzeMask !== "function") {
      return { error: "缺少 Ecom.straighten.buildForegroundMask / analyzeMask（src/straighten.js 未加载）" };
    }
    return { ps: ps, S: S };
  }

  function line(ps, s) { ps.log("info", "[自动摆正] " + s); }
  function warn(ps, s) { ps.log("warn", "[自动摆正] " + s); }

  // 取一次像素 → 前景掩膜 → 摆正量
  // forceMode：回读时传首测的 maskMode，保证两次量的都是同一个东西；另外 "pixels"＝明确要求用像素基准自动挑
  //   （跳过图层蒙版，供「蒙版没跟着图层旋转」时的二次复核）。
  //   真机 2026-10-16 10:59:55 事故：首测 mask=bgThreshold 抓的是「卡片」，整层旋转后四角透明，
  //   掩膜自动切到 alpha（＝整张已旋转的画布矩形），量到的 θ 变成画布转过的角度 ⇒ 被判「未生效」而停手。
  // ★ 基准优先级（真机 2026-10-16 12:40:21 事故后定）：
  //   ① 已经抠过图 ⇒ 用【图层蒙版】（抠图的产物就是主体轮廓；那一层的像素 alpha 可能仍全 255，
  //      此时 buildForegroundMask 会退回颜色阈值，把灰底当主体 ⇒ 残差 23% 误判 skip）；
  //   ② 否则像素带真 alpha（透明 PNG）⇒ alpha 模式；
  //   ③ 否则颜色阈值（不透明照片）。
  //   forceMode 非空时严格锁死首测基（回读必须同基准），不再自动切换。
  async function detect(ps, S, layerId, forceMode) {
    var pix = await ps.getSubjectPixels({ applyAlpha: false, maxDim: DETECT_MAX_DIM, layerId: layerId });
    if (!pix || !pix.ok) return { ok: false, error: "读取像素失败：" + String((pix && pix.error) || "unknown") };
    var d = pix.data || {};
    var fm = null;
    if (!forceMode || forceMode === "layerMask") {
      fm = S.buildMaskFromLayerMask(d.alphaMask, d.width, d.height, {});
    }
    if (fm && fm.ok) {
      line(ps, "掩膜基准＝图层蒙版（抠图产物，占比 " + (fm.coverage * 100).toFixed(2) + "%）");
    } else {
      if (fm && d.alphaMask) line(ps, "图层蒙版不可用（" + fm.error + "）→ 退回像素掩膜");
      if (forceMode === "layerMask") {
        return { ok: false, error: "回读需要图层蒙版基准，但它现在不可用（" + String((fm && fm.error) || "no mask") + "）" };
      }
      fm = S.buildForegroundMask(d.rgba, d.width, d.height, {
        channels: d.channels, forceMode: (forceMode === "pixels") ? null : forceMode
      });
    }
    if (!fm || !fm.ok) {
      return { ok: false, error: "生成前景掩膜失败：" + String((fm && (fm.error || fm.reason)) || "unknown") };
    }
    var an = S.analyzeMask(fm.mask, fm.width, fm.height, {});
    if (!an || !an.ok) {
      return { ok: false, error: "摆正量分析失败：" + String((an && an.reason) || "unknown") };
    }
    return {
      ok: true, analysis: an, maskMode: fm.mode,
      // 逐物体摆正要用：像素网格尺寸 + 它覆盖的文档取景框（null＝整幅画布等比）
      gridW: fm.width, gridH: fm.height,
      pixFrame: d.pixelFrame || null,
      docW: d.docWidth, docH: d.docHeight
    };
  }

  function selectLayer(layerId) {
    return { _obj: "select", _target: [{ _ref: "layer", _id: layerId }] };
  }

  // ★ transform 只作用于【当前激活图层】，只给 _target 会被静默丢掉 → 必须先 select（compose.js:29 真机教训）
  function transformDesc(layerId, angleDeg) {
    return {
      _obj: "transform",
      _target: [{ _ref: "layer", _id: layerId }],
      freeTransformCenterState: { _enum: "quadCenterState", _value: "QCSAverage" },
      angle: { _unit: "angleUnit", _value: angleDeg },
      interpolation: { _enum: "interpolationType", _value: "bicubic" }
    };
  }

  async function rotate(ps, layerId, layerName, angleDeg, label) {
    var res = await ps.run([selectLayer(layerId), transformDesc(layerId, angleDeg)], {
      history: "suspend", preserveSelection: true, label: label,
      lockProbeLayerId: layerId, lockProbeLayerName: layerName,
      // ★ 真机 2026-10-16 10:46:31：变换被拒（命令"变换"当前不可用）会被 ps.run 当"宿主忙"重试 8 次约 34s
      //   （compose.js:143 记过）。这里把重试压到 2 次 / 10s 预算：拒了就是拒了，不该让整条流程干等。
      busyRetries: 2, busyBudgetMs: 10000
    });
    if (!res || !res.ok) return { ok: false, error: String((res && res.error) || "unknown") };
    return { ok: true };
  }

  // 真正要纠的角度＝相对最近轴向的倾斜（竖版主体的 θ 接近 ±90°，用 θ 判断会全盘判错）
  function tiltOf(an) {
    if (!an) return 0;
    var t = (typeof an.tiltDeg === "number") ? an.tiltDeg : an.thetaDeg;
    while (t > 45) t -= 90;
    while (t <= -45) t += 90;
    return t;
  }

  function detectLine(an, maskMode) {
    return "检测：θ=" + f2(an.thetaDeg) + "°（相对轴向倾斜 " + f2(tiltOf(an)) + "°）· 四边残差=" +
      f2(an.edgeRmsPct) + "% · 透视偏差=" +
      f4(an.perspective.maxDeviation) + " · mask=" + maskMode + "(" + f4(an.coverage) + ") → " + an.verdict;
  }

  // 多物体（D 档）时补一行逐物体明细：并集的 tilt/残差会被「物体之间的相对摆放」带偏，
  // 真机 2026-10-16 11:57:37 那张「纸盒 + 牙膏管」并集 tilt=3.85°，而两个物体各自只有 +1.29°/+0.25°。
  function objectsLine(an) {
    var objs = an.objects || [];
    var parts = [];
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      parts.push("#" + (i + 1) + " " + o.w + "x" + o.h + " tilt " + f2(o.tiltDeg) + "°（长宽方差比 " + f2(o.elongation) + "）");
    }
    return "多物体：" + objs.length + " 个 —— " + parts.join(" / ") + "；取中点 " + f2(tiltOf(an)) +
      "°，逐物体极差/2=" + f2(an.objectResidualDeg) + "°（并集残差/透视在多物体时没有判别力，仅供诊断）";
  }

  // =====================================================================
  // 逐物体分开摆正（用户 2026-10-16 决策：选项 A —— 保持单层，各转各的角度）
  // =====================================================================
  // 网格坐标 → 文档坐标（pixFrame=null 时网格按整幅画布等比；映射与 ps.js resampleMask 同源）
  function gridRectToDoc(rect, pixFrame, gridW, gridH, docW, docH) {
    var f = pixFrame || { left: 0, top: 0, right: docW, bottom: docH };
    var sx = (f.right - f.left) / gridW, sy = (f.bottom - f.top) / gridH;
    return {
      left: f.left + rect.left * sx, top: f.top + rect.top * sy,
      right: f.left + (rect.right + 1) * sx, bottom: f.top + (rect.bottom + 1) * sy
    };
  }

  function rectSelectionDesc(r) {
    // ★ 矩形的四条边都必须是 UnitValue 对象（{_unit,_value}），不能把 _unit 写在矩形上、四边给裸数字：
    //   真机 2026-10-16 13:29:32 就是这么被拒的（NAPI API failure: Number expected）——transform 的 angle
    //   同一种写法能用，正是因为它本来就是 {_unit:"angleUnit",_value:…}。
    var u = function (v) { return { _unit: "pixelsUnit", _value: Math.round(v) }; };
    return {
      _obj: "set", _target: [{ _ref: "channel", _property: "selection" }],
      to: {
        _obj: "rectangle", top: u(r.top), left: u(r.left),
        bottom: u(r.bottom), right: u(r.right)
      }
    };
  }

  function deselectDesc() { return { _obj: "deselect", _target: [{ _ref: "channel", _property: "selection" }] }; }

  // 取消选区的四种写法（★ 四种都要发，不能只看 executeAction 的返回值 —— 实测「不抛异常」≠「被执行」）
  // ★ 真机 2026-10-16 13:37:52 实测：`{_obj:"deselect", _target:[channel/selection]}` 返回 ok，
  //   但画布上的矩形选区**原样还在**（用户截图确认）。app.js 自己的 deselect 其实是「把 selection 通道
  //   set 成 ordinal none」（docs/RESEARCH-descriptors.md 取证，app.js 偏移 16884）⇒ 那条才是权威写法，
  //   放在第一位；其余三种依次补发，最后用空矩形兜底。
  function deselectDescs() {
    return [
      {
        label: "set-selection-none",
        desc: { _obj: "set", _target: [{ _ref: "channel", _property: "selection" }], to: { _enum: "ordinal", _value: "none" } }
      },
      { label: "deselect(document)", desc: { _obj: "deselect", _target: [{ _ref: "document", _enum: "ordinal", _value: "targetEnum" }] } },
      { label: "deselect(channel)", desc: deselectDesc() },
      { label: "空矩形", desc: rectSelectionDesc({ top: 0, left: 0, bottom: 0, right: 0 }) }
    ];
  }

  // 只转选区内的像素：先建矩形选区，再对激活层做 transform —— 有选区时 PS 只变换选区内内容，
  //   旋转中心＝变换框中心＝选区中心（故选区必须紧贴该物体，中心才与物体中心大致重合；
  //   回读里专门查「物体中心位移」，防的就是 PS 拿图层中心当旋转中心）。
  async function rotateRegion(ps, layerId, layerName, rectDoc, angleDeg, label) {
    var res = await ps.run([selectLayer(layerId), rectSelectionDesc(rectDoc), transformDesc(layerId, angleDeg)], {
      history: "suspend", preserveSelection: true, label: label,
      lockProbeLayerId: layerId, lockProbeLayerName: layerName,
      busyRetries: 2, busyBudgetMs: 10000
    });
    if (!res || !res.ok) return { ok: false, error: String((res && res.error) || "unknown") };
    return { ok: true };
  }

  function nearestObj(list, cx, cy) {
    var best = null, bestD = Infinity;
    for (var i = 0; i < list.length; i++) {
      var d = (list[i].cx - cx) * (list[i].cx - cx) + (list[i].cy - cy) * (list[i].cy - cy);
      if (d < bestD) { bestD = d; best = list[i]; }
    }
    return best ? { obj: best, dist: Math.sqrt(bestD) } : null;
  }

  function skipsText(skips) {
    var parts = [];
    for (var i = 0; i < skips.length; i++) parts.push("#" + skips[i].index + " " + skips[i].reason);
    return parts.join("；");
  }

  // 逐物体旋转结束后不留残余选区（后面的背景 / 投影 / 导出都不该带着选区跑）
  // ★ 真机 2026-10-16 13:31:59：这里**必须** preserveSelection:false —— ps.run 默认会在批处理首尾各插一条
  //   saveDocumentSelection / restoreDocumentSelection，末尾那条 restore 把选区又「恢复」回来 ⇒ 清选区被
  //   它自己抵消，用户看到框还亮着。
  // ★ 真机 2026-10-16 13:37:52：只发一发 `deselect(channel)` 报了 ok 却毫无作用（选区原样还在）⇒ 现在把
  //   deselectDescs() 里的四种写法**全部依次发一遍**（不提前 return），逐条记日志；被 PS 回 ok 的写法列出来，
  //   全被拒才写 warn。谁真生效只能看画布，所以宁可多发。
  async function finishSelection(ps) {
    var forms = deselectDescs();
    var oks = [], errs = [];
    for (var i = 0; i < forms.length; i++) {
      var r = await ps.run([forms[i].desc], {
        history: "suspend", preserveSelection: false, label: "电商图片制作 · 取消选区（" + forms[i].label + "）",
        busyRetries: 2, busyBudgetMs: 8000
      });
      if (r && r.ok) oks.push(forms[i].label);
      else errs.push(forms[i].label + " → " + String((r && r.error) || "unknown"));
    }
    if (oks.length) {
      line(ps, "已发出取消选区命令（" + forms.length + " 种写法，PS 回 ok 的：" + oks.join(" / ") + "）");
      return { ok: true, forms: oks };
    }
    warn(ps, "取消选区的 " + forms.length + " 种写法全被拒（文档可能残留矩形选区）：" + errs.join("；"));
    return { ok: false, error: errs.join("；") };
  }

  // ctx = { layerId, layerName, first, an0, data }
  async function runPerObject(ps, S, ctx) {
    var an0 = ctx.an0, data = ctx.data, layerId = ctx.layerId, layerName = ctx.layerName;
    var spec = S.planObjectRotations(an0, { noopDeg: NOOP_THETA_DEG });
    for (var n = 0; n < spec.notes.length; n++) line(ps, "  · " + spec.notes[n]);
    if (spec.rotateCount === 0) {
      data.reason = an0.skipReason ? "multi-skip" : "no-object-to-rotate";
      warn(ps, "逐物体摆正：没有可单独摆正的物体" + (an0.skipReason ? "（" + an0.skipReason + "）" : "") +
        (spec.skips.length ? " —— " + skipsText(spec.skips) : ""));
      return { ok: true, data: data };
    }

    // ① 先烘焙图层蒙版：旋转选区的像素时蒙版不会跟着转（蒙版是主体原轮廓），不烘焙就会把
    //   转出去的边角按原轮廓裁掉 —— 视觉上物体顶端仍是水平切口（等于没摆正）。
    var basis = ctx.first.maskMode;
    if (ctx.first.maskMode === "layerMask") {
      var bake = await ps.applyUserMask(layerId, layerName, 30000);
      if (!bake || !bake.ok) {
        data.reason = "mask-bake-failed";
        data.error = String((bake && bake.error) || "unknown");
        warn(ps, "逐物体摆正需要先烘焙图层蒙版，但烘焙失败：" + data.error +
          " —— 画面未改动；请先在抠图步骤「应用蒙版」后再点一次");
        return { ok: true, data: data };
      }
      data.maskBaked = true;
      basis = "pixels";     // 蒙版没了 ⇒ 回读只能走像素基准
      line(ps, "逐物体摆正前已烘焙图层蒙版（否则旋转后的边角会被原轮廓蒙版裁掉）");
    }

    // ② 逐个物体：矩形选区 → 原地旋转
    var done = [], accAngle = 0;
    for (var i = 0; i < spec.items.length; i++) {
      var it = spec.items[i];
      if (!it.ok) { warn(ps, "物体 #" + it.index + " 跳过：" + it.reason); continue; }
      var angle = PS_ANGLE_SIGN * it.tiltDeg;
      var rectDoc = gridRectToDoc(it.rect, ctx.first.pixFrame, ctx.first.gridW, ctx.first.gridH, ctx.first.docW, ctx.first.docH);
      var r = await rotateRegion(ps, layerId, layerName, rectDoc, angle,
        "电商图片制作 · 逐物体摆正 #" + it.index + " " + f2(angle) + "°");
      if (!r.ok) {
        data.reason = "transform-rejected";
        data.error = r.error;
        warn(ps, "物体 #" + it.index + " 的选区变换被拒（angle=" + f2(angle) + "°，选区 " +
          Math.round(rectDoc.left) + "," + Math.round(rectDoc.top) + " → " + Math.round(rectDoc.right) + "," +
          Math.round(rectDoc.bottom) + "）：" + r.error + " —— 已停止逐物体旋转");
        await finishSelection(ps);
        return { ok: true, data: data };
      }
      line(ps, "物体 #" + it.index + "：倾斜 " + f2(it.tiltDeg) + "° → 发 angle=" + f2(angle) +
        "°（选区 " + Math.round(rectDoc.left) + "," + Math.round(rectDoc.top) + " → " +
        Math.round(rectDoc.right) + "," + Math.round(rectDoc.bottom) + "，外扩 " + it.padPx + "px）");
      accAngle += angle;
      done.push(it);
      data.turnsDeg.push(f2(angle));
    }
    data.applied = done.length > 0;
    data.appliedAngleDeg = f2(accAngle);
    await finishSelection(ps);

    // ③ 回读：每个物体都要更接近正位，且物体中心不能跑（防「绕图层中心转」把物体挪走）
    var after = await detect(ps, S, layerId, basis);
    if (!after.ok) {
      data.reason = "readback-failed";
      data.error = after.error;
      warn(ps, "已发出逐物体旋转但回读失败（无法证明是否摆正）：" + after.error + " —— 请用「回退」或手动确认");
      return { ok: true, data: data };
    }
    var aObjs = (after.analysis && after.analysis.objects) || [];
    var okAll = true, worst = 0, parts = [];
    for (var k = 0; k < done.length; k++) {
      var it2 = done[k];
      var mm = nearestObj(aObjs, it2.cx, it2.cy);
      var tol = Math.max(6, 0.02 * Math.max(it2.bw, it2.bh));
      if (!mm) {
        okAll = false;
        parts.push("#" + it2.index + " " + f2(it2.tiltDeg) + "° → 回读里找不到该物体");
        data.perObject.push({ index: it2.index, tiltBeforeDeg: f2(it2.tiltDeg), tiltAfterDeg: null, shiftPx: null, ok: false });
        continue;
      }
      var t1 = mm.obj.tiltDeg;
      var leveled = (Math.abs(t1) <= Math.abs(it2.tiltDeg) - MIN_IMPROVE_DEG) || (Math.abs(t1) <= NOOP_THETA_DEG);
      var centered = mm.dist <= tol;
      if (!leveled || !centered) okAll = false;
      if (Math.abs(t1) > worst) worst = Math.abs(t1);
      parts.push("#" + it2.index + " " + f2(it2.tiltDeg) + "° → " + f2(t1) + "°（中心位移 " + f2(mm.dist) +
        "px" + (centered ? "" : " ✗ 超过 " + f2(tol) + "px") + "）");
      data.perObject.push({
        index: it2.index, tiltBeforeDeg: f2(it2.tiltDeg), tiltAfterDeg: f2(t1),
        shiftPx: f2(mm.dist), ok: leveled && centered
      });
    }
    data.tiltAfterDeg = f2(worst);
    data.thetaAfterDeg = f2(after.analysis.thetaDeg);
    line(ps, "逐物体回读：" + parts.join(" · "));
    if (okAll) {
      data.verified = true;
      line(ps, "已逐物体摆正：主体层「" + layerName + "」共转 " + done.length + " 个物体，累计 " + f2(accAngle) +
        "°，最大残余倾斜 " + f2(worst) + "°（回读复核通过）");
    } else {
      data.reason = "verify-failed";
      warn(ps, "逐物体旋转已发出，但回读不完全达标（" + parts.join(" · ") + "）—— 请人工确认或用「回退」");
    }
    return { ok: true, data: data };
  }

  async function run(opts) {
    opts = opts || {};
    var m = mods();
    if (m.error) return { ok: false, error: m.error };
    var ps = m.ps, S = m.S;

    var layerId = (typeof opts.subjectLayerId === "number") ? opts.subjectLayerId : null;
    var layerName = String(opts.subjectLayerName || "主体层");
    if (layerId === null) return { ok: false, error: "没有主体图层 id（请先抠图或指定主体层）" };

    var first = await detect(ps, S, layerId);
    if (!first.ok) return { ok: false, error: first.error };
    var an0 = first.analysis;
    line(ps, detectLine(an0, first.maskMode));
    if (an0.mode === "multi") line(ps, objectsLine(an0));
    for (var i = 0; i < an0.notes.length; i++) line(ps, "  · " + an0.notes[i]);

    var objTilts = [];
    for (var oi = 0; oi < (an0.objectTilts || []).length; oi++) objTilts.push(f2(an0.objectTilts[oi]));

    var data = {
      verdict: an0.verdict, thetaDeg: f2(an0.thetaDeg), tiltDeg: f2(tiltOf(an0)),
      mode: an0.mode || "single", objectCount: an0.objectCount || 0,
      objectTilts: objTilts, objectResidualDeg: f2(an0.objectResidualDeg || 0),
      thetaAfterDeg: null, tiltAfterDeg: null,
      applied: false, appliedAngleDeg: 0, verified: false, turnsDeg: [],
      perObject: [], maskBaked: false,
      edgeRmsPct: f2(an0.edgeRmsPct), maxDeviation: f4(an0.perspective.maxDeviation),
      layerId: layerId, layerName: layerName
    };

    // ★ 多物体：整层按「中点」转一次只能让最歪的那个残余最小，另一个必然被转歪（真机 0.66°/2.03°）
    //   ⇒ 用户 2026-10-16 决策 A：保持单层、逐物体各转各的（见 runPerObject）。
    if (an0.mode === "multi") {
      return await runPerObject(ps, S, { layerId: layerId, layerName: layerName, first: first, an0: an0, data: data });
    }

    if (an0.verdict !== "micro") {
      // confirm（3°~15° 或残差不够干净）/ skip（>15°、异形、斜放）：不动画面，只写日志（PLAN §5.1）
      data.reason = "not-micro";
      warn(ps, "不动画面（" + an0.verdict + "）：" + (an0.verdict === "confirm"
        ? "角度或残差落在「建议人工确认」档 —— 请自己判断是否需要手动摆正"
        : "按跳过策略放过（多为斜放 / 异形 / 非平面，强行摆正会毁图）"));
      return { ok: true, data: data };
    }
    if (Math.abs(tiltOf(an0)) < NOOP_THETA_DEG) {
      data.reason = "already-level";
      line(ps, "不动画面：|倾斜| " + f2(tiltOf(an0)) + "° < " + NOOP_THETA_DEG + "°，已经摆正（幂等）");
      return { ok: true, data: data };
    }

    var want = PS_ANGLE_SIGN * tiltOf(an0);    // 目标：把长轴转回最近的轴向（横版→水平、竖版→竖直）
    var badTheta = null;                       // 第一次若把图转得更歪，记下当时的 θ
    var changed = false;                       // 有证据表明像素真的转了（不论转对转错）

    // ★ 真机 2026-10-16 10:46:31（用户 b-2.0 图）：主体层是 PS 默认锁定的「背景」层时，
    //   transform 被拒「命令"变换"当前不可用」，而 ps.run 会把它当"宿主忙"重试（compose.js:143 记过 8 次约 34s）。
    //   ⇒ 变换前先显式解锁（背景层会被转成普通层，见 ps.js ensureUnlocked）；解不开就只写警告返回，不空转重试。
    var unl = await ps.ensureUnlocked(layerId, layerName);
    if (!unl || !unl.ok) {
      data.reason = "layer-locked";
      data.error = String((unl && unl.error) || "unknown");
      warn(ps, "主体层被锁定且无法自动解锁：" + data.error + " —— 画面未改动，流程继续");
      return { ok: true, data: data };
    }
    // ★ 真机 2026-10-16 11:24 事故：背景层转普通层会【换 id】（1 → 2），ensureUnlocked 把新 id 交回来，
    //   必须换掉继续 —— 否则后面的 select / transform 全打在一个已不存在的图层上，PS 只会回
    //   「命令"选择"/"变换"当前不可用」，看起来像"解锁了但一直失败"。
    if (unl.data && unl.data.layerId !== undefined && String(unl.data.layerId) !== String(layerId)) {
      line(ps, "主体层 id 已由 " + layerId + " 变为 " + unl.data.layerId + "（背景层转换会换 id）→ 本次旋转改用新 id");
      layerId = Number(unl.data.layerId);
      data.layerId = layerId;
    }
    if (unl.data && unl.data.unlocked) {
      line(ps, "主体层「" + layerName + "」原本被锁定（" +
        ((unl.data.before && unl.data.before.why) ? unl.data.before.why.join("、") : "") +
        "）→ 已自动解锁（" + unl.data.via + "）后继续");
    }

    for (var attempt = 1; attempt <= MAX_ROTATE_ATTEMPTS; attempt++) {
      // 第 2 次＝把第 1 次的旋转反向补回来（净效果 = -want），只在上次「确实转向了另一侧」时才走
      var angle = (attempt === 1) ? want : (-2 * want);
      var r = await rotate(ps, layerId, layerName, angle,
        "电商图片制作 · 摆正 " + f2(angle) + "°" + (attempt === 1 ? "" : "（方向纠正）"));
      if (!r.ok) {
        data.reason = "transform-rejected";
        data.error = r.error;
        warn(ps, "变换被拒（angle=" + f2(angle) + "°）：" + r.error + " —— 画面未改动，流程继续");
        return { ok: true, data: data };
      }
      data.turnsDeg.push(f2(angle));
      data.appliedAngleDeg = f2(data.appliedAngleDeg + angle);

      var after = await detect(ps, S, layerId, first.maskMode);   // ★ 与首测同基准，否则会量到别的形状
      if (!after.ok) {
        data.reason = "readback-failed";
        data.error = after.error;
        data.applied = true;            // 转了，但没能证明转对了
        warn(ps, "已发出旋转 " + f2(angle) + "° 但回读失败（无法证明是否摆正）：" + after.error +
          " —— 请用「回退」或手动确认");
        return { ok: true, data: data };
      }
      var t1 = tiltOf(after.analysis), t0 = tiltOf(an0);
      line(ps, "回读（第 " + attempt + " 次，发 angle=" + f2(angle) + "°）：倾斜 " + f2(t0) + "° → " +
        f2(t1) + "°（θ " + f2(an0.thetaDeg) + "° → " + f2(after.analysis.thetaDeg) + "°）");

      // 判据一律跟【执行前】的倾斜比：目标是比出发点更接近最近的轴向
      if (Math.abs(t1) <= Math.abs(t0) - MIN_IMPROVE_DEG) {
        data.applied = true;
        data.verified = true;
        data.thetaAfterDeg = f2(after.analysis.thetaDeg);
        data.tiltAfterDeg = f2(t1);
        if (attempt > 1) {
          warn(ps, "第一次旋转的方向是反的（倾斜曾变成 " + f2(badTheta) + "°），已自动反向纠正 —— " +
            "建议把 src/straighten-apply.js 的 PS_ANGLE_SIGN 改成 " + (-PS_ANGLE_SIGN) + "（下次就不用纠正了）");
        }
        line(ps, "已摆正：主体层「" + layerName + "」累计旋转 " + f2(data.appliedAngleDeg) +
          "°，倾斜 " + f2(t0) + "° → " + f2(t1) + "°（回读复核通过）");
        return { ok: true, data: data };
      }

      if (Math.abs(t1) >= Math.abs(t0) + MIN_IMPROVE_DEG) {
        // 像素确实变了、而且更歪 ⇒ 方向常量反了：反向补一次（净效果＝另一个方向）
        changed = true;
        badTheta = t1;
        if (attempt < MAX_ROTATE_ATTEMPTS) {
          warn(ps, "这次旋转把图转得更歪了（倾斜 " + f2(t0) + "° → " + f2(t1) + "°）→ 反向纠正一次");
          continue;
        }
      }

      // ★ 用图层蒙版当基准后必须有的兜底：蒙版没跟着图层旋转时（未链接的蒙版 / 蒙版已被应用），
      //   蒙版基准会一直量到同一个倾斜 ⇒ 假「未生效」。像素基准再量一次即可区分：
      //   像素基准变好 ⇒ 其实转成功了，只是蒙版没动；像素基准同样没变 ⇒ 确实没生效。
      if (!changed && first.maskMode === "layerMask" && Math.abs(t1 - t0) < MIN_IMPROVE_DEG) {
        var alt = await detect(ps, S, layerId, "pixels");
        if (alt.ok) {
          var tAlt = tiltOf(alt.analysis);
          line(ps, "回读复核（图层蒙版几乎没动，改用像素基准 " + alt.maskMode + " 再量一次）：倾斜 " +
            f2(t0) + "° → " + f2(tAlt) + "°");
          if (Math.abs(tAlt) <= Math.abs(t0) - MIN_IMPROVE_DEG) {
            data.applied = true;
            data.verified = true;
            data.thetaAfterDeg = f2(alt.analysis.thetaDeg);
            data.tiltAfterDeg = f2(tAlt);
            data.maskBasisNote = "图层蒙版没跟着图层旋转（像素基准才量到变化）";
            line(ps, "已摆正：主体层「" + layerName + "」累计旋转 " + f2(data.appliedAngleDeg) +
              "°，倾斜 " + f2(t0) + "° → " + f2(tAlt) + "°（像素基准回读复核通过；图层蒙版未跟随旋转）");
            return { ok: true, data: data };
          }
        } else {
          line(ps, "回读复核失败（像素基准也量不了：" + alt.error + "），按未生效处理");
        }
      }

      // 走到这里 = 没能变得更好：要么像素压根没变（变换没生效），要么反向补一次后仍然不对
      data.applied = changed;
      data.verified = false;
      data.thetaAfterDeg = f2(after.analysis.thetaDeg);
      data.tiltAfterDeg = f2(t1);
      if (changed) {
        data.reason = "wrong-direction";
        warn(ps, "旋转没把倾斜拉回（倾斜 " + f2(t0) + "° → " + f2(t1) + "°）⇒ 已停止，" +
          "建议用「回退」复原后手动摆正");
      } else {
        data.reason = "no-effect";
        warn(ps, "旋转没有产生可测变化（倾斜仍 " + f2(t1) + "°，发的是 angle=" + f2(angle) + "°）⇒ 判定为未生效，" +
          "已停止（不再盲转；请检查主体层是否被锁定 / 是否处于变换会话中）");
      }
      return { ok: true, data: data };
    }
    // for 循环的每个分支都会 return，这里只作兜底
    data.reason = "unknown";
    return { ok: true, data: data };
  }

  window.Ecom.straightenApply = {
    run: run,
    // 供离线引用 / 日志复核：改这两个常量前先看 docs/PROBE-straighten.md §5.3
    NOOP_THETA_DEG: NOOP_THETA_DEG,
    MIN_IMPROVE_DEG: MIN_IMPROVE_DEG,
    PS_ANGLE_SIGN: PS_ANGLE_SIGN
  };
})();
