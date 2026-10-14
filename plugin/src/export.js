// Ecom.export —— 导出（INTERFACE §11）
// 逐个尺寸 duplicate 文档 → flattenImage → imageSize → save 另存 → close(saving:"no")
// ★ 每条命令都带 _target:{_ref:"document",_id:copyDocId}：绝不修改/关闭用户原文档
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  function selectDoc(docId) {
    return { _obj: "select", _target: { _ref: "document", _id: docId } };
  }

  function splitPath(fullPath) {
    var p = String(fullPath).replace(/\//g, "\\");
    var i = p.lastIndexOf("\\");
    var dir = i >= 0 ? p.slice(0, i) : "";
    var file = i >= 0 ? p.slice(i + 1) : p;
    var dot = file.lastIndexOf(".");
    var base = dot > 0 ? file.slice(0, dot) : file;
    return { dir: dir, base: base };
  }

  function docIds(ps) {
    var out = [];
    try {
      var m = ps.require();
      var docs = m.app.documents || [];
      for (var i = 0; i < docs.length; i++) out.push({ id: docs[i].id, name: String(docs[i].title || docs[i].name || "") });
    } catch (e) { /* 读不到就返回空，由调用方回退 */ }
    return out;
  }

  async function exportOne(ps, docId, size, format, quality, outPath, baseName) {
    var label = size.w + "x" + size.h;
    var copyName = "ecom_tmp_" + label;
    var copyId = null;
    var before = docIds(ps);
    try {
      var dup = await ps.run([{
        _obj: "duplicate",
        _target: { _ref: "document", _id: docId },
        name: copyName
      }], { history: "normal", preserveSelection: false, label: "电商图片制作 · 导出副本 " + label });
      if (!dup.ok) return { ok: false, error: "复制文档失败：" + dup.error };

      var after = docIds(ps);
      var beforeIds = {};
      for (var i = 0; i < before.length; i++) beforeIds[before[i].id] = true;
      for (var j = 0; j < after.length; j++) {
        if (!beforeIds[after[j].id]) { copyId = after[j].id; break; }
      }
      if (copyId === null) {
        for (var k = 0; k < after.length; k++) {
          if (after[k].name === copyName) { copyId = after[k].id; break; }
        }
      }
      if (copyId === null) {
        try {
          copyId = ps.require().app.activeDocument.id;
          ps.log("warn", "未能通过文档列表差集定位副本，改用当前激活文档 id=" + copyId);
        } catch (eAct) {
          return { ok: false, error: "无法定位导出的副本文档" };
        }
      }
      if (copyId === docId) return { ok: false, error: "副本定位错误：拿到了原文档 id，已中止以免改动原图" };

      // flatten 失败不中止（单图层文档可能没得合并）
      var flat = await ps.runRaw([{ _obj: "flattenImage", _target: { _ref: "document", _id: copyId } }]);
      if (!flat.ok || ps.firstErrorItem(flat.data && flat.data.results)) {
        ps.log("warn", "副本合并图层失败（继续导出）：" +
          (flat.ok ? ps.describeErrorItem(ps.firstErrorItem(flat.data.results)) : flat.error));
      }

      var fin = await ps.run([
        selectDoc(copyId),
        {
          _obj: "imageSize",
          width: { _unit: "pixelsUnit", _value: size.w },
          height: { _unit: "pixelsUnit", _value: size.h }
        }
      ], { history: "normal", preserveSelection: false, label: "电商图片制作 · 缩放 " + label });
      if (!fin.ok) return { ok: false, error: fin.error };

      // ★ 第 7 轮：另存改走 ps.saveDocToFile（DOM saveAs / 会话令牌 / 路径字面量三级降级，各自落日志）
      var sv = await ps.saveDocToFile(copyId, outPath, format, quality);
      if (!sv.ok) return { ok: false, error: sv.error };

      var bytes = await ps.fileSize(outPath);
      return { ok: true, data: { path: outPath, bytes: bytes, w: size.w, h: size.h, name: baseName } };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "导出 " + label + " 失败：" + msg };
    } finally {
      if (copyId !== null && copyId !== docId) {
        var c = await ps.run([{
          _obj: "close",
          _target: { _ref: "document", _id: copyId },
          saving: { _enum: "saving", _value: "no" }
        }], { history: "normal", preserveSelection: false, label: "电商图片制作 · 关闭副本" });
        if (!c.ok) ps.log("warn", "关闭副本 " + copyId + " 失败：" + c.error);
      }
    }
  }

  async function run(opts) {
    opts = opts || {};
    var ps = window.Ecom.ps;
    var sizes = opts.sizes || [];
    var format = opts.format === "png" ? "png" : "jpg";
    var quality = Number(opts.quality);
    if (!isFinite(quality)) quality = 12;
    if (quality < 0) quality = 0;
    if (quality > 12) quality = 12;
    var outputDir = opts.outputDir ? String(opts.outputDir) : null;

    var files = [];
    var failures = [];
    try {
      if (!sizes.length) return { ok: false, error: "没有勾选任何导出尺寸" };

      var docRes = await ps.activeDoc();
      if (!docRes.ok) return { ok: false, error: docRes.error };
      var docId = docRes.data.id;
      if (!docRes.data.path) {
        return { ok: false, error: "当前文档尚未保存到磁盘，请先另存为 .psd/.jpg 后再导出（导出目录需要参照原图路径）" };
      }

      var sp = splitPath(docRes.data.path);
      var ext = format === "png" ? "png" : "jpg";
      // ★ 第 7 轮（用户 m02731）：不覆盖时不再新建 output 子目录，落在原图同目录、文件名 = 原名-ps-N。
      var overwrite = !!opts.overwrite;
      var dir = outputDir ? String(outputDir) : sp.dir;
      var mk = await ps.createFolder(dir);
      // ★ 第 3 轮缺陷 B：即使 ps.createFolder 返回坏值，也绝不能让 dir 变成非字符串
      //   （v3 曾因 createFolder 返回 Promise 使 dir.replace 抛 TypeError，真机每次导出都失败）
      if (mk.ok && mk.data && typeof mk.data.path === "string" && mk.data.path) {
        dir = mk.data.path;
      } else {
        ps.log("warn", "创建导出目录未返回可用路径（继续用原路径导出）：" + (mk.error || "返回值异常"));
      }

      // 目录里已有的名字（避免 -ps-N 撞名）
      var onDisk = {};
      var listRes = await ps.listDir(dir);
      if (listRes && listRes.ok && listRes.data && listRes.data.names) {
        for (var q = 0; q < listRes.data.names.length; q++) onDisk[String(listRes.data.names[q]).toLowerCase()] = true;
      } else {
        ps.log("warn", "列举导出目录失败（序号可能与已有文件冲突）：" + ((listRes && listRes.error) || "返回值异常"));
      }
      var used = {};
      function taken(name) {
        var low = String(name).toLowerCase();
        return used[low] === true || onDisk[low] === true;
      }
      function nextName() {
        for (var n = 1; n < 10000; n++) {
          var nm = sp.base + "-ps-" + n + "." + ext;
          if (!taken(nm)) { used[String(nm).toLowerCase()] = true; return nm; }
        }
        var fb = sp.base + "-ps-" + Date.now() + "." + ext;
        used[fb.toLowerCase()] = true;
        return fb;
      }
      ps.log("info", "导出命名：" + (overwrite ? "覆盖原文件（首个尺寸写回原名，其余 -ps-N）" : "原名-ps-N（不覆盖、不新建文件夹）") + "；目录 " + dir);
      var i;
      for (i = 0; i < sizes.length; i++) {
        var s = sizes[i] || {};
        var w = Math.round(Number(s.w));
        var h = Math.round(Number(s.h));
        var label = (isFinite(w) && isFinite(h)) ? (w + "x" + h) : String(s.label || "未知尺寸");
        if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) {
          failures.push({ size: label, error: "尺寸非法（w=" + s.w + ", h=" + s.h + "）" });
          continue;
        }
        var fileName;
        if (overwrite && i === 0) {
          fileName = sp.base + "." + ext;
          used[fileName.toLowerCase()] = true;
        } else {
          fileName = nextName();
        }
        var outPath = dir.replace(/\\+$/, "") + "\\" + fileName;
        ps.log("info", "导出 " + label + " → " + outPath);
        var one = await exportOne(ps, docId, { w: w, h: h }, format, quality, outPath, fileName);
        if (one.ok) files.push({ path: one.data.path, bytes: one.data.bytes, w: one.data.w, h: one.data.h });
        else failures.push({ size: label, error: one.error });
      }

      var data = { outputDir: dir, files: files, failures: failures, overwrite: overwrite, naming: overwrite ? "覆盖原文件" : "原名-ps-N" };
      if (!files.length) {
        return {
          ok: false,
          error: failures.length ? ("全部尺寸导出失败，首个错误：" + failures[0].error) : "未导出任何文件",
          data: data
        };
      }
      ps.log("info", "导出完成：成功 " + files.length + " 个，失败 " + failures.length + " 个，目录 " + dir);
      return { ok: true, data: data };
    } catch (e) {
      var msg = e && e.message ? e.message : String(e);
      return { ok: false, error: "导出失败：" + msg, data: { outputDir: outputDir, files: files, failures: failures } };
    }
  }

  window.Ecom.export = {
    run: run
  };
})();
