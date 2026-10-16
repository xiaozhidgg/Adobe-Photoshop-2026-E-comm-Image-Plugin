#target photoshop
// =====================================================================
// probe5.jsx -- 只读探针：事件名 / 4 字符码 / “应用后回读真实键名”
//
// 运行：
//   pwsh -Command "powershell -ExecutionPolicy Bypass -File verify\probe.ps1 -JsxPath verify\probe5.jsx -TimeoutSec 300"
//
// 安全边界（违反即失败）
//   * 只操作自己创建的临时文档（名字以 dsh-probe5 开头），结束全部 close(DONOTSAVECHANGES)；
//   * 不触碰用户的 PSD / 图片，不 kill / 不重启 Photoshop；
//   * 一律 DialogModes.NO，不播 Action，不调用需要模态工作区的对话框形式；
//   * 每段单独 try/catch，异常不中断后续段；清理放在 main() 之外无条件执行。
//
// 输出：%TEMP%\dsh-ps-probe\result.txt（probe.ps1 会复制成 verify\out\probe-jsx.log）
// 证据原则：只写原始事实（原始错误文本 / 原始键名），结论另起一段，不美化。
// =====================================================================

var PROBE_TAG = "dsh-probe5";
var OUTFOLDER = new Folder(Folder.temp.fsName + "/dsh-ps-probe");
if (!OUTFOLDER.exists) { OUTFOLDER.create(); }
var OUTFILE = new File(OUTFOLDER.fsName + "/result.txt");
OUTFILE.encoding = "UTF-8";
OUTFILE.open("w");
OUTFILE.write("PROBE5_START\n");
OUTFILE.close();

// 每行追加后立即关闭 -> 上半段证据已经落盘，后面某段卡死也不丢
function w(line) {
  try { OUTFILE.open("a"); OUTFILE.write(line + "\n"); OUTFILE.close(); } catch (e) {}
  try { $.writeln(line); } catch (e2) {}
}

function sq(v) {
  if (v === null) { return "<null>"; }
  if (v === undefined) { return "<undefined>"; }
  var s = "" + v;
  s = s.replace(/\r/g, "\\r"); s = s.replace(/\n/g, "\\n"); s = s.replace(/\t/g, "\\t");
  if (s.length > 900) { s = s.substring(0, 900) + "...<TRUNC>"; }
  return s;
}

// 原始错误文本：e.toString() 与 e.number 原样，两个都不修饰
function errOf(e) {
  var p = [];
  try { p.push("toString={" + sq(e.toString()) + "}"); } catch (x) { p.push("toString=<none>"); }
  try { p.push("num={" + sq(e.number) + "}"); } catch (x) { p.push("num=<none>"); }
  return p.join(" ");
}

function rec(tag, name, status, detail) {
  w(tag + " " + name + " | " + status + (detail === undefined ? "" : (" | " + detail)));
}

function uv(x) { try { return "" + x.as("px"); } catch (e) { return "" + x; } }

function boundsStr(l) {
  if (!l) { return "<noLayer>"; }
  try { var b = l.bounds; return "L=" + uv(b[0]) + " T=" + uv(b[1]) + " R=" + uv(b[2]) + " B=" + uv(b[3]); }
  catch (e) { return "boundsERR{" + errOf(e) + "}"; }
}

function nowMs() { try { return new Date().getTime(); } catch (e) { return -1; } }

// 事件/键名 ID 解析：4 字符 code 必须走 charIDToTypeID。
// 反例（本探针第一轮踩到）：stringIDToTypeID("Trnf") 会给字面量 "Trnf" 凭空造一个新 typeID，
// 那**不是** transform 事件（真 transform = charIDToTypeID("Trnf") = stringIDToTypeID("transform")，
// 见 B 段 Trnf 行的 roundtrip=MATCH）。用错就会得到假的"未知的"结论。
function evId(name, logRow) {
  var id = null, how = "?";
  try {
    if (("" + name).length === 4) { id = charIDToTypeID(name); how = "charIDToTypeID"; }
    else { id = stringIDToTypeID(name); how = "stringIDToTypeID(NOT_a_validity_proof)"; }
  } catch (e) { how = "THREW{" + errOf(e) + "}"; }
  if (logRow) {
    var back = ""; try { back = typeIDToStringID(id); } catch (e2) { back = "<throw " + errOf(e2) + ">"; }
    rec("EV", "resolve[" + sq(name) + "]", how, "typeID=" + sq(id) + " back=" + sq(back));
  }
  return id;
}

// 取描述符 class：本机对 getObjectValue 得到的描述符调 getClass() 会抛
// {错误: 非法参数 - 参数 1 - 缺少必需值} num={1238}（第一轮实测）。
// 单独包起来，失败只记错，不连累整段回读。
function clsOf(obj) {
  try { return "" + typeIDToStringID(obj.getClass()); }
  catch (e) { return "<getClassERR " + errOf(e) + ">"; }
}

function activeDocName() { try { return "" + app.activeDocument.name; } catch (e) { return "<none/err " + errOf(e) + ">"; } }

// 安全闸：探针运行时用户可能正好开着别的文档（本轮实测就有 1 个非探针文档）。
// 任何会**改画面**的动作前都强制把活动文档切回自己的临时文档，切不回来就放弃该动作，
// 保证绝不误改用户文档。
var CSECTION_DOC = null;
var ASECTION_DOC = null;
function lockToDoc(docObj, tag) {
  if (docObj === null || docObj === undefined) { return false; }
  try { app.activeDocument = docObj; } catch (e) { rec("SAFE", tag, "setActiveDoc_FAIL", errOf(e)); return false; }
  var n = activeDocName();
  if (n !== "" + docObj.name) { rec("SAFE", tag, "ABORT_ACTIVE_DOC_MISMATCH", "activeDoc=" + sq(n) + " expected=" + sq("" + docObj.name)); return false; }
  return true;
}
function lockToProbeDoc(tag) { return lockToDoc(CSECTION_DOC, tag); }

// =====================================================================
// ENV
// =====================================================================
function envReport(label) {
  var ver = "<ERR>"; try { ver = "" + app.version; } catch (e) { ver = "<ERR " + errOf(e) + ">"; }
  var n = -1; try { n = app.documents.length; } catch (e) { n = -1; }
  var act = "none";
  try { if (app.documents.length > 0) { act = app.activeDocument.name; } } catch (e) { act = "<ERR " + errOf(e) + ">"; }
  rec("ENV", label, "OK", "app.version=" + sq(ver) + " | documents.length=" + n + " | activeDocument=" + sq(act));
  return { ver: ver, n: n, act: act };
}

// =====================================================================
// A. 事件名存在性：空参调用 + 原始错误文本
// =====================================================================
var JUDGE_RULE = "判定规则(写死本文，逐条对照)：错误文本含“未知的 / not currently available / 当前不可用” ⇒ 事件名不可用；"
  + "出现具体数值型/参数型错误 ⇒ 事件名可用、只是参数不对；无异常返回 ⇒ 该事件接受空参（名字有效）；无法归类的原文一律标 PARAM_ERROR_or_other 由人读。"
  + "警告：参数名写错时命令可能带默认参数执行（PLAN-straighten §9 的风险），所以“无异常”不等于语义生效，必须回读。";

function judgeEvent(errText) {
  if (errText === null) { return "SUCCESS_ACCEPTED_EMPTY"; }
  if (errText.indexOf("未知的") >= 0) { return "UNAVAILABLE_unknown_command"; }
  if (errText.indexOf("<未知的>") >= 0) { return "UNAVAILABLE_unknown_command"; }
  if (errText.indexOf("not currently available") >= 0) { return "UNAVAILABLE_not_available"; }
  if (errText.indexOf("当前不可用") >= 0) { return "UNAVAILABLE_not_available"; }
  return "PARAM_ERROR_or_other(read_raw)";
}

function tryEvent(name, tag) {
  var err = null, ok = false, tid = null;
  try {
    tid = evId(name, true);
    var d = new ActionDescriptor();
    app.executeAction(tid, d, DialogModes.NO);
    ok = true;
  } catch (e) { err = errOf(e); }
  rec(tag === undefined ? "A" : tag, name, ok ? "NO_THROW" : "THREW",
      "eventTypeID=" + sq(tid) + " | documents=" + app.documents.length + " | judge=" + judgeEvent(err)
      + (err === null ? " | raw=<no error>" : (" | raw=" + err)));
}

function tryEventWithParam(eventName, paramKey, unitCode, value) {
  var err = null, ok = false;
  try {
    var d = new ActionDescriptor();
    d.putUnitDouble(evId(paramKey, true), charIDToTypeID(unitCode), value);
    app.executeAction(evId(eventName), d, DialogModes.NO);
    ok = true;
  } catch (e) { err = errOf(e); }
  rec("A.param", eventName + " + " + paramKey, ok ? "NO_THROW" : "THREW",
      "unit=" + sq(unitCode) + " value=" + value
      + " | judge=" + judgeEvent(err) + (err === null ? "" : (" | raw=" + err)));
}

// A0. 无文档对照：证明“没有打开的文档”本身就会让任何 AM 事件回「当前不可用」，
//     所以事件名测试必须在有文档上下文的情况下做，否则全是假阴性。
function sectionA0() {
  w("MARKER A0.nodoc BEGIN");
  rec("A0", "documents.length", "INFO", "" + app.documents.length);
  if (app.documents.length === 0) {
    tryEvent("trim", "A0.nodoc");
    w("A0.note 上面这行是在 0 文档下测已知可用的事件名 trim：若它也报“当前不可用/未知的”，说明该错误文本在无文档时是假阴性，"
      + "A 段必须在有文档上下文下重测（本脚本随后会建 dsh-probe5-A 并重测）。");
  } else {
    w("A0.note 当前已有文档，跳过无文档对照。");
  }
  w("MARKER A0.nodoc END");
}

function setupDocA() {
  var d = null;
  try {
    d = app.documents.add(300, 200, 72, PROBE_TAG + "-A", NewDocumentMode.RGB, DocumentFill.WHITE);
    app.activeDocument = d;
    ASECTION_DOC = d;
    rec("A", "docContext", "OK", "created+active=" + sq(d.name) + " | activeDoc=" + sq(activeDocName()) + " | documents.length=" + app.documents.length);
  } catch (e) { rec("A", "docContext", "FAIL", errOf(e)); }
  return d;
}

function sectionA() {
  w("MARKER A.eventnames BEGIN");
  var t0 = nowMs();
  lockToDoc(ASECTION_DOC, "A.eventnames");
  rec("A", "activeDocAtStart", "INFO", sq(activeDocName()) + " (必须是 dsh-probe5-A，绝不是用户文档)");
  w("A.RULE " + JUDGE_RULE);
  // 对照组在前（已知可用/已知不存在），风险最高的模态类事件名排在最后，
  // 这样即使某个调用让宿主忙住，前面的证据也已经落盘。
  var NAMES = [
    "trim",                  // 对照组：已知可用的真实事件名
    "dshBogusEventNameA",    // 负对照：自造名字，必须报"未知的"，用来证明本测试能分辨
    "transform",
    "distort",
    "perspective",
    "upright",
    "autoStraighten",
    "lensCorrection",
    "lensCorrectionFilter",
    "adaptiveWideAngle",
    "cameraRaw",
    "cameraRawFilter"
  ];
  for (var i = 0; i < NAMES.length; i++) {
    tryEvent(NAMES[i]);
  }
  w("A.elapsedMs " + (nowMs() - t0));
  w("MARKER A.eventnames END");
}

// A2. 带候选参数键的调用：区分“命令不认识”与“参数不认识”
function sectionA2() {
  w("MARKER A2.paramkeys BEGIN");
  var t0 = nowMs();
  lockToDoc(ASECTION_DOC, "A2.paramkeys");
  rec("A2", "activeDocAtStart", "INFO", sq(activeDocName()));
  var LENS = ["verticalPerspective", "horizontalPerspective", "perspectiveVertical", "perspectiveHorizontal", "rotate", "scale"];
  for (var i = 0; i < LENS.length; i++) { tryEventWithParam("lensCorrection", LENS[i], "#Ang", 1.0); }
  var CR = ["upright", "Upright", "perspectiveVertical"];
  for (var j = 0; j < CR.length; j++) { tryEventWithParam("cameraRaw", CR[j], "#Prc", 1.0); }
  var TRA = ["quad", "quadrilateral", "freeTransform", "distort", "perspective", "warp"];
  for (var k = 0; k < TRA.length; k++) { tryEventWithParam("Trnf", TRA[k], "#Pxl", 10.0); }
  w("A2.note 上面每一行只放“一个候选参数键”，所以报错若说参数/键无效 ⇒ 命令本身被认出来了（比空参更强的信号）；若报“未知的” ⇒ 命令名不对。");
  w("A2.elapsedMs " + (nowMs() - t0));
  w("MARKER A2.paramkeys END");
}

// =====================================================================
// B. 4 字符码反查表（仅供参考，不作存在性判据）
// =====================================================================
function sectionB() {
  w("MARKER B.charids BEGIN");
  w("B.NOTE 本表只是参考，不作为存在性判据：stringIDToTypeID / charIDToTypeID 都会给不认识的字符串凭空造出一个合法 typeID 并成功返回"
    + "（DEVELOPER.md §6.1：任意垃圾串 → 合法 typeID，自造 dshBogusNameA/B/C 得到 4244/4245/4246）。"
    + "因此“反查非空”不能证明事件存在；反查为空也不代表事件不存在（可能只是 4 字符 code 猜错了）。");

  // B0. 造 ID 演示：证明 stringIDToTypeID 对垃圾串也成功 -> 反证它不能做存在性判据
  var BOGUS = ["dshBogusNameA", "dshBogusNameB", "zzzTotalGarbageStringID_XYZ_123", "definitelyNotARealPhotoshopEvent"];
  for (var bi = 0; bi < BOGUS.length; bi++) {
    var bid = null, bak = "", berr = null;
    try { bid = stringIDToTypeID(BOGUS[bi]); } catch (e) { berr = errOf(e); }
    if (bid !== null) { try { bak = typeIDToStringID(bid); } catch (e2) { bak = "<throw " + errOf(e2) + ">"; } }
    rec("B.bogus", "stringIDToTypeID(" + sq(BOGUS[bi]) + ")", berr === null ? "RETURNED_ID" : "THREW",
        "typeID=" + sq(bid) + " back=" + sq(bak) + (berr === null ? "" : (" | err=" + berr)));
  }

  // B1. 候选 4 字符码逐个反查（空串 / 异常都原样记录）
  var CODES = [
    ["Mk  ", "make（对照组，已知可用）"],
    ["ImgS", "imageSize（对照组，已知可用）"],
    ["Exps", "exposure（对照组，已知可用）"],
    ["Trnf", "transform?"],
    ["Dstr", "distort?"],
    ["Prsp", "perspective?"],
    ["AdpW", "adaptiveWideAngle?"],
    ["Uprt", "upright?"],
    ["Lnsc", "lensCorrection?"],
    ["LnsC", "lensCorrection?"],
    ["CRaw", "cameraRaw?"],
    ["CamR", "cameraRawFilter?"],
    ["Auto", "autoStraighten?"],
    ["Trim", "trim?"],
    ["UnSf", "unSharpMask?（DEVELOPER §6.1 记为反查为空）"]
  ];
  for (var i = 0; i < CODES.length; i++) {
    var code = CODES[i][0], note = CODES[i][1];
    var cid = null, cerr = null, back = "", backErr = null, rt = "n/a";
    try { cid = charIDToTypeID(code); } catch (e) { cerr = errOf(e); }
    if (cerr === null) {
      try { back = typeIDToStringID(cid); } catch (e2) { backErr = errOf(e2); }
      if (backErr === null && back !== "") {
        // 往返一致性：反查出的名字再正向造 ID，看是否同一个 ID
        try { rt = (stringIDToTypeID(back) === cid) ? "MATCH" : ("MISMATCH(stringIDToTypeID(" + sq(back) + ")=" + stringIDToTypeID(back) + ")"); }
        catch (e3) { rt = "throw{" + errOf(e3) + "}"; }
      }
    }
    rec("B.code", "code[" + sq(code) + "]", cerr === null ? "INFO" : "THREW",
        "note=" + note + " | typeID=" + sq(cid) + " | back=" + sq(back)
        + (backErr === null ? "" : (" | backErr=" + backErr))
        + (cerr === null ? (" | roundtrip=" + rt) : (" | err=" + cerr)));
  }
  w("MARKER B.charids END");
}

// =====================================================================
// C. 应用后回读真实键名
// =====================================================================

// C1. 通用描述符 dump：把 smartObject 里真实出现的键名与原始值写出来
function dumpDesc(prefix, dObj, depth) {
  if (depth < 0) { return; }
  var count = 0;
  try { count = dObj.count; } catch (e) { rec("C.dump", prefix, "FAIL_noCount", errOf(e)); return; }
  for (var i = 0; i < count; i++) {
    var k = null, ks = "?", typ = -1, ts = "?";
    try { k = dObj.getKey(i); } catch (e) { rec("C.dump", prefix + "[" + i + "]", "FAIL_getKey", errOf(e)); continue; }
    try { ks = typeIDToStringID(k); } catch (e2) { ks = "?"; }
    try { typ = dObj.getType(k); } catch (e3) { typ = -1; }
    var val = "";
    try {
      if (typ === DescValueType.OBJECTTYPE) { ts = "OBJECT"; val = "class=" + sq(clsOf(dObj.getObjectValue(k))); }
      else if (typ === DescValueType.LISTTYPE) { ts = "LIST"; val = "count=" + dObj.getList(k).count; }
      else if (typ === DescValueType.DOUBLETYPE) { ts = "DOUBLE"; val = "" + dObj.getDouble(k); }
      else if (typ === DescValueType.UNITDOUBLETYPE) { ts = "UNITDOUBLE"; val = "" + dObj.getUnitDoubleValue(k) + " unit=" + sq(safeTypeName(dObj.getUnitDoubleType(k))); }
      else if (typ === DescValueType.BOOLEANTYPE) { ts = "BOOL"; val = "" + dObj.getBoolean(k); }
      else if (typ === DescValueType.INTEGERTYPE) { ts = "INT"; val = "" + dObj.getInteger(k); }
      else if (typ === DescValueType.STRINGTYPE) { ts = "STRING"; val = sq(dObj.getString(k)); }
      else if (typ === DescValueType.ENUMERATEDTYPE) { ts = "ENUM"; val = sq(safeTypeName(dObj.getEnumerationType(k))) + "/" + sq(safeTypeName(dObj.getEnumerationValue(k))); }
      else if (typ === DescValueType.CLASSTYPE) { ts = "CLASS"; val = sq(safeTypeName(dObj.getClass(k))); }
      else if (typ === DescValueType.REFERENCETYPE) { ts = "REFERENCE"; val = ""; }
      else { ts = "TYPE(" + typ + ")"; val = "<not read>"; }
    } catch (ev) { val = "<readErr " + errOf(ev) + ">"; }
    rec("C.dump", prefix + "." + ks + "[" + i + "]", ts, "typeID=" + sq(k) + " | " + val);
    if (typ === DescValueType.OBJECTTYPE && depth > 0) {
      try { dumpDesc(prefix + "." + ks, dObj.getObjectValue(k), depth - 1); } catch (e4) { rec("C.dump", prefix + "." + ks, "FAIL_recurse", errOf(e4)); }
    }
    if (typ === DescValueType.LISTTYPE && depth > 0) {
      try {
        var lst = dObj.getList(k);
        for (var j = 0; j < lst.count && j < 8; j++) {
          try {
            var item = lst.getObjectValue(j);
            rec("C.dump", prefix + "." + ks + "[" + j + "]", "LIST_ITEM", "class=" + sq(clsOf(item)) + " n=" + item.count);
            dumpDesc(prefix + "." + ks + "[" + j + "]", item, depth - 1);
          } catch (e5) { rec("C.dump", prefix + "." + ks + "[" + j + "]", "NOT_OBJECT", errOf(e5)); }
        }
        if (lst.count > 8) { rec("C.dump", prefix + "." + ks, "LIST_TRUNCATED", "showing 8 of " + lst.count); }
      } catch (e6) { rec("C.dump", prefix + "." + ks, "FAIL_list", errOf(e6)); }
    }
  }
}

function safeTypeName(id) { try { return typeIDToStringID(id); } catch (e) { return "?" + id; } }

// C2. 回读当前图层：smartObject 全部键名 + filterFX（智能滤镜）真实键名
function smartFilterReport(label) {
  // 每一步单独 try/catch：第一轮整段包一个 try，结果只得到一行 FAIL，
  // 不知道是哪一步抛的（实测第一轮在此段抛出 num={1238}）。现在每步都留痕。
  // 只读：executeActionGet 不修改任何东西，但仍把活动文档锁回自己的临时文档，保证读的是它。
  lockToProbeDoc("C.fx[" + label + "]");
  var ref, d;
  try {
    ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  } catch (e1) { rec("C.fx", label, "STEP1_makeRef_FAIL", errOf(e1)); return; }
  try { d = executeActionGet(ref); }
  catch (e2) { rec("C.fx", label, "STEP2_executeActionGet_FAIL", errOf(e2)); return; }
  var docKeys = [];
  try {
    for (var q = 0; q < d.count; q++) { try { docKeys.push(typeIDToStringID(d.getKey(q))); } catch (eq) { docKeys.push("?"); } }
    rec("C.fx", label, "STEP3_layerDescKeys", "activeDoc=" + sq(activeDocName()) + " layer=" + sq("" + app.activeDocument.activeLayer.name) + " n=" + d.count + " | " + sq(docKeys.join(",")));
  } catch (e3) { rec("C.fx", label, "STEP3_layerDescKeys_FAIL", errOf(e3)); }

  var soKey = null, has = false;
  try { soKey = stringIDToTypeID("smartObject"); } catch (e4) { rec("C.fx", label, "STEP4_soKey_FAIL", errOf(e4)); return; }
  try { has = d.hasKey(soKey); } catch (e5) { rec("C.fx", label, "STEP4_hasKey_FAIL", errOf(e5)); return; }
  if (!has) { rec("C.fx", label, "NO_smartObject_key", "该层不是智能对象 ⇒ 键名未取证"); return; }

  var so;
  try { so = d.getObjectValue(soKey); } catch (e6) { rec("C.fx", label, "STEP5_getObjectValue_FAIL", errOf(e6)); return; }
  rec("C.fx", label, "STEP6_smartObject_cls", sq(clsOf(so)) + " n=" + so.count);
  try { dumpDesc("C.so." + label, so, 2); } catch (e7) { rec("C.fx", label, "STEP7_dump_FAIL", errOf(e7)); }

  var fx = null;
  try { fx = stringIDToTypeID("filterFX"); } catch (e8) { rec("C.fx", label, "STEP8_fxKey_FAIL", errOf(e8)); return; }
  var hasFx = false;
  try { hasFx = so.hasKey(fx); } catch (e9) { rec("C.fx", label, "STEP8_hasFx_FAIL", errOf(e9)); return; }
  if (!hasFx) { rec("C.fx", label, "NO_filterFX", "没有 filterFX 键 ⇒ 当前不是智能滤镜（键名未取证）"); return; }

  var lst = null;
  try { lst = so.getList(fx); } catch (e10) { rec("C.fx", label, "STEP9_getList_FAIL", errOf(e10)); return; }
  rec("C.fx", label, "filterFX_COUNT", "" + lst.count);
  for (var j = 0; j < lst.count; j++) {
    var item = null;
    try { item = lst.getObjectValue(j); } catch (e11) { rec("C.fx", label + ".filterFX[" + j + "]", "getObjectValue_FAIL", errOf(e11)); continue; }
    var kn = [];
    try { for (var m = 0; m < item.count; m++) { var kk = item.getKey(m); var kks; try { kks = typeIDToStringID(kk); } catch (e3b) { kks = "?"; } kn.push(kks); } } catch (e12) { kn.push("<keyEnumERR " + errOf(e12) + ">"); }
    rec("C.fx", label + ".filterFX[" + j + "]", "keys", "n=" + item.count + " | " + sq(kn.join(",")));
    try { rec("C.fx", label + ".filterFX[" + j + "].name", "OK", sq(item.getString(stringIDToTypeID("name")))); } catch (e13) { rec("C.fx", label + ".filterFX[" + j + "].name", "FAIL", errOf(e13)); }
    try { rec("C.fx", label + ".filterFX[" + j + "].enabled", "OK", sq(item.getBoolean(stringIDToTypeID("enabled")))); } catch (e14) { rec("C.fx", label + ".filterFX[" + j + "].enabled", "FAIL", errOf(e14)); }
    try { dumpDesc("C.fx." + label + ".filterFX[" + j + "]", item, 3); } catch (e15) { rec("C.fx", label + ".filterFX[" + j + "]", "dump_FAIL", errOf(e15)); }
  }
}

// C3. 四点 quad 载荷：4 个 Pnt 对象，每个 Hrzn/Vrtc 为 #Pxl 单位双精度
function quadListOf(pts) {
  var l = new ActionList();
  for (var i = 0; i < pts.length; i++) {
    var p = new ActionDescriptor();
    p.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), pts[i][0]);
    p.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), pts[i][1]);
    l.putObject(charIDToTypeID("Pnt "), p);
  }
  return l;
}

function targetRef() {
  var ref = new ActionReference();
  ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
  return ref;
}

// C4. 一次带参数的动作尝试：前后都回读 bounds，事后回读 smartObject
function tryAction(label, buildFn) {
  var err = null, ok = false, b0 = "<n/a>", b1 = "<n/a>", lay = null, evTid = null;
  if (!lockToProbeDoc("C.act[" + label.tag + "]")) {
    rec("C.act", label.tag, "SKIPPED_wrongActiveDoc", "未执行任何动作（避免误改用户文档）");
    return;
  }
  try { lay = app.activeDocument.activeLayer; } catch (e0) { lay = null; }
  b0 = boundsStr(lay);
  try {
    var d = new ActionDescriptor();
    d.putReference(charIDToTypeID("null"), targetRef());
    buildFn(d);
    evTid = evId(label.event, true);
    app.executeAction(evTid, d, DialogModes.NO);
    ok = true;
  } catch (e) { err = errOf(e); }
  try { lay = app.activeDocument.activeLayer; } catch (e1) { lay = null; }
  b1 = boundsStr(lay);
  rec("C.act", label.tag, ok ? "NO_THROW" : "THREW",
      "activeDoc=" + sq(activeDocName()) + " event=" + sq(label.event) + " eventTypeID=" + sq(evTid) + (label.key ? (" key=" + sq(label.key) + " form=" + label.form) : "")
      + " | boundsBefore{" + b0 + "} boundsAfter{" + b1 + "} | changed=" + (b0 !== b1)
      + (err === null ? " | raw=<no error>" : (" | raw=" + err)));
  smartFilterReport("C.after[" + label.tag + "]");
}

function sectionC() {
  w("MARKER C.applyThenRead BEGIN");
  var t0 = nowMs();
  var docC = null;
  try { docC = app.documents.add(300, 200, 72, PROBE_TAG + "-C", NewDocumentMode.RGB, DocumentFill.WHITE); }
  catch (e) { rec("C", "newDoc", "FAIL", errOf(e)); w("MARKER C.applyThenRead END"); return; }
  try { app.activeDocument = docC; } catch (e) { rec("C", "activate", "FAIL", errOf(e)); }
  CSECTION_DOC = docC;
  rec("C", "lockTargetDoc", "INFO", "CSECTION_DOC=" + sq("" + docC.name) + " | activeDoc=" + sq(activeDocName()) + " | allDocs=" + sq(app.documents.length));

  // 造一个有明确 bounds 的主体（50,50)-(250,150)，这样变换是否真生效可从 bounds 判断
  var lay = null;
  try {
    lay = docC.artLayers.add();
    lay.name = "ProbeSubject";
    var pts = [[50, 50], [250, 50], [250, 150], [50, 150]];
    docC.selection.select(pts, SelectionType.REPLACE, 0, true);
    var col = new SolidColor();
    col.rgb.red = 210; col.rgb.green = 70; col.rgb.blue = 70;
    docC.selection.fill(col);
    docC.selection.deselect();
    rec("C", "setupLayer", "OK", "name=" + sq(lay.name) + " bounds{" + boundsStr(lay) + "}");
  } catch (e) { rec("C", "setupLayer", "FAIL", errOf(e)); }

  // 变智能对象（probe4 的可用手段）
  try {
    app.activeDocument = docC;
    docC.activeLayer = lay;
    app.executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
    rec("C", "newPlacedLayer", "OK", "kind=" + sq("" + docC.activeLayer.kind) + " name=" + sq(docC.activeLayer.name));
  } catch (e) { rec("C", "newPlacedLayer", "FAIL", errOf(e)); }
  smartFilterReport("C.afterNewPlacedLayer");

  // 正对照：DOM 滤镜已知会生成智能滤镜（probe4 已验证）-> 证明“回读键名”这条机制本身是通的
  try {
    app.activeDocument = docC;
    docC.activeLayer.applyUnSharpMask(100, 2.0, 0);
    rec("C.PC", "applyUnSharpMask[DOM]", "OK", "正对照 amount=100 radius=2.0 threshold=0");
  } catch (e) { rec("C.PC", "applyUnSharpMask[DOM]", "FAIL", errOf(e)); }
  smartFilterReport("C.PC.afterUSM");

  // C5. 候选滤镜事件：空参调用 -> 不论成败都回读 filterFX
  var FILTERS = ["lensCorrection", "lensCorrectionFilter", "cameraRaw", "cameraRawFilter", "adaptiveWideAngle", "upright"];
  for (var i = 0; i < FILTERS.length; i++) {
    tryAction({ tag: "flt[" + FILTERS[i] + "].empty", event: FILTERS[i], key: "", form: "empty-descriptor" },
      function (d) { /* 空描述符：故意不带参数 */ });
  }

  // C6. 候选滤镜 + 候选参数键（在 temp doc 上，参数故意简单）
  var FPARAM = [
    ["lensCorrection", "verticalPerspective"],
    ["lensCorrection", "horizontalPerspective"],
    ["lensCorrection", "perspectiveVertical"],
    ["lensCorrection", "perspectiveHorizontal"],
    ["lensCorrection", "rotate"],
    ["lensCorrection", "scale"]
  ];
  for (var fi = 0; fi < FPARAM.length; fi++) {
    (function (ev, key) {
      tryAction({ tag: "flt[" + ev + "]+" + key, event: ev, key: key, form: "unitDouble(#Ang)=1.0" },
        function (d) { d.putUnitDouble(evId(key, true), charIDToTypeID("#Ang"), 1.0); });
    })(FPARAM[fi][0], FPARAM[fi][1]);
  }

  // C7. transform 的四点/四边形形式候选：每次前后回读 bounds
  var TGT = [[60, 55], [240, 45], [245, 155], [55, 160]];
  var TFORMS = [
    { tag: "Trnf.quad(list)", event: "Trnf", key: "quad", form: "putList(quad)=4xPnt", useChar: true },
    { tag: "Trnf.quadrilateral(list)", event: "Trnf", key: "quadrilateral", form: "putList(quadrilateral)=4xPnt", useChar: true },
    { tag: "Trnf.distort(list)", event: "Trnf", key: "distort", form: "putList(distort)=4xPnt", useChar: true },
    { tag: "Trnf.perspective(list)", event: "Trnf", key: "perspective", form: "putList(perspective)=4xPnt", useChar: true },
    { tag: "Trnf.warp(list)", event: "Trnf", key: "warp", form: "putList(warp)=4xPnt", useChar: true },
    { tag: "Trnf.freeTransform(obj{quad})", event: "Trnf", key: "freeTransform", form: "putObject(freeTransform, {quad})", useChar: true },
    { tag: "transform.quad(list)", event: "transform", key: "quad", form: "putList(quad)=4xPnt", useChar: false },
    { tag: "transform.freeTransform(obj{quad})", event: "transform", key: "freeTransform", form: "putObject(freeTransform, {quad})", useChar: false }
  ];
  for (var ti = 0; ti < TFORMS.length; ti++) {
    (function (f) {
      tryAction(f, function (d) {
        if (f.form.indexOf("putList") === 0) {
          d.putList(evId(f.key, true), quadListOf(TGT));
        } else {
          var inner = new ActionDescriptor();
          inner.putList(charIDToTypeID("quad"), quadListOf(TGT));
          d.putObject(evId(f.key, true), evId(f.key), inner);
        }
      });
    })(TFORMS[ti]);
  }

  // C8. 对照：transform 事件本身能不能真生效（用真实 4 字符码 mdSc/Angl/Ofst），
  //     若这些也改不动 bounds，就说明“bounds 没变”这条判据或引用方式有问题，而不是载荷形式的问题。
  tryAction({ tag: "Trnf.Ofst(control-move)", event: "Trnf", key: "Ofst", form: "putObject(Ofst,Ofst,{Hrzn,Vrtc})" },
    function (d) {
      var mv = new ActionDescriptor();
      mv.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), 20);
      mv.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), 20);
      d.putObject(charIDToTypeID("Ofst"), charIDToTypeID("Ofst"), mv);
    });
  tryAction({ tag: "Trnf.mdSc(control-scale)", event: "Trnf", key: "mdSc", form: "putUnitDouble(mdSc,#Prc)=80" },
    function (d) { d.putUnitDouble(charIDToTypeID("mdSc"), charIDToTypeID("#Prc"), 80); });
  tryAction({ tag: "Trnf.Angl(control-rotate)", event: "Trnf", key: "Angl", form: "putUnitDouble(Angl,#Ang)=5" },
    function (d) { d.putUnitDouble(charIDToTypeID("Angl"), charIDToTypeID("#Ang"), 5); });
  tryAction({ tag: "Trnf.quad(after-controls)", event: "Trnf", key: "quad", form: "putList(charID quad)=4xPnt(second pass)" },
    function (d) { d.putList(charIDToTypeID("quad"), quadListOf(TGT)); });

  w("C.elapsedMs " + (nowMs() - t0));
  w("MARKER C.applyThenRead END");
}

// =====================================================================
// D. 清理
// =====================================================================
function cleanup() {
  w("MARKER D.cleanup BEGIN");
  try {
    var victims = [], names = [];
    for (var i = 0; i < app.documents.length; i++) {
      var nm = app.documents[i].name;
      if (nm.indexOf(PROBE_TAG) === 0) { victims.push(app.documents[i]); names.push(nm); }
    }
    rec("D", "targets", "INFO", "count=" + victims.length + " | " + sq(names.join(" / ")));
    for (var j = 0; j < victims.length; j++) {
      try { victims[j].close(SaveOptions.DONOTSAVECHANGES); rec("D", "closed", "OK", sq(names[j])); }
      catch (e) { rec("D", "closed", "FAIL", sq(names[j]) + " | " + errOf(e)); }
    }
  } catch (e) { rec("D", "enumerate", "FAIL", errOf(e)); }
  var post = [];
  try { for (var k = 0; k < app.documents.length; k++) { post.push(app.documents[k].name); } } catch (e2) {}
  rec("D", "postDocs", "INFO", "count=" + post.length + " | " + sq(post.join(" ;; ")));
  w("MARKER D.cleanup END");
}

// =====================================================================
// main
// =====================================================================
function main() {
  w("ENV.RULE 本次探针只创建自己名字的临时文档，全部不保存关闭；不动任何用户文档。");
  try { app.displayDialogs = DialogModes.NO; rec("ENV", "displayDialogs", "OK", "NO"); }
  catch (e) { rec("ENV", "displayDialogs", "FAIL", errOf(e)); }

  w("MARKER ENV.BEFORE BEGIN");
  envReport("BEFORE");
  w("MARKER ENV.BEFORE END");

  try { sectionA0(); } catch (e) { rec("SECTION", "A0", "FAIL", errOf(e)); }
  try { setupDocA(); } catch (e) { rec("SECTION", "A.setup", "FAIL", errOf(e)); }
  try { sectionA(); } catch (e) { rec("SECTION", "A", "FAIL", errOf(e)); }
  try { sectionA2(); } catch (e) { rec("SECTION", "A2", "FAIL", errOf(e)); }
  try { sectionB(); } catch (e) { rec("SECTION", "B", "FAIL", errOf(e)); }
  try { sectionC(); } catch (e) { rec("SECTION", "C", "FAIL", errOf(e)); }
}

var tStart = nowMs();
var fatal = "";
try { main(); } catch (e) { fatal = errOf(e); }
if (fatal !== "") { w("FATAL main() " + fatal); }

// 清理无条件执行（ExtendScript 不支持 try/catch/finally，用顺序 + 各自 try 兜底）
try { cleanup(); } catch (e) { rec("SECTION", "D.cleanup", "FAIL", errOf(e)); }

w("MARKER ENV.AFTER BEGIN");
try { envReport("AFTER"); } catch (e) { rec("SECTION", "ENV.AFTER", "FAIL", errOf(e)); }
w("MARKER ENV.AFTER END");

w("TOTAL_ELAPSED_MS " + (nowMs() - tStart));
w("PROBE5_END");
"DSH_PROBE5_DONE";
