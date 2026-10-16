// Ecom.straighten —— 摆正量数学（纯函数，可离线 vm 载入自检）
// 依据 docs/PLAN-straighten.md §4（模块划分）/ §5（判定阈值）/ §6（验证方式）/ §9（只读探针）。
// ★ 本文件只做「检测」：不含旋转、不含变换、不含 UI、不含 FLOW。
// ★ 纯函数模块：不 require 任何东西，不引用宿主运行环境（宿主脚本 API / 脚本宿主 / DOM 一律不碰），
//   必须能在 Node 里用 vm 载入。
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  // ---- §5 判定阈值：对外导出，探针与离线自检都引这里，避免两处写死 ----
  var STRAIGHTEN_THRESHOLDS = {
    // 判定
    minCoverage: 0.01,        // 前景像素占比下限（低于即 ok:false）
    skipThetaDeg: 15,         // |相对最近轴向的倾斜 tilt| 超过即跳过（不是 |θ|：竖版主体的 θ 接近 90°）
    skipEdgeRmsPct: 3.0,      // 四边 RMS 残差上限（% 边长）
    skipMaxDeviation: 0.05,   // 透视偏差上限
    microThetaDeg: 5,         // 微调档角度上限（|相对轴向倾斜 tilt|）：≤5° 且四边拟合好就自动微调；
                              // 用户 2026-10-16 决策由 3° 放宽到 5°（真实产品图常见 3°~4°，3° 会让 A 档在实战中不干活）
    microEdgeRmsPct: 1.5,     // 微调档残差上限
    microMaxDeviation: 0.01,  // 微调档透视偏差上限
    // 像素 → 掩膜
    alphaThreshold: 128,      // mode:alpha 时 alpha >= 它算前景
    tolerance: 40,            // mode:bgThreshold 时与背景色的最大通道差 > 它算前景
    edgeBandPct: 0.02,        // 取背景色用的四周边缘带宽度（占该轴尺寸）
    // 四边残差采样
    edgeMidPct: 0.6,          // 每条边只取中间 60%
    edgeFitBandPct: 0.02,     // 直线拟合只吃「距该边 ≤ 2% 边长」的点
    // 诊断
    angleMismatchDeg: 5,      // 主轴角与旋转卡壳矩形角差超过它 → notes 记一句
    rectTieAreaPct: 0.005,    // 卡壳矩形面积并列判据（相对），并列时取与主轴一致的那个
    curvatureNotePct: 0.5,    // 近边带 RMS 与整边 RMS 差超过它 → notes 记一句（轮廓弯曲）
    maxBoundaryPoints: 20000, // 轮廓点上限，超出等距抽稀
    // ---- D 档：多物体（§8）----
    objMinAreaPct: 0.005,     // 单个连通域面积 < 画布 0.5% ⇒ 丢弃（噪点、碎屑、水印）
    objMergeGapPx: 3,         // 只桥接 ≤ 3px 的细缝（抗锯齿/白描边断裂）；★ 不用 PLAN §8 初稿的
                              // 「间距 < min(宽度)/4」——实测那对商品间距 52px < 65px，会被错误合并成一个
    objMaxCount: 5,           // 连通域上限：超过即视为「不是单件/少数几件商品图」，跳过
    objMinElongation: 1.2,    // 长宽方差比下限：低于它的物体近似圆形，倾斜无意义、不参与判定
    objMaxResidualDeg: 0.7    // 逐物体倾斜「极差/2」上限：超过 ⇒ 朝向不一致，只报告不动手
  };

  function pick(opts, key) {
    var v = opts ? opts[key] : undefined;
    var n = Number(v);
    return (v !== undefined && v !== null && isFinite(n)) ? n : STRAIGHTEN_THRESHOLDS[key];
  }

  function normalizeDeg(a) {
    while (a > 90) a -= 180;
    while (a <= -90) a += 180;
    return a;
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx, dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  // 中位数（偶数个取两中值平均后取整，保持像素域整数语义）
  function median(values) {
    var s = values.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    if (s.length === 0) return 0;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }

  // =====================================================================
  // 1) 像素 → 前景掩膜
  // =====================================================================
  // pixels 是【交错通道】的 Uint8Array/Uint8ClampedArray：[r,g,b(,a)] 逐像素（宿主 getSubjectPixels 的产物）
  function buildForegroundMask(pixels, width, height, opts) {
    opts = opts || {};
    var channels = (opts.channels === 3 || opts.channels === 4) ? opts.channels : 4;
    var alphaThreshold = pick(opts, "alphaThreshold");
    var tolerance = pick(opts, "tolerance");
    var edgeBandPct = pick(opts, "edgeBandPct");

    var w = Math.round(Number(width) || 0);
    var h = Math.round(Number(height) || 0);
    var stub = {
      ok: false, mode: channels === 4 ? "alpha" : "bgThreshold",
      mask: new Uint8Array(0), width: 0, height: 0, bg: null, coverage: 0
    };
    if (!(w > 0) || !(h > 0)) {
      stub.error = "宽高非法：" + width + "x" + height;
      return stub;
    }
    var need = w * h * channels;
    if (!pixels || typeof pixels.length !== "number" || pixels.length < need) {
      stub.error = "pixels 长度不足：需要 " + need + "，实际 " + (pixels ? pixels.length : "无");
      return stub;
    }

    var n = w * h;
    var mask = new Uint8Array(n);
    var i, o, transparent = false;
    if (channels === 4) {
      for (i = 0; i < n; i++) {
        if (pixels[i * 4 + 3] !== 255) { transparent = true; break; }
      }
    }

    // ★ opts.forceMode：回读必须与首测用同一基准。真机 2026-10-16 10:59:55 事故：把整层（不透明照片）转了 2°
    //   之后四角露出透明像素，本函数自动从 bgThreshold 切到 alpha，掩膜就从「卡片」变成「整张已旋转的画布矩形」，
    //   量到的 θ（−2.04°）其实是画布转过的角度 ⇒ 应用侧的保护逻辑被假信号触发而停手。
    var forceMode = (opts.forceMode === "alpha" || opts.forceMode === "bgThreshold") ? opts.forceMode : null;
    var useAlpha = forceMode ? (forceMode === "alpha") : (channels === 4 && transparent);
    if (useAlpha && channels !== 4) {
      stub.error = "forceMode=alpha 需要 4 通道像素（实际 " + channels + "）";
      return stub;
    }

    var mode, bg = null;
    if (useAlpha) {
      // 有真 alpha（存在半透明/透明）→ 以 alpha 为掩膜
      mode = "alpha";
      for (i = 0; i < n; i++) {
        mask[i] = pixels[i * 4 + 3] >= alphaThreshold ? 1 : 0;
      }
    } else {
      // 无 alpha 或 alpha 全 255（不指定图层读像素时的合成结果，宿主像素读取实现第 1613 行的情形）
      // → 用四周边缘带中位数当背景色，按通道差阈值分割
      // ★ 4 通道时 alpha < alphaThreshold 的像素一律当背景、并排除出背景色采样：整层旋转后露出的透明四角
      //   RGB 常是 (0,0,0)，既会被误判成前景（与浅色背景差得远），也会把背景色中位数拖到黑。
      mode = "bgThreshold";
      bg = estimateBgColor(pixels, w, h, channels, edgeBandPct, alphaThreshold);
      for (i = 0; i < n; i++) {
        o = i * channels;
        if (channels === 4 && pixels[o + 3] < alphaThreshold) { mask[i] = 0; continue; }
        var dr = pixels[o] > bg[0] ? pixels[o] - bg[0] : bg[0] - pixels[o];
        var dg = pixels[o + 1] > bg[1] ? pixels[o + 1] - bg[1] : bg[1] - pixels[o + 1];
        var db = pixels[o + 2] > bg[2] ? pixels[o + 2] - bg[2] : bg[2] - pixels[o + 2];
        var d = dr > dg ? (dr > db ? dr : db) : (dg > db ? dg : db);
        mask[i] = d > tolerance ? 1 : 0;
      }
    }

    var fg = 0;
    for (i = 0; i < n; i++) if (mask[i]) fg++;
    return {
      ok: true, mode: mode, mask: mask, width: w, height: h, bg: bg, coverage: fg / n
    };
  }

  // =====================================================================
  // 1.2) 图层蒙版（抠图产物）→ 前景掩膜
  // =====================================================================
  // ★ 抠图之后的【图层蒙版】就是主体轮廓，是比颜色阈值可靠得多的基准。
  //   真机 2026-10-16 12:40:21 事故：抠图已完成、图层蒙版非零占比 33.59%（可用），但那一层的像素 alpha
  //   仍是全 255（「按选区删背景」并未真的把像素变透明）⇒ buildForegroundMask 退回 bgThreshold(62.52%)，
  //   把灰底和产品一起当主体，四边残差 23.26% ⇒ 误判 skip，什么都不做。
  //   传进来的 alpha 由 ps.getSubjectPixels 保证已重采样到像素网格（alphaMask.length === w*h）。
  function buildMaskFromLayerMask(alpha, width, height, opts) {
    opts = opts || {};
    var alphaThreshold = pick(opts, "alphaThreshold");
    var minCoverage = pick(opts, "minCoverage");
    var maxCoverage = (typeof opts.maxCoverage === "number") ? opts.maxCoverage : 0.99;
    var w = Math.round(Number(width) || 0);
    var h = Math.round(Number(height) || 0);
    var stub = { ok: false, mode: "layerMask", mask: new Uint8Array(0), width: 0, height: 0, coverage: 0 };
    if (!(w > 0) || !(h > 0)) {
      stub.error = "宽高非法：" + width + "x" + height;
      return stub;
    }
    var n = w * h;
    if (!alpha || typeof alpha.length !== "number" || alpha.length < n) {
      stub.error = "图层蒙版长度不足：需要 " + n + "，实际 " + (alpha ? alpha.length : "无");
      return stub;
    }
    var mask = new Uint8Array(n);
    var fg = 0;
    for (var i = 0; i < n; i++) {
      if (alpha[i] >= alphaThreshold) { mask[i] = 1; fg++; }
    }
    var coverage = fg / n;
    if (coverage < minCoverage) {
      stub.error = "图层蒙版前景过少（" + coverage.toFixed(6) + " < minCoverage " + minCoverage + "）";
      return stub;
    }
    if (coverage > maxCoverage) {
      stub.error = "图层蒙版几乎全白（" + coverage.toFixed(6) + " > maxCoverage " + maxCoverage +
        "）⇒ 没有切出主体轮廓，不能当基准";
      return stub;
    }
    return { ok: true, mode: "layerMask", mask: mask, width: w, height: h, bg: null, coverage: coverage };
  }

  // 四周边缘带（各方向 bandPct 宽）像素的逐通道中位数
  // alphaMin：4 通道时跳过比它更透明的像素（全透明像素不作为背景色样本，理由见 buildForegroundMask 的
  //   bgThreshold 分支注释）；若整条边缘带都被筛空，则退回不筛样本的旧行为（否则中位数是空集）。
  function estimateBgColor(pixels, w, h, channels, bandPct, alphaMin) {
    var bw = Math.max(1, Math.round(bandPct * w));
    var bh = Math.max(1, Math.round(bandPct * h));
    var rs = [], gs = [], bs = [];
    for (var pass = 0; pass < 2; pass++) {
      var skipAlpha = (pass === 0 && channels === 4 && alphaMin > 0);
      for (var y = 0; y < h; y++) {
        var inYBand = (y < bh) || (y >= h - bh);
        var row = y * w;
        for (var x = 0; x < w; x++) {
          if (!inYBand && x >= bw && x < w - bw) continue;
          var o = (row + x) * channels;
          if (skipAlpha && pixels[o + 3] < alphaMin) continue;
          rs.push(pixels[o]);
          gs.push(pixels[o + 1]);
          bs.push(pixels[o + 2]);
        }
      }
      if (rs.length > 0) break;
    }
    return [median(rs), median(gs), median(bs)];
  }

  // =====================================================================
  // 1.5) D 档：多物体分离（连通域 → 面积过滤 → 逐物体倾斜）
  // =====================================================================
  // 背景（真机 2026-10-16 11:57:37，用户那张「纸盒 + 牙膏管」）：
  //   ① 并集掩膜的四边残差 21.57%（凸包边跨过了两个物体之间的空隙）⇒ 判 skip；
  //   ② 更危险的是并集的二阶矩把「两个物体的相对摆放」算成了倾斜：并集 tilt=3.85°，
  //      而两个物体各自只有 +1.29° 和 +0.25° —— 若按 3.85° 转会【过转】，把本来正的那个转歪。
  //   ⇒ 多物体必须逐个量，再决定「有共同角度可用」还是「交回人工」。
  // ★ 合并规则与 PLAN §8 初稿（bbox 间距 < min(两者宽度)/4 判同一物体）不同：实测那张图上两个物体
  //   间距约 52px < min(宽度)/4 ≈ 65px，按初稿会被合成一个物体、并集倾斜的错误原样复现。故这里只桥接
  //   ≤ objMergeGapPx 的「抗锯齿细缝」；同一物体被白色区域切成几块时，各块倾斜几乎相同，
  //   靠下面的「倾斜一致性」判据照样能过关，不需要靠距离合并。
  function labelComponents(mask, w, h) {
    var label = new Int32Array(w * h);
    var stack = new Int32Array(w * h);
    var comps = [];
    var next = 0;
    for (var y0 = 0; y0 < h; y0++) {
      var row0 = y0 * w;
      for (var x0 = 0; x0 < w; x0++) {
        var i0 = row0 + x0;
        if (!mask[i0] || label[i0]) continue;
        next++;
        var sp = 0;
        stack[sp++] = i0;
        label[i0] = next;
        var area = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
        var minX = x0, maxX = x0, minY = y0, maxY = y0;
        while (sp > 0) {
          var i = stack[--sp];
          var x = i % w;
          var y = (i - x) / w;
          area++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
          if (x > 0 && mask[i - 1] && !label[i - 1]) { label[i - 1] = next; stack[sp++] = i - 1; }
          if (x < w - 1 && mask[i + 1] && !label[i + 1]) { label[i + 1] = next; stack[sp++] = i + 1; }
          if (y > 0 && mask[i - w] && !label[i - w]) { label[i - w] = next; stack[sp++] = i - w; }
          if (y < h - 1 && mask[i + w] && !label[i + w]) { label[i + w] = next; stack[sp++] = i + w; }
        }
        comps.push({ labels: [next], minX: minX, maxX: maxX, minY: minY, maxY: maxY, area: area, sx: sx, sy: sy, sxx: sxx, syy: syy, sxy: sxy });
      }
    }
    // 连 label 一起返回：调用方要用它重建「只含保留连通域」的干净掩膜
    return { label: label, comps: comps };
  }

  function mergeComps(a, b) {
    a.labels = (a.labels || []).concat(b.labels || []);
    a.minX = Math.min(a.minX, b.minX); a.maxX = Math.max(a.maxX, b.maxX);
    a.minY = Math.min(a.minY, b.minY); a.maxY = Math.max(a.maxY, b.maxY);
    a.area += b.area; a.sx += b.sx; a.sy += b.sy;
    a.sxx += b.sxx; a.syy += b.syy; a.sxy += b.sxy;
    return a;
  }

  // 只桥接 ≤ gapPx 的细缝（抗锯齿/白描边造成的 1~3px 断裂）
  function mergeTinyGaps(comps, gapPx) {
    var changed = true;
    while (changed) {
      changed = false;
      for (var i = 0; i < comps.length && !changed; i++) {
        for (var j = i + 1; j < comps.length; j++) {
          var a = comps[i], b = comps[j];
          var gapX = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX) - 1);
          var gapY = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY) - 1);
          if (gapX <= gapPx && gapY <= gapPx) {
            mergeComps(a, b);
            comps.splice(j, 1);
            changed = true;
            break;
          }
        }
      }
    }
    return comps;
  }

  function compTilt(c) {
    var cx = c.sx / c.area, cy = c.sy / c.area;
    var mu20 = c.sxx / c.area - cx * cx;
    var mu02 = c.syy / c.area - cy * cy;
    var mu11 = c.sxy / c.area - cx * cy;
    var theta = normalizeDeg(0.5 * Math.atan2(2 * mu11, mu20 - mu02) * 180 / Math.PI);
    var tilt = theta;
    while (tilt > 45) tilt -= 90;
    while (tilt <= -45) tilt += 90;
    var lo = Math.min(mu20, mu02), hi = Math.max(mu20, mu02);
    return {
      labels: c.labels || [],
      cx: cx, cy: cy,
      w: c.maxX - c.minX + 1, h: c.maxY - c.minY + 1,
      // 原始包围盒（逐物体摆正要用它建矩形选区，w/h 是"外接矩形"宽度，不能当选区用）
      minX: c.minX, minY: c.minY, maxX: c.maxX, maxY: c.maxY,
      areaPx: c.area,
      thetaDeg: theta,
      tiltDeg: tilt,
      elongation: lo > 0 ? hi / lo : 1
    };
  }

  // =====================================================================
  // 1.6) D 档 proper：逐物体分开摆正 —— 纯规划（不做任何宿主操作）
  // =====================================================================
  // 用户 2026-10-16 决策（选项 A）：保持单层，用每个物体的【矩形选区】限定范围，各按自己的倾斜原地旋转。
  //   为什么不按「中点整层转一次」：真机两个物体是 0.66° / 2.03°，整层转只让最歪的那个残余最小，
  //   另一个必然被转歪 ~0.7°（视觉可辨）。
  // ★ 选区是矩形 ⇒ 必须给旋转留外扩量（转出选区的像素会被裁掉）；但外扩后若罩住邻居的包围盒，
  //   就会连邻居一起转 ⇒ 与任何其他物体相交就跳过该物体（宁可不动，也不误转）。
  // 返回 { items: [{ index（1 起）、ok、tiltDeg、cx、cy、bw、bh、padPx、rect（网格坐标，含外扩）、reason? }],
  //        rotateCount、skips: [{index, reason}]、notes }
  function planObjectRotations(an, opts) {
    opts = opts || {};
    var noopDeg = (typeof opts.noopDeg === "number") ? opts.noopDeg : 0.2;
    var padPx = (typeof opts.padPx === "number") ? opts.padPx : 2;
    var minElong = pick(opts, "objMinElongation");
    var out = { items: [], rotateCount: 0, skips: [], notes: [] };
    if (!an || an.mode !== "multi") {
      out.notes.push("不是多物体（mode=" + String((an && an.mode) || "single") + "）⇒ 不走逐物体路径");
      return out;
    }
    if (an.skipReason) {
      out.notes.push("多物体判定已给跳过理由：" + an.skipReason);
      return out;
    }
    var objs = an.objects || [];
    if (objs.length < 2) {
      out.notes.push("保留物体只有 " + objs.length + " 个 ⇒ 不走逐物体路径");
      return out;
    }
    for (var i = 0; i < objs.length; i++) {
      var o = objs[i];
      var bw = o.maxX - o.minX + 1, bh = o.maxY - o.minY + 1;
      var item = {
        index: i + 1, ok: false, tiltDeg: o.tiltDeg, cx: o.cx, cy: o.cy, bw: bw, bh: bh,
        padPx: 0, rect: null, reason: null
      };
      if (!(o.elongation >= minElong)) {
        item.reason = "近似方形（长宽方差比 " + o.elongation.toFixed(2) + " < " + minElong + "）⇒ 没有可信长轴，无法判断该转多少";
      } else if (Math.abs(o.tiltDeg) < noopDeg) {
        item.reason = "|倾斜| " + o.tiltDeg.toFixed(2) + "° < " + noopDeg + "° ⇒ 本来就在它的正位";
      } else {
        var pad = Math.ceil(0.5 * Math.sqrt(bw * bw + bh * bh) * Math.tan(Math.abs(o.tiltDeg) * Math.PI / 180)) + padPx;
        var rect = { left: o.minX - pad, top: o.minY - pad, right: o.maxX + pad, bottom: o.maxY + pad };
        item.padPx = pad;
        item.rect = rect;
        var hit = null;
        for (var j = 0; j < objs.length && !hit; j++) {
          if (j === i) continue;
          var q = objs[j];
          if (!(q.maxX < rect.left || q.minX > rect.right || q.maxY < rect.top || q.minY > rect.bottom)) hit = j + 1;
        }
        if (hit) {
          item.reason = "选区（外扩 " + pad + "px 后）罩住了 #" + hit + " 的包围盒 ⇒ 会把邻居一起转，跳过";
        } else {
          item.ok = true;
          out.rotateCount++;
        }
      }
      out.items.push(item);
      if (!item.ok) out.skips.push({ index: item.index, reason: item.reason });
    }
    return out;
  }

  // 返回 { objects, informative, tiltList, tiltDeg（各物体倾斜的中点）, residualDeg（极差/2）,
  //        ambiguous（倾斜不一致 ⇒ 只报告）, skipReason, notes }
  function detectObjects(mask, w, h, opts) {
    var gapPx = pick(opts, "objMergeGapPx");
    var minAreaPct = pick(opts, "objMinAreaPct");
    var maxCount = pick(opts, "objMaxCount");
    var minElong = pick(opts, "objMinElongation");
    var maxResidual = pick(opts, "objMaxResidualDeg");
    var notes = [];
    var lc = labelComponents(mask, w, h);
    var canvas = w * h;
    var survivors = [];
    var dropped = 0;
    for (var i = 0; i < lc.comps.length; i++) {
      if (lc.comps[i].area / canvas < minAreaPct) { dropped++; continue; }
      survivors.push(lc.comps[i]);
    }
    if (dropped > 0) notes.push("碎片过滤：丢掉 " + dropped + " 个面积 < 画布 " + (minAreaPct * 100).toFixed(2) + "% 的连通域");
    // 细缝合并只作用在【留下的分量】上（先按面积过滤再合并 ⇒ k 小得多）；
    // 分量数异常多（噪声掩膜）时直接跳过合并：mergeTinyGaps 是多轮 O(k²)，k 上百就可能冻住面板
    var comps = survivors;
    if (survivors.length > 200) {
      notes.push("保留连通域 " + survivors.length + " 个偏多 → 跳过细缝合并（仍按面积过滤）");
    } else {
      comps = mergeTinyGaps(survivors, gapPx);
    }
    var objects = [];
    for (var j = 0; j < comps.length; j++) objects.push(compTilt(comps[j]));
    objects.sort(function (a, b) { return b.areaPx - a.areaPx; });

    var informative = [];
    for (var k = 0; k < objects.length; k++) {
      if (objects[k].elongation >= minElong) informative.push(objects[k]);
      else notes.push("物体 #" + (k + 1) + " 近似圆形（长宽方差比 " + objects[k].elongation.toFixed(2) +
        " < " + minElong + "）→ 倾斜无意义，不参与判定");
    }

    var out = {
      objects: objects,
      informative: informative,
      tiltList: [],
      tiltDeg: 0,
      residualDeg: 0,
      ambiguous: false,
      skipReason: null,
      workMask: null,
      notes: notes
    };

    // 碎片丢弃后重建「干净掩膜」：单物体路径的矩与凸包必须只用保留的连通域，否则远处一个
    // 小碎块会把整张掩膜的主轴带偏（合成自检用例 23：真实倾斜 2° 被算成 42.73°）
    if (dropped > 0) {
      var keep = {};
      for (var q = 0; q < objects.length; q++) {
        var lls = objects[q].labels || [];
        for (var z = 0; z < lls.length; z++) keep[lls[z]] = 1;
      }
      var work = new Uint8Array(w * h);
      for (var p = 0; p < w * h; p++) {
        var L = lc.label[p];
        if (L && keep[L]) work[p] = 1;
      }
      out.workMask = work;
    }
    if (objects.length > maxCount) {
      out.skipReason = "连通域 " + objects.length + " 个 > objMaxCount " + maxCount + "（画面不像单件/少数几件商品图）";
      return out;
    }
    if (informative.length === 0) {
      out.skipReason = "没有可用的倾斜信息（" + objects.length + " 个物体全部近似圆形）";
      return out;
    }
    var lo = Infinity, hi = -Infinity;
    for (var m = 0; m < informative.length; m++) {
      var t = informative[m].tiltDeg;
      out.tiltList.push(t);
      if (t < lo) lo = t;
      if (t > hi) hi = t;
    }
    out.tiltDeg = (lo + hi) / 2;                 // 中点：让「最差的那个物体」残余倾斜最小
    out.residualDeg = (hi - lo) / 2;
    out.ambiguous = out.residualDeg > maxResidual;
    return out;
  }

  // 日志/notes 用的「+1.29° / +0.25°」串
  function fmtTiltList(list) {
    var s = "";
    for (var i = 0; i < list.length; i++) s += (i > 0 ? "° / " : "") + list[i].toFixed(2);
    return s + "°";
  }

  // =====================================================================
  // 2) 掩膜 → 摆正量
  // =====================================================================
  function analyzeMask(mask, width, height, opts) {
    opts = opts || {};
    var minCoverage = pick(opts, "minCoverage");
    var skipThetaDeg = pick(opts, "skipThetaDeg");
    var skipEdgeRmsPct = pick(opts, "skipEdgeRmsPct");
    var skipMaxDeviation = pick(opts, "skipMaxDeviation");
    var microThetaDeg = pick(opts, "microThetaDeg");
    var microEdgeRmsPct = pick(opts, "microEdgeRmsPct");
    var microMaxDeviation = pick(opts, "microMaxDeviation");
    var notes = [];

    var w = Math.round(Number(width) || 0);
    var h = Math.round(Number(height) || 0);
    if (!(w > 0) || !(h > 0)) {
      return { ok: false, reason: "宽高非法：" + width + "x" + height, coverage: 0, areaPx: 0, notes: notes };
    }
    if (!mask || typeof mask.length !== "number" || mask.length < w * h) {
      return { ok: false, reason: "掩膜长度不足：需要 " + (w * h), coverage: 0, areaPx: 0, notes: notes };
    }

    // ---- D 档：先分连通域（碎片丢弃 / 细缝合并），后面一律在「干净掩膜」work 上算 ----
    // 必须先做：远处一个小碎块会把整张掩膜的主轴带偏（合成自检用例 23：真实倾斜 2° 被算成 42.73°），
    // 而并集主轴在多物体时本身就没有判别力（见下面多物体分支）。
    var multi = detectObjects(mask, w, h, opts);
    var work = multi.workMask || mask;

    // ---- 面积 / 质心 / 二阶中心矩 ----
    var count = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0;
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        if (!work[row + x]) continue;
        count++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      }
    }
    var coverage = count / (w * h);
    if (count === 0 || coverage < minCoverage) {
      notes.push("前景像素 " + count + "，占比 " + coverage.toFixed(6) + " < minCoverage " + minCoverage);
      return { ok: false, reason: "前景过少", coverage: coverage, areaPx: count, notes: notes };
    }
    var cx = sx / count, cy = sy / count;
    var mu20 = sxx / count - cx * cx;
    var mu02 = syy / count - cy * cy;
    var mu11 = sxy / count - cx * cy;
    // 主轴角：θ = 0.5·atan2(2μ11, μ20-μ02)，归一到 (-90, 90]
    var thetaDeg = normalizeDeg(0.5 * Math.atan2(2 * mu11, mu20 - mu02) * 180 / Math.PI);

    // ★ 真正要纠的是「相对最近轴向的倾斜」tilt，不是 θ 本身：
    //   竖版主体（瓶子/盒子/牙膏管，产品图的大多数）长轴本来就接近竖直，θ ≈ ±90°，只歪几度时
    //   θ 却报成 86° —— 旧版据此判「斜放」直接跳过（真机 2026-10-16 11:38:35：真实竖版图 θ=-86.15°
    //   → skip，什么都没做）。把 θ 折叠到 (-45, 45] 就得到真正的倾斜量，且旋转方向天然正确
    //   （竖版主体仍以「保持竖直」为目标，不会被放倒）。
    var tiltDeg = thetaDeg;
    while (tiltDeg > 45) tiltDeg -= 90;
    while (tiltDeg <= -45) tiltDeg += 90;

    // ---- 轮廓点 / 凸包 / 最小外接矩形（旋转卡壳） ----
    var boundary = subsample(collectBoundary(work, w, h), STRAIGHTEN_THRESHOLDS.maxBoundaryPoints);
    var hull = convexHull(boundary);
    var rect = minAreaRect(hull, thetaDeg);
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) {
      return { ok: false, reason: "轮廓退化：凸包或最小外接矩形不可用", coverage: coverage, areaPx: count, notes: notes };
    }
    var angleDelta = Math.abs(normalizeDeg(rect.thetaDeg - thetaDeg));
    if (angleDelta > STRAIGHTEN_THRESHOLDS.angleMismatchDeg) {
      notes.push("主轴角 " + thetaDeg.toFixed(2) + "° 与最小外接矩形角 " +
        rect.thetaDeg.toFixed(2) + "° 相差 " + angleDelta.toFixed(2) + "°（以矩形角为准）");
    }

    // ---- 四极值点四边形（矩形局部坐标系，±45° 方向取极值 = 四个角） ----
    var quadInfo = quadFromExtremes(boundary, rect);

    // ---- 四边残差 ----
    var edgeInfo = edgeResiduals(boundary, rect);
    for (var k = 0; k < edgeInfo.notes.length; k++) notes.push(edgeInfo.notes[k]);
    var edges = edgeInfo.edges;
    var edgeRmsPct = Math.max(Math.max(edges.top, edges.right), Math.max(edges.bottom, edges.left));

    // ---- 透视 ----
    var topW = quadInfo.topW, botW = quadInfo.botW, leftH = quadInfo.leftH, rightH = quadInfo.rightH;
    var widthRatio = botW > 0 ? topW / botW : 0;
    var heightRatio = rightH > 0 ? leftH / rightH : 0;
    var maxDeviation = Math.max(Math.abs(1 - widthRatio), Math.abs(1 - heightRatio));
    var perspective = { widthRatio: widthRatio, heightRatio: heightRatio, maxDeviation: maxDeviation };

    // ---- D 档：多物体（连通域分离 → 逐物体倾斜） ----
    // ★ 并集的二阶矩会被「物体之间的相对摆放」带偏：真机 2026-10-16 11:57:37 那张「纸盒 + 牙膏管」，
    //   并集 tilt=3.85°（并集四边残差 21.57%），而两个物体各自只有 +1.29° 和 +0.25° —— 按 3.85° 转
    //   会【过转】，把本来已经正的那个转歪。故 ≥2 个物体时一律改用逐物体倾斜，并集残差/透视不再参与判定。
    //   （detectObjects 在算子前已跑过一次：碎片丢弃后的干净掩膜 work 就是它的产物）
    for (var mo = 0; mo < multi.notes.length; mo++) notes.push(multi.notes[mo]);
    var objects = multi.objects;
    var multiMode = objects.length >= 2;
    if (multiMode) tiltDeg = multi.tiltDeg;

    // ---- 判定（§5：先跳过、再微调、其余人工确认） ----
    var verdict, skipReason = multiMode ? multi.skipReason : null;
    if (multiMode) {
      // 多物体：并集的残差/透视没有判别力，跳过判据已在 detectObjects 里判好
    } else if (!quadInfo.valid) {
      skipReason = "凸包极值点不构成 4 个角（非凸 / 退化）";
    } else if (Math.abs(tiltDeg) > skipThetaDeg) {
      skipReason = "|相对轴向倾斜| " + Math.abs(tiltDeg).toFixed(2) + "° > skipThetaDeg " + skipThetaDeg +
        "（θ=" + thetaDeg.toFixed(2) + "°）";
    } else if (edgeRmsPct > skipEdgeRmsPct) {
      skipReason = "四边残差 " + edgeRmsPct.toFixed(2) + "% > skipEdgeRmsPct " + skipEdgeRmsPct;
    } else if (maxDeviation > skipMaxDeviation) {
      skipReason = "透视偏差 " + maxDeviation.toFixed(4) + " > skipMaxDeviation " + skipMaxDeviation;
    }

    if (skipReason !== null) {
      verdict = "skip";
      notes.push("跳过：" + skipReason);
    } else if (multiMode) {
      if (multi.ambiguous) {
        verdict = "confirm";
        notes.push("建议人工确认：多物体倾斜不一致（" + objects.length + " 个物体：" + fmtTiltList(multi.tiltList) +
          "，极差 " + (multi.residualDeg * 2).toFixed(2) + "° > 上限 " +
          (STRAIGHTEN_THRESHOLDS.objMaxResidualDeg * 2).toFixed(2) + "°）—— 没有任何单一角度能让它们同时摆正");
      } else if (Math.abs(tiltDeg) < microThetaDeg) {
        verdict = "micro";
        notes.push("可微调：多物体 " + objects.length + " 个（" + fmtTiltList(multi.tiltList) + "），取中点 " +
          tiltDeg.toFixed(2) + "°；并集残差 " + edgeRmsPct.toFixed(2) + "% / 透视 " + maxDeviation.toFixed(4) +
          " 在多物体时无判别力，已忽略");
      } else {
        verdict = "confirm";
        notes.push("建议人工确认：多物体 " + objects.length + " 个，取中点倾斜 " + tiltDeg.toFixed(2) +
          "° ≥ microThetaDeg " + microThetaDeg);
      }
    } else if (Math.abs(tiltDeg) < microThetaDeg &&
      edgeRmsPct <= microEdgeRmsPct &&
      maxDeviation <= microMaxDeviation) {
      verdict = "micro";
      notes.push("可微调：倾斜 " + tiltDeg.toFixed(2) + "°（θ=" + thetaDeg.toFixed(2) + "°，残差 " +
        edgeRmsPct.toFixed(2) + "% / 透视 " + maxDeviation.toFixed(4) + "）");
    } else {
      verdict = "confirm";
      notes.push("建议人工确认：倾斜 " + tiltDeg.toFixed(2) + "°（θ=" + thetaDeg.toFixed(2) + "°）、残差 " +
        edgeRmsPct.toFixed(2) + "%、透视 " + maxDeviation.toFixed(4));
    }

    return {
      ok: true,
      reason: undefined,
      coverage: coverage,
      areaPx: count,
      centroid: { x: cx, y: cy },
      thetaDeg: thetaDeg,
      tiltDeg: tiltDeg,
      mode: multiMode ? "multi" : "single",
      objectCount: objects.length,
      objects: objects,
      objectTilts: multi.tiltList,
      objectResidualDeg: multi.residualDeg,
      // skip 的理由单独给一个字段：逐物体摆正要先问「这个分析还允许动手吗」（notes 里那句是给人看的）
      skipReason: skipReason,
      minRect: { cx: rect.cx, cy: rect.cy, w: rect.w, h: rect.h, thetaDeg: rect.thetaDeg },
      edges: edges,
      edgeRmsPct: edgeRmsPct,
      quad: { topW: topW, botW: botW, leftH: leftH, rightH: rightH },
      perspective: perspective,
      verdict: verdict,
      notes: notes
    };
  }

  // 前景像素中「有 4 邻域是背景或越界」的算轮廓点
  function collectBoundary(mask, w, h) {
    var pts = [];
    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var i = row + x;
        if (!mask[i]) continue;
        if (x === 0 || y === 0 || x === w - 1 || y === h - 1 ||
          !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) {
          pts.push({ x: x, y: y });
        }
      }
    }
    return pts;
  }

  function subsample(points, maxN) {
    if (points.length <= maxN) return points;
    var stride = Math.ceil(points.length / maxN);
    var out = [];
    for (var i = 0; i < points.length; i += stride) out.push(points[i]);
    return out;
  }

  // Andrew monotone chain（逆时针，去掉共线点）
  function convexHull(points) {
    var pts = points.slice().sort(function (a, b) { return (a.x - b.x) || (a.y - b.y); });
    if (pts.length < 3) return pts;
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function cross(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  }

  // 矩形角度差对 90° 取模（<a> 与 <a+90> 是同一个矩形）
  function angDiffMod90(a, b) {
    var d = Math.abs(normalizeDeg(a - b));
    return Math.min(d, 90 - d);
  }

  // 旋转卡壳：枚举凸包每条边方向，取面积最小的外接矩形。
  // ★ 面积近似并列（≤ rectTieAreaPct）时取「与主轴一致」的那个：等腰梯形的
  //   斜边方向矩形与水平方向矩形面积只差万分之一，纯按面积取会让四边形坐标系退化。
  function minAreaRect(hull, principalDeg) {
    var n = hull.length;
    if (n < 3) return null;
    var cands = [];
    for (var i = 0; i < n; i++) {
      var p = hull[i], q = hull[(i + 1) % n];
      var dx = q.x - p.x, dy = q.y - p.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len === 0) continue;
      var ux = dx / len, uy = dy / len;     // 沿边方向
      var vx = -uy, vy = ux;                // 垂直方向
      var minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
      for (var j = 0; j < n; j++) {
        var rx = hull[j].x - p.x, ry = hull[j].y - p.y;
        var u = rx * ux + ry * uy;
        var v = rx * vx + ry * vy;
        if (u < minU) minU = u;
        if (u > maxU) maxU = u;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
      }
      var rw = maxU - minU, rh = maxV - minV;
      var area = rw * rh;
      var ang = normalizeDeg(Math.atan2(uy, ux) * 180 / Math.PI);
      if (rw < rh) {
        var t = rw; rw = rh; rh = t;
        ang = normalizeDeg(ang + 90);
      }
      var cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
      cands.push({
        area: area, w: rw, h: rh, thetaDeg: ang,
        cx: p.x + ux * cu + vx * cv,
        cy: p.y + uy * cu + vy * cv
      });
    }
    if (!cands.length) return null;
    var minArea = Infinity, k;
    for (k = 0; k < cands.length; k++) if (cands[k].area < minArea) minArea = cands[k].area;
    var limit = minArea * (1 + STRAIGHTEN_THRESHOLDS.rectTieAreaPct);
    var best = null, bestDiff = Infinity;
    for (k = 0; k < cands.length; k++) {
      var c = cands[k];
      if (c.area > limit) continue;
      var diff = isFinite(principalDeg) ? angDiffMod90(c.thetaDeg, principalDeg) : 0;
      if (best === null || diff < bestDiff || (diff === bestDiff && c.area < best.area)) {
        best = c;
        bestDiff = diff;
      }
    }
    return best;
  }

  // 把点投到矩形局部坐标系（原点=矩形中心，x 轴=矩形长边方向）
  function toLocal(p, rect) {
    var t = rect.thetaDeg * Math.PI / 180;
    var c = Math.cos(t), s = Math.sin(t);
    var dx = p.x - rect.cx, dy = p.y - rect.cy;
    return { x: dx * c + dy * s, y: -dx * s + dy * c };
  }

  // 局部坐标系里沿 ±45° 取 4 个极值点 = 四边形的四个角
  // （等比矩形/等腰梯形时这四个点就是真角点；退化形状会出现重合点 → valid=false）
  function quadFromExtremes(points, rect) {
    var bestS = Infinity, bestD = -Infinity, bestS2 = -Infinity, bestD2 = Infinity;
    var TL = null, TR = null, BR = null, BL = null;
    for (var i = 0; i < points.length; i++) {
      var q = toLocal(points[i], rect);
      var sum = q.x + q.y, dif = q.x - q.y;
      if (sum < bestS) { bestS = sum; TL = q; }
      if (dif > bestD) { bestD = dif; TR = q; }
      if (sum > bestS2) { bestS2 = sum; BR = q; }
      if (dif < bestD2) { bestD2 = dif; BL = q; }
    }
    var out = { valid: false, topW: 0, botW: 0, leftH: 0, rightH: 0 };
    if (!TL || !TR || !BR || !BL) return out;
    if (samePoint(TL, TR) || samePoint(TL, BR) || samePoint(TL, BL) ||
      samePoint(TR, BR) || samePoint(TR, BL) || samePoint(BR, BL)) {
      return out;
    }
    // 四边形面积（鞋带公式），角点必须构成非退化四边形
    var area = Math.abs(
      TL.x * TR.y - TR.x * TL.y + TR.x * BR.y - BR.x * TR.y +
      BR.x * BL.y - BL.x * BR.y + BL.x * TL.y - TL.x * BL.y) / 2;
    if (!(area > 0)) return out;
    out.valid = true;
    out.topW = dist(TL.x, TL.y, TR.x, TR.y);
    out.botW = dist(BL.x, BL.y, BR.x, BR.y);
    out.leftH = dist(TL.x, TL.y, BL.x, BL.y);
    out.rightH = dist(TR.x, TR.y, BR.x, BR.y);
    return out;
  }

  function samePoint(a, b) {
    return Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;
  }

  // 四边 RMS 残差（单位：该边长的百分比）
  // 采样：局部坐标系里「沿边投影落在中间 60%」且离该边最近的点才归给这条边；
  // 直线拟合只用「距该边 ≤ 2% 边长」的点（总体最小二乘 = PCA 主轴）；
  // 残差在归给该边的全部点上算 —— 只取近边带会把圆形/弧形边的局部直线性算成 0 残差。
  function edgeResiduals(points, rect, opts) {
    var mid = pick(opts, "edgeMidPct") / 2;             // 中间 60% → ±0.3
    var fitBand = pick(opts, "edgeFitBandPct");
    var halfW = rect.w / 2, halfH = rect.h / 2;
    var midW = mid * rect.w, midH = mid * rect.h;
    var names = ["top", "right", "bottom", "left"];
    var assigned = { top: [], right: [], bottom: [], left: [] };
    var fits = { top: [], right: [], bottom: [], left: [] };
    var i, q;

    for (i = 0; i < points.length; i++) {
      q = toLocal(points[i], rect);
      var bestEdge = null, bestDist = Infinity, d;
      if (q.y < 0 && Math.abs(q.x) <= midW) { d = Math.abs(q.y + halfH); if (d < bestDist) { bestDist = d; bestEdge = "top"; } }
      if (q.y > 0 && Math.abs(q.x) <= midW) { d = Math.abs(q.y - halfH); if (d < bestDist) { bestDist = d; bestEdge = "bottom"; } }
      if (q.x < 0 && Math.abs(q.y) <= midH) { d = Math.abs(q.x + halfW); if (d < bestDist) { bestDist = d; bestEdge = "left"; } }
      if (q.x > 0 && Math.abs(q.y) <= midH) { d = Math.abs(q.x - halfW); if (d < bestDist) { bestDist = d; bestEdge = "right"; } }
      if (bestEdge === null) continue;
      assigned[bestEdge].push(q);
      var edgeLen = (bestEdge === "top" || bestEdge === "bottom") ? rect.w : rect.h;
      if (bestDist <= fitBand * edgeLen) fits[bestEdge].push(q);
    }

    var edges = { top: 0, right: 0, bottom: 0, left: 0 };
    var bandEdges = { top: 0, right: 0, bottom: 0, left: 0 };
    var notes = [];
    for (i = 0; i < names.length; i++) {
      var name = names[i];
      var edgeLen2 = (name === "top" || name === "bottom") ? rect.w : rect.h;
      var fallback = (name === "top" || name === "bottom") ? rect.thetaDeg : rect.thetaDeg + 90;
      var fallbackRad = fallback * Math.PI / 180;
      // 拟合集：近边带点；不足 2 个就退回该边全部归属点
      var fitPts = (fits[name].length >= 2) ? fits[name] : assigned[name];
      if (fitPts.length < 2) {
        edges[name] = 0;
        bandEdges[name] = 0;
        notes.push("边 " + name + " 采样点不足（" + fitPts.length + "），残差记 0");
        continue;
      }
      var line = fitLine(fitPts, fallbackRad);
      // 报告值：归给该边的全部点
      var reportPts = (assigned[name].length >= 2) ? assigned[name] : fitPts;
      edges[name] = rmsToLine(reportPts, line) / edgeLen2 * 100;
      bandEdges[name] = rmsToLine(fitPts, line) / edgeLen2 * 100;
      if (edges[name] - bandEdges[name] > STRAIGHTEN_THRESHOLDS.curvatureNotePct) {
        notes.push("边 " + name + " 残差主要来自轮廓弯曲：整边 " + edges[name].toFixed(2) +
          "% vs 近边带 " + bandEdges[name].toFixed(2) + "%（报告用整边）");
      }
    }
    return { edges: edges, bandEdges: bandEdges, notes: notes };
  }

  // 总体最小二乘（PCA）直线：返回过质心、沿主方向的一条直线
  function fitLine(pts, fallbackRad) {
    var n = pts.length, i, dx, dy;
    var mx = 0, my = 0;
    for (i = 0; i < n; i++) { mx += pts[i].x; my += pts[i].y; }
    mx /= n; my /= n;
    var cxx = 0, cyy = 0, cxy = 0;
    for (i = 0; i < n; i++) {
      dx = pts[i].x - mx; dy = pts[i].y - my;
      cxx += dx * dx; cyy += dy * dy; cxy += dx * dy;
    }
    cxx /= n; cyy /= n; cxy /= n;
    if (cxx + cyy < 1e-12) {
      return { x: mx, y: my, ux: Math.cos(fallbackRad), uy: Math.sin(fallbackRad) };
    }
    var ang = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
    return { x: mx, y: my, ux: Math.cos(ang), uy: Math.sin(ang) };
  }

  function rmsToLine(pts, line) {
    var sum = 0, i, dx, dy, perp;
    for (i = 0; i < pts.length; i++) {
      dx = pts[i].x - line.x; dy = pts[i].y - line.y;
      perp = dx * (-line.uy) + dy * line.ux;   // 到直线的垂直距离
      sum += perp * perp;
    }
    return Math.sqrt(sum / pts.length);
  }

  window.Ecom.straighten = {
    STRAIGHTEN_THRESHOLDS: STRAIGHTEN_THRESHOLDS,
    buildForegroundMask: buildForegroundMask,
    buildMaskFromLayerMask: buildMaskFromLayerMask,
    planObjectRotations: planObjectRotations,
    analyzeMask: analyzeMask
  };
})();
