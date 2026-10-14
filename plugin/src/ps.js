// Ecom.ps —— 唯一的宿主桥接层（INTERFACE §4）
// ★ require("photoshop") / require("uxp") 只允许出现在本文件（INTERFACE §0）
// 描述符来源一律标注 docs/RESEARCH-descriptors.md 的条目号与证据等级。
window.Ecom = window.Ecom || {};

(function () {
  "use strict";

  var DEFAULT_COMMAND = "电商图片制作";
  var cachedMods = null;
  var logSink = null;
  var colorPickerOpen = false;
  var maskStateLogged = false;               // 第 6 轮：整层 get 的返回形态只记一次证据日志，避免刷屏

  // ---- 调试日志落盘（INTERFACE §4 / §15.2 第 13 条）---------------------------------
  // 真机实测：3P 插件的 console.log 【不会】进入 UXPLogs_*.log（com.ecom.psimage 全量 0 命中），
  // 面板之外唯一的持久通道是插件自己写文件。
  // ★ 任何写日志失败都必须被吞掉 —— 绝不能因为写日志失败让抠图/导出失败。
  var fileLogEnabled = true;                 // 默认开启
  var logFile = null;                        // 缓存 { entry, path, temp }
  var logWriteChain = Promise.resolve();     // Promise 链串行化，避免并发写交错
  var logBytesWritten = 0;
  var logLinesWritten = 0;
  var logFileWarned = false;
  var LOG_FILE_NAME = "ecom-debug.log";
  var LOG_MAX_BYTES = 200 * 1024;
  var LOG_MAX_LINES = 3000;
  var LOG_KEEP_LINES = 1000;

  function mods() {
    if (!cachedMods) {
      var photoshop = require("photoshop");
      var uxpMod = null;
      try { uxpMod = require("uxp"); } catch (eUxp) { uxpMod = null; }
      cachedMods = {
        app: photoshop.app,
        core: photoshop.core,
        action: photoshop.action,
        imaging: photoshop.imaging,
        uxp: uxpMod
      };
    }
    return cachedMods;
  }

  function errText(e) {
    if (e === null || e === undefined) return "未知错误";
    if (typeof e === "string") return e;
    var s = "";
    try { s = (e.message || "") + (e.number !== undefined ? " (#" + e.number + ")" : ""); } catch (e2) { s = ""; }
    if (!s) { try { s = String(e); } catch (e3) { s = "未知错误"; } }
    return s;
  }

  // 只送面板 sink，不落盘：供落盘子系统自身报错时使用，避免写日志递归
  function panelLog(level, text) {
    if (typeof logSink !== "function") return;   // 无 sink 时静默丢弃（INTERFACE §2）
    try { logSink(level, String(text)); } catch (e) { /* sink 自身出错不得影响主流程 */ }
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }

  function stamp() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " +
      pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
  }

  function warnFileLogOnce(msg) {
    if (logFileWarned) return;
    logFileWarned = true;
    panelLog("warn", "日志落盘不可用（仅面板可见）：" + msg);
  }

  // 定位日志文件：优先数据目录，失败退临时目录；两者都失败 → ok:false（不抛异常）
  async function resolveLogFile() {
    if (logFile) return { ok: true, data: logFile };
    var m = mods();
    if (!m.uxp || !m.uxp.storage || !m.uxp.storage.localFileSystem) {
      return { ok: false, error: "UXP 文件系统不可用（localFileSystem 缺失）" };
    }
    var fs = m.uxp.storage.localFileSystem;
    var folder = null;
    var temp = false;
    try { folder = await fs.getDataFolder(); } catch (eData) { folder = null; }
    if (!folder) {
      try { folder = await fs.getTemporaryFolder(); temp = true; } catch (eTmp) { folder = null; }
    }
    if (!folder) {
      return { ok: false, error: "getDataFolder 与 getTemporaryFolder 都不可用" };
    }
    var entry = null;
    try {
      entry = await folder.getEntry(LOG_FILE_NAME);
    } catch (eMissing) {
      entry = await folder.createFile(LOG_FILE_NAME, { overwrite: false });
    }
    // ★ 第 2 轮缺陷 1：getNativePath 是【async】的（官方插件取证：
    //   Adobe Photoshop 2026\Required\UXP\com.adobe.photoshop.creative_assistant\index.js:90 逐字为
    //   `const path = await storage.localFileSystem.getNativePath(file);`，同文件 :653 亦然）。
    //   写成 String(fs.getNativePath(entry)) 只会拿到 "[object Promise]"，用户永远找不到日志文件。
    // 取值顺序：await getNativePath(entry) → entry.nativePath（22 个官方文件直接读该属性）→ folder.nativePath + "/" + 文件名。
    // 三者全失败也必须保持 ok:true 且 path:""（面板显示「日志落盘不可用」是既有正确降级，不抛异常）。
    var path = "";
    try {
      if (typeof fs.getNativePath === "function") {
        var np = await fs.getNativePath(entry);
        path = np === undefined || np === null ? "" : String(np);
      }
    } catch (ePath1) { path = ""; }
    if (!path) {
      try { path = entry.nativePath === undefined || entry.nativePath === null ? "" : String(entry.nativePath); }
      catch (ePath2) { path = ""; }
    }
    if (!path) {
      try {
        var dir = folder.nativePath === undefined || folder.nativePath === null ? "" : String(folder.nativePath);
        if (dir) {
          var tail = dir.charAt(dir.length - 1);
          path = dir + (tail === "/" || tail === "\\" ? "" : "/") + LOG_FILE_NAME;
        }
      } catch (ePath3) { path = ""; }
    }
    if (!path) panelLog("warn", "日志文件路径无法解析（getNativePath / nativePath 都不可用）：日志仍会写入，但面板无法显示路径");
    logFile = { entry: entry, path: path, temp: temp };
    return { ok: true, data: logFile };
  }

  async function readLogText(entry) {
    var storage = null;
    try { storage = mods().uxp.storage; } catch (eStorage) { storage = null; }
    var raw = null;
    if (storage && storage.formats && typeof storage.formats.utf8 === "string") {
      try { raw = await entry.read({ format: storage.formats.utf8 }); } catch (eFmt) { raw = null; }
    }
    if (raw === null) raw = await entry.read();
    if (typeof raw === "string") return raw;
    if (raw && typeof TextDecoder === "function") return new TextDecoder().decode(toUint8(raw));
    warnFileLogOnce("日志文件读取结果既不是字符串也无法解码");
    return "";
  }

  // 超过 200KB 或 3000 行 → 从头截断到最近约 1000 行（整体覆盖写入）
  async function compactLogFile(entry) {
    var text = await readLogText(entry);
    var lines = text.split("\n");
    if (lines.length > LOG_KEEP_LINES) lines = lines.slice(lines.length - LOG_KEEP_LINES);
    var kept = lines.join("\n");
    await entry.write(kept);
    logBytesWritten = kept.length;
    logLinesWritten = lines.length;
  }

  // ★ 第 2 轮缺陷 2：不再尝试 append，也不再有 appendOk 状态机。
  //   本机取证：D:\software\Adobe Photoshop 2026\Required\UXP\ 下 3072 个 .js 里 `append: true` 0 命中，
  //   Adobe 自家插件从不这么写。危险点在于 UXP 可能【忽略】不认识的选项而不是抛错 ——
  //   那样 appendOk 会永远停在 true，退化分支永不触发，日志被静默覆盖成只剩最后一行，
  //   恰好在最需要日志的场景下以最坏的方式失效。故只走已取证的「读全文 + 拼接 + 整体覆盖」。
  async function writeLogLine(line) {
    var r = await resolveLogFile();
    if (!r.ok) { warnFileLogOnce(r.error); return r; }
    var entry = r.data.entry;
    var old = "";
    try { old = await readLogText(entry); } catch (eRead) { old = ""; }
    await entry.write(old + line);
    logBytesWritten += line.length;
    logLinesWritten += 1;
    if (logBytesWritten > LOG_MAX_BYTES || logLinesWritten > LOG_MAX_LINES) {
      await compactLogFile(entry);
    }
    return { ok: true, data: { path: r.data.path } };
  }

  // 入队即返回（不 await）：Promise 链保证串行，任何异常在此吞掉
  function appendLogLine(line) {
    logWriteChain = logWriteChain.then(function () {
      return writeLogLine(line);
    }).catch(function (e) {
      warnFileLogOnce(errText(e));
      return null;
    });
  }

  async function logFilePath() {
    try {
      var r = await resolveLogFile();
      if (!r.ok) return { ok: false, error: r.error };
      return { ok: true, data: { path: r.data.path, temporary: !!r.data.temp } };
    } catch (e) {
      return { ok: false, error: "取得日志文件路径失败：" + errText(e) };
    }
  }

  function setFileLogEnabled(enabled) {
    fileLogEnabled = !!enabled;
    return { ok: true, data: { enabled: fileLogEnabled } };
  }

  function log(level, text) {
    var msg = String(text);
    panelLog(level, msg);
    // ★ 落盘：面板之外的持久通道；入队失败/写盘失败都不得影响主流程
    if (fileLogEnabled) {
      try { appendLogLine("[" + stamp() + "] [" + String(level) + "] " + msg + "\n"); }
      catch (eLog) { /* 忽略 */ }
    }
  }

  function safeJson(value, maxLen) {
    var text;
    try { text = JSON.stringify(value); } catch (e) { text = String(value); }
    if (text === undefined) text = String(value);
    var cap = maxLen || 1000;
    if (text.length > cap) text = text.slice(0, cap) + "…(截断)";
    return text;
  }

  // 真机首跑核对用：同时写 UDT console 与插件日志面板
  function probe(label, value) {
    var text = typeof value === "string" ? value : safeJson(value);
    try { console.log("[Ecom.probe] " + label + " = " + text); } catch (e) { /* console 不可用时忽略 */ }
    log("info", "探测 " + label + " = " + text);
  }

  function toUint8(raw) {
    if (!raw) return new Uint8Array(0);
    if (raw instanceof Uint8Array) return raw;
    if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
    if (raw.buffer instanceof ArrayBuffer) return new Uint8Array(raw.buffer, raw.byteOffset || 0, raw.byteLength || raw.length);
    if (typeof raw.length === "number") return Uint8Array.from(raw);
    return new Uint8Array(0);
  }

  function numOf(v) {
    if (typeof v === "number") return v;
    if (v && typeof v === "object" && typeof v._value === "number") return v._value;
    if (typeof v === "string") {
      var n = parseFloat(v);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function pickNumber(obj, keys) {
    // ★ 真机返工（09:32:43）：像素持有者 imageData 的 typeof 是 "function" —— 可调用的宿主对象。
    //   旧写法只认 object，于是「函数持有者自带的 width/height 一律读成 null」，
    //   日志里表现为 buffer 取到了 len=6 却 w=null,h=null → 又判「无法确定宽高与通道数」。
    if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return null;
    for (var i = 0; i < keys.length; i++) {
      var n = numOf(obj[keys[i]]);
      if (n !== null && n > 0) return n;
    }
    return null;
  }

  // §1.1：batchPlay 失败项以 {_obj:"error"} 混在返回数组里，不抛异常
  function firstErrorItem(results) {
    if (!results || !results.length) return null;
    for (var i = 0; i < results.length; i++) {
      var item = results[i];
      if (item && typeof item === "object" && item._obj === "error") return item;
    }
    return null;
  }

  function describeErrorItem(item) {
    if (!item) return "";
    var parts = [];
    if (item.message !== undefined) parts.push(String(item.message));
    if (item.number !== undefined && item.number !== null) parts.push("#" + String(item.number));
    if (!parts.length) parts.push(safeJson(item));
    return parts.join(" ");
  }

  // ★ 真机实测（PS 2026，2026-10-13，用户日志逐字）：
  //   UXP 的 imaging.getPixels / imaging.getLayerMask **必须**在 executeAsModal 的作用域内调用，否则抛
  //   "The requested functionality is only allowed from inside a modal scope. See
  //    https://www.adobe.com/go/ps_executeasmodal for details. (#1000)"
  //   ⇒ 自动调色整条链（analyze.subject → getSubjectPixels → getPixels）在真机上 100% 失败，
  //     而面板只会显示「主体统计失败」。（docs/RESEARCH-descriptors.md 的 F26 写「getPixels 不需要
  //     executeAsModal」，该结论已被真机推翻。）
  //   modalDepth 防止嵌套 executeAsModal（UXP 会拒绝重复进入）；深度 > 0 时说明已在 modal 内，直接调用。
  var modalDepth = 0;

  async function enterModal(label, fn) {
    var m = mods();
    return await m.core.executeAsModal(async function (executionContext) {
      modalDepth++;
      try {
        return await fn(executionContext);
      } finally {
        modalDepth--;
      }
    }, { commandName: label || DEFAULT_COMMAND });
  }

  async function imagingCall(label, fn) {
    if (modalDepth > 0) return await fn();
    return await enterModal(label, fn);
  }

  // 只读 batchPlay；部分宿主版本要求只读也走 modal → 直接调用失败时用 modal 重试一次
  async function readBatchPlay(descriptors) {
    var m = mods();
    try {
      return await m.action.batchPlay(descriptors, {});
    } catch (e) {
      log("warn", "只读 batchPlay 直接调用失败，改用 modal 重试：" + errText(e));
      return await m.core.executeAsModal(function () {
        return m.action.batchPlay(descriptors, {});
      }, { commandName: "读取 Photoshop 状态" });
    }
  }

  async function modal(label, fn) {
    try {
      var data = await enterModal(label, fn);
      return { ok: true, data: data };
    } catch (e) {
      var msg = errText(e);
      log("error", "modal(" + (label || DEFAULT_COMMAND) + ") 失败：" + msg);
      return { ok: false, error: msg };
    }
  }

  // 只做 modal 包装，不做错误项检测（供需要逐项容错的模块使用）
  async function runRaw(descriptors) {
    var m = mods();
    try {
      var results = await enterModal(DEFAULT_COMMAND, function () {
        return m.action.batchPlay(descriptors, {});
      });
      return { ok: true, data: { results: results || [] } };
    } catch (e) {
      var msg = errText(e);
      log("error", "batchPlay 执行失败：" + msg);
      return { ok: false, error: msg };
    }
  }

  // ★ 真机定案（09:46 / 09:55 两轮日志）：removeBackground 是延迟命令，之后的 1~3 分钟里 PS 会把描述符
  //   通道整条锁死 —— 读被拒「命令"获取"当前不可用」，写被拒「命令"设置"当前不可用」，于是紧接的
  //   边缘净化 set 直接失败、一键就停在那里（用户报的「只跑到接地投影/边缘净化」）。
  //   忙类拒绝意味着【命令没执行】，所以整条链重跑是安全的 —— 但必须先等宿主空闲再重跑，否则只是再撞一次墙。
  //   只重跑「确认没落地任何步骤」的链：若错误之前已有真实步骤成功，重跑会重复执行（调整层会叠两层）。
  var WRAPPER_OBJS = { "saveDocumentSelection": 1, "restoreDocumentSelection": 1 };
  function busySafeToRetry(results) {
    var bad = firstErrorItem(results);
    if (!bad) return true;                                  // 抛异常 = 整批被拒，什么都没执行
    var idx = results.indexOf(bad);
    if (idx < 0) return false;
    for (var i = 0; i < idx; i++) {
      var o = results[i] && results[i]._obj;
      if (o && !WRAPPER_OBJS[o]) return false;               // 错误之前已有真实步骤 → 重跑会重复
    }
    return true;
  }

  var RUN_BUSY_BUDGET_MS = 300000;
  // ★ 第 7 轮真机取证（10:59:32 日志）：两次「整条链重跑」挤在同一秒里、等于没等 ——
  //   原因是 waitHostIdle 的探针是「取整个图层」，而忙期里【读会先恢复、同一秒的写仍被拒】
  //   （同秒日志：探针已可用，紧接着 set userMaskFeather 仍报「命令"设置"当前不可用」）。
  //   所以重跑前除了探针还要补一段递增退避，并把重试次数提到 8：总等待可覆盖实测 1~3 分钟的锁死窗口
  //   （10:14:41 抠图 → 10:15:38 边缘净化成功＝晚了 57s；另一次 removeBackground 锁死 >150s）。
  var RUN_BUSY_RETRIES = 8;
  async function run(descriptors, opts) {
    // ★ 调用方可覆盖：抠图第二跳（建蒙版）必须等第一跳 removeBackground 算完 ——
    //   真机 12:40:45 第一跳完成，之后 PS 锁死描述符通道 ≥30s（12:41:45 探测仍在报「命令"获取"当前不可用」），
    //   默认 8 次重试只覆盖 30s → 第二跳被拒、蒙版没建成。这里让抠图链自己给足时间。
    var maxRetries = (opts && typeof opts.busyRetries === "number") ? opts.busyRetries : RUN_BUSY_RETRIES;
    var budgetMs = (opts && typeof opts.busyBudgetMs === "number") ? opts.busyBudgetMs : RUN_BUSY_BUDGET_MS;
    var attempt = 0;
    var lockTried = false;
    for (;;) {
      var r = await runOnce(descriptors, opts);
      if (r.ok || attempt >= maxRetries || !isBusy(r.error) || !busySafeToRetry(r.data ? r.data.results : null)) {
        if (!r.ok && /modal state/i.test(String(r.error || ""))) {
          r.error = r.error + "（PS 里有未结束的模态对话框/变换会话：请在 PS 里按 Esc 或回车结束它，再重跑本步）";
        }
        return r;
      }
      var label = (opts && opts.label) || DEFAULT_COMMAND;
      // ★ 用户 m04284 真机事故（14:40:03）：图层【被锁】时 PS 回的也是「命令"变换"当前不可用」，
      //   isBusy 会把它当"宿主忙"退避重试 8 次（约 34s）→ 用户看到的是"插件卡住"。锁是永久原因，
      //   重试永远无效。⇒ 被拒且错误像"命令不可用"时先查锁：能解就解锁并立刻重跑（只查一次）。
      if (!lockTried && opts && opts.lockProbeLayerId !== undefined && opts.lockProbeLayerId !== null &&
          /当前不可用|not available|unknown/i.test(String(r.error || ""))) {
        lockTried = true;
        var lk = await ensureUnlocked(opts.lockProbeLayerId, opts.lockProbeLayerName);
        if (lk.ok && lk.data && lk.data.unlocked) {
          log("warn", label + " 被拒的原因不是忙碌，而是【图层被锁】（" +
            ((lk.data.before && lk.data.before.why) ? lk.data.before.why.join("、") : "") + "）→ 已解锁，立即重跑本步");
          continue;
        }
        if (!lk.ok) {
          log("error", "排查结论：不是宿主忙，而是【图层被锁且自动解锁失败】—— " + lk.error);
          return { ok: false, error: r.error + "；排查结论=图层被锁：" + lk.error, data: r.data, lockedCause: true };
        }
      }
      log("warn", label + " 被 PS 拒（宿主仍在忙）→ 等空闲后整条链重跑（第 " + (attempt + 1) + " 次重试）：" + r.error);
      var idle = await waitHostIdle(null, budgetMs);
      if (!idle.ok) {
        log("error", "等待宿主空闲失败，放弃重跑本步：" + idle.error);
        return r;
      }
      // 探针（取整层）比写命令先恢复 → 再补一段递增退避，避免「探针说空闲 → 立刻重跑 → 又被拒」空转。
      var gap = busyGap(attempt, 0, budgetMs);
      if (gap > 0) {
        log("warn", "重跑前再等 " + gap + "ms（探针先恢复、写命令仍可能被拒）");
        await sleep(gap);
      }
      attempt++;
    }
  }

  async function runOnce(descriptors, opts) {
    opts = opts || {};
    var historyMode = opts.history === undefined ? "suspend" : opts.history;
    var preserveSelection = opts.preserveSelection === undefined ? true : !!opts.preserveSelection;
    var label = opts.label || DEFAULT_COMMAND;
    var list = (descriptors || []).slice();
    if (preserveSelection) {
      list.unshift({ _obj: "saveDocumentSelection" });      // 惯例：批处理首尾包选区（手册 G29 / app.js:26888）
      list.push({ _obj: "restoreDocumentSelection" });
    }
    var m = mods();
    try {
      var results = await enterModal(label, async function (executionContext) {
        var token = null;
        var doc = m.app.activeDocument;
        if (historyMode === "suspend" && doc) {
          // G29 [本机取证]：suspendHistory / resumeHistory 必须成对且在 modal 回调内
          token = await executionContext.hostControl.suspendHistory({ documentID: doc.id, name: label });
        }
        try {
          return await m.action.batchPlay(list, {});
        } finally {
          if (token !== null) {
            try { await executionContext.hostControl.resumeHistory(token); }
            catch (eResume) { log("warn", "resumeHistory 失败：" + errText(eResume)); }
          }
        }
      });

      var bad = firstErrorItem(results);
      if (bad) {
        var msg = "Photoshop 拒绝了描述符：" + describeErrorItem(bad);
        log("error", msg);
        return { ok: false, error: msg, data: { results: results || [] } };
      }
      return { ok: true, data: { results: results || [] } };
    } catch (e) {
      var em = errText(e);
      log("error", label + " 失败：" + em);
      return { ok: false, error: em };
    }
  }

  async function activeDoc() {
    try {
      var m = mods();
      var d = m.app.activeDocument;
      if (!d) return { ok: false, error: "当前没有打开的文档，请先在 Photoshop 中打开一张图片" };
      var path = null;
      try { path = d.path ? String(d.path) : ""; } catch (ePath) { path = ""; }
      return {
        ok: true,
        data: {
          id: d.id,
          name: String(d.title || d.name || ""),
          width: Math.round(d.width),
          height: Math.round(d.height),
          path: path && path.length ? path : null,   // 未保存的新文档 → null，不算错误
          resolution: d.resolution
        }
      };
    } catch (e) {
      return { ok: false, error: "读取当前文档失败：" + errText(e) };
    }
  }

  function clamp255(n) {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = 0;
    return n < 0 ? 0 : n > 255 ? 255 : n;
  }

  function hexToRGB(hex) {
    var s = String(hex === null || hex === undefined ? "" : hex).trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return { red: 0, green: 0, blue: 0 };
    return {
      red: parseInt(s.slice(0, 2), 16),
      green: parseInt(s.slice(2, 4), 16),
      blue: parseInt(s.slice(4, 6), 16)
    };
  }

  function rgbToHex(color) {
    var c = color || {};
    var out = "#";
    var keys = ["red", "green", "blue"];
    for (var i = 0; i < keys.length; i++) {
      var h = clamp255(c[keys[i]]).toString(16).toUpperCase();
      out += h.length < 2 ? "0" + h : h;
    }
    return out;
  }

  async function pickColor() {
    if (colorPickerOpen) return { ok: false, error: "取色器已打开，请先完成当前取色" };
    colorPickerOpen = true;
    var m = mods();
    try {
      // F28 [本机取证]：_target 必须是 application（不是 document），结果在 res[0][0].RGBFloatColor（0..255 标度）
      // 兼容两种返回层级：正常为 [[{RGBFloatColor}]]（多一层数组），部分宿主直接给 [{RGBFloatColor}]
      var res = await m.core.executeAsModal(function () {
        return m.action.batchPlay([{
          _target: { _ref: "application" },
          _obj: "showColorPicker",
          context: "电商图片制作 · 取色",
          color: { _obj: "RGBColor", red: 255, green: 255, blue: 255 }
        }], {});
      }, { commandName: "Color Picker" });
      var r0 = res && res[0];
      var r1 = r0 && r0[0];
      var entry = (r1 && r1.RGBFloatColor) ? r1 : (r0 && r0.RGBFloatColor ? r0 : null);
      var rgb = entry && entry.RGBFloatColor;
      if (!rgb) {
        probe("pickColor.raw", res);
        return { ok: false, error: "取色被取消，或宿主未返回颜色" };
      }
      return { ok: true, data: { hex: rgbToHex({ red: rgb.red, green: rgb.green, blue: rgb.blue }) } };
    } catch (e) {
      return { ok: false, error: "取色失败：" + errText(e) };
    } finally {
      colorPickerOpen = false;
    }
  }

  // ★ 真机实测（PS 2026，用户日志逐字）：`get historyState(targetEnum)` 的返回是
  //   [{"name":"打开","itemIndex":2,"count":2,"auto":true,"historyBrushSource":false,
  //     "currentHistoryState":true,"ID":61}]
  //   —— id 的键名是 **`ID`**（大写），既不是 `_id` 也不是 `historyStateID`。
  //   旧代码只认 `_id`/`historyStateID` ⇒ 永远报「返回结构里找不到 historyState 的 _id」，
  //   「一键回退」整个功能真机上从未可用过。
  function extractHistoryIdShallow(o) {
    if (!o || typeof o !== "object") return null;
    if (typeof o.ID === "number") return o.ID;            // ★ 真机实际键名
    if (typeof o.historyStateID === "number") return o.historyStateID;
    if (typeof o._id === "number") return o._id;
    if (typeof o.id === "number") return o.id;
    return null;
  }

  function extractHistoryId(entry) {
    if (!entry || typeof entry !== "object") return null;
    if (entry.historyState && typeof entry.historyState === "object") {
      var inner = extractHistoryIdShallow(entry.historyState);
      if (inner !== null) return inner;
    }
    var shallow = extractHistoryIdShallow(entry);
    if (shallow !== null) return shallow;
    var stack = [entry];
    var guard = 0;
    while (stack.length && guard++ < 200) {
      var cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      var keys = Object.keys(cur);
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        var v = cur[k];
        if ((k === "_id" || k === "ID") && typeof v === "number") return v;
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return null;
  }

  async function snapshot() {
    try {
      // G29 方案 (A) [本机取证]：取当前 historyState 的 _id（★ 不用 _index）
      var res = await readBatchPlay([{
        _obj: "get",
        _target: { _ref: [{ _ref: "historyState", _enum: "ordinal", _value: "targetEnum" }] }
      }]);
      var bad = firstErrorItem(res);
      if (bad) return { ok: false, error: "记录历史快照失败：" + describeErrorItem(bad) };
      var id = extractHistoryId(res && res[0]);
      if (id === null) {
        probe("snapshot.raw", res);
        return { ok: false, error: "记录历史快照失败：返回结构里找不到 historyState 的 _id（原始返回已写入日志）" };
      }
      log("info", "已记录历史快照 id=" + id);
      return { ok: true, data: { token: id } };
    } catch (e) {
      return { ok: false, error: "记录历史快照失败：" + errText(e) };
    }
  }

  async function restore(token) {
    var id = token && typeof token === "object" ? token.historyId : token;
    if (id === null || id === undefined) return { ok: false, error: "回退失败：历史快照 token 无效" };
    var r = await run([{
      _obj: "select",
      _target: { _ref: [{ _ref: "historyState", _id: id }] }
    }], { history: "normal", preserveSelection: false, label: "电商图片制作 · 回退" });
    if (!r.ok) return { ok: false, error: "回退失败：" + r.error };
    log("info", "已回退到历史快照 id=" + id);
    return { ok: true, data: { restored: true } };
  }

  // ★ 用户 m03873：把图层蒙版【烘焙进像素】（= PS 的「图层>图层蒙版>应用」，缩览图消失、不能再编辑）。
  //   ⚠ 教训（第 17 轮真机）：harness 的 ops-jsx.js:624 用 stringIDToTypeID('applyLayerMask')，照抄到 UXP 后
  //   PS 27.1 回「命令"<未知的>"当前不可用」——stringIDToTypeID 只是凭空 mint 一个 ID，事件名不存在时
  //   当场不报错，要等 PS 真执行才说「未知的」。⇒「照抄 harness 的名字」不构成可用性证明；
  //   本机真正生效的是下面候选表第一种 delete + apply:true（官方 apply 语义）。
  //   陷阱：不能靠"命令没报错"判定生效 —— 必须回读整层 get 确认蒙版真的消失（详见 docs/DEVELOPER.md §17）。
  async function applyUserMask(layerId, nameHint, busyBudgetMs) {
    var budget = (typeof busyBudgetMs === "number" && busyBudgetMs > 0) ? busyBudgetMs : 120000;
    // ★ 真机 14:33 取证：单发 `applyLayerMask` 被 PS 回「命令"<未知的>"当前不可用」—— stringIDToTypeID 只会
    //   mint 一个新 ID，事件名写错它当时不报错，要等 PS 真执行时才说「未知的」。⇒ 按候选表逐个试，
    //   每试一种都用【重新取的整层 get】确认蒙版真的没了（这才是「烘焙生效」的判据），并把生效形式写进日志。
    var forms = [
      { name: "delete+apply", ops: [
        { _obj: "select", _target: [{ _ref: "layer", _id: layerId }] },
        { _obj: "delete", _target: [{ _ref: "channel", _enum: "channel", _value: "mask" }], apply: true }
      ] },
      { name: "applyLayerMask", ops: [
        { _obj: "select", _target: [{ _ref: "layer", _id: layerId }] },
        { _obj: "applyLayerMask" }
      ] }
    ];
    var errs = [];
    for (var fi = 0; fi < forms.length; fi++) {
      var r = await run(forms[fi].ops, {
        label: "电商图片制作 · 应用图层蒙版（烘焙·" + forms[fi].name + "）",
        busyRetries: 8, busyBudgetMs: budget
      });
      if (!r.ok) { errs.push(forms[fi].name + "：" + r.error); continue; }
      var chk = await hasUserMask(layerId, 8000, nameHint);
      if (!(chk.ok && chk.data && chk.data.hasMask === true)) {
        log("info", "应用蒙版生效形式 = " + forms[fi].name + "（整层 get 已读不到蒙版" + (chk.ok ? "" : "；回读误差=" + chk.error) + "）");
        return { ok: true, data: { form: forms[fi].name, maskGone: true } };
      }
      errs.push(forms[fi].name + "：命令通过但整层 get 仍读到蒙版（userMaskEnabled=" + String(chk.data.maskEnabled) + "）");
    }
    return { ok: false, error: "两种「应用蒙版」形式都没生效 —— " + errs.join("；") };
  }

  function describeKeys(obj) {
    if (!obj || typeof obj !== "object") return String(obj);
    try { return Object.keys(obj).join(","); } catch (e) { return "无法枚举"; }
  }

  // F27/B2：返回形态未坐实 —— 真机 getLayerMask 顶层键是 {imageData, sourceBounds}（没有 width/height/dispose），
  // 与 getPixels 同族；imageData 里到底有没有 getData() 真机尚未坐实（探测曾报「未取到像素缓冲区」）。
  // 对策：不再假定单一形态 —— 把两级候选逐个试（有 getData() 的 → 自身即类数组的），
  //       并把每个键的类型/长度写进日志，使下一次真机运行自证形态。
  function safeKeys(obj) {
    try { return obj && typeof obj === "object" ? Object.keys(obj) : []; } catch (e) { return []; }
  }

  function shapeOf(obj, depth) {
    if (obj === null || obj === undefined) return String(obj);
    var t = typeof obj;
    if (t !== "object") return t;
    var ks = safeKeys(obj);
    var parts = [];
    for (var i = 0; i < ks.length && i < 14; i++) {
      var v;
      try { v = obj[ks[i]]; } catch (eV) { parts.push(ks[i] + ":<取值抛错>"); continue; }
      var vt = typeof v;
      if (v && vt === "object") {
        var sub = (typeof depth === "number" && depth > 0) ? " sub=[" + safeKeys(v).slice(0, 8).join(",") + "]" : "";
        parts.push(ks[i] + ":{len=" + (typeof v.length === "number" ? v.length : "-") + sub + "}");
      } else if (v && vt === "function") {
        // ★ 真机（09:32:43）：getPixels 的 imageData 是 "typeof function" —— UXP 原生实例就是可调用宿主对象，
        //   方法可能挂在自有属性或原型上。旧代码只打一句 "function"，等于把唯一线索丢掉；
        //   失败时把自有键与原型键都写进日志，下一轮不用再猜。
        var own = [];
        try { own = Object.getOwnPropertyNames(v).slice(0, 10); } catch (eOwn) { own = ["<取值抛错>"]; }
        var pr = [];
        try { pr = Object.getOwnPropertyNames(Object.getPrototypeOf(v) || {}).slice(0, 10); } catch (ePr) { pr = ["<取值抛错>"]; }
        parts.push(ks[i] + ":fn[own=" + own.join(",") + " | proto=" + pr.join(",") + "]");
      } else {
        parts.push(ks[i] + ":" + vt);
      }
    }
    return "{" + parts.join(" ") + "}";
  }

  // 类数组像素缓冲（Uint8Array / Uint8ClampedArray 等视图）
  function isPixelBuffer(v) {
    if (!v || (typeof v !== "object" && typeof v !== "function")) return false;
    return typeof v.length === "number" && typeof v.BYTES_PER_ELEMENT === "number";
  }

  // 候选持有者：self → 一级子键 → 二级子键（只两级，不做无界遍历）
  // ★ 真机取证（17:59:17）：getPixels 返回 {imageData:function sourceBounds:{…} level:number} ——
  //   imageData 是【函数】不是对象，旧的「只收 object」直接把唯一持有者过滤掉了，
  //   于是走到「已试[self{无getData} / sourceBounds{无getData}]」→ 调色整条判失败。
  //   → 函数候选必须一起收，并记住它的父对象（调用时要绑 this）。
  function pixelCandidates(wrap) {
    var out = [];
    function push(name, o, parent) {
      var t = typeof o;
      if (o && (t === "object" || t === "function")) out.push({ n: name, o: o, p: parent, fn: t === "function" });
    }
    push("self", wrap, null);
    var ks = safeKeys(wrap);
    for (var i = 0; i < ks.length; i++) {
      var v;
      try { v = wrap[ks[i]]; } catch (eV) { continue; }
      var tv = typeof v;
      if (!v || (tv !== "object" && tv !== "function")) continue;
      push(ks[i], v, wrap);
      if (tv !== "object") continue; // 函数没有可枚举子键
      var vk = safeKeys(v);
      for (var j = 0; j < vk.length; j++) {
        var w2;
        try { w2 = v[vk[j]]; } catch (eV2) { continue; }
        var tw = typeof w2;
        if (w2 && (tw === "object" || tw === "function")) push(ks[i] + "." + vk[j], w2, v);
      }
    }
    return out;
  }

  // 尺寸来源：自身 width/height → 任一子对象的 width/height/x/y/left… → 顶层 sourceBounds 的四个边界
  function pickSize(o, wrap) {
    var w = pickNumber(o, ["width", "Width"]);
    var h = pickNumber(o, ["height", "Height"]);
    if (!w || !h) {
      var ks = safeKeys(o);
      for (var i = 0; i < ks.length; i++) {
        var v;
        try { v = o[ks[i]]; } catch (eV) { continue; }
        if (v && typeof v === "object") {
          w = w || pickNumber(v, ["width", "Width"]);
          h = h || pickNumber(v, ["height", "Height"]);
        }
      }
    }
    var sb = (wrap && wrap.sourceBounds) || (o && o.sourceBounds) || null;
    if ((!w || !h) && sb && typeof sb === "object") {
      var l = pickNumber(sb, ["left", "x"]);
      var t = pickNumber(sb, ["top", "y"]);
      var rr = pickNumber(sb, ["right"]);
      var bb = pickNumber(sb, ["bottom"]);
      if (typeof l === "number" && typeof rr === "number" && typeof t === "number" && typeof bb === "number") {
        w = w || Math.max(0, Math.round(rr - l));
        h = h || Math.max(0, Math.round(bb - t));
      }
    }
    return { width: w, height: h };
  }

  // 从任意返回形态里取出像素缓冲 + 尺寸；成功={raw,width,height,how,holder}，失败={err}
  // ★ 真机取证（09:22:14，两次事故复现）：唯一的像素持有者 imageData 是【类构造器】——
  //   它不是「要绑父对象调用的方法」：真机错误原文
  //     Class constructor PhotoshopImageData cannot be invoked without 'new'
  //   （call() 一个 class 必然抛这句）。而旧代码的门禁是「只有 imageData.prototype.getData 是函数才试 new」，
  //   getData 挂在实例上、原型上取不到 → 门禁永远不成立 → 只剩 call() 一条路 → 必然抛。
  //   后果：getPixels（调色）与 getLayerMask（覆盖率）两条路双双全灭。
  //   → 每个函数候选依次试【原样 → new → call()】（09:32:43 追加：真机上它是可调用的宿主对象，
  //     原样调用才对，见下面 pixelVariants 的注释），并把真正走通的那条写进日志（how）自证形态。
  function pixelVariants(c) {
    if (!c.fn) return [{ n: c.n, kind: "obj", o: c.o, p: c.p }];
    // ★ 真机返工（09:32:43）：imageData 的 typeof 是 "function"，但 UXP 的原生实例本身就是「可调用的宿主对象」——
    //   Adobe 自家插件（com.adobe.photoshop.creative_assistant/index.js:723、adjustments-panel/js/ps.js:357）
    //   就是直接 await selection.imageData.getData() / imgObj.imageData.dispose()，从不 new。
    //   旧变体只有 new / call()，把「原样用这个值」这条路整条漏掉 → 三条路全灭（日志
    //   「imageData→new{无getData} / imageData→call()→抛:Class constructor …」）。
    //   现在顺序＝原样 → new → call()。
    return [
      { n: c.n, kind: "obj", o: c.o, p: c.p },
      { n: c.n + "→new", kind: "new", o: c.o },
      { n: c.n + "→call()", kind: "call", o: c.o, p: c.p }
    ];
  }

  // 沿原型链找方法：原生实例的方法常常挂在原型上，而不出现在 Object.keys 里。
  function protoMethod(obj, name) {
    var cur = obj;
    for (var d = 0; d < 4 && cur; d++) {
      try {
        var desc = Object.getOwnPropertyDescriptor(cur, name);
        if (desc && typeof desc.value === "function") return desc.value;
      } catch (eD) { /* 原生对象可能拒答描述符 */ }
      try { cur = Object.getPrototypeOf(cur); } catch (eP) { return null; }
    }
    return null;
  }

  async function takePixelHolder(target, label) {
    if (isPixelBuffer(target)) {
      var r0 = toUint8(target);
      if (r0 && r0.length) return { raw: r0, via: label + "[]" };
    }
    if (target && typeof target.getData === "function") return { holder: target, via: label + ".getData()" };
    if (protoMethod(target, "getData")) return { holder: target, via: label + ".getData()(proto)" };
    if (target && typeof target.getConstData === "function") {
      return { holder: target, raw: toUint8(await target.getConstData()), via: label + ".getConstData()" };
    }
    return null;
  }

  async function extractPixelBuffer(wrap) {
    var cands = pixelCandidates(wrap);
    var tried = [];
    var found = null;

    for (var i = 0; i < cands.length && !found; i++) {
      var vs = pixelVariants(cands[i]);
      for (var k = 0; k < vs.length && !found; k++) {
        var v = vs[k];
        var target;
        try {
          if (v.kind === "new") target = new v.o();
          else if (v.kind === "call") target = await v.o.call(v.p === null || v.p === undefined ? undefined : v.p);
          else target = v.o;
        } catch (eMake) { tried.push(v.n + "→抛:" + errText(eMake)); continue; }
        var pick;
        try { pick = await takePixelHolder(target, v.n); }
        catch (eP) { tried.push(v.n + "→抛:" + errText(eP)); continue; }
        if (!pick) { tried.push(v.n + "{无getData}"); continue; }
        tried.push(pick.via);
        var raw = pick.raw;
        if (!raw && pick.holder) raw = toUint8(await pick.holder.getData());
        if (raw && raw.length) found = { holder: pick.holder || wrap, raw: raw, how: pick.via };
      }
    }
    if (!found) return { err: "已试[" + tried.join(" / ") + "]；形态=" + shapeOf(wrap, 1) };
    var sz = pickSize(found.holder, wrap);
    return { raw: found.raw, width: sz.width, height: sz.height, how: found.how, holder: found.holder };
  }

  function disposeQuiet(obj) {
    if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return;
    try { if (typeof obj.dispose === "function") obj.dispose(); } catch (e) { /* 释放失败不影响结果 */ }
  }

  function extractChannel0(arr, pixelCount, channels) {
    if (channels <= 1) return arr.slice(0, pixelCount);
    var out = new Uint8Array(pixelCount);
    for (var i = 0; i < pixelCount; i++) out[i] = arr[i * channels];
    return out;
  }

  // ★ 用户 m03578 真机定案（13:47:16 → 13:47:55，4080x1836 那份文档）：抠图链里的 rasterizeLayer 会把图层
  //   【换成一个新 id】（日志：主体层锁定「背景」id=1；13:47:55 读到的蒙版像素却属于 id=2）。于是所有
  //   「按旧 id 读蒙版」都抛 `Error: Unknown layer`（全日志 454 次）—— 面板就只能显示「未测出 / 待确认」。
  //   ⇒ 蒙版读取一律带图层【名字】当提示：id 报 Unknown layer 时按名字重解析一次 id 再读（只自愈一次）。
  function isUnknownLayer(err) {
    return /unknown layer/i.test(String(err || ""));
  }

  // 按名字在活动文档里找图层 id（DOM，不需要描述符通道；连 PS 忙期也能用）。找不到返回 null。
  function layerIdByName(name) {
    if (!name) return null;
    try {
      var m = mods();
      var doc = m.app && m.app.activeDocument;
      var layers = doc && doc.layers ? doc.layers : null;
      if (!layers) return null;
      for (var i = 0; i < layers.length; i++) {
        var L = layers[i];
        if (L && String(L.name) === String(name)) {
          var id = Number(L.id);
          if (isFinite(id) && id > 0) return id;
        }
      }
    } catch (e) { }
    return null;
  }

  // 图层 id 是否仍存在（rasterizeLayer 会让旧 id 消失）。任何不确定都返回 true —— 宁可不动，也不要把主体 id 换错。
  async function layerExistsById(layerId) {
    if (layerId === null || layerId === undefined) return false;
    try {
      var m = mods();
      var doc = m.app && m.app.activeDocument;
      var layers = doc && doc.layers ? doc.layers : null;
      if (!layers) return true;
      for (var i = 0; i < layers.length; i++) {
        if (layers[i] && Number(layers[i].id) === Number(layerId)) return true;
      }
      return false;
    } catch (e) { return true; }
  }

  // 需要自愈时返回新 id，否则返回 null（已自愈过、没给名字、错误不是 Unknown layer、名字也找不到 → 都不自愈）
  function selfHealLayerId(errorText, layerId, nameHint, alreadyHealed) {
    if (alreadyHealed || !nameHint || !isUnknownLayer(errorText)) return null;
    var fresh = layerIdByName(nameHint);
    if (fresh === null || fresh === layerId) return null;
    return fresh;
  }

  async function readUserMask(layerId) {
    var m = mods();
    var mask = null;
    var holder = null;
    try {
      // F27 [本机取证]：{layerID, kind:"user"}；无蒙版时该调用会抛异常
      //   → 不变式：调用方必须先 hasUserMask 判定为 true（本文件两处调用点均已被 getUserMaskCoverage 的判定挡住），
      //     且判定只能用第 6 轮的「整层 get」形式，不得回退到被 PS 2026 拒绝的属性 get。
      // ★ 真机实测（与 getPixels 同因）：getLayerMask 与 imageData.getData() 都必须落在
      //   executeAsModal 作用域内 —— 只包住 getLayerMask、把 getData() 留在外面同样会被拒。
      //   两者合进同一次 modal 调用。
      var got = await imagingCall("电商图片制作 · 读取蒙版", async function () {
        var mk = await m.imaging.getLayerMask({ layerID: layerId, kind: "user" });
        return { mask: mk, px: await extractPixelBuffer(mk) };
      });
      mask = got.mask;
      probe("getLayerMask.keys", describeKeys(mask));
      var px = got.px;
      if (px.err) {
        probe("getLayerMask.shape", shapeOf(mask, 1));
        log("warn", "getLayerMask 返回结构无法识别（" + px.err + "）→ alphaMask 置 null");
        return { ok: false, error: "蒙版返回结构无法识别（" + px.err + "）" };
      }
      holder = px.holder;
      probe("getLayerMask.buffer", { how: px.how, len: px.raw.length, w: px.width, h: px.height });
      var arr = px.raw;
      var w = px.width;
      var h = px.height;
      if (!w || !h) {
        log("warn", "蒙版尺寸字段探测失败（buffer=" + px.how + "，len=" + arr.length + "，形态=" + shapeOf(mask, 1) + "）");
        return { ok: false, error: "蒙版尺寸无法识别" };
      }
      var pixelCount = w * h;
      if (arr.length < pixelCount) {
        log("warn", "蒙版像素不足：w=" + w + " h=" + h + " len=" + arr.length);
        return { ok: false, error: "蒙版像素数据不足" };
      }
      var channels = Math.max(1, Math.round(arr.length / pixelCount));
      var gray = extractChannel0(arr, pixelCount, channels);
      // ★ 真机返工（09:48:44 / 09:48:56 / 09:49:13 三次读数覆盖率 1 → 0.094 → 1 来回跳）：
      //   同一图层、同一份蒙版，12 秒内量出两种完全相反的结果 → 光看一个 coverage 数字无法判定
      //   「蒙版真的全白（抠图没切）」还是「读到了还没画完的蒙版 / 空白占位」。
      //   于是每次读都落一份签名：零像素数、白像素数、min/max/均值、前 8 个字节。
      //   真蒙版必然有大量 0（主体外是黑）；空白占位必然 零=0 且 全白=pixelCount。
      var zeros = 0, whites = 0, mn = 255, mx = 0, sum = 0;
      for (var i = 0; i < pixelCount; i++) {
        var g = gray[i];
        sum += g;
        if (g === 0) zeros++; else if (g === 255) whites++;
        if (g < mn) mn = g;
        if (g > mx) mx = g;
      }
      var head = [];
      for (var hh = 0; hh < 8 && hh < pixelCount; hh++) head.push(gray[hh]);
      log("info", "蒙版像素签名：图层 id=" + layerId + " " + w + "x" + h + " ch=" + channels +
        " 零=" + zeros + " 白=" + whites + " min=" + mn + " max=" + mx +
        " 均值=" + (Math.round(sum / pixelCount * 10) / 10) + " 前8=[" + head.join(",") + "]");
      if (zeros === 0) {
        log("warn", "蒙版全白（零像素数=0）→ 覆盖率 1 不能当作抠图成功：要么确实没切掉任何区域，" +
          "要么读到的是还没画完的蒙版/空白占位。请对照「蒙版像素签名」与图层缩览图判断。");
      }
      return { ok: true, data: { gray: gray, width: w, height: h, channels: channels, coverage: (pixelCount - zeros) / pixelCount } };
    } catch (e) {
      log("warn", "读取图层蒙版失败：" + errText(e));
      return { ok: false, error: "读取图层蒙版失败：" + errText(e) };
    } finally {
      disposeQuiet(holder);
      if (mask !== holder) disposeQuiet(mask);
    }
  }

  // 第 6 轮真机取证（PS 2026，H1/H2/H3/T2/T2b 全组 FAIL）：
  //   「属性 get」形式一律被拒 —— {_obj:"get",_target:{_ref:[{_property:"hasUserMask"}, …]}}、换 _target 数组顺序、
  //   换 layer _id，以及 userMaskEnabled 属性，全部报「命令"获取"当前不可用」。
  //   可用写法是取【整个图层对象】，再从返回对象里读 hasUserMask 布尔值（真机 43 个键，hasKey(hasUserMask)=true）。
  //   返回包装形态未完全固定（直接挂在结果上 / 包在 _obj:"layer" 里）→ 沿已知包装键限深查找，不做无界遍历。
  var BOOL_WRAP_KEYS = ["layer", "to", "target", "value", "_target"];
  function findBoolDeep(obj, key, depth) {
    var d = depth || 0;
    if (!obj || typeof obj !== "object" || d > 3) return null;
    if (typeof obj[key] === "boolean") return obj[key];
    if (Array.isArray(obj)) {
      for (var i = 0; i < obj.length; i++) {
        var ra = findBoolDeep(obj[i], key, d + 1);
        if (ra !== null) return ra;
      }
      return null;
    }
    for (var k = 0; k < BOOL_WRAP_KEYS.length; k++) {
      var v = obj[BOOL_WRAP_KEYS[k]];
      if (v && typeof v === "object") {
        var rv = findBoolDeep(v, key, d + 1);
        if (rv !== null) return rv;
      }
    }
    return null;
  }

  // ★ 真机实测（PS 2026，用户日志 17:47:46 与 17:48:04 对照）：removeBackground 是【异步延迟】命令 ——
  //   PS 受理后还要算好几秒甚至几十秒，这期间一切描述符都被拒：`命令"获取"当前不可用`、`命令"选择"当前不可用`。
  //   17:47 那次 3 次重试（合计约 3.1s）全落在计算窗口内 → 抠图被判失败 → 一键流程停在这一步；
  //   17:48:04 用户手动再点一次（约 15s 后）同样的调用就成功了。用户原话即「ps自带的抠图需要时间计算」。
  //   对策：把 BUSY 当成「等」而不是「错」，但用【递增退避 + 直接调用】等（见 BUSY_BACKOFF_MS）。
  // 只把「宿主暂时不受理」当可重试；#1000 / modal scope 是代码缺陷（没包 modal），重试没意义且会掩盖 bug。
  // ★ 真机取证（09:17:48 / 09:22:13）：抠图链刚跑完的那几秒里 imaging.getLayerMask 抛 `Error: Unknown layer`。
  //   它不是「这个图层没有蒙版」，而是「图层状态还在更新，宿主暂时认不出这个 id」——
  //   旧代码把它当致命错误，于是 coverage 永远是 null、覆盖率永远显示「未知」。
  // ★ 第 7 轮真机取证（PS 27.1，直连探测）：延迟命令（removeBackground/selectSubject）算完之前，PS 会拒掉
  //   **一切** Action Manager 描述符 —— 连与图层无关的只读查询 get numberOfLayers 也报「非法参数」，
  //   几分钟后同一描述符正常返回。也就是说「忙」有两套错误文案：「当前不可用」和「非法参数」。
  //   旧 BUSY_RE 只认前者 → 「非法参数」被当成真错 → 蒙版状态判定立刻认输、不重试
  //   → 面板永远显示「待确认」：这正是用户三次反馈的「还是无法检测蒙版」。
  var BUSY_RE = /当前不可用|is not available|not available|RPC_E|busy|unknown layer|非法参数|invalid argument|illegal argument|参数错误|参数无效/i;
  var MODAL_RE = /#1000|modal scope/i;

  function isBusy(err) {
    var s = String(err === undefined || err === null ? "" : err);
    return BUSY_RE.test(s) && !MODAL_RE.test(s);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // 忙类错误（含 Unknown layer）退避重试后才认输；预算耗尽同样如实返回失败。
  async function readUserMaskRetry(layerId, busyBudgetMs, nameHint) {
    var budget = (typeof busyBudgetMs === "number" && busyBudgetMs >= 0) ? busyBudgetMs : 8000;
    var attempt = 0;
    var waited = 0;
    var healed = false;
    for (;;) {
      var r = await readUserMask(layerId);
      if (r.ok) {
        if (r.data) r.data.layerId = layerId;
        if (attempt > 0) log("info", "读取蒙版像素在第 " + (attempt + 1) + " 次尝试后成功（累计等待 " + waited + "ms）");
        return r;
      }
      var fresh = selfHealLayerId(r.error, layerId, nameHint, healed);
      if (fresh !== null) {
        log("warn", "读蒙版像素报 Unknown layer：图层 id 已变（旧 id=" + layerId + "）→ 按名字「" + nameHint + "」重解析为 id=" + fresh + " 后重试");
        layerId = fresh; healed = true; attempt = 0; waited = 0;
        continue;
      }
      var gap = busyGap(attempt, waited, budget);
      if (!isBusy(r.error) || gap <= 0) return r;
      log("warn", "读取蒙版像素第 " + (attempt + 1) + " 次被拒（PS 仍在更新图层状态），" + gap +
        "ms 后重试（已等 " + waited + "ms / 上限 " + budget + "ms）：" + r.error);
      await sleep(gap);
      waited += gap;
      attempt++;
    }
  }

  // ★ 真机定案（09:46:06→09:46:33）：removeBackground 是【延迟命令】—— PS 在它算完之前会把
  //   **所有描述符通道锁死**（读被拒「命令"获取"当前不可用」，写也被拒「命令"设置"当前不可用」，
  //   于是紧接的边缘净化 set userMaskFeather 直接失败、一键停在那里）。实测锁死 >27s。
  //   所以抠图之后需要一个「等宿主空闲」的闸门：拿一次整层 get 当探针，成功＝空闲；
  //   被拒就递增退避继续等，并把进度写进日志（用户至少知道在等什么，而不是面板死了）。
  async function waitHostIdle(layerId, budgetMs) {
    var budget = (typeof budgetMs === "number" && budgetMs > 0) ? budgetMs : 120000;
    var attempt = 0;
    var waited = 0;
    var lastErr = "（未探测）";
    var target = (layerId === undefined || layerId === null)
      ? [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
      : [{ _ref: "layer", _id: layerId }];
    for (;;) {
      var idle = false;
      try {
        var res = await readBatchPlay([{ _obj: "get", _target: target }]);
        var bad = firstErrorItem(res);
        if (bad) lastErr = "读取图层状态失败：" + describeErrorItem(bad);
        else idle = true;
      } catch (e) {
        lastErr = "读取图层状态失败：" + errText(e);
      }
      if (idle) {
        if (attempt > 0) log("info", "宿主已空闲：等了 " + waited + "ms（探测 " + (attempt + 1) + " 次）→ 继续后续步骤");
        return { ok: true, data: { waitedMs: waited, attempts: attempt + 1 } };
      }
      var gap = busyGap(attempt, waited, budget);
      if (!isBusy(lastErr) || gap <= 0) {
        return { ok: false, error: lastErr + "（已等 " + waited + "ms / 上限 " + budget + "ms，探测 " + (attempt + 1) + " 次）" };
      }
      log("warn", "等待 Photoshop 完成抠图运算：第 " + (attempt + 1) + " 次探测被拒（已等 " + waited + "ms / 上限 " + budget + "ms）：" + lastErr);
      await sleep(gap);
      waited += gap;
      attempt++;
    }
  }

  async function hasUserMaskOnce(layerId, forceModal) {
    try {
      // 第 6 轮 F2：只走「取整个图层对象」这一种形式（属性形式在 PS 2026 上被拒，见上方取证）
      var target = (layerId === undefined || layerId === null)
        ? [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
        : [{ _ref: "layer", _id: layerId }];
      var res = forceModal
        ? await enterModal("电商图片制作 · 读取蒙版状态", function () {
            return mods().action.batchPlay([{ _obj: "get", _target: target }], {});
          })
        : await readBatchPlay([{ _obj: "get", _target: target }]);
      var bad = firstErrorItem(res);
      if (bad) return { ok: false, error: "读取蒙版状态失败：" + describeErrorItem(bad) };
      var entry = res && res[0];
      // 第 6 轮追加 B：两级判据 —— userMaskEnabled 的【键是否存在】本身就是蒙版存在与否的判据
      //   （生产插件 lib/jsx.js:118-126 同写法）。真机三例对照：无蒙版 false/false、有蒙版 true/true、deselect 后 true/true；
      //   `mask` 键三例全不存在，绝不可用它判定蒙版。
      var enabled = findBoolDeep(entry, "userMaskEnabled", 0);
      var legacy = findBoolDeep(entry, "hasUserMask", 0);
      var flag = enabled !== null ? enabled : legacy;
      var usedKey = enabled !== null ? "userMaskEnabled" : (legacy !== null ? "hasUserMask" : "无");
      if (!maskStateLogged) {
        maskStateLogged = true;
        log("info", "读取蒙版状态：整层 get 生效，判据键=" + usedKey + " userMaskEnabled=" + String(enabled) +
          " hasUserMask=" + String(legacy) + "（返回键=" + describeKeys(entry) + "）");
      }
      if (flag === null) {
        log("warn", "整层 get 返回里既没有 userMaskEnabled 也没有 hasUserMask 键（返回键=" + describeKeys(entry) + "）→ 按失败上报，不猜");
        return { ok: false, error: "读取蒙版状态失败：整层 get 返回里既没有 userMaskEnabled 也没有 hasUserMask 键（原始键已写入日志）" };
      }
      // userMaskEnabled=false 且 hasUserMask=true＝蒙版存在但被临时停用（真机未取证）→ 仍按「有蒙版」处理并记日志，
      //   否则一键流程会误判成「没抠图」而中断；只有两键都为 false 才是真无蒙版。
      if (flag === false && legacy === true) {
        log("warn", "userMaskEnabled=false 但 hasUserMask=true（蒙版存在但被停用）→ 按有蒙版处理");
      }
      return { ok: true, data: { hasMask: flag === true || legacy === true, maskEnabled: enabled } };
    } catch (e) {
      return { ok: false, error: "读取蒙版状态失败：" + errText(e) };
    }
  }

  // ★ 真机取证（17:58:31 → 17:59:17，用户日志）：抠图后 45s 内 71 次重试【每次都被强制包进 modal】全被拒，
  //   而上限一到、紧接着的一次【直接】batchPlay 就成功了（同一秒里「边缘净化」那次整层 get 也成功）。
  //   → 重试一律走直接调用，不再强制 modal（getLayerMask/像素读取仍需 modal，#1000 已真机取证，两者不可混）。
  //   → 间隔改成递增退避（8 次、合计约 21s），不再 600ms 硬捶：硬捶既刷满日志，也分不清是「等得不够」还是「捶坏了」。
  // ★ 真机返工（09:46:06→09:46:33 日志）：抠图后 PS 忙了 27s+ 还没结束（get/set 全被拒），
  //   旧的表 8 次只有约 21s，遇到 60s 的预算也根本用不满 → 退避表必须能撑到预算。
  // ★ 真机返工（09:55 日志，4080x1836 图）：removeBackground 让 PS 锁死描述符通道【超过 150s】
  //   （09:55:19→09:57:54 探测 26 次全被拒），而抠图步骤给的预算写的是 120s ——
  //   旧表 12 条只够 72s，循环在「表用尽」时就收工了，日志写着「上限 120000ms」却只等了 72000ms。
  //   → 表必须能撑满任何预算，并用 busyGap() 把最后一跳裁到剩余预算，预算才是真上限。
  var BUSY_BACKOFF_MS = [400, 800, 1600, 3200, 5000, 5000, 5000, 8000, 8000, 10000, 10000, 15000,
    15000, 15000, 20000, 20000, 30000, 30000, 30000, 30000];
  var BUSY_BUDGET_DEFAULT_MS = 21000;

  // 下一次该等多久：表内取表项；表用尽后沿用最后一跳（不再因为「表短」而提前放弃）；
  // 永不超过剩余预算；预算已用完返回 0（调用方据此收工，并把真实等待时长写进日志）。
  function busyGap(attempt, waited, budget) {
    var remain = budget - waited;
    if (remain <= 0) return 0;
    var base = (attempt < BUSY_BACKOFF_MS.length) ? BUSY_BACKOFF_MS[attempt] : BUSY_BACKOFF_MS[BUSY_BACKOFF_MS.length - 1];
    return (base < remain) ? base : remain;
  }
  // busyBudgetMs：这次判定最多愿意等多久。默认 21s（设计性流程）；抠图链里只需 2s ——
  //   真机取证（17:58:31→17:59:17）抠图后 PS 会锁死描述符通道几十秒，而「蒙版状态」在那条链上
  //   只是一条诊断信息（蒙版是 removeBackground 自己建的，有没有不靠读它）。为它把面板卡住几十秒
  //   就是用户报的「有蒙版了还在检测」。
  async function hasUserMask(layerId, busyBudgetMs, nameHint) {
    var budget = (typeof busyBudgetMs === "number" && busyBudgetMs >= 0) ? busyBudgetMs : BUSY_BUDGET_DEFAULT_MS;
    var attempt = 0;
    var waited = 0;
    var healed = false;
    for (;;) {
      var last = await hasUserMaskOnce(layerId, false);
      if (last.ok) {
        if (last.data) last.data.layerId = layerId;
        if (attempt > 0) log("info", "读取蒙版状态在第 " + (attempt + 1) + " 次尝试后成功（累计等待 " + waited + "ms）");
        return last;
      }
      var fresh = selfHealLayerId(last.error, layerId, nameHint, healed);
      if (fresh !== null) {
        log("warn", "读蒙版状态报 Unknown layer：图层 id 已变（旧 id=" + layerId + "）→ 按名字「" + nameHint + "」重解析为 id=" + fresh + " 后重试");
        layerId = fresh; healed = true; attempt = 0; waited = 0;
        continue;
      }
      var gap = busyGap(attempt, waited, budget);
      var busy = isBusy(last.error);
      if (!busy || gap <= 0) {
        if (busy) log("warn", "读取蒙版状态等待已达上限 " + budget + "ms（共试 " + (attempt + 1) + " 次）→ 按未知继续，不阻塞流程：" + last.error);
        return last;
      }
      log("warn", "读取蒙版状态第 " + (attempt + 1) + " 次被拒（抠图后 PS 仍在算，属正常等待），" + gap +
        "ms 后重试（已等 " + waited + "ms / 上限 " + budget + "ms）：" + last.error);
      await sleep(gap);
      waited += gap;
      attempt++;
    }
  }

  // ★ 用户 m03367 真机取证（这条是硬证据，不要再退回旧写法）：
  //   旧写法 `set {to:{clipping:true}}` 在这台 PS 27.1 上【无报错但不生效】—— 日志连着几轮写「剪贴到主体：成功 N/N 个调整层」，
  //   而 photoshop_inspect 权威回读里那两个调整层只有 mask、没有 clipping，用户在图层面板也看不到折角箭头。
  //   本机可用写法 = groupEvent（菜单「创建剪贴蒙版」），对照 DSH photoshop 插件 lib/ops-jsx.js:655 的 clipping_mask（同机实测可用）。
  //   改完之后由这里回读确认，不再凭「set 没报错」就宣布成功。
  async function readLayerClipping(layerId) {
    var r = await runRaw([{ _obj: "get", _target: [{ _ref: "layer", _id: layerId }] }]);
    if (!r.ok) return { ok: false, error: r.error };
    var item = (r.data && r.data.results && r.data.results[0]) ? r.data.results[0] : null;
    if (!item) return { ok: false, error: "整层 get 没返回结果" };
    var keys = ["group", "grouped", "clipping"];
    for (var i = 0; i < keys.length; i++) {
      var v = item[keys[i]];
      if (typeof v === "boolean") return { ok: true, data: { supported: true, key: keys[i], value: v, clipped: v === true } };
    }
    return { ok: true, data: { supported: false, keys: Object.keys(item || {}).join(",") } };
  }

  async function getUserMaskCoverage(layerId, busyBudgetMs, nameHint) {
    // 先用 hasUserMask 判定：无蒙版时必须直接返回 hasMask:false，【不要】去调 imaging.getLayerMask —— 真机取证无蒙版时它抛异常。
    var has = await hasUserMask(layerId, busyBudgetMs, nameHint);
    if (has.ok && has.data && has.data.layerId) layerId = has.data.layerId;   // 自愈后的新 id 后面接着用
    if (!has.ok) {
      // 兜底（PS 2026 真机实测）：状态判定被拒时直接试读蒙版像素 —— 读得到就说明蒙版存在，顺便拿到覆盖率；
      //   读不到（无蒙版时 getLayerMask 抛异常）就按「无蒙版」处理，而不是把整条一键流程判成失败。
      log("warn", "蒙版状态判定失败，改用「直接读蒙版像素」兜底：" + has.error);
      var direct = await readUserMaskRetry(layerId, busyBudgetMs, nameHint);
      if (direct.ok) {
        return { ok: true, data: { hasMask: true, coverage: direct.data.coverage, maskEnabled: null, maskWidth: direct.data.width, maskHeight: direct.data.height } };
      }
      log("warn", "直接读蒙版像素也失败 → 按「无蒙版」处理：" + direct.error);
      return { ok: true, data: { hasMask: false, coverage: null, maskEnabled: null, verdictUncertain: true } };
    }
    if (!has.data.hasMask) {
      // ★ 第 10 轮真机（11:36:25 与 11:37:35 同一份文档）：整层 get 会【谎报无蒙版】——
      //   面板于是显示「待确认」，而同一时刻「蒙版像素签名」明明读到了 7.5MB 的真实蒙版（零=6787467 白=684440）。
      //   所以状态说「无蒙版」时再做一次便宜的像素探测（预算封顶 4s）：读得到就以像素为准。
      var probeBudget = (typeof busyBudgetMs === "number" && busyBudgetMs > 0) ? Math.min(busyBudgetMs, 4000) : 4000;
      var probe = await readUserMaskRetry(layerId, probeBudget, nameHint);
      if (probe.ok) {
        log("warn", "整层 get 报「无蒙版」，但真读到蒙版像素（" + probe.data.width + "x" + probe.data.height +
          "，非零占比 " + (Math.round(probe.data.coverage * 10000) / 100) + "%）→ 以像素证据为准");
        return { ok: true, data: { hasMask: true, coverage: probe.data.coverage, maskEnabled: null, maskWidth: probe.data.width, maskHeight: probe.data.height, stateContradicted: true, layerId: layerId } };
      }
      return { ok: true, data: { hasMask: false, coverage: null, maskEnabled: has.data.maskEnabled } };
    }
    var r = await readUserMaskRetry(layerId, busyBudgetMs, nameHint);
    if (!r.ok) {
      // ★ 真机取证（17:48:04）：整层 get 已【正面确认】蒙版存在（userMaskEnabled / hasUserMask 均为 true），
      //   此时灰度像素读取失败只说明「量不出覆盖率」，【不能】据此把抠图判成失败 —— 那正是「一键卡在抠图」的第二条路径。
      //   如实返回 hasMask:true + coverage:null（未知），是否接受由调用方决定。
      log("warn", "蒙版存在（整层 get 已确认）但灰度像素读取失败，覆盖率按未知处理：" + r.error);
      return { ok: true, data: { hasMask: true, coverage: null, maskEnabled: has.data.maskEnabled, verdictUncertain: true, readError: r.error } };
    }
    return { ok: true, data: { hasMask: true, coverage: r.data.coverage, maskEnabled: has.data.maskEnabled, maskWidth: r.data.width, maskHeight: r.data.height, layerId: layerId } };
  }

  // 数值形态本机未取证 → 三种都认：裸数字 / {_value:n} / {_value:{_value:n}}
  function numDeep(v, depth) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "string") { var sn = parseFloat(v); return isFinite(sn) ? sn : null; }
    var d = depth || 0;
    if (typeof v === "object" && d < 3) {
      if (v._value !== undefined) return numDeep(v._value, d + 1);
      if (v.value !== undefined) return numDeep(v.value, d + 1);
    }
    return null;
  }

  function quadOf(node) {
    if (!node || typeof node !== "object") return null;
    var l = numDeep(node.left), t = numDeep(node.top), rr = numDeep(node.right), b = numDeep(node.bottom);
    if (l === null || t === null || rr === null || b === null) return null;
    return { left: l, top: t, right: rr, bottom: b };
  }

  // ★ 第 2 轮缺陷 3：multiGet 的返回是【按下标给属性】的（手册 F25 取证：524.js 的 getDocDim 用
  //   l[0].width._value 与 l[2].resolution._value）→ res[0] 很可能是数组而非对象，
  //   写成 `res[0].bounds || res[0]` 在真机上拿不到数值。故递归深搜整个返回，并记录命中路径。
  // onlyKey：要求命中节点的路径以该键名结尾（如 "boundsNoEffects" / "bounds"）；传 null = 任意带四数的节点。
  function searchQuad(node, pathStr, depth, onlyKey) {
    if (!node || typeof node !== "object" || depth > 8) return null;
    if (!onlyKey || new RegExp("(^|\\.)" + onlyKey + "$").test(pathStr)) {
      var q = quadOf(node);
      if (q) return { quad: q, path: pathStr };
    }
    if (Object.prototype.toString.call(node) === "[object Array]") {
      for (var i = 0; i < node.length; i++) {
        var hit = searchQuad(node[i], pathStr + "[" + i + "]", depth + 1, onlyKey);
        if (hit) return hit;
      }
      return null;
    }
    var keys = Object.keys(node);
    for (var k = 0; k < keys.length; k++) {
      var hit2 = searchQuad(node[keys[k]], pathStr + "." + keys[k], depth + 1, onlyKey);
      if (hit2) return hit2;
    }
    return null;
  }

  // 途径 1：UXP DOM 的层对象直接给 bounds.left/top/right/bottom。
  // UXP 侧取证：Required\UXP\photoshop.js @char 37368 与 app.js @char 163639 都给 Layer.prototype 定义了
  // `boundsNoEffects` getter，内部实现是 `getProperties(_directRef(this),["boundsNoEffects"])[0].boundsNoEffects`
  // → 该键名既是合法的 DOM 属性、也是合法的 AM 属性名。
  // ★ 真机实测（PS 2026，2026-10-13）：`bounds` **包含图层样式**。一个 600×600 的层套上
  //   dropShadow(distance=18, size=25, opacity=75) 后，bounds 由 0,0,600,600 变成 **-5,0,605,623**；
  //   `boundsNoEffects` 不含效果。投影是本插件的常规步骤（backdrop.addShadow 正是把样式加在【主体层本身】上），
  //   所以「居中」必须用 boundsNoEffects，否则量到的是「主体+投影」的框，主体会被推偏。
  function domLayerBounds(layerId) {
    try {
      var m = mods();
      var d = m.app.activeDocument;
      if (!d || !d.layers) return null;
      var found = null;
      (function walk(list) {
        for (var i = 0; i < list.length && !found; i++) {
          var l = list[i];
          if (!l) continue;
          if (String(l.id) === String(layerId)) { found = l; return; }
          if (l.layers) walk(l.layers);
        }
      })(d.layers);
      if (!found) return null;
      var q = found.boundsNoEffects ? quadOf(found.boundsNoEffects) : null;
      if (q) return { quad: q, kind: "dom-noeffects" };
      q = found.bounds ? quadOf(found.bounds) : null;
      if (q) return { quad: q, kind: "dom-bounds" };
      return null;
    } catch (eDom) {
      return null;
    }
  }

  // ★ 用户 m04284 真机事故（14:40:03）：主体层是 PS 默认锁定的「背景」层（id=1，bounds=整张画布），
  //   变换被 PS 拒「命令"变换"当前不可用」→ isBusy 把它当"宿主忙"退避重试 8 次（约 34s）才失败，
  //   用户看到的就是"插件卡住"。【锁是永久性原因，退避重试永远无效】。
  //   ⇒ 动手前先查锁：能解就解（写日志），解不了就快速失败并给人话指引。
  function domFindLayerById(layerId) {
    try {
      var m = mods();
      var d = m.app && m.app.activeDocument;
      if (!d || !d.layers) return null;
      var found = null;
      (function walk(list) {
        for (var i = 0; i < list.length && !found; i++) {
          var l = list[i];
          if (!l) continue;
          if (String(l.id) === String(layerId)) { found = l; return; }
          if (l.layers) walk(l.layers);
        }
      })(d.layers);
      return found;
    } catch (e) { return null; }
  }

  // 读图层锁定状态（DOM，不需要描述符通道，忙期也能读）。background=true 是 PS 对「背景」层的默认锁定。
  function layerLockInfo(layerId, nameHint) {
    try {
      var l = domFindLayerById(layerId);
      if (!l && nameHint) {
        var byName = layerIdByName(nameHint);
        if (byName !== null) l = domFindLayerById(byName);
      }
      if (!l) {
        return { ok: false, layerId: layerId, error: "读不到图层（id=" + layerId + "「" + (nameHint || "") + "」）的锁定状态" };
      }
      var info = {
        name: String(l.name || nameHint || ""),
        allLocked: !!l.allLocked,
        positionLocked: !!l.positionLocked,
        transparencyLocked: !!l.transparencyLocked,
        pixelsLocked: !!l.pixelsLocked,
        background: l.isBackgroundLayer === true
      };
      info.locked = info.allLocked || info.positionLocked || info.transparencyLocked || info.pixelsLocked || info.background;
      info.why = [];
      if (info.allLocked) info.why.push("全部锁定");
      if (info.positionLocked) info.why.push("锁定位置");
      if (info.transparencyLocked) info.why.push("锁定透明像素");
      if (info.pixelsLocked) info.why.push("锁定图像像素");
      if (info.background) info.why.push("背景层（PS 默认锁定）");
      return { ok: true, layerId: layerId, data: info };
    } catch (e) {
      return { ok: false, layerId: layerId, error: "读图层锁定状态失败：" + errText(e) };
    }
  }

  // 锁着就解锁（DOM 写优先，退回描述符），并【回读确认】；读不到锁定状态时放行（不因读数失败挡主流程）。
  // 返回 { ok, data:{ locked, unlocked, before, after, via } }；解不开时 ok:false 且 error 给人话指引。
  async function ensureUnlocked(layerId, nameHint) {
    var info = layerLockInfo(layerId, nameHint);
    if (!info.ok) return { ok: true, data: { locked: false, unlocked: false, note: info.error } };
    if (!info.data.locked) return { ok: true, data: { locked: false, unlocked: false, before: info.data } };
    var before = info.data;

    // 途径 1：DOM 直接写（DOM 对锁定状态可写；必须包在 modal 作用域内）
    var domErr = null;
    try {
      await modal("电商图片制作 · 解锁图层（" + (before.name || nameHint || layerId) + "）", async function () {
        var l = domFindLayerById(layerId);
        if (!l && nameHint) {
          var byName = layerIdByName(nameHint);
          if (byName !== null) l = domFindLayerById(byName);
        }
        if (!l) throw new Error("找不到图层对象");
        if (before.allLocked) l.allLocked = false;
        if (before.positionLocked) l.positionLocked = false;
        if (before.transparencyLocked) l.transparencyLocked = false;
        if (before.pixelsLocked) l.pixelsLocked = false;
      });
    } catch (eDom) { domErr = errText(eDom); }

    var after = layerLockInfo(layerId, nameHint);
    if (after.ok && after.data && !after.data.locked) {
      log("info", "图层「" + (before.name || nameHint) + "」处于锁定状态（" + before.why.join("、") +
        "）→ 已解锁（DOM 途径）后继续");
      return { ok: true, data: { locked: true, unlocked: true, via: "dom", before: before, after: after.data } };
    }

    // 途径 2：描述符 set layerLocking = none（同样回读确认，不靠"命令没报错"当成功）
    var r = await run([
      {
        _obj: "set",
        _target: [{ _ref: "layer", _id: layerId }],
        to: { _obj: "layerLocking", layerLocking: { _enum: "layerLocking", _value: "none" } }
      }
    ], { history: "suspend", label: "电商图片制作 · 解锁图层（描述符·" + (before.name || nameHint || layerId) + "）", busyRetries: 2, busyBudgetMs: 20000 });

    var after2 = layerLockInfo(layerId, nameHint);
    if (after2.ok && after2.data && !after2.data.locked) {
      log("info", "图层「" + (before.name || nameHint) + "」处于锁定状态（" + before.why.join("、") +
        "）→ 已解锁（描述符途径）后继续");
      return { ok: true, data: { locked: true, unlocked: true, via: "descriptor", before: before, after: after2.data } };
    }

    var detail = [];
    if (domErr) detail.push("DOM：" + domErr);
    if (!r.ok) detail.push("描述符：" + r.error);
    if (after2.ok && after2.data && after2.data.locked) detail.push("回读仍为锁定（" + after2.data.why.join("、") + "）");
    return {
      ok: false,
      layerId: layerId,
      error: "图层「" + (before.name || nameHint) + "」被锁定（" + before.why.join("、") + "）且自动解锁失败" +
        (detail.length ? " —— " + detail.join("；") : "") + "。请在图层面板点掉锁图标（背景层可双击解锁/改名）后重跑本步"
    };
  }

  // ★ 用户 m04355「导出加一个选择目录的选项」。
  //   依 Adobe 官方文档（UXP「Filesystem Operations」→ Ask the user to choose a location）：
  //     选目录 = `localFileSystem.getFolder({ initialDomain })`，返回 Folder 或 null（用户取消），本机路径取 `folder.nativePath`；
  //   官方另有 createPersistentToken / getEntryForPersistentToken 用于"跨会话记住用户授权的位置"，那是
  //   `localFileSystem: "request"` 权限级别才需要的：本项目 manifest 是 `fullAccess`，写文件本来就走
  //   getEntryWithUrl("file:///绝对路径")（见本文件 createFolder/fileSize），所以记住路径字符串即可，无需 token。
  async function pickFolder(initialDomainName) {
    try {
      var m = mods();
      if (!m.uxp || !m.uxp.storage || !m.uxp.storage.localFileSystem) {
        return { ok: false, error: "UXP 文件系统不可用（localFileSystem 缺失）" };
      }
      var storage = m.uxp.storage;
      var lfs = storage.localFileSystem;
      var opts = {};
      var d = storage.domains;
      var want = (initialDomainName && d) ? d[initialDomainName] : null;
      if (want) opts.initialDomain = want;
      var folder = await lfs.getFolder(opts);
      if (!folder) return { ok: true, data: { cancelled: true } };
      var p = String(folder.nativePath || "").replace(/[\\\/]+$/, "");
      if (!p) {
        return { ok: false, error: "已选中文件夹但拿不到本机路径（nativePath 为空；需要 manifest 的 localFileSystem=fullAccess）" };
      }
      return { ok: true, data: { path: p, name: String(folder.name || "") } };
    } catch (e) {
      return { ok: false, error: "调起文件夹选择器失败：" + errText(e) };
    }
  }

  async function layerBounds(layerId) {
    try {
      var target = (layerId === undefined || layerId === null)
        ? { _ref: "layer", _enum: "ordinal", _value: "targetEnum" }
        : { _ref: "layer", _id: layerId };
      var got = null;
      var source = "";
      // 途径 1：DOM 优先（multiGet 的形状未取证，而 DOM bounds 是标准属性）
      if (layerId !== undefined && layerId !== null) {
        var domQ = domLayerBounds(layerId);
        if (domQ) { got = domQ.quad; source = domQ.kind; }
      }
      var res = null;
      if (!got) {
        // 途径 2（E20 [本机取证] 的描述符）：multiGet + extendedReference
        // ★ 一次同时取两个：boundsNoEffects（不含图层样式，首选）与 bounds（旧行为，含效果）。
        res = await readBatchPlay([{
          _obj: "multiGet",
          _target: target,
          extendedReference: [["boundsNoEffects"], ["bounds"]]
        }]);
        var bad = firstErrorItem(res);
        if (bad) {
          // boundsNoEffects 被宿主拒绝时，退回只取 bounds 的旧写法（宁可量偏也不要整步失败）
          log("warn", "图层边界：multiGet 取 boundsNoEffects 被拒，回退只取 bounds：" + describeErrorItem(bad));
          res = await readBatchPlay([{
            _obj: "multiGet",
            _target: target,
            extendedReference: [["bounds"]]
          }]);
          bad = firstErrorItem(res);
          if (bad) return { ok: false, error: "读取图层边界失败：" + describeErrorItem(bad) };
        }
        // 先认 boundsNoEffects，再认 bounds，最后放宽到任何带四个数值的节点
        var hit = searchQuad(res, "", 0, "boundsNoEffects")
          || searchQuad(res, "", 0, "bounds")
          || searchQuad(res, "", 0, null);
        if (hit) { got = hit.quad; source = "multiGet" + hit.path; }
      }
      if (!got) {
        // 两种途径都失败：留下可复测的原文，否则真机上无法定位
        probe("layerBounds.raw", res);
        var raw = "";
        try { raw = JSON.stringify(res); } catch (eStr) { raw = String(res); }
        log("info", "图层边界：DOM 与 multiGet 两种途径都失败；原始返回（截断 800 字符）=" + raw.slice(0, 800));
        return { ok: false, error: "图层边界的返回结构无法识别（原始返回已写入日志）" };
      }
      // 不猜 resolution/72 折算：把数值与文档尺寸一起写进日志，由真机判定是否被分辨率缩放
      var docSize = "未知";
      var ad = await activeDoc();
      if (ad.ok) docSize = ad.data.width + "x" + ad.data.height;
      log("info", "构图：主体边界 来源=" + source + " L=" + Math.round(got.left) + " T=" + Math.round(got.top) +
        " R=" + Math.round(got.right) + " B=" + Math.round(got.bottom) + "（文档 " + docSize + "）");
      return {
        ok: true,
        data: {
          left: Math.round(got.left), top: Math.round(got.top),
          right: Math.round(got.right), bottom: Math.round(got.bottom),
          width: Math.round(got.right - got.left), height: Math.round(got.bottom - got.top),
          source: source
        }
      };
    } catch (e) {
      return { ok: false, error: "读取图层边界失败：" + errText(e) };
    }
  }

  async function activeLayer() {
    try {
      var m = mods();
      var d = m.app.activeDocument;
      if (!d) return { ok: false, error: "当前没有打开的文档" };
      var list = d.activeLayers || [];
      var l = list[0];
      if (!l) return { ok: false, error: "当前没有选中的图层" };
      return { ok: true, data: { id: l.id, name: String(l.name || ""), kind: String(l.kind || "") } };
    } catch (e) {
      return { ok: false, error: "读取当前图层失败：" + errText(e) };
    }
  }

  // LayerKind 取值取证：D:\software\Adobe Photoshop 2026\Required\UXP\constants.js 偏移 8284 区段
  //   e.NORMAL="pixel", e.GROUP="group", e.SMARTOBJECT="smartObject", e.SOLIDFILL="solidColor", e.TEXT="text", …
  var SUBJECT_KINDS = ["pixel", "normal", "smartObject", "smartobject"];

  async function findSubjectLayer(opts) {
    opts = opts || {};
    // ★ v3（契约 §10）：默认排除名单【只有】"阴影"。
    // 原因：PS 中文版把单层图片的像素层默认命名为「背景」，按名排除会误伤用户真正的画面层；
    // 插件自建的背景层是 kind==="solidColor"，已被下面 SUBJECT_KINDS 的 kind 过滤挡掉，无需按名排除。
    var exclude = ["阴影"].concat(opts.excludeNames || []);
    try {
      var m = mods();
      var d = m.app.activeDocument;
      if (!d) return { ok: false, error: "当前没有打开的文档" };
      var activeId = null;
      try {
        var al = d.activeLayers && d.activeLayers[0];
        if (al) activeId = al.id;
      } catch (eActive) { activeId = null; }

      var candidates = [];
      collect(d.layers || [], 0);

      function collect(list, depth) {
        for (var i = 0; i < list.length; i++) {
          var l = list[i];
          if (!l) continue;
          var kind = String(l.kind || "");
          var name = String(l.name || "");
          if (kind === "group") { collect(l.layers || [], depth + 1); continue; }
          if (exclude.indexOf(name) >= 0) continue;
          if (SUBJECT_KINDS.indexOf(kind) < 0) continue;
          candidates.push({ id: l.id, name: name, kind: kind, depth: depth });
        }
      }

      if (!candidates.length) {
        return { ok: false, error: "没有找到可用的主体图层（已排除：" + exclude.join("、") + "）" };
      }
      var chosen = candidates[0];                       // 默认取最上层
      for (var j = 0; j < candidates.length; j++) {
        if (candidates[j].id === activeId) { chosen = candidates[j]; break; }
      }
      return { ok: true, data: chosen };
    } catch (e) {
      return { ok: false, error: "查找主体图层失败：" + errText(e) };
    }
  }

  async function getSubjectPixels(opts) {
    opts = opts || {};
    var maxDim = Number(opts.maxDim) > 0 ? Math.round(Number(opts.maxDim)) : 512;
    // ★ 第 7 轮：applyAlpha=true 时返回带 alpha 的 4 通道数据（subjectAlphaCoverage 用它量「主体像素占比」）
    // ★ Adobe 官方标注（Imaging API → getPixels → options.applyAlpha，原文）：
    //   "If true, then RGBA pixels will be converted to RGB by matting on white.
    //    The returned imageData property will not contain an alpha channel."
    //   ⇒ applyAlpha:true 是【按白底合成、主动丢掉 alpha】。想拿真 alpha 通道必须不传（默认 false → RGBA 4 通道）。
    //   本插件第 10 轮曾传 applyAlpha:true 去「量主体像素 alpha」，真机固定只回 channels=3 —— 正是这条标注的结果。
    var alphaOn = opts.applyAlpha === true;
    if (alphaOn) {
      log("warn", "getSubjectPixels 收到 applyAlpha:true —— 按 Adobe 标注这会把 RGBA 按白底合成为 RGB（返回不含 alpha 通道）；要真 alpha 应传 applyAlpha:false");
    }
    // ★ 第 7 轮：指定图层读像素（不指定读到的是文档合成结果，背景层可见时 alpha 恒为全不透明）
    var layerId = (typeof opts.layerId === "number") ? opts.layerId : null;
    var m = mods();
    var imgHolder = null;
    var imgWrap = null;
    try {
      var docRes = await activeDoc();
      if (!docRes.ok) {
        log("error", "读取像素失败：" + docRes.error);
        return { ok: false, error: docRes.error };
      }
      var docW = docRes.data.width;
      var docH = docRes.data.height;

      // F26 [本机取证]：对象参数形式；★ targetSize 只给 height（只给一维才等比）
      // ★ 第 6 轮 F4：显式带 documentID，消除「未指定目标文档」这一整类隐式依赖
      //   （用户日志里 analyze.subject 在无蒙版的普通文档上也失败却一行日志都没有）。
      //   UXP imaging 是否接受该键本机未取证 → 先带、被拒再退回原形式，两条路径都落盘，
      //   避免把「多带一个键」变成新的静默失败点。
      // ★ 整体放进 modal 作用域：真机实测 getPixels 与 imageData.getData() 都要求 modal scope
      var pix = await imagingCall("电商图片制作 · 读取像素", async function () {
        var wrap;
        try {
          var opt1 = {
            documentID: docRes.data.id,
            targetSize: { height: maxDim },
            applyAlpha: alphaOn,
            colorSpace: "RGB",
            componentSize: 8
          };
          if (layerId !== null) opt1.layerID = layerId;
          wrap = await m.imaging.getPixels(opt1);
        } catch (eDocId) {
          log("warn", "getPixels 带 documentID=" + docRes.data.id + " 被拒，退回不带 documentID 的原形式：" + errText(eDocId));
          wrap = await m.imaging.getPixels({
            targetSize: { height: maxDim },
            applyAlpha: alphaOn,
            colorSpace: "RGB",
            componentSize: 8
          });
        }
        return { wrap: wrap, px: await extractPixelBuffer(wrap) };
      });
      imgWrap = pix.wrap;
      probe("getPixels.keys", describeKeys(imgWrap));
      if (pix.px.err) {
        probe("getPixels.shape", shapeOf(imgWrap, 1));
        log("error", "读取像素失败：返回结构无法识别（" + pix.px.err + "）");
        return { ok: false, error: "读取像素失败：返回结构无法识别（" + pix.px.err + "）" };
      }
      imgHolder = pix.px.holder;
      var rgba = pix.px.raw;
      probe("getPixels.buffer", { how: pix.px.how, len: rgba.length, w: pix.px.width, h: pix.px.height });
      // ★ 尺寸来源按可信度排序，并用「长度必须整除、通道数恰好 3 或 4」来验证，不再只信返回对象自省：
      //   targetSize 只给 height → 输出高度 = min(maxDim, 文档高)，宽度按文档等比；这条不依赖任何自省，最可靠。
      var expH = Math.max(1, Math.min(maxDim, docH));
      var expW = Math.max(1, Math.round(docW * (expH / docH)));
      var dimCands = [
        { w: pix.px.width, h: pix.px.height, how: "返回对象自带 width/height" },
        { w: expW, h: expH, how: "按 targetSize+文档尺寸推算" }
      ];
      var sbW = imgWrap && imgWrap.sourceBounds;
      if (sbW && typeof sbW === "object") {
        var sbL = pickNumber(sbW, ["left", "x"]);
        var sbT = pickNumber(sbW, ["top", "y"]);
        var sbR = pickNumber(sbW, ["right"]);
        var sbB = pickNumber(sbW, ["bottom"]);
        if (typeof sbL === "number" && typeof sbR === "number" && typeof sbT === "number" && typeof sbB === "number") {
          dimCands.push({ w: Math.round(sbR - sbL), h: Math.round(sbB - sbT), how: "sourceBounds（文档坐标，仅在未缩放时成立）" });
        }
      }
      var chosen = null;
      var dimTried = [];
      for (var di = 0; di < dimCands.length && !chosen; di++) {
        var dc = dimCands[di];
        if (!dc.w || !dc.h) { dimTried.push(dc.how + "→缺一维"); continue; }
        var pc0 = dc.w * dc.h;
        var ch0 = Math.round(rgba.length / pc0);
        if (rgba.length % pc0 === 0 && (ch0 === 3 || ch0 === 4)) chosen = { w: dc.w, h: dc.h, channels: ch0, how: dc.how };
        else dimTried.push(dc.how + "→" + dc.w + "x" + dc.h + " 得通道数 " + ch0);
      }
      if (!chosen) {
        // applyAlpha 语义未查清（未查清事项 #2）→ 不猜通道数，如实报错
        probe("getPixels.dims", { tried: dimTried, len: rgba.length, shape: shapeOf(imgWrap, 1) });
        log("error", "读取像素失败：无法确定像素宽高与通道数（已试[" + dimTried.join(" / ") + "] len=" + rgba.length +
          " holder键=" + describeKeys(imgHolder) + "）");
        return { ok: false, error: "读取像素失败：无法确定像素宽高与通道数" };
      }
      probe("getPixels.dims", { how: chosen.how, w: chosen.w, h: chosen.h, channels: chosen.channels });
      var w = chosen.w;
      var h = chosen.h;
      var channels = chosen.channels;
      var pixelCount = w * h;

      var alphaMask = null;
      var maskCoverage = null;
      var layerRes = await activeLayer();
      if (layerRes.ok) {
        var cov = await getUserMaskCoverage(layerRes.data.id);
        if (cov.ok && cov.data.hasMask && cov.data.coverage !== null) {
          maskCoverage = cov.data.coverage;
          var maskRead = await readUserMask(layerRes.data.id);
          if (maskRead.ok) {
            alphaMask = resampleMask(maskRead.data, w, h);
          } else {
            log("warn", "蒙版读取失败，alphaMask 置 null：" + maskRead.error);
          }
        } else if (!cov.ok) {
          log("warn", "蒙版状态未知，alphaMask 置 null：" + cov.error);
        }
      }

      probe("getPixels.probe", {
        pixels: w + "x" + h, channels: channels, docSize: docW + "x" + docH,
        hasAlphaMask: !!alphaMask, maskCoverage: maskCoverage
      });

      // 蒙版分辨率可能不等于像素分辨率 → 最近邻重采样到像素网格，保证 alphaMask.length === w*h
      return {
        ok: true,
        data: {
          width: w,
          height: h,
          rgba: rgba,
          alphaMask: alphaMask,
          channels: channels,
          alphaMaskCoverage: maskCoverage,
          docWidth: docW,
          docHeight: docH
        }
      };
    } catch (e) {
      log("error", "读取像素失败：" + errText(e));
      return { ok: false, error: "读取像素失败：" + errText(e) };
    } finally {
      disposeQuiet(imgHolder);                 // ★ 必须释放，否则 PS 侧内存泄漏（F26）
      if (imgWrap !== imgHolder) disposeQuiet(imgWrap);
    }
  }

  function resampleMask(mask, w, h) {
    var mw = mask.width;
    var mh = mask.height;
    var src = mask.gray;
    var out = new Uint8Array(w * h);
    for (var y = 0; y < h; y++) {
      var sy = Math.min(mh - 1, Math.floor((y + 0.5) * mh / h));
      var rowSrc = sy * mw;
      var rowDst = y * w;
      for (var x = 0; x < w; x++) {
        var sx = Math.min(mw - 1, Math.floor((x + 0.5) * mw / w));
        out[rowDst + x] = src[rowSrc + sx];
      }
    }
    return out;
  }

  // ★ 第 4 轮：getEntryWithUrl 的 URL 形式解析器（createFolder 与 fileSize 共用同一份形式与顺序）
  //   形式逐字保持第 3 轮已验证的三种（缺陷 C 取证：Adobe 从不把裸 Windows 路径交给它 ——
  //   com.adobe.photoshop.presets\...\ps-presets.js:1009 / :1564 都是 `'file://' + path`）。
  //   返回 { ok, entry, form, errors }：成功时 form = 生效形式字符串，由【调用方】决定怎么记日志
  //   （helper 内不写日志，避免 fileSize 每个文件刷一条）；失败时 entry=null、errors = 三条原始报错原文。
  async function resolveEntryByNativePath(fs, nativePath) {
    var forms = [
      { label: "裸原生路径", url: nativePath },
      { label: "file:///+正斜杠", url: "file:///" + String(nativePath).replace(/\\/g, "/") },
      { label: "file://+原样(Adobe写法)", url: "file://" + nativePath }
    ];
    var errors = [];
    for (var k = 0; k < forms.length; k++) {
      try {
        var entry = await fs.getEntryWithUrl(forms[k].url);
        if (entry) return { ok: true, entry: entry, form: forms[k].label + " → " + forms[k].url, formLabel: forms[k].label, errors: errors };
        errors.push(forms[k].label + " → 返回空 Entry");
      } catch (eForm) {
        errors.push(forms[k].label + " → " + errText(eForm));
      }
    }
    return { ok: false, entry: null, form: "", formLabel: "", errors: errors };
  }

  async function createFolder(nativeDirPath) {
    try {
      var m = mods();
      if (!m.uxp || !m.uxp.storage || !m.uxp.storage.localFileSystem) {
        return { ok: false, error: "UXP 文件系统不可用（localFileSystem 缺失）" };
      }
      var fs = m.uxp.storage.localFileSystem;
      var normalized = String(nativeDirPath).replace(/\//g, "\\").replace(/\\+$/, "");
      var parentPath = normalized.slice(0, normalized.lastIndexOf("\\"));
      var folderName = normalized.slice(normalized.lastIndexOf("\\") + 1);
      if (!parentPath || !folderName) return { ok: false, error: "目录路径无效：" + nativeDirPath };
      // ★ 第 4 轮：三形式尝试已提到共用 helper resolveEntryByNativePath（行为与第 3 轮逐字等价）
      var pr = await resolveEntryByNativePath(fs, parentPath);
      if (!pr.ok) return { ok: false, error: "打开父目录失败，三种 getEntryWithUrl 形式都不可用：" + pr.errors.join("；") };
      var parent = pr.entry;
      log("info", "创建目录：getEntryWithUrl 生效形式 = " + pr.form);
      var folder = null;
      try {
        folder = await parent.getEntry(folderName);
      } catch (eMissing) {
        folder = await parent.createFolder(folderName);
      }
      // ★ 第 3 轮缺陷 A（阻塞级）：getNativePath 是 async（取证见本文件日志落盘处注释），
      //   这里曾写成非 await → data.path 变成 Promise 对象，消费方 export.js 的 dir.replace 直接抛
      //   TypeError，真机上每一次导出都失败。取值顺序：
      //   await getNativePath(folder) → folder.nativePath → 传入的 normalized（最后一段必达 → 永远是字符串）。
      var nativePath = "";
      try {
        if (typeof fs.getNativePath === "function") {
          var npFolder = await fs.getNativePath(folder);
          nativePath = npFolder === undefined || npFolder === null ? "" : String(npFolder);
        }
      } catch (eNative1) { nativePath = ""; }
      if (!nativePath) {
        try { nativePath = folder && folder.nativePath ? String(folder.nativePath) : ""; }
        catch (eNative2) { nativePath = ""; }
      }
      if (!nativePath) nativePath = normalized;
      if (typeof nativePath !== "string") nativePath = String(nativePath);
      return { ok: true, data: { path: nativePath } };
    } catch (e) {
      return { ok: false, error: "创建目录失败：" + errText(e) };
    }
  }

  // ★ 第 4 轮：fileSize 改用共用的三形式解析器。
  //   旧实现把裸原生路径直接交给 getEntryWithUrl（Adobe 从不这么调）→ 真机很可能解析不到 → 导出结果里 bytes 恒 0。
  //   失败语义【不变】：任何异常一律 return 0，绝不抛（它被 export.js:106 在导出主链里 await，抛了会毁掉整个导出）。
  //   entry.size 同步属性优先、read() 兜底的判定顺序也【不变】。
  //   日志去重：它会被每一个导出文件调用一次 → 成功形式只写一条 info、全失败只写一条 warn，绝不按文件刷屏。
  var fileSizeLoggedForm = null;
  var fileSizeFailLogged = false;

  async function fileSize(nativeFilePath) {
    try {
      var m = mods();
      var fs = m.uxp.storage.localFileSystem;
      var native = String(nativeFilePath).replace(/\//g, "\\");
      var pr = await resolveEntryByNativePath(fs, native);
      if (!pr.ok) {
        if (!fileSizeFailLogged) {
          fileSizeFailLogged = true;
          log("warn", "fileSize：三种 getEntryWithUrl 形式都不可用（导出结果里的字节数会显示 0，不影响导出成功）：" + pr.errors.join("；"));
        }
        return 0;
      }
      if (fileSizeLoggedForm !== pr.formLabel) {
        fileSizeLoggedForm = pr.formLabel;
        log("info", "fileSize：getEntryWithUrl 生效形式 = " + pr.form);
      }
      var entry = pr.entry;
      if (typeof entry.size === "number") return entry.size;
      var data = await entry.read();
      if (data instanceof ArrayBuffer) return data.byteLength;
      if (data && typeof data.length === "number") return data.length;
      return 0;
    } catch (e) {
      return 0;
    }
  }

  // ★ 第 7 轮（真机 2026-10-14 10:18 证据）：batchPlay 的 in:{_kind:"local",_path:...}
  //   被 PS 27.1 拒绝：Error: invalid file token used —— UXP 的 AM 要的是「文件令牌」而非路径字面量。
  //   本函数三级降级并落日志自证：① DOM doc.saveAs.jpg(entry) ② batchPlay in:<会话令牌>
  //   ③ batchPlay 旧路径字面量三形式。哪一级生效都会写进 ecom-debug.log。
  async function fileEntryForPath(nativeFilePath) {
    var m = mods();
    if (!m.uxp || !m.uxp.storage || !m.uxp.storage.localFileSystem) {
      return { ok: false, error: "UXP 文件系统不可用（localFileSystem 缺失）" };
    }
    var fsMod = m.uxp.storage.localFileSystem;
    var p = String(nativeFilePath).replace(/\//g, "\\");
    var i = p.lastIndexOf("\\");
    if (i <= 0) return { ok: false, error: "路径无效：" + nativeFilePath };
    var parentPath = p.slice(0, i);
    var fileName = p.slice(i + 1);
    var pr = await resolveEntryByNativePath(fsMod, parentPath);
    if (!pr.ok) return { ok: false, error: "打开目标目录失败：" + pr.errors.join("；") };
    var file = null;
    try { file = await pr.entry.createFile(fileName, { overwrite: true }); }
    catch (eCreate) {
      try { file = await pr.entry.getEntry(fileName); } catch (eGet) { file = null; }
      if (!file) return { ok: false, error: "创建目标文件失败：" + errText(eCreate) };
    }
    return { ok: true, data: { entry: file, fs: fsMod } };
  }

  async function saveDocToFile(docId, nativeFilePath, format, quality) {
    var m = mods();
    var isPng = format === "png";
    var asObj = isPng
      ? { _obj: "PNGFormat", compression: 6, method: 0 }
      : { _obj: "JPEG", extendedQuality: quality, matteType: { _enum: "matteColor", _value: "white" }, embedProfiles: true };
    var exp = await fileEntryForPath(nativeFilePath);
    if (exp.ok) {
      var docObj = null;
      try {
        var docs = m.app.documents || [];
        for (var k = 0; k < docs.length; k++) if (docs[k].id === docId) docObj = docs[k];
      } catch (eDocs) { docObj = null; }
      if (docObj) {
        try {
          await modal("电商图片制作 · 另存（DOM）", async function () {
            if (isPng) await docObj.saveAs.png(exp.data.entry, { compression: 6, method: "quick" }, true);
            else await docObj.saveAs.jpg(exp.data.entry, { quality: quality }, true);
            return true;
          });
          log("info", "另存生效形式 = DOM saveAs." + (isPng ? "png" : "jpg") + " → " + nativeFilePath);
          return { ok: true, data: { path: nativeFilePath, method: "dom-saveAs" } };
        } catch (eDom) {
          log("warn", "DOM saveAs 失败（改试文件令牌）：" + errText(eDom));
        }
      } else {
        log("warn", "DOM saveAs 跳过：文档列表里找不到 id=" + docId);
      }
    } else {
      log("warn", "DOM saveAs 跳过（取文件 entry 失败）：" + exp.error);
    }
    if (exp.ok && typeof exp.data.fs.createSessionToken === "function") {
      try {
        var token = await exp.data.fs.createSessionToken(exp.data.entry);
        var r2 = await run([{ _obj: "save", _target: { _ref: "document", _id: docId }, in: token, as: asObj }],
          { history: "normal", preserveSelection: false, label: "电商图片制作 · 另存（令牌）" });
        if (r2.ok && !firstErrorItem(r2.data && r2.data.results)) {
          log("info", "另存生效形式 = batchPlay 会话令牌 → " + nativeFilePath);
          return { ok: true, data: { path: nativeFilePath, method: "batchPlay-token" } };
        }
        log("warn", "会话令牌另存失败：" + (r2.ok ? describeErrorItem(firstErrorItem(r2.data.results)) : r2.error));
      } catch (eTok) { log("warn", "createSessionToken 失败：" + errText(eTok)); }
    }
    var forms = [
      { label: "local+_path", inObj: { _obj: "local", _path: nativeFilePath } },
      { label: "裸_path", inObj: { _path: nativeFilePath } },
      { label: "kind+_path", inObj: { _kind: "local", _path: nativeFilePath } }
    ];
    var errs = [];
    for (var f = 0; f < forms.length; f++) {
      var r3 = await run([{ _obj: "save", _target: { _ref: "document", _id: docId }, in: forms[f].inObj, as: asObj }],
        { history: "normal", preserveSelection: false, label: "电商图片制作 · 另存（" + forms[f].label + "）" });
      if (r3.ok && !firstErrorItem(r3.data && r3.data.results)) {
        log("info", "另存生效形式 = batchPlay " + forms[f].label + " → " + nativeFilePath);
        return { ok: true, data: { path: nativeFilePath, method: "batchPlay-" + forms[f].label } };
      }
      errs.push(forms[f].label + " → " + (r3.ok ? describeErrorItem(firstErrorItem(r3.data.results)) : r3.error));
    }
    return { ok: false, error: "另存失败（DOM / 会话令牌 / 路径字面量都不行）：" + errs.join("；") };
  }

  // 目录列举（导出命名用）：返回文件名数组，最多 3000 个
  async function listDir(nativeDirPath) {
    var m = mods();
    if (!m.uxp || !m.uxp.storage || !m.uxp.storage.localFileSystem) {
      return { ok: false, error: "UXP 文件系统不可用（localFileSystem 缺失）" };
    }
    var fsMod = m.uxp.storage.localFileSystem;
    var pr = await resolveEntryByNativePath(fsMod, String(nativeDirPath).replace(/\//g, "\\"));
    if (!pr.ok) return { ok: false, error: "打开目录失败：" + pr.errors.join("；") };
    var names = [];
    try {
      var entries = await pr.entry.getEntries();
      for (var i = 0; i < entries.length && names.length < 3000; i++) {
        if (typeof entries[i].name === "string") names.push(entries[i].name);
      }
    } catch (eList) {
      return { ok: false, error: "列举目录失败：" + errText(eList) };
    }
    return { ok: true, data: { names: names } };
  }

  // ★ 第 7 轮（用户 m02731「还是无法检测蒙版」）：抠图结果有比蒙版状态更硬的证据 —— 主体图层的像素 alpha。
  //   本函数走 getSubjectPixels({applyAlpha:true}) 直接量「有多少像素还是不透明的」，与蒙版状态完全无关。
  // 给「按 id 取像素」的调用做 id 自愈：先按给定 id 调；报 Unknown layer 且有名字 → 按名字重解析一次再调。
  // ★ m03578 真机：rasterizeLayer 换 id 后，getPixels 也会报 `Unknown layer (#1)`（13:47:54）。
  async function withLayerIdSelfHeal(layerId, nameHint, fn) {
    var r = await fn(layerId);
    if (r && r.ok) return r;
    var err = (r && r.error) || "";
    if (!isUnknownLayer(err) || !nameHint) return r;
    var fresh = layerIdByName(nameHint);
    if (fresh === null || fresh === layerId) return r;
    log("warn", "取像素报 Unknown layer：图层 id 已变（旧 id=" + layerId + "）→ 按名字「" + nameHint +
      "」重解析为 id=" + fresh + " 后重试");
    return await fn(fresh);
  }

  async function subjectAlphaCoverage(layerId, budgetMs, nameHint) {
    var px = await withLayerIdSelfHeal(layerId, nameHint, function (id) {
      // 不传 applyAlpha（= false）：官方标注 applyAlpha:true 会按白底合成并丢掉 alpha 通道，永远拿不到真 alpha。
      return getSubjectPixels({ maxDim: 1200, applyAlpha: false, layerId: id, budgetMs: budgetMs });
    });
    if (!px.ok) return { ok: false, error: px.error };
    var d = px.data || {};
    var buf = d.rgba || d.buffer || d.raw || d.data || null;
    var comps = Number(d.channels);
    if (!buf || !isFinite(comps) || comps < 4) {
      return { ok: false, error: "像素不含 alpha 通道（channels=" + comps + "；按 Adobe 标注，applyAlpha:true 会按白底合成成 RGB 并丢掉 alpha —— 本函数已改为不传该选项）" };
    }
    var total = Math.floor(buf.length / comps);
    var solid = 0;
    for (var i = 0; i < total; i++) { if (buf[i * comps + 3] > 8) solid++; }
    return { ok: true, data: { coverage: total ? (solid / total) : 0, sampled: total, components: comps } };
  }

  window.Ecom.ps = {
    require: mods,
    setLogSink: function (fn) { logSink = typeof fn === "function" ? fn : null; },
    log: log,
    logFilePath: logFilePath,
    setFileLogEnabled: setFileLogEnabled,
    probe: probe,
    modal: modal,
    run: run,
    runRaw: runRaw,
    activeDoc: activeDoc,
    hexToRGB: hexToRGB,
    rgbToHex: rgbToHex,
    pickColor: pickColor,
    snapshot: snapshot,
    restore: restore,
    getSubjectPixels: getSubjectPixels,
    // 以下为附加辅助（不改变 INTERFACE §4 已冻结的签名），供 cutout / backdrop / adjust / compose / export 复用
    readBatchPlay: readBatchPlay,
    firstErrorItem: firstErrorItem,
    describeErrorItem: describeErrorItem,
    activeLayer: activeLayer,
    layerBounds: layerBounds,
    hasUserMask: hasUserMask,
    waitHostIdle: waitHostIdle,
    getUserMaskCoverage: getUserMaskCoverage,
    applyUserMask: applyUserMask,
    ensureUnlocked: ensureUnlocked,
    layerLockInfo: layerLockInfo,
    layerIdByName: layerIdByName,
    layerExistsById: layerExistsById,
    readUserMaskPixels: readUserMaskRetry,
    readLayerClipping: readLayerClipping,
    findSubjectLayer: findSubjectLayer,
    createFolder: createFolder,
    fileSize: fileSize,
    saveDocToFile: saveDocToFile,
    listDir: listDir,
    pickFolder: pickFolder,
    subjectAlphaCoverage: subjectAlphaCoverage,
    safeJson: safeJson
  };
})();
