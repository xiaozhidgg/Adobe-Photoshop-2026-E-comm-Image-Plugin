// 真实数据回归（D 档 / 多物体）：把 Python 探针导出的真实掩膜喂给插件的 analyzeMask，
// 检查「≥2 个物体 ⇒ 用逐物体倾斜、忽略并集残差」这条路径在真图上的行为。
//
// 数据来源（两步）：
//   python verify/probe-two-objects.py <截图> 3000 verify/calib/two-objects.raw
//   node   verify/straighten-multi-check.js [raw 路径，默认 verify/calib/two-objects.raw]
//
// 期望（用户那张「纸盒 + 牙膏管」截图，Python 探针实测 tilt +1.29° / +0.25°）：
//   mode=multi、objectCount=2、各物体 tilt 与 Python 侧一致、tiltDeg=中点 ≈ +0.77°、
//   residualDeg ≈ 0.52°（< objMaxResidualDeg 0.7）、verdict=micro。

"use strict";

var fs = require("fs");
var path = require("path");
var vm = require("vm");

var rawPath = process.argv[2] || path.join("verify", "calib", "two-objects.raw");
var pyTilts = [1.29, 0.25];   // Python 探针 <img> 3000 的实测值（顺序：按 x 均值，即 纸盒→牙膏管）
// ★ 允许 ±0.3° 的偏差：插件比 Python 探针多一步「桥接 ≤ objMergeGapPx(3px) 的细缝」，
//   细长物体（牙膏管长宽方差比 8.16）对边缘多几个像素很敏感 —— 真机口径下这点偏差不影响结论
//   （判据是「逐物体倾斜的极差/2」是否超过 objMaxResidualDeg，量级 0.1° vs 0.7°）。

var pass = 0, fail = 0;
function chk(name, cond, detail) {
  if (cond) { pass++; console.log("  [OK]   " + name + (detail ? "  " + detail : "")); }
  else { fail++; console.log("  [FAIL] " + name + (detail ? "  " + detail : "")); }
}

function loadStraighten() {
  var src = fs.readFileSync(path.join(__dirname, "..", "plugin", "src", "straighten.js"), "utf8");
  var ctx = { window: { Ecom: {} }, console: console };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: "plugin/src/straighten.js" });
  var S = ctx.window.Ecom && ctx.window.Ecom.straighten;
  if (!S || typeof S.analyzeMask !== "function") throw new Error("straighten.js 没导出 analyzeMask");
  return S;
}

function main() {
  if (!fs.existsSync(rawPath)) {
    console.log("找不到掩膜 " + rawPath + "，先跑：python verify/probe-two-objects.py <截图> 3000 " + rawPath);
    process.exit(1);
  }
  var meta = JSON.parse(fs.readFileSync(rawPath + ".json", "utf8"));
  var mask = new Uint8Array(fs.readFileSync(rawPath));
  if (mask.length !== meta.width * meta.height) {
    throw new Error("掩膜长度不匹配：" + mask.length + " vs " + meta.width + "x" + meta.height);
  }
  console.log("掩膜 " + meta.width + "x" + meta.height + "  前景 " +
    (100 * mask.reduce(function (s, v) { return s + (v ? 1 : 0); }, 0) / mask.length).toFixed(2) + "%");

  var S = loadStraighten();
  var res = S.analyzeMask(mask, meta.width, meta.height, {});
  console.log("analyzeMask → verdict=" + res.verdict + " mode=" + res.mode + " objectCount=" + res.objectCount +
    " tiltDeg=" + (res.tiltDeg === undefined ? "-" : res.tiltDeg.toFixed(3)) +
    " residual=" + (res.objectResidualDeg === undefined ? "-" : res.objectResidualDeg.toFixed(3)) +
    " 并集: |θ|=" + (res.thetaDeg === undefined ? "-" : res.thetaDeg.toFixed(2)) +
    " 残差=" + (res.edgeRmsPct === undefined ? "-" : res.edgeRmsPct.toFixed(2)) + "%");
  if (res.objects) {
    for (var i = 0; i < res.objects.length; i++) {
      var o = res.objects[i];
      console.log("  物体 #" + (i + 1) + " 面积 " + o.areaPx + "px(" + (100 * o.areaPx / (meta.width * meta.height)).toFixed(2) +
        "%) " + o.w + "x" + o.h + " θ=" + o.thetaDeg.toFixed(2) + "° tilt=" + o.tiltDeg.toFixed(2) +
        "° 长宽方差比=" + o.elongation.toFixed(2));
    }
  }
  if (res.notes && res.notes.length) console.log("  notes: " + res.notes.join(" | "));

  console.log("\n断言：");
  chk("ok", res.ok === true);
  chk("mode=multi", res.mode === "multi", "实际 " + res.mode);
  chk("objectCount=2", res.objectCount === 2, "实际 " + res.objectCount);
  chk("verdict=micro", res.verdict === "micro", "实际 " + res.verdict);
  chk("tiltDeg≈中点 +0.77°", res.tiltDeg !== undefined && Math.abs(res.tiltDeg - 0.77) < 0.1,
    "实际 " + (res.tiltDeg === undefined ? "-" : res.tiltDeg.toFixed(3)));
  chk("residual≈0.52°", res.objectResidualDeg !== undefined && Math.abs(res.objectResidualDeg - 0.52) < 0.1,
    "实际 " + (res.objectResidualDeg === undefined ? "-" : res.objectResidualDeg.toFixed(3)));
  if (res.objects) {
    for (var k = 0; k < Math.min(res.objects.length, pyTilts.length); k++) {
      chk("物体 #" + (k + 1) + " tilt 与 Python 探针同向且差 < 0.3°(" + pyTilts[k] + "°)",
        Math.abs(res.objects[k].tiltDeg - pyTilts[k]) < 0.3,
        "js " + res.objects[k].tiltDeg.toFixed(3));
    }
  }

  console.log("\n通过 " + pass + " 项 / 失败 " + fail + " 项");
  process.exit(fail === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.log("检查脚本自身出错：" + (e && e.stack ? e.stack : e));
  process.exit(2);
}
