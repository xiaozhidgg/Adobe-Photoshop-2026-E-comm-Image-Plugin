// Ecom.analyze —— 主体统计（INTERFACE §6）
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  function clamp(n, lo, hi) {
    if (!isFinite(n)) return lo;
    return n < lo ? lo : n > hi ? hi : n;
  }

  // 只统计蒙版非零像素；无蒙版时全图统计（INTERFACE §6：不得报错）
  function collectStats(data) {
    var w = data.width;
    var h = data.height;
    var rgba = data.rgba;
    var channels = data.channels;
    var mask = data.alphaMask;
    var useMask = !!mask && mask.length >= w * h;

    var sumR = 0, sumG = 0, sumB = 0, sumLuma = 0, sumSat = 0, count = 0;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    var hist = new Uint32Array(256);

    for (var y = 0; y < h; y++) {
      var row = y * w;
      for (var x = 0; x < w; x++) {
        var i = row + x;
        if (useMask && mask[i] === 0) continue;
        var o = i * channels;
        var r = rgba[o];
        var g = rgba[o + 1];
        var b = rgba[o + 2];
        sumR += r; sumG += g; sumB += b;
        var luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        sumLuma += luma;
        var mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        var mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        sumSat += mx === 0 ? 0 : ((mx - mn) / mx) * 100;
        var bin = luma * 255;
        bin = bin < 0 ? 0 : bin > 255 ? 255 : bin | 0;
        hist[bin]++;
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (count === 0) return null;

    var meanR = sumR / count, meanG = sumG / count, meanB = sumB / count;
    var meanLuma = sumLuma / count;
    var meanSat = sumSat / count;

    function percentile(p) {
      var target = Math.round(p * (count - 1));
      var acc = 0;
      for (var k = 0; k < 256; k++) {
        acc += hist[k];
        if (acc > target) return k / 255;
      }
      return 1;
    }
    var p5 = percentile(0.05);
    var p95 = percentile(0.95);

    // 降采样网格坐标 → 文档坐标系像素
    var sx = data.docWidth / w;
    var sy = data.docHeight / h;
    var bounds = {
      left: Math.round(minX * sx),
      top: Math.round(minY * sy),
      right: Math.round((maxX + 1) * sx),
      bottom: Math.round((maxY + 1) * sy)
    };
    var bw = bounds.right - bounds.left;
    var bh = bounds.bottom - bounds.top;

    return {
      scope: useMask ? "subject" : "full",
      bounds: bounds,
      width: bw,
      height: bh,
      meanR: meanR,
      meanG: meanG,
      meanB: meanB,
      meanLuma: meanLuma,
      meanSat: meanSat,
      castRG: meanR - meanG,
      castBG: meanB - meanG,
      lumaP5: p5,
      lumaP95: p95,
      dynamicRange: p95 - p5,
      sampleCount: count,
      gridWidth: w,
      gridHeight: h
    };
  }

  async function subject() {
    var ps = window.Ecom.ps;
    try {
      var px = await ps.getSubjectPixels({ maxDim: 512 });
      // ★ v4：失败分支必须落盘 —— 否则真机上「调色自动全 0」查不出原因（用户日志里连一行统计失败都没有）
      if (!px.ok) {
        ps.log("error", "主体统计失败：" + px.error);
        return { ok: false, error: px.error };
      }
      var stats = collectStats(px.data);
      if (!stats) {
        ps.log("error", "主体统计失败：像素采样为空，无法统计主体（蒙版可能全为 0）");
        return { ok: false, error: "像素采样为空，无法统计主体（蒙版可能全为 0）" };
      }
      // 蒙版存在但裁剪掉全部像素时按全图回退，绝不报错（INTERFACE §6）
      if (stats.scope === "subject" && stats.sampleCount < 64) {
        ps.log("warn", "蒙版非零像素仅 " + stats.sampleCount + " 个，改用全图统计");
        var full = collectStats({
          width: px.data.width, height: px.data.height, rgba: px.data.rgba,
          channels: px.data.channels, alphaMask: null,
          docWidth: px.data.docWidth, docHeight: px.data.docHeight
        });
        if (full) stats = full;
      }
      ps.log("info", "主体统计 scope=" + stats.scope + " 尺寸=" + stats.width + "x" + stats.height +
        " 采样数=" + stats.sampleCount +
        " 平均亮度=" + stats.meanLuma.toFixed(3) + " 平均饱和=" + stats.meanSat.toFixed(1) +
        " 色偏RG=" + stats.castRG.toFixed(1) + " 色偏BG=" + stats.castBG.toFixed(1) +
        " 动态范围=" + stats.dynamicRange.toFixed(3));
      return { ok: true, data: stats };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      ps.log("error", "主体统计失败：" + msg);
      return { ok: false, error: "主体统计失败：" + msg };
    }
  }

  window.Ecom.analyze = {
    subject: subject,
    clamp: clamp
  };
})();
