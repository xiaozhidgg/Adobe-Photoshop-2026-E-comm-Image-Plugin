// 摆正量数学离线自检（不依赖 Photoshop，不需要真实图片）
// 运行：node verify/straighten-math-check.js
// 载入方式沿用本仓库既有离线脚本（%TEMP%\ecom-v6-check.js）：vm + 伪造 {window, console}
//
// 合成基准角就是声明角：掩膜按「逐像素点在旋转坐标系内判定」生成
// （局部坐标 [lx,ly] = R(-θ)·(p - 中心)，|lx| <= 半宽 且 |ly| <= 半高 即为前景）。
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const MODULE = path.join(__dirname, "..", "plugin", "src", "straighten.js");
const sandbox = { window: { Ecom: {} }, console: console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(MODULE, "utf8"), sandbox, { filename: "straighten.js" });

const S = sandbox.window.Ecom.straighten;
const TH = S.STRAIGHTEN_THRESHOLDS;

let cases = 0;
let asserts = 0;
let fails = 0;

function ok(cond, label, extra) {
  asserts++;
  if (cond) {
    console.log("  PASS  " + label + (extra ? "   " + extra : ""));
  } else {
    fails++;
    console.log("  FAIL  " + label + (extra ? "   " + extra : ""));
  }
}

function head(name) {
  cases++;
  console.log("\n[用例 " + cases + "] " + name);
}

function f(n, d) {
  const k = d === undefined ? 2 : d;
  return (Number(n) >= 0 ? " " : "") + Number(n).toFixed(k);
}

// ---------------------------------------------------------------- 合成
// 旋转矩形掩膜：声明角 θ 通过旋转坐标系判定，基准角 == 声明角
function makeRectMask(w, h, cx, cy, hw, hh, thetaDeg) {
  const mask = new Uint8Array(w * h);
  const t = thetaDeg * Math.PI / 180;
  const c = Math.cos(t), s = Math.sin(t);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      const lx = dx * c + dy * s;      // R(-θ)
      const ly = -dx * s + dy * c;
      if (Math.abs(lx) <= hw && Math.abs(ly) <= hh) { mask[y * w + x] = 1; count++; }
    }
  }
  return { mask: mask, count: count };
}

// 等腰梯形掩膜：上宽 topW（y=y0 行）、下宽 botW（y=y0+height-1 行），水平居中于 cx
function makeTrapezoidMask(w, h, cx, topW, botW, height, y0) {
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let k = 0; k < height; k++) {
    const t = height === 1 ? 0 : k / (height - 1);
    const halfW = (topW + (botW - topW) * t) / 2;
    const y = y0 + k;
    for (let x = 0; x < w; x++) {
      if (Math.abs(x - cx) <= halfW) { mask[y * w + x] = 1; count++; }
    }
  }
  return { mask: mask, count: count };
}

// 圆（异形轮廓）掩膜
function makeCircleMask(w, h, cx, cy, r) {
  const mask = new Uint8Array(w * h);
  let count = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) { mask[y * w + x] = 1; count++; }
    }
  }
  return { mask: mask, count: count };
}

// RGBA 交错通道缓冲：把掩膜画成前景色，其余填背景色/背景 alpha
function paint(w, h, mask, fg, bg, fgAlpha, bgAlpha, channels) {
  const px = new Uint8Array(w * h * channels);
  for (let i = 0; i < w * h; i++) {
    const o = i * channels;
    const on = mask[i] === 1;
    px[o] = on ? fg[0] : bg[0];
    px[o + 1] = on ? fg[1] : bg[1];
    px[o + 2] = on ? fg[2] : bg[2];
    if (channels === 4) px[o + 3] = on ? fgAlpha : bgAlpha;
  }
  return px;
}

// ---------------------------------------------------------------- 用例 1：契约
head("契约：导出形状与阈值常量");
ok(S && typeof S.buildForegroundMask === "function" && typeof S.analyzeMask === "function",
  "window.Ecom.straighten 暴露两个纯函数");
ok(TH && TH.minCoverage === 0.01 && TH.skipThetaDeg === 15 && TH.skipEdgeRmsPct === 3.0 &&
  TH.skipMaxDeviation === 0.05 && TH.microThetaDeg === 5 && TH.microEdgeRmsPct === 1.5 &&
  TH.microMaxDeviation === 0.01,
  "STRAIGHTEN_THRESHOLDS 七个判定阈值与任务书一致",
  "minCoverage=" + TH.minCoverage + " skip=" + TH.skipThetaDeg + "/" + TH.skipEdgeRmsPct + "/" +
  TH.skipMaxDeviation + " micro=" + TH.microThetaDeg + "/" + TH.microEdgeRmsPct + "/" + TH.microMaxDeviation);
ok(TH.objMinAreaPct === 0.005 && TH.objMergeGapPx === 3 && TH.objMaxCount === 5 &&
  TH.objMinElongation === 1.2 && TH.objMaxResidualDeg === 0.7,
  "D 档五个多物体阈值与任务书一致",
  "面积下限=" + TH.objMinAreaPct + " 细缝=" + TH.objMergeGapPx + "px 数量上限=" + TH.objMaxCount +
  " 长宽方差比=" + TH.objMinElongation + " 极差/2上限=" + TH.objMaxResidualDeg);

// ---------------------------------------------------------------- 用例 2-6：旋转矩形
// 这一组刻意放大合成尺寸：二值栅格化的角度分辨率随物体像素尺寸下降（见用例 14），
// 用 560x360 的矩形可让栅格化误差远小于 0.15° 的断言预算，测到的是数学而不是栅格。
const W = 400, H = 400, CX = 200, CY = 200, HW = 110, HH = 70;          // 其余用例的画布（矩形 220x140）
const RW = 900, RH = 900, RCX = 450, RCY = 450, RHW = 280, RHH = 180;   // 旋转矩形用例：矩形 560x360
const RECT_CASES = [0.5, 2, 5, 10, -3.5, -7];
console.log("\n【旋转矩形】画布 " + RW + "x" + RH + "，矩形 " + (RHW * 2) + "x" + (RHH * 2) +
  "，中心 (" + RCX + "," + RCY + ")");
console.log("  声明θ    测得θ(主轴)  测得θ(卡壳矩形)  θ误差   残差%   透视偏差   verdict");
for (const declared of RECT_CASES) {
  const syn = makeRectMask(RW, RH, RCX, RCY, RHW, RHH, declared);
  const r = S.analyzeMask(syn.mask, RW, RH);
  const dTheta = r.thetaDeg - declared;
  const dRect = r.minRect.thetaDeg - declared;
  console.log("  " + f(declared, 1) + "°   " + f(r.thetaDeg, 2) + "°      " + f(r.minRect.thetaDeg, 2) +
    "°        " + f(dTheta, 3) + "°  " + f(r.edgeRmsPct, 2) + "   " + f(r.perspective.maxDeviation, 4) +
    "    " + r.verdict);

  head("旋转矩形 θ=" + declared + "°（合成基准角即声明角）");
  ok(r.ok === true, "ok=true", "coverage=" + f(r.coverage, 4) + " area=" + r.areaPx);
  ok(Math.abs(dTheta) <= 0.15, "主轴角 |测得-声明| <= 0.15°", "Δ=" + f(dTheta, 4) + "°");
  ok(Math.abs(dRect) <= 0.2, "卡壳矩形角 |测得-声明| <= 0.20°", "Δ=" + f(dRect, 4) + "°");
  ok(Math.abs(r.minRect.w - RHW * 2) <= 3 && Math.abs(r.minRect.h - RHH * 2) <= 3,
    "最小外接矩形尺寸 ≈ 560x360", "w=" + f(r.minRect.w, 1) + " h=" + f(r.minRect.h, 1));
  ok(r.edgeRmsPct <= 1.0, "四边 RMS 残差 <= 1.0%（真直边）", "max=" + f(r.edgeRmsPct, 3) + "%");
  ok(Math.abs(r.perspective.maxDeviation) <= 0.01, "透视偏差 <= 0.01（平行边）",
    "maxDeviation=" + f(r.perspective.maxDeviation, 4));
  // 档位按【测得】tilt 判（声明 5° 会因二值栅格化落到 4.99° 而进 micro，这是量化噪声不是缺陷）
  if (Math.abs(r.tiltDeg) < 5) {
    ok(r.verdict === "micro", "verdict=micro（测得 |tilt| < microThetaDeg 5）",
      "tilt=" + f(r.tiltDeg, 3) + "° verdict=" + r.verdict);
  } else {
    ok(r.verdict === "confirm" || r.verdict === "skip", "verdict=confirm/skip（测得 |tilt| >= 5°）",
      "tilt=" + f(r.tiltDeg, 3) + "° verdict=" + r.verdict);
  }
}

// ---------------------------------------------------------------- 用例 7-9：梯形（透视）
const TRAPS = [
  { topW: 190, botW: 200 },
  { topW: 180, botW: 200 },
  { topW: 160, botW: 200 }
];
console.log("\n【梯形（透视）】画布 " + W + "x" + H + "，高 160，下宽 200");
console.log("  声明topW/botW  声明偏差  widthRatio  heightRatio  测得偏差   偏差误差   verdict");
for (const t of TRAPS) {
  const declaredDev = Math.abs(1 - t.topW / t.botW);
  const syn = makeTrapezoidMask(W, H, 200, t.topW, t.botW, 160, 120);
  const r = S.analyzeMask(syn.mask, W, H);
  const devErr = r.perspective.maxDeviation - declaredDev;
  console.log("  " + t.topW + "/" + t.botW + "        " + f(declaredDev, 3) + "     " +
    f(r.perspective.widthRatio, 4) + "    " + f(r.perspective.heightRatio, 4) + "     " +
    f(r.perspective.maxDeviation, 4) + "    " + f(devErr, 4) + "     " + r.verdict);

  head("梯形 topW/botW=" + (t.topW / t.botW).toFixed(2) + "（声明透视偏差 " + declaredDev.toFixed(2) + "）");
  ok(r.ok === true, "ok=true", "coverage=" + f(r.coverage, 4) + " area=" + r.areaPx);
  ok(Math.abs(devErr) <= 0.02, "|测得 maxDeviation - 声明| <= 0.02", "Δ=" + f(devErr, 4));
  ok(r.perspective.maxDeviation > 0.01, "透视偏差确实 > microMaxDeviation 0.01",
    "maxDeviation=" + f(r.perspective.maxDeviation, 4));
  ok(r.verdict !== "micro", "verdict != micro（异形轮廓不微调）", "verdict=" + r.verdict);
  ok(r.quad.topW >= r.quad.botW || Math.abs(r.quad.botW - t.botW) <= 2,
    "四边形下边宽 ≈ 下底宽 200", "topW=" + f(r.quad.topW, 1) + " botW=" + f(r.quad.botW, 1));
}

// ---------------------------------------------------------------- 用例 10：圆（异形）
head("圆形 r=110（异形轮廓，必须零改动）");
const circle = makeCircleMask(W, H, CX, CY, 110);
const rc = S.analyzeMask(circle.mask, W, H);
console.log("  测得：coverage=" + f(rc.coverage, 4) + " theta=" + f(rc.thetaDeg, 2) + "° 残差 top/right/bottom/left=" +
  f(rc.edges.top, 2) + "/" + f(rc.edges.right, 2) + "/" + f(rc.edges.bottom, 2) + "/" + f(rc.edges.left, 2) +
  "% max=" + f(rc.edgeRmsPct, 2) + "% 透视偏差=" + f(rc.perspective.maxDeviation, 4) + " verdict=" + rc.verdict);
console.log("  notes: " + JSON.stringify(rc.notes));
ok(rc.ok === true, "ok=true", "area=" + rc.areaPx);
ok(rc.verdict !== "micro", "verdict != micro（圆弧不是直边，不得判微调）", "verdict=" + rc.verdict);
ok(rc.edgeRmsPct > TH.microEdgeRmsPct, "四边残差 > microEdgeRmsPct 1.5%",
  "max=" + f(rc.edgeRmsPct, 2) + "%");

// ---------------------------------------------------------------- 用例 11：前景过少
head("小面积块 20x20（占比 0.25% < minCoverage 1%）");
const blob = makeRectMask(W, H, 20, 20, 10, 10, 0);
const rb = S.analyzeMask(blob.mask, W, H);
console.log("  coverage=" + f(rb.coverage, 6) + " reason=" + JSON.stringify(rb.reason));
ok(rb.ok === false, "ok=false");
ok(typeof rb.reason === "string" && rb.reason.length > 0, "带 reason", rb.reason);
ok(rb.coverage < TH.minCoverage, "coverage < minCoverage", "coverage=" + f(rb.coverage, 6));

// ---------------------------------------------------------------- 用例 12：alpha 路径
head("buildForegroundMask · alpha 路径（RGBA，背景 alpha=0）");
const alphaSyn = makeRectMask(W, H, CX, CY, HW, HH, 8);
const alphaPx = paint(W, H, alphaSyn.mask, [40, 60, 80], [255, 255, 255], 255, 0, 4);
const am = S.buildForegroundMask(alphaPx, W, H, { channels: 4 });
let amCount = 0;
for (let i = 0; i < am.mask.length; i++) if (am.mask[i]) amCount++;
console.log("  mode=" + am.mode + " bg=" + JSON.stringify(am.bg) + " coverage=" + f(am.coverage, 4) +
  " 前景像素=" + amCount + "（期望 " + alphaSyn.count + "）");
ok(am.ok === true, "ok=true");
ok(am.mode === "alpha", "mode=alpha（存在透明像素）", "mode=" + am.mode);
ok(am.bg === null, "bg=null", "bg=" + JSON.stringify(am.bg));
ok(amCount === alphaSyn.count, "掩膜前景像素数 == 合成矩形像素数", amCount + " == " + alphaSyn.count);
const ra = S.analyzeMask(am.mask, W, H);
ok(Math.abs(ra.thetaDeg - 8) <= 0.15, "端到端：测得 θ ≈ 声明 8°", "测得 " + f(ra.thetaDeg, 3) + "°");

// ---------------------------------------------------------------- 用例 13：bgThreshold 路径
head("buildForegroundMask · bgThreshold 路径（纯色背景 + 中间一个歪矩形，alpha 全 255）");
const bgSyn = makeRectMask(W, H, CX, CY, HW, HH, 7);
const bgPx = paint(W, H, bgSyn.mask, [30, 30, 30], [200, 210, 220], 255, 255, 4);  // ps.js:1613 的情形
const bm = S.buildForegroundMask(bgPx, W, H, { channels: 4 });
let bmCount = 0;
for (let i = 0; i < bm.mask.length; i++) if (bm.mask[i]) bmCount++;
console.log("  mode=" + bm.mode + " 估到背景色 bg=" + JSON.stringify(bm.bg) + " coverage=" + f(bm.coverage, 4) +
  " 前景像素=" + bmCount + "（期望 " + bgSyn.count + "）");
ok(bm.ok === true, "ok=true");
ok(bm.mode === "bgThreshold", "alpha 全 255 → 走 bgThreshold", "mode=" + bm.mode);
ok(Array.isArray(bm.bg) && Math.abs(bm.bg[0] - 200) <= 2 && Math.abs(bm.bg[1] - 210) <= 2 &&
  Math.abs(bm.bg[2] - 220) <= 2, "四周边缘带中位数估出的背景色 ≈ (200,210,220)", "bg=" + JSON.stringify(bm.bg));
ok(Math.abs(bmCount - bgSyn.count) <= bgSyn.count * 0.01,
  "掩膜前景像素数 ≈ 合成矩形像素数（±1%）", bmCount + " vs " + bgSyn.count);
const rb2 = S.analyzeMask(bm.mask, W, H);
console.log("  端到端：测得 θ=" + f(rb2.thetaDeg, 3) + "° verdict=" + rb2.verdict +
  " 残差=" + f(rb2.edgeRmsPct, 2) + "% 透视偏差=" + f(rb2.perspective.maxDeviation, 4));
ok(Math.abs(rb2.thetaDeg - 7) <= 0.15, "端到端：测得 θ ≈ 声明 7°", "测得 " + f(rb2.thetaDeg, 3) + "°");
ok(rb2.verdict === "confirm", "7° → confirm（3° < |θ| < 15°）", "verdict=" + rb2.verdict);

// ---------------------------------------------------------------- 用例 14：栅格化分辨率（已知局限，写进报告）
head("二值栅格化的角度分辨率：同为 0.5° 的矩形，偏差随物体像素尺寸缩小而变大");
console.log("  矩形半宽x半高   前景像素数   声明θ   测得θ     偏差");
const rasterSizes = [{ hw: 110, hh: 70 }, { hw: 280, hh: 180 }, { hw: 560, hh: 360 }];
const rasterBias = [];
for (const s of rasterSizes) {
  const cw = s.hw * 2 + 60, ch = s.hh * 2 + 60;
  const syn = makeRectMask(cw, ch, cw / 2, ch / 2, s.hw, s.hh, 0.5);
  const r = S.analyzeMask(syn.mask, cw, ch);
  rasterBias.push({ hw: s.hw, bias: r.thetaDeg - 0.5 });
  console.log("  " + s.hw + "x" + s.hh + "        " + syn.count + "     " + f(0.5, 1) + "°   " +
    f(r.thetaDeg, 3) + "°   " + f(r.thetaDeg - 0.5, 3) + "°");
}
ok(Math.abs(rasterBias[2].bias) <= 0.15, "最大尺寸(560x360)的 0.5° 偏差 <= 0.15°",
  "Δ=" + f(rasterBias[2].bias, 4) + "°");
ok(Math.abs(rasterBias[0].bias) > Math.abs(rasterBias[2].bias),
  "偏差随尺寸缩小而变大（栅格化极限，非算法误差）",
  "110x70 Δ=" + f(rasterBias[0].bias, 3) + "° vs 560x360 Δ=" + f(rasterBias[2].bias, 3) + "°");

// ---------------------------------------------------------------- 用例 15：返回字段完整性（冻结接口）
head("返回字段完整性：analyzeMask / buildForegroundMask 的字段名与类型");
const syn5 = makeRectMask(RW, RH, RCX, RCY, RHW, RHH, 4);
const r5 = S.analyzeMask(syn5.mask, RW, RH);
const topTypes = [
  ["ok", "boolean"], ["coverage", "number"], ["areaPx", "number"], ["thetaDeg", "number"],
  ["minRect", "object"], ["edges", "object"], ["edgeRmsPct", "number"], ["quad", "object"],
  ["perspective", "object"], ["centroid", "object"], ["verdict", "string"], ["notes", "object"],
  ["tiltDeg", "number"], ["mode", "string"], ["objectCount", "number"],
  ["objects", "object"], ["objectTilts", "object"], ["objectResidualDeg", "number"]
];
const badTop = topTypes.filter(function (p) { return typeof r5[p[0]] !== p[1]; })
  .map(function (p) { return p[0] + ":" + typeof r5[p[0]]; });
ok(badTop.length === 0, "analyzeMask 顶层 18 个字段名/类型齐全",
  badTop.length ? badTop.join(",") : "18/18");

const nums = {
  "centroid.x": r5.centroid.x, "centroid.y": r5.centroid.y,
  "minRect.cx": r5.minRect.cx, "minRect.cy": r5.minRect.cy, "minRect.w": r5.minRect.w,
  "minRect.h": r5.minRect.h, "minRect.thetaDeg": r5.minRect.thetaDeg,
  "edges.top": r5.edges.top, "edges.right": r5.edges.right,
  "edges.bottom": r5.edges.bottom, "edges.left": r5.edges.left,
  "quad.topW": r5.quad.topW, "quad.botW": r5.quad.botW,
  "quad.leftH": r5.quad.leftH, "quad.rightH": r5.quad.rightH,
  "perspective.widthRatio": r5.perspective.widthRatio,
  "perspective.heightRatio": r5.perspective.heightRatio,
  "perspective.maxDeviation": r5.perspective.maxDeviation
};
const badNum = Object.keys(nums).filter(function (k) { return !Number.isFinite(nums[k]); });
console.log("  子字段: " + JSON.stringify({
  centroid: [Math.round(r5.centroid.x), Math.round(r5.centroid.y)],
  "minRect.cx/cy": [Math.round(r5.minRect.cx), Math.round(r5.minRect.cy)],
  "quad.topW/botW": [Math.round(r5.quad.topW), Math.round(r5.quad.botW)],
  "quad.leftH/rightH": [Math.round(r5.quad.leftH), Math.round(r5.quad.rightH)],
  "edges(top,right,bottom,left)": [r5.edges.top, r5.edges.right, r5.edges.bottom, r5.edges.left]
    .map(function (v) { return Number(v.toFixed(3)); })
}));
ok(badNum.length === 0, "18 个子字段全部为有限数值", badNum.length ? badNum.join(",") : "18/18");
ok(r5.verdict === "micro" || r5.verdict === "confirm" || r5.verdict === "skip",
  "verdict ∈ {micro,confirm,skip}", "verdict=" + r5.verdict);
ok(r5.notes.length >= 1, "notes 至少一条（自由文本）", "notes[0]=" + JSON.stringify(r5.notes[0]));

const bm5 = S.buildForegroundMask(alphaPx, W, H, { channels: 4 });
const badBm = [["ok", "boolean"], ["mode", "string"], ["mask", "object"], ["width", "number"],
  ["height", "number"], ["coverage", "number"]]
  .filter(function (p) { return typeof bm5[p[0]] !== p[1]; })
  .map(function (p) { return p[0] + ":" + typeof bm5[p[0]]; });
ok(badBm.length === 0, "buildForegroundMask 6 个字段名/类型齐全", badBm.length ? badBm.join(",") : "6/6");
// 注意：模块跑在 vm 的独立 realm 里，其 Uint8Array 与本文件的构造函数不同，
// 因此用 Object.prototype.toString 判类型而不是 instanceof（跨 realm） 。
const isU8 = Object.prototype.toString.call(bm5.mask) === "[object Uint8Array]";
ok(isU8 && bm5.mask.length === W * H && bm5.width === W && bm5.height === H,
  "mask 是 Uint8Array 且长度 == width*height",
  "tag=" + Object.prototype.toString.call(bm5.mask) + " len=" + bm5.mask.length + " (" + W + "*" + H + ")");

// ---------------------------------------------------------------- 用例 16：3 通道（完全没有 alpha）
head("buildForegroundMask · channels=3（根本没有 alpha 通道）→ 必须走 bgThreshold");
const syn16 = makeRectMask(W, H, CX, CY, HW, HH, 4);
const rgbPx = paint(W, H, syn16.mask, [20, 20, 20], [210, 200, 190], 255, 255, 3);
const m3 = S.buildForegroundMask(rgbPx, W, H, { channels: 3 });
let m3Count = 0;
for (let i = 0; i < m3.mask.length; i++) if (m3.mask[i]) m3Count++;
console.log("  mode=" + m3.mode + " bg=" + JSON.stringify(m3.bg) + " 前景像素=" + m3Count +
  "（期望 " + syn16.count + "）");
ok(m3.ok === true, "ok=true");
ok(m3.mode === "bgThreshold", "channels=3 无 alpha → bgThreshold", "mode=" + m3.mode);
ok(Array.isArray(m3.bg) && Math.abs(m3.bg[0] - 210) <= 2 && Math.abs(m3.bg[1] - 200) <= 2 &&
  Math.abs(m3.bg[2] - 190) <= 2, "背景色 ≈ (210,200,190)", "bg=" + JSON.stringify(m3.bg));
ok(Math.abs(m3Count - syn16.count) <= syn16.count * 0.01, "前景像素数 ≈ 合成值（±1%）",
  m3Count + " vs " + syn16.count);
const r16 = S.analyzeMask(m3.mask, W, H);
ok(Math.abs(r16.thetaDeg - 4) <= 0.15, "端到端：测得 θ ≈ 声明 4°", "测得 " + f(r16.thetaDeg, 3) + "°");
ok(r16.verdict === "micro", "4° < microThetaDeg 5 ⇒ micro（本用例测通道，档位与旋转矩形用例同源）", "verdict=" + r16.verdict);

// ---------------------------------------------------------------- 用例 17-18：forceMode
// 复刻真机 2026-10-16 10:59:55 事故：把整层（不透明照片）转了 2° 之后，四角露出透明像素。
// 不锁基准时掩膜会从「卡片」自动切到 alpha（＝整张已旋转的画布矩形），量到的 θ 是画布转过的角度
// ⇒ 应用侧的保护逻辑被判「未生效」而停手（其实图已经摆正）。
head("buildForegroundMask · forceMode：旋转后露出的透明四角不得污染掩膜（真机事故复刻）");
{
  const N = 400, ccx = 200, ccy = 200;
  const canvasRect = makeRectMask(N, N, ccx, ccy, 190, 140, -2.04);  // 图层内容＝已转 -2.04° 的画布
  const cardRect = makeRectMask(N, N, ccx, ccy, 60, 40, 0);          // 里面那张已经摆正的卡片
  const px = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const o = i * 4;
    if (!canvasRect.mask[i]) continue;    // 透明像素：RGB 留 0（真机 applyAlpha:false 就是这样），alpha 留 0
    const v = cardRect.mask[i] ? 60 : 196;
    px[o] = px[o + 1] = px[o + 2] = v;
    px[o + 3] = 255;
  }
  const auto = S.buildForegroundMask(px, N, N, { channels: 4 });
  const forced = S.buildForegroundMask(px, N, N, { channels: 4, forceMode: "bgThreshold" });
  const anAuto = S.analyzeMask(auto.mask, N, N);
  const anForced = S.analyzeMask(forced.mask, N, N);
  console.log("  自动判模式=" + auto.mode + " coverage=" + f(auto.coverage, 4) + " θ=" + f(anAuto.thetaDeg, 2) + "°" +
    "   |   forceMode=bgThreshold → coverage=" + f(forced.coverage, 4) + " bg=" + JSON.stringify(forced.bg) +
    " θ=" + f(anForced.thetaDeg, 2) + "°");
  ok(auto.mode === "alpha", "自动判模式切到 alpha（掩膜＝整张画布）", "mode=" + auto.mode);
  ok(Math.abs(anAuto.thetaDeg + 2.04) <= 0.6,
    "自动模式量到的是【画布转过的角度】(≈-2.04°) —— 正是真机里的假信号", "θ=" + f(anAuto.thetaDeg, 2) + "°");
  ok(forced.mode === "bgThreshold", "forceMode 能锁住 bgThreshold 基准", "mode=" + forced.mode);
  ok(Math.abs(anForced.thetaDeg) <= 0.5, "锁定基准后量到的是【卡片】(≈0°)", "θ=" + f(anForced.thetaDeg, 2) + "°");
  ok(Array.isArray(forced.bg) && forced.bg[0] > 150 && forced.bg[1] > 150 && forced.bg[2] > 150,
    "透明四角不参与背景色采样（bg 没被 (0,0,0) 拖黑）", "bg=" + JSON.stringify(forced.bg));
  ok(forced.coverage > 0.02 && forced.coverage < 0.10, "掩膜只剩卡片（透明四角被当背景丢掉）",
    "coverage=" + f(forced.coverage, 4) + "（卡片占比 " + f(cardRect.count / (N * N), 4) + "）");
}
head("forceMode=alpha 但只有 3 通道 → 报错，不许静默给出错掩膜");
{
  const bad = S.buildForegroundMask(rgbPx, W, H, { channels: 3, forceMode: "alpha" });
  ok(bad.ok === false, "ok=false", "ok=" + bad.ok);
  ok(/4 通道/.test(String(bad.error)), "错误文本指明需要 4 通道", "error=" + bad.error);
}

// ---------------------------------------------------------------- 19. 竖版主体（真机 2026-10-16 11:38:35 事故）
head("竖版主体：长轴接近竖直（θ≈±90°）时，判定必须用「相对轴向倾斜 tilt」，不能用 θ");
{
  const PW = 600, PH = 900;
  // 竖版矩形：水平半径 110 < 竖直半径 240 ⇒ 长轴竖直
  const p1 = makeRectMask(PW, PH, 300, 450, 110, 240, 2);
  const a1 = S.analyzeMask(p1.mask, PW, PH);
  console.log("  竖版歪 2°：θ=" + f(a1.thetaDeg, 2) + "° tilt=" + f(a1.tiltDeg, 2) + "° verdict=" + a1.verdict +
    " 残差=" + f(a1.edgeRmsPct, 2) + "%");
  ok(Math.abs(Math.abs(a1.thetaDeg) - 88) <= 0.7, "长轴竖直 ⇒ θ ≈ ±88°（旧版拿它比 15° 阈值必然误判）",
    "θ=" + f(a1.thetaDeg, 2) + "°");
  ok(Math.abs(a1.tiltDeg - 2) <= 0.3, "tilt ≈ 2°（真正要纠的倾斜）", "tilt=" + f(a1.tiltDeg, 2) + "°");
  ok(a1.verdict === "micro", "竖版小角度 ⇒ micro（旧版会误判 skip 而完全不动）", "verdict=" + a1.verdict);

  const p2 = makeRectMask(PW, PH, 300, 450, 110, 240, 3.85);   // 真机那张图实测到的倾斜量
  const a2 = S.analyzeMask(p2.mask, PW, PH);
  ok(Math.abs(Math.abs(a2.tiltDeg) - 3.85) <= 0.4, "tilt ≈ 3.85°（真机 11:38:35 的实测值）",
    "tilt=" + f(a2.tiltDeg, 2) + "° θ=" + f(a2.thetaDeg, 2) + "°");
  ok(a2.verdict === "micro", "3.85° ≤ microThetaDeg 5 ⇒ micro（用户 2026-10-16 决策放宽后，真机那张图能自动摆正）",
    "verdict=" + a2.verdict);

  const p2b = makeRectMask(PW, PH, 300, 450, 110, 240, 6.5);
  const a2b = S.analyzeMask(p2b.mask, PW, PH);
  ok(a2b.verdict === "confirm", "6.5° 落在 5°~15° ⇒ confirm（只报告、不自动转）",
    "tilt=" + f(a2b.tiltDeg, 2) + "° verdict=" + a2b.verdict);

  const p3 = makeRectMask(PW, PH, 300, 450, 110, 240, 20);
  const a3 = S.analyzeMask(p3.mask, PW, PH);
  ok(Math.abs(Math.abs(a3.tiltDeg) - 20) <= 0.5, "tilt ≈ ±20°", "tilt=" + f(a3.tiltDeg, 2) + "°");
  ok(a3.verdict === "skip", "竖版歪 20° ⇒ skip（> skipThetaDeg 15）", "verdict=" + a3.verdict);
}

// ---------------------------------------------------------------- 用例 21：D 档多物体
// 真机 2026-10-16 11:57:37：用户那张「纸盒 + 牙膏管」被【并集】二阶矩算成 tilt=3.85°、并集四边残差 21.57%，
// 而两个物体各自只有 +1.29° / +0.25°（Python 探针 verify/probe-two-objects.py 实测）。
// 并集残差被两者之间的空隙撑坏 ⇒ ≥2 个物体时必须逐个量，再决定「有没有共同角度可用」。
const MW = 900, MH = 900;

function makeMultiMask(list) {
  const mask = new Uint8Array(MW * MH);
  for (let i = 0; i < list.length; i++) {
    const one = makeRectMask(MW, MH, list[i].cx, list[i].cy, list[i].hw, list[i].hh, list[i].theta).mask;
    for (let k = 0; k < mask.length; k++) if (one[k]) mask[k] = 1;
  }
  return mask;
}

head("D 档多物体：两个同朝向物体 ⇒ 取中点、判 micro");
const mA = makeMultiMask([
  { cx: 250, cy: 450, hw: 30, hh: 100, theta: 1.29 },
  { cx: 650, cy: 450, hw: 30, hh: 100, theta: 0.25 }
]);
const aA = S.analyzeMask(mA, MW, MH, {});
ok(aA.mode === "multi" && aA.objectCount === 2, "2 个物体 ⇒ mode=multi",
  "mode=" + aA.mode + " n=" + aA.objectCount);
const tA = (aA.objectTilts || []).slice().sort(function (x, y) { return x - y; });
ok(tA.length === 2 && Math.abs(tA[0] - 0.25) <= 0.15 && Math.abs(tA[1] - 1.29) <= 0.15,
  "逐物体 tilt 各自准确（不是并集的 3.85°）",
  "tiltList=" + tA.map(function (v) { return f(v, 2); }).join(" / "));
ok(Math.abs(aA.tiltDeg - 0.77) <= 0.1, "tiltDeg = 两物体中点 ≈ 0.77°（让最歪的那个残余最小）", "tilt=" + f(aA.tiltDeg, 3));
ok(Math.abs(aA.objectResidualDeg - 0.52) <= 0.1, "极差/2 ≈ 0.52° ≤ objMaxResidualDeg 0.7", "residual=" + f(aA.objectResidualDeg, 3));
ok(aA.verdict === "micro", "两个物体同朝向且极差小 ⇒ micro（可自动摆正）", "verdict=" + aA.verdict);

head("D 档多物体：朝向不一致 ⇒ confirm（只报告）");
const mB = makeMultiMask([
  { cx: 250, cy: 450, hw: 30, hh: 100, theta: 2 },
  { cx: 650, cy: 450, hw: 30, hh: 100, theta: 6 }
]);
const aB = S.analyzeMask(mB, MW, MH, {});
ok(aB.mode === "multi" && aB.verdict === "confirm", "极差/2 = 2° > 0.7° ⇒ confirm（没有任何单一角度能同时摆正）",
  "verdict=" + aB.verdict + " residual=" + f(aB.objectResidualDeg, 2));

head("D 档多物体：碎片过滤 / 细缝合并 / 近似方形不参与");
const mC = makeMultiMask([
  { cx: 250, cy: 450, hw: 30, hh: 100, theta: 2 },
  { cx: 720, cy: 720, hw: 8, hh: 8, theta: 0 }          // 16x16 = 256px ≈ 0.03% < objMinAreaPct 0.5%
]);
const aC = S.analyzeMask(mC, MW, MH, {});
ok(aC.objectCount === 1 && aC.mode === "single", "面积 < 0.5% 画布的碎片被丢弃 ⇒ 退回单物体路径",
  "n=" + aC.objectCount + " mode=" + aC.mode);
ok(aC.verdict === "micro" && Math.abs(aC.tiltDeg - 2) <= 0.15, "剩下的物体照常判 micro", "tilt=" + f(aC.tiltDeg, 2));

const mD = makeMultiMask([
  { cx: 340, cy: 450, hw: 30, hh: 100, theta: 2 },      // x 310..370
  { cx: 402, cy: 450, hw: 30, hh: 100, theta: 2.4 }     // x 372..432 ⇒ 间距 1px
]);
const aD = S.analyzeMask(mD, MW, MH, {});
ok(aD.objectCount === 1 && aD.mode === "single", "间距 1px（≤ objMergeGapPx 3）的两块被桥接成同一物体",
  "n=" + aD.objectCount);

const mE = makeMultiMask([
  { cx: 250, cy: 450, hw: 30, hh: 100, theta: 2 },      // 60x200 长条
  { cx: 650, cy: 450, hw: 100, hh: 100, theta: 0 }      // 200x200 方块：长宽方差比 ≈ 1
]);
const aE = S.analyzeMask(mE, MW, MH, {});
ok(aE.mode === "multi" && aE.objectCount === 2, "方块 + 长条算 2 个物体", "n=" + aE.objectCount);
ok(Math.abs(aE.tiltDeg - 2) <= 0.2, "方块的倾斜不参与判定（长宽方差比 < objMinElongation 1.2）⇒ 取长条的 2°",
  "tilt=" + f(aE.tiltDeg, 2));
ok(aE.verdict === "micro", "仍有一个可用倾斜 ⇒ micro", "verdict=" + aE.verdict);

head("D 档多物体：连通域过多 ⇒ skip（不像单件商品图）");
const six = [];
for (let i = 0; i < 6; i++) six.push({ cx: 150 + i * 120, cy: 450, hw: 40, hh: 40, theta: 1 });
const mF = makeMultiMask(six);
const aF = S.analyzeMask(mF, MW, MH, {});
ok(aF.objectCount === 6 && aF.verdict === "skip", "6 个连通域 > objMaxCount 5 ⇒ skip",
  "n=" + aF.objectCount + " verdict=" + aF.verdict);

head("图层蒙版基准（真机 2026-10-16 12:40:21 事故）：抠图后必须用图层蒙版，而不是颜色阈值");
// 复刻真机形态：背景是【有渐变的灰底】（真实拍摄常见），主体是浅色卡片；α 全 255
//（「按选区删背景」并没有真的把像素变透明）—— 于是 buildForegroundMask 会走 bgThreshold。
const LW = 200, LH = 200;
const px4 = new Uint8Array(LW * LH * 4);
for (let y = 0; y < LH; y++) {
  const v = Math.round(110 + (250 - 110) * y / (LH - 1));
  for (let x = 0; x < LW; x++) {
    const o = (y * LW + x) * 4;
    px4[o] = v; px4[o + 1] = v; px4[o + 2] = v; px4[o + 3] = 255;
  }
}
const cardMask = makeRectMask(LW, LH, 100, 100, 50, 20, 5.44).mask;   // 100x40 卡片，歪 5.44°（0/1 图）
// 真机的 alphaMask 是 0/255 的灰度（ps.js 读图层蒙版后重采样），这里照它的值域造
const cardAlpha = new Uint8Array(LW * LH);
for (let i = 0; i < cardMask.length; i++) {
  if (cardMask[i]) { cardAlpha[i] = 255; const o = i * 4; px4[o] = 232; px4[o + 1] = 232; px4[o + 2] = 232; }
}

const bgFm = S.buildForegroundMask(px4, LW, LH, { channels: 4 });
ok(bgFm.ok && bgFm.mode === "bgThreshold", "像素 alpha 全 255 ⇒ 像素基准只能退回颜色阈值（真机同款）",
  "mode=" + bgFm.mode);
const lmFm = S.buildMaskFromLayerMask(cardAlpha, LW, LH, {});
ok(lmFm.ok && lmFm.mode === "layerMask", "图层蒙版能当基准", "mode=" + lmFm.mode);
ok(Math.abs(lmFm.coverage - 0.1) < 0.01, "图层蒙版占比 = 卡片真实占比 ≈ 10%", "coverage=" + f(lmFm.coverage, 4));
ok(Math.abs(bgFm.coverage - lmFm.coverage) > 0.02, "两种基准量到的不是同一个东西（这就是必须优先用蒙版的原因）",
  "bg=" + f(bgFm.coverage, 4) + " layerMask=" + f(lmFm.coverage, 4));
const anLm = S.analyzeMask(lmFm.mask, LW, LH, {});
ok(Math.abs(anLm.tiltDeg - 5.44) <= 0.4, "图层蒙版基准量出真实倾斜 ≈ 5.44°", "tilt=" + f(anLm.tiltDeg));
const anBg = S.analyzeMask(bgFm.mask, LW, LH, {});
ok(Math.abs(anBg.tiltDeg - 5.44) > 1, "颜色阈值基准量出的倾斜是错的（真机 12:40:21 就是被它误判成 skip）",
  "tilt=" + f(anBg.tiltDeg) + " verdict=" + anBg.verdict);

const allWhite = new Uint8Array(LW * LH); allWhite.fill(255);
const wm = S.buildMaskFromLayerMask(allWhite, LW, LH, {});
ok(wm.ok === false && /几乎全白/.test(wm.error), "几乎全白的蒙版不能当基准（没切出轮廓）", "error=" + wm.error);
const tiny = new Uint8Array(LW * LH); for (let i = 0; i < 4; i++) tiny[i] = 255;
const tm = S.buildMaskFromLayerMask(tiny, LW, LH, {});
ok(tm.ok === false && /前景过少/.test(tm.error), "前景过少的蒙版不能当基准", "error=" + tm.error);
ok(S.buildMaskFromLayerMask(new Uint8Array(10), LW, LH, {}).ok === false, "蒙版长度不足 ⇒ ok:false（不静默算错）");
const edge = new Uint8Array(LW * LH); edge[0] = TH.alphaThreshold - 1; edge[1] = TH.alphaThreshold;
const em = S.buildMaskFromLayerMask(edge, LW, LH, {});
ok(em.ok === false && /前景过少/.test(em.error), "分界就是 alphaThreshold（127 不算前景 ⇒ 过少报错）", "error=" + em.error);
const edge2 = new Uint8Array(LW * LH);
for (let i = 0; i < 400; i++) edge2[i] = TH.alphaThreshold;   // 前两行 = alphaThreshold（刚好压住 minCoverage 下限）
edge2[500] = TH.alphaThreshold - 1;
const e2 = S.buildMaskFromLayerMask(edge2, LW, LH, {});
ok(e2.ok === true && e2.mask[0] === 1 && e2.mask[500] === 0,
  "分界就看 alphaThreshold：等于它算前景、低于它不算", "coverage=" + f(e2.coverage, 5));

head("逐物体摆正规划：逐物体各转各的，选区 = 包围盒 + 旋转外扩");
// 用户 2026-10-16 决策 A：保持单层、用每个物体的矩形选区各转各的角度（整层按中点转会把另一个转歪 0.7°）
const pA = S.planObjectRotations(aA, {});
ok(pA.rotateCount === 2 && pA.items.length === 2, "两个物体各自可转（tilt 0.25/1.29 都 ≥ noop 0.2）",
  "rotateCount=" + pA.rotateCount + " skips=" + pA.skips.length);
function pickByTilt(plan, target, tol) {
  return plan.items.filter(function (it) { return Math.abs(it.tiltDeg - target) <= tol; })[0];
}
const pSmall = pickByTilt(pA, 0.25, 0.2), pBig = pickByTilt(pA, 1.29, 0.2);
ok(!!pSmall && !!pBig && pSmall.ok && pBig.ok, "规划项带逐物体 tilt，两个都 ok（没有邻居遮挡）",
  "small=" + (pSmall && pSmall.tiltDeg) + " big=" + (pBig && pBig.tiltDeg));
const expPadB = Math.ceil(0.5 * Math.sqrt(pBig.bw * pBig.bw + pBig.bh * pBig.bh) *
  Math.tan(Math.abs(pBig.tiltDeg) * Math.PI / 180)) + 2;
ok(pBig.padPx === expPadB, "外扩 = 包围盒对角线一半 × tan|tilt| + 2px（转出选区的像素会被裁掉）",
  "pad=" + pBig.padPx + " 期望=" + expPadB + " bw=" + pBig.bw + " bh=" + pBig.bh);
const objBig = (aA.objects || []).filter(function (o) { return Math.abs(o.tiltDeg - 1.29) <= 0.2; })[0];
ok(!!objBig && Math.abs(objBig.minX - 218) <= 4 && Math.abs(objBig.maxX - 282) <= 4 &&
  Math.abs(objBig.minY - 350) <= 6 && Math.abs(objBig.maxY - 550) <= 6,
  "物体带原始包围盒（逐物体选区要用它，w/h 是外接矩形宽不能当选区）",
  "bbox=" + (objBig ? objBig.minX + "," + objBig.minY + " → " + objBig.maxX + "," + objBig.maxY : "缺"));
ok(!!objBig && pBig.rect.left === objBig.minX - expPadB && pBig.rect.right === objBig.maxX + expPadB &&
  pBig.rect.top === objBig.minY - expPadB && pBig.rect.bottom === objBig.maxY + expPadB,
  "选区 = 包围盒四周各外扩 padPx（左/上/右/下逐项相等）",
  "rect=" + (pBig.rect ? pBig.rect.left + "," + pBig.rect.top + " → " + pBig.rect.right + "," + pBig.rect.bottom : "缺"));

head("逐物体摆正规划：包围盒外扩后压到邻居 ⇒ 跳过（宁可不动，也不把邻居一起转）");
const mG = makeMultiMask([
  { cx: 250, cy: 450, hw: 30, hh: 100, theta: 4 },      // 歪 4° ⇒ 包围盒 ~74x204、外扩 ~10px
  { cx: 330, cy: 450, hw: 30, hh: 100, theta: 4 }       // 包围盒间距 ~5px：> objMergeGapPx 3（不合并）、< 外扩 10（会被罩住）
]);
const aG = S.analyzeMask(mG, MW, MH, {});
ok(aG.mode === "multi" && aG.objectCount === 2, "7px 间距的两块保持独立（只桥接 ≤3px 细缝）", "n=" + aG.objectCount);
const pG = S.planObjectRotations(aG, {});
ok(pG.rotateCount === 0 && pG.skips.length === 2 && /罩住/.test(pG.skips[0].reason),
  "外扩后互相罩住 ⇒ 两个都跳过（旋转会把邻居一起转）",
  "rotateCount=" + pG.rotateCount + " reason=" + (pG.skips[0] && pG.skips[0].reason));

head("逐物体摆正规划：近方形 / 本来就在正位 / 物体过多 ⇒ 不转");
const pE = S.planObjectRotations(aE, {});       // aE = 200x200 方块 + 60x200 长条(2°)
ok(pE.rotateCount === 1 && /近似方形/.test(pE.skips[0].reason),
  "方块（长宽方差比 < objMinElongation 1.2）没有可信长轴 ⇒ 跳过，只转长条",
  "rotateCount=" + pE.rotateCount + " reason=" + pE.skips[0].reason);
const pNoop = S.planObjectRotations(aA, { noopDeg: 1.0 });
ok(pNoop.rotateCount === 1 && /本来就在它的正位/.test(pNoop.skips[0].reason),
  "|tilt| < noopDeg ⇒ 本来就在它的正位（幂等，不动像素）",
  "rotateCount=" + pNoop.rotateCount + " reason=" + pNoop.skips[0].reason);
ok(typeof aF.skipReason === "string", "skip 的理由在分析结果里有独立字段（逐物体路径要先问能不能动手）",
  "skipReason=" + aF.skipReason);
const pF = S.planObjectRotations(aF, {});
ok(pF.rotateCount === 0 && /跳过理由/.test(pF.notes.join(" ")),
  "连通域过多（skipReason）⇒ 一个都不转", "notes=" + pF.notes.join(" | "));
const pSingle = S.planObjectRotations(aC, {});
ok(pSingle.rotateCount === 0 && /不是多物体/.test(pSingle.notes[0]),
  "单物体路径不归逐物体规划管", "notes=" + pSingle.notes[0]);

// ---------------------------------------------------------------- 汇总
console.log("\n合成用例 " + cases + " 项 / 断言 " + asserts + " 个 / 失败 " + fails);
process.exitCode = fails ? 1 : 0;
