// Ecom.compose —— 构图规范化（INTERFACE §10）
// imageSize(等比缩小, E17) → canvasSize(E18) → 主体层等比缩放 → JS 侧算位移(E20) 闭环居中
// ★ UXP 里没有对齐类命令（align / ADSCentersH 全树 0 命中）→ 居中必须自己算
// ★ 陷阱：transform 吃的是【当前激活图层】，只给 _target 而不先 select 会被静默丢掉（真机缺陷 #12a）
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  // ★ v3（契约 §10）：不再按名排除 "背景"。
  // 原因：PS 中文版把单层图片的像素层默认命名为「背景」，按名排除会误伤用户真正的画面层；
  // 插件自建的背景层是 kind==="solidColor"，已被 ps.findSubjectLayer 的 SUBJECT_KINDS 过滤掉，无需按名排除。
  // ★ v4：连「阴影」也不再按名排除 —— 插件不再创建任何固定名图层（投影改为图层样式），
  // 继续按名排除只会误伤用户自己名为「阴影」的图层。要排除什么一律由 opts.excludeLayerNames 显式传入。
  var FIXED_EXCLUDE = [];

  var CENTER_TOLERANCE = 2;    // px：偏离画布中心超过它才算未居中
  var CENTER_MAX_ROUNDS = 2;   // 最多校正轮数

  function clamp(n, lo, hi) {
    if (!isFinite(n)) return lo;
    return n < lo ? lo : n > hi ? hi : n;
  }

  function selectDoc(docId) {
    return { _obj: "select", _target: { _ref: "document", _id: docId } };
  }

  // ★ v3：transform 必须作用在当前激活图层上，_target 不足以定位 → 每次 transform 前都要 select
  function selectLayer(layerId) {
    return { _obj: "select", _target: [{ _ref: "layer", _id: layerId }] };
  }

  function transformLayer(layerId, params) {
    var d = { _obj: "transform", _target: [{ _ref: "layer", _id: layerId }] };
    var keys = Object.keys(params);
    for (var i = 0; i < keys.length; i++) d[keys[i]] = params[keys[i]];
    // 不带 QCSAverage 会以角落为基准，位移翻倍（INTERFACE §10）
    d.freeTransformCenterState = { _enum: "quadCenterState", _value: "QCSAverage" };
    return d;
  }

  async function resizeDoc(docId, w, h) {
    var ps = window.Ecom.ps;
    return ps.run([
      selectDoc(docId),
      { _obj: "imageSize", width: { _unit: "pixelsUnit", _value: w }, height: { _unit: "pixelsUnit", _value: h } }
    ], { history: "suspend", preserveSelection: true, label: "电商图片制作 · 图像大小" });
  }

  // 读 bounds 并算出「主体 bbox 中心 → 画布中心」的位移；闭环靠反复调用它校验
  async function offsetToCenter(ps, layerId, baseSize) {
    var r = await ps.layerBounds(layerId);
    if (!r.ok) return { ok: false, error: r.error };
    var b = r.data;
    return {
      ok: true,
      data: {
        bounds: b,
        dx: Math.round(baseSize / 2 - (b.left + b.right) / 2),
        dy: Math.round(baseSize / 2 - (b.top + b.bottom) / 2)
      }
    };
  }

  async function normalize(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    var baseSize = Number(opts.baseSize);
    if (!isFinite(baseSize) || baseSize <= 0) baseSize = 1600;
    baseSize = Math.round(baseSize);
    var marginPercent = Number(opts.marginPercent);
    if (!isFinite(marginPercent) || marginPercent < 0) marginPercent = 0;
    if (marginPercent > 45) marginPercent = 45;
    var exclude = FIXED_EXCLUDE.concat(opts.excludeLayerNames || []);
    var center = opts.center === undefined ? true : !!opts.center;   // v3：默认居中

    try {
      var docRes = await ps.activeDoc();
      if (!docRes.ok) return { ok: false, error: docRes.error };
      var docId = docRes.data.id;
      var docW = docRes.data.width;
      var docH = docRes.data.height;

      // 先整体缩到目标边长（只缩不放），避免 canvasSize 直接裁掉画面
      var longSide = Math.max(docW, docH);
      if (longSide > baseSize) {
        var k = baseSize / longSide;
        var nw = Math.max(1, Math.round(docW * k));
        var nh = Math.max(1, Math.round(docH * k));
        var rz = await resizeDoc(docId, nw, nh);
        if (!rz.ok) return { ok: false, error: "整体缩放失败：" + rz.error };
        ps.log("info", "构图：文档已整体等比缩放到 " + nw + "x" + nh);
      }

      // canvasSize：锚点/相对键名是 [推断]（手册 E18）→ 带 anchor 失败则退回只给宽高
      var canvasFallback = false;
      var cs = await ps.run([
        selectDoc(docId),
        {
          _obj: "canvasSize",
          width: { _unit: "pixelsUnit", _value: baseSize },
          height: { _unit: "pixelsUnit", _value: baseSize },
          anchor: { _enum: "anchorPosition", _value: "middleCenter" },
          relative: false
        }
      ], { history: "suspend", preserveSelection: true, label: "电商图片制作 · 画布大小" });
      if (!cs.ok) {
        ps.log("warn", "canvasSize 带 anchor/relative 失败（[推断] 键名），退回只给宽高：" + cs.error);
        var cs2 = await ps.run([
          selectDoc(docId),
          {
            _obj: "canvasSize",
            width: { _unit: "pixelsUnit", _value: baseSize },
            height: { _unit: "pixelsUnit", _value: baseSize }
          }
        ], { history: "suspend", preserveSelection: true, label: "电商图片制作 · 画布大小（回退）" });
        if (!cs2.ok) return { ok: false, error: "画布大小调整失败：" + cs.error + "；回退写法也失败：" + cs2.error };
        canvasFallback = true;
      }

      var after = await ps.activeDoc();
      if (!after.ok) return { ok: false, error: after.error };
      if (after.data.width !== baseSize || after.data.height !== baseSize) {
        ps.log("warn", "画布尺寸为 " + after.data.width + "x" + after.data.height + "，与目标 " +
          baseSize + "x" + baseSize + " 不一致（锚点/相对语义为 [推断] 项；位置上会由闭环居中校正）");
      }

      var found = await ps.findSubjectLayer({ excludeNames: exclude });
      if (!found.ok) return { ok: false, error: found.error };
      var subjectId = found.data.id;

      var boundsRes = await ps.layerBounds(subjectId);
      if (!boundsRes.ok) return { ok: false, error: boundsRes.error };
      var b0 = boundsRes.data;
      var maxEdge = Math.max(b0.width, b0.height);
      if (maxEdge <= 0) return { ok: false, error: "主体图层「" + found.data.name + "」的边界为空，无法构图" };

      var targetEdge = baseSize * (100 - 2 * marginPercent) / 100;
      var scale = clamp(targetEdge / maxEdge, 0.01, 20);
      var pct = scale * 100;

      // ★ 用户 m04284 真机事故（14:40:03）：主体层若是 PS 默认锁定的「背景」层，变换会被拒
      //   「命令"变换"当前不可用」→ 被当"宿主忙"重试 8 次（约 34s）＝用户眼里的"插件卡住"。
      //   ⇒ 变换前先解锁（并写日志）；解不开就直接失败，不空转重试。
      var unlock = await ps.ensureUnlocked(subjectId, found.data.name);
      if (!unlock.ok) return { ok: false, error: "主体图层被锁定，无法自动解锁：" + unlock.error };
      if (unlock.data && unlock.data.unlocked) {
        ps.log("info", "构图：主体层「" + found.data.name + "」原本被锁定（" +
          ((unlock.data.before && unlock.data.before.why) ? unlock.data.before.why.join("、") : "") + "）→ 已自动解锁后继续");
      }

      // ★ transform 之前显式 select 主体层（v2 只给 _target，缩放/居中被静默丢掉）
      var t1 = await ps.run([
        selectLayer(subjectId),
        transformLayer(subjectId, {
          width: { _unit: "percentUnit", _value: pct },
          height: { _unit: "percentUnit", _value: pct },
          interpolation: { _enum: "interpolationType", _value: "bicubic" }
        })
      ], {
        history: "suspend", preserveSelection: true, label: "电商图片制作 · 主体等比缩放",
        lockProbeLayerId: subjectId, lockProbeLayerName: found.data.name
      });
      if (!t1.ok) return { ok: false, error: "主体缩放失败：" + t1.error };

      var firstRes = await offsetToCenter(ps, subjectId, baseSize);
      if (!firstRes.ok) return { ok: false, error: firstRes.error };

      var movedTo = { x: 0, y: 0 };
      var centered = false;
      if (center) {
        // ★ v3 闭环：读 bounds → 算 dx,dy → transform(offset) → 重读 bounds 校验，
        //   仍偏离中心超过容差就再校正一轮（最多 CENTER_MAX_ROUNDS 轮）。
        //   这样位移不依赖 canvasSize 的 anchor/relative 语义（[推断] 项），锚点失效也能被纠回来。
        var cur = firstRes.data;
        for (var round = 1; round <= CENTER_MAX_ROUNDS; round++) {
          if (Math.abs(cur.dx) <= CENTER_TOLERANCE && Math.abs(cur.dy) <= CENTER_TOLERANCE) break;
          var t2 = await ps.run([
            selectLayer(subjectId),
            transformLayer(subjectId, {
              offset: {
                _obj: "offset",
                horizontal: { _unit: "pixelsUnit", _value: cur.dx },
                vertical: { _unit: "pixelsUnit", _value: cur.dy }
              },
              interpolation: { _enum: "interpolationType", _value: "bicubic" }
            })
          ], {
            history: "suspend", preserveSelection: true, label: "电商图片制作 · 主体居中（第 " + round + " 轮）",
            lockProbeLayerId: subjectId, lockProbeLayerName: found.data.name
          });
          if (!t2.ok) return { ok: false, error: "主体居中失败（第 " + round + " 轮）：" + t2.error };
          movedTo.x += cur.dx;
          movedTo.y += cur.dy;
          var againRes = await offsetToCenter(ps, subjectId, baseSize);
          if (!againRes.ok) return { ok: false, error: againRes.error };
          cur = againRes.data;
        }
        centered = Math.abs(cur.dx) <= CENTER_TOLERANCE && Math.abs(cur.dy) <= CENTER_TOLERANCE;
        if (!centered) {
          ps.log("warn", "构图：居中未在 " + CENTER_MAX_ROUNDS + " 轮内收敛，主体仍偏离中心 (" +
            cur.dx + "," + cur.dy + ")px（容差 " + CENTER_TOLERANCE + "px）；请人工确认画布状态");
        }
      } else {
        ps.log("info", "构图：center=false → 跳过居中，仅做等比缩放与画布尺寸调整");
      }

      var subjectPx = Math.round(maxEdge * scale);
      ps.log("info", "构图：画布 " + baseSize + "x" + baseSize + "，主体 " + subjectPx + "px（缩放 " +
        (scale * 100).toFixed(1) + "%），center=" + center + "，位移 (" + movedTo.x + "," + movedTo.y +
        ")，已居中=" + centered + (canvasFallback ? "，canvasSize 已回退写法" : ""));
      return {
        ok: true,
        data: {
          baseSize: baseSize,
          subjectPx: subjectPx,
          scale: scale,
          movedTo: { x: movedTo.x, y: movedTo.y },
          center: center,
          centered: centered,
          subjectLayerId: subjectId,
          canvasFallback: canvasFallback
        }
      };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "构图失败：" + msg };
    }
  }

  window.Ecom.compose = {
    normalize: normalize
  };
})();
