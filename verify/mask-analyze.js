// 用法：node verify/mask-analyze.js <mask.raw> <width> <height>
// 用 plugin/src/straighten.js 的【同一套数学】复算一张外部掩膜（alpha>=128 视为前景），
// 目的是把「掩膜来源」与「数学」分开：换一个掩膜来源复算，就能判断日志里的角度是数学问题还是掩膜问题。
"use strict";

const fs = require("fs");
const vm = require("vm");
const path = require("path");

const SRC = path.join(__dirname, "..", "plugin", "src", "straighten.js");
const sandbox = { window: { Ecom: {} }, console: console };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, "utf8"), sandbox, { filename: "straighten.js" });
const S = sandbox.window.Ecom.straighten;

const raw = process.argv[2];
const W = Number(process.argv[3]);
const H = Number(process.argv[4]);
if (!raw || !W || !H) {
  console.log("用法：node verify/mask-analyze.js <mask.raw> <width> <height>");
  process.exit(2);
}

const buf = fs.readFileSync(raw);
if (buf.length < W * H) {
  console.log("掩膜长度不足：" + buf.length + " < " + W * H);
  process.exit(2);
}
const alpha = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) alpha[i] = buf[i] >= 128 ? 255 : 0;

const fm = S.buildMaskFromLayerMask(alpha, W, H, {});
if (!fm.ok) {
  console.log("掩膜不可用：" + fm.error);
  process.exit(1);
}
const an = S.analyzeMask(fm.mask, W, H, {});
if (!an.ok) {
  console.log("分析失败：" + an.reason);
  process.exit(1);
}
const f = (n, d) => (Number(n) >= 0 ? " " : "") + Number(n).toFixed(d === undefined ? 2 : d);
console.log("画布 " + W + "x" + H + " · 前景占比 " + (fm.coverage * 100).toFixed(2) + "%");
console.log("mode=" + an.mode + " objectCount=" + an.objectCount +
  " θ=" + f(an.thetaDeg) + " tilt=" + f(an.tiltDeg) +
  " 极差/2=" + f(an.objectResidualDeg || 0) + " verdict=" + an.verdict);
if (an.objects && an.objects.length) {
  an.objects.forEach(function (o, i) {
    console.log("  #" + (i + 1) + " " + o.w + "x" + o.h + " 中心(" + Math.round(o.cx) + "," + Math.round(o.cy) + ")" +
      " tilt=" + f(o.tiltDeg) + " θ=" + f(o.thetaDeg) + " 长宽方差比=" + f(o.elongation));
  });
}
const plan = S.planObjectRotations(an, {});
console.log("逐物体旋转计划：可转 " + plan.rotateCount + " 个 / 跳过 " + plan.skips.length + " 个");
plan.items.forEach(function (it) {
  const r = it.rect;
  console.log("  #" + it.index + " " + (it.ok ? "转 " + f(-it.tiltDeg) + "°" : "跳过(" + it.reason + ")") +
    (r ? " 选区 L" + Math.round(r.left) + " T" + Math.round(r.top) + " R" + Math.round(r.right) + " B" + Math.round(r.bottom) +
      "（外扩 " + it.padPx + "px）" : ""));
});
(an.notes || []).forEach(function (n) { console.log("  · " + n); });
