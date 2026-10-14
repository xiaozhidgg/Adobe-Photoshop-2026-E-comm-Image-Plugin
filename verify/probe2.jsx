#target photoshop
// =====================================================================
// probe2.jsx - second-pass probe, run with:
//     verify\probe.ps1 -JsxPath verify\probe2.jsx
//
// Purpose: resolve the ambiguities left by probe.jsx run 1.
//   A. Is stringIDToTypeID() minting IDs for unknown names? (proof)
//   B. Does Photoshop know the classic 4-char IDs for the commands that
//      failed? (charIDToTypeID never mints - it packs the 4 chars)
//   C. Do the failing commands succeed with a 4-char event ID?
//   D. Do they succeed on a document that HAS been saved to disk?
//   E. Do the pure-DOM equivalents (translate / applyUnSharpMask) work?
//   F. With the correct event ID, does USM on a smart object become a
//      SMART FILTER?
// Pure ASCII source; output to %TEMP%\dsh-ps-probe\result.txt.
// =====================================================================

var OUTFOLDER = new Folder(Folder.temp.fsName + "/dsh-ps-probe");
if (!OUTFOLDER.exists) { OUTFOLDER.create(); }
var OUTFILE = new File(OUTFOLDER.fsName + "/result.txt");
OUTFILE.encoding = "UTF-8";
OUTFILE.open("w");
OUTFILE.write("PROBE2_START\n");
OUTFILE.close();

function w(line) {
  try { OUTFILE.open("a"); OUTFILE.write(line + "\n"); OUTFILE.close(); } catch (e) {}
}
function sq(v) {
  if (v === null) { return "<null>"; }
  if (v === undefined) { return "<undefined>"; }
  var s = "" + v;
  s = s.replace(/\r/g, "\\r"); s = s.replace(/\n/g, "\\n"); s = s.replace(/\t/g, "\\t");
  if (s.length > 700) { s = s.substring(0, 700) + "...<TRUNC>"; }
  return s;
}
function errOf(e) {
  var p = [];
  try { p.push("toString={" + sq(e.toString()) + "}"); } catch (x) { p.push("toString=<none>"); }
  try { p.push("num={" + sq(e.number) + "}"); } catch (x) {}
  return p.join(" ");
}
function rec(tag, name, status, detail) {
  w(tag + " " + name + " | " + status + (detail === undefined ? "" : (" | " + detail)));
}
function uv(x) { try { return "" + x.as("px"); } catch (e) { return "" + x; } }
function boundsStr(l) {
  try { var b = l.bounds; return "L=" + uv(b[0]) + " T=" + uv(b[1]) + " R=" + uv(b[2]) + " B=" + uv(b[3]); }
  catch (e) { return "boundsERR{" + errOf(e) + "}"; }
}

try { app.displayDialogs = DialogModes.NO; rec("ENV", "displayDialogs", "OK", "NO"); } catch (e) { rec("ENV", "displayDialogs", "FAIL", errOf(e)); }

// =====================================================================
// A. minting proof
// =====================================================================
w("MARKER A.minting BEGIN");
function idOf(nm) { try { return "" + stringIDToTypeID(nm); } catch (e) { return "ERR{" + errOf(e) + "}"; } }
rec("MINT", "previously-probed-names", "INFO", "unSharpMask=" + idOf("unSharpMask") + " reduceNoise=" + idOf("reduceNoise") + " selectSubject=" + idOf("selectSubject") + " setSelection=" + idOf("setSelection") + " selectHistoryState=" + idOf("selectHistoryState"));
rec("MINT", "bogus-A-never-seen", "INFO", "dshBogusNameA=" + idOf("dshBogusNameA"));
rec("MINT", "bogus-B-never-seen", "INFO", "dshBogusNameB=" + idOf("dshBogusNameB"));
rec("MINT", "bogus-C-never-seen", "INFO", "dshBogusNameC=" + idOf("dshBogusNameC"));
rec("MINT", "classic-names-for-compare", "INFO", "flattenImage=" + idOf("flattenImage") + " canvasSize=" + idOf("canvasSize") + " imageSize=" + idOf("imageSize") + " gaussianBlur=" + idOf("gaussianBlur"));
w("MARKER A.minting END");

// =====================================================================
// B. 4-char dictionary resolution (charIDToTypeID packs chars - never mints)
// =====================================================================
w("MARKER B.dict BEGIN");
var CODES = [
  ["UnSf", "unSharpMask"], ["RdNs", "reduceNoise"], ["GsnB", "gaussianBlur"],
  ["AdjL", "adjustmentLayer"], ["HStr", "hueSaturation"], ["BrgC", "brightnessContrast"],
  ["BriC", "brightnessContrast"], ["PhtF", "photoFilter"], ["ClrB", "colorBalance"],
  ["Exps", "exposure"], ["ImgS", "imageSize"], ["CnvS", "canvasSize"],
  ["FltI", "flattenImage"], ["Mk  ", "make"], ["move", "move"], ["Algn", "align"],
  ["Usng", "using"], ["Type", "type"], ["null", "null"], ["UsrM", "userMaskEnabled"],
  ["RvlA", "revealAll"], ["Msk ", "mask"], ["fsel", "fsel"], ["PrgP", "progress"],
  ["Ofst", "offset"], ["Trgt", "targetEnum"], ["Ordn", "ordinal"], ["Lyr ", "layer"],
  ["Chnl", "channel"], ["Dlt ", "delete"], ["Dplc", "duplicate"], ["SlcS", "selectSubject"],
  ["Slct", "select"], ["At  ", "at"], ["T   ", "T"], ["setd", "set"],
  ["Amnt", "amount"], ["Rds ", "radius"], ["Thre", "threshold"], ["#Prc", "percentUnit"],
  ["#Pxl", "pixelUnit"], ["CnsP", "constrainProportions"], ["Intr", "interpolation"],
  ["Anch", "anchor"], ["MidC", "middleCenter"], ["AdCH", "horizontalCenterAlign"],
  ["AdCV", "verticalCenterAlign"], ["Hrzn", "horizontal"], ["Vrtc", "vertical"],
  ["RGBC", "RGBColor"], ["Rd  ", "red"], ["Grn ", "green"], ["Bl  ", "blue"],
  ["Clr ", "color"], ["Wdth", "width"], ["Hght", "height"], ["Nw  ", "new"],
  ["Adjs", "adjustment"], ["sdw ", "dropShadow"]
];
for (var c = 0; c < CODES.length; c++) {
  var code = CODES[c][0], exp = CODES[c][1];
  try {
    var id = charIDToTypeID(code);
    var got = "<roundtrip-threw>";
    try { got = typeIDToStringID(id); } catch (e2) { got = "<ERR " + errOf(e2) + ">"; }
    var sId = "<stringID threw>";
    try { sId = "" + stringIDToTypeID(exp); } catch (e3) { sId = "<ERR>"; }
    rec("DICT", "code[" + code + "]", (got === exp ? "MATCH" : "MISMATCH"),
        "typeID=" + id + " typeIDToStringID=" + sq(got) + " expected=" + exp + " | stringIDToTypeID('" + exp + "')=" + sId + " | stringID===charID:" + (sId === ("" + id)));
  } catch (e) {
    rec("DICT", "code[" + code + "]", "FAIL", "expected=" + exp + " | " + errOf(e));
  }
}
w("MARKER B.dict END");

// =====================================================================
// shared setup helpers
// =====================================================================
function newDoc(name) {
  var d = app.documents.add(900, 900, 72, name, NewDocumentMode.RGB, DocumentFill.WHITE);
  var lay = d.artLayers.add();
  lay.name = "ProbeSubject";
  var pts = [];
  for (var a = 0; a < 72; a++) {
    var th = (a / 72) * Math.PI * 2;
    pts.push([450 + 250 * Math.cos(th), 450 + 250 * Math.sin(th)]);
  }
  d.selection.select(pts, SelectionType.REPLACE, 0, true);
  var col = new SolidColor();
  col.rgb.red = 210; col.rgb.green = 70; col.rgb.blue = 70;
  d.selection.fill(col);
  d.selection.deselect();
  return d;
}
function findLayer(d, name) {
  for (var i = 0; i < d.artLayers.length; i++) { if (d.artLayers[i].name === name) { return d.artLayers[i]; } }
  return null;
}
function activateSubj(d) {
  var l = findLayer(d, "ProbeSubject");
  if (l) { d.activeLayer = l; }
  return l;
}
function smartFilterReport(label) {
  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var d = executeActionGet(ref);
    var soKey = stringIDToTypeID("smartObject");
    if (!d.hasKey(soKey)) { rec("SMARTFILTER", label, "NO_smartObject_key", ""); return; }
    var so = d.getObjectValue(soKey);
    var names = [];
    for (var i = 0; i < so.count; i++) {
      var k = so.getKey(i); var ks;
      try { ks = typeIDToStringID(k); } catch (e2) { ks = "?"; }
      names.push(ks);
    }
    rec("SMARTFILTER", label, "smartObjectKeys", "n=" + so.count + " | " + sq(names.join(",")));
    var fx = stringIDToTypeID("filterFX");
    if (!so.hasKey(fx)) { rec("SMARTFILTER", label, "NO_filterFX", "no filterFX key -> no smart filter"); return; }
    var lst = so.getList(fx);
    rec("SMARTFILTER", label, "filterFX_COUNT", "" + lst.count);
    for (var j = 0; j < lst.count; j++) {
      var item = lst.getObjectValue(j);
      var kn = [];
      for (var m = 0; m < item.count; m++) { var kk = item.getKey(m); var kks; try { kks = typeIDToStringID(kk); } catch (e3) { kks = "?"; } kn.push(kks); }
      rec("SMARTFILTER", label + ".filterFX[" + j + "]", "keys", "n=" + item.count + " | " + sq(kn.join(",")));
      try { rec("SMARTFILTER", label + ".filterFX[" + j + "].name", "OK", sq(item.getString(stringIDToTypeID("name")))); } catch (e4) { rec("SMARTFILTER", label + ".filterFX[" + j + "].name", "FAIL", errOf(e4)); }
      try { rec("SMARTFILTER", label + ".filterFX[" + j + "].enabled", "OK", sq(item.getBoolean(stringIDToTypeID("enabled")))); } catch (e5) {}
    }
  } catch (e) { rec("SMARTFILTER", label, "FAIL", errOf(e)); }
}
function historyReport(label, d) {
  try {
    var hs = d.historyStates; var names = [];
    for (var i = 0; i < hs.length; i++) { names.push(hs[i].name); }
    rec("HISTORY", label, "OK", "count=" + hs.length + " | " + sq(names.join(" > ")));
  } catch (e) { rec("HISTORY", label, "FAIL", errOf(e)); }
}
function layerDescKeys(label) {
  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var d = executeActionGet(ref);
    var names = [];
    for (var i = 0; i < d.count; i++) { var k = d.getKey(i); var ks; try { ks = typeIDToStringID(k); } catch (e2) { ks = "?"; } names.push(ks); }
    rec("LAYERKEYS", label, "n=" + d.count, sq(names.join(",")));
    var hm = stringIDToTypeID("hasUserMask");
    rec("LAYERKEYS", label + ".hasUserMask", "READ", d.hasKey(hm) ? sq(d.getBoolean(hm)) : "<absent>");
    var um = stringIDToTypeID("userMaskEnabled");
    rec("LAYERKEYS", label + ".userMaskEnabled", "READ", d.hasKey(um) ? sq(d.getBoolean(um)) : "<absent>");
  } catch (e) { rec("LAYERKEYS", label, "FAIL", errOf(e)); }
}

// =====================================================================
// C/D/E. command matrix on UNSAVED vs SAVED document
// =====================================================================
function runMatrix(tag, d) {
  w("MARKER matrix." + tag + " BEGIN");
  // --- C1 adjustment layer with 4-char class + 4-char enum value
  try {
    app.activeDocument = d; activateSubj(d);
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    ref.putClass(charIDToTypeID("AdjL"));
    desc.putReference(charIDToTypeID("null"), ref);
    var d2 = new ActionDescriptor();
    d2.putEnumerated(charIDToTypeID("Type"), charIDToTypeID("Type"), charIDToTypeID("HStr"));
    desc.putObject(charIDToTypeID("Usng"), charIDToTypeID("AdjL"), d2);
    app.executeAction(charIDToTypeID("Mk  "), desc, DialogModes.NO);
    rec("M", tag + ".adjLayer[charID AdjL+HStr]", "OK", "name=" + sq(d.activeLayer.name));
  } catch (e) { rec("M", tag + ".adjLayer[charID AdjL+HStr]", "FAIL", errOf(e)); }

  // --- C2 adjustment layer, original recipe (stringID class + stringID enum)
  try {
    app.activeDocument = d; activateSubj(d);
    var desc3 = new ActionDescriptor();
    var ref3 = new ActionReference();
    ref3.putClass(stringIDToTypeID("adjustmentLayer"));
    desc3.putReference(charIDToTypeID("null"), ref3);
    var d4 = new ActionDescriptor();
    d4.putEnumerated(charIDToTypeID("Type"), charIDToTypeID("Type"), stringIDToTypeID("hueSaturation"));
    desc3.putObject(charIDToTypeID("Usng"), stringIDToTypeID("adjustmentLayer"), d4);
    app.executeAction(charIDToTypeID("Mk  "), desc3, DialogModes.NO);
    rec("M", tag + ".adjLayer[orig recipe re-run]", "OK", "name=" + sq(d.activeLayer.name));
  } catch (e) { rec("M", tag + ".adjLayer[orig recipe re-run]", "FAIL", errOf(e)); }

  // --- C3 layer mask via charID enum values
  try {
    app.activeDocument = d; activateSubj(d);
    var md = new ActionDescriptor();
    var mref = new ActionReference();
    mref.putClass(charIDToTypeID("Chnl"));
    md.putReference(charIDToTypeID("null"), mref);
    var atref = new ActionReference();
    atref.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Msk "));
    md.putReference(charIDToTypeID("At  "), atref);
    md.putEnumerated(charIDToTypeID("Usng"), charIDToTypeID("UsrM"), charIDToTypeID("RvlA"));
    app.executeAction(charIDToTypeID("Mk  "), md, DialogModes.NO);
    rec("M", tag + ".layerMask[charID UsrM+RvlA]", "OK", "on " + sq(d.activeLayer.name));
  } catch (e) { rec("M", tag + ".layerMask[charID UsrM+RvlA]", "FAIL", errOf(e)); }
  try { layerDescKeys(tag + ".afterMask"); } catch (e) {}

  // --- C4 AM move (offset), target = raster layer
  try {
    app.activeDocument = d; activateSubj(d);
    var before = boundsStr(d.activeLayer);
    var mv = new ActionDescriptor();
    var r1 = new ActionReference();
    r1.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    mv.putReference(charIDToTypeID("null"), r1);
    var off = new ActionDescriptor();
    off.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), 30);
    off.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), 20);
    mv.putObject(charIDToTypeID("Ofst"), charIDToTypeID("Ofst"), off);
    mv.putBoolean(charIDToTypeID("PrgP"), true);
    app.executeAction(charIDToTypeID("move"), mv, DialogModes.NO);
    rec("M", tag + ".move[AM offset no-to-ref]", "OK", "before{" + before + "} after{" + boundsStr(d.activeLayer) + "}");
  } catch (e) { rec("M", tag + ".move[AM offset no-to-ref]", "FAIL", errOf(e)); }

  // --- E1 DOM translate
  try {
    app.activeDocument = d; activateSubj(d);
    var b2 = boundsStr(d.activeLayer);
    d.activeLayer.translate(UnitValue(30, "px"), UnitValue(20, "px"));
    rec("M", tag + ".translate[DOM]", "OK", "before{" + b2 + "} after{" + boundsStr(d.activeLayer) + "}");
  } catch (e) { rec("M", tag + ".translate[DOM]", "FAIL", errOf(e)); }

  // --- C5 AM unSharpMask using the classic 4-char event id "UnSf"
  try {
    app.activeDocument = d; activateSubj(d);
    var ud = new ActionDescriptor();
    var ur = new ActionReference();
    ur.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    ud.putReference(charIDToTypeID("null"), ur);
    ud.putUnitDouble(charIDToTypeID("Amnt"), charIDToTypeID("#Prc"), 80);
    ud.putUnitDouble(charIDToTypeID("Rds "), charIDToTypeID("#Pxl"), 1.0);
    ud.putInteger(charIDToTypeID("Thre"), 2);
    app.executeAction(charIDToTypeID("UnSf"), ud, DialogModes.NO);
    rec("M", tag + ".unSharpMask[charID UnSf]", "OK", "amount=80 radius=1 threshold=2");
  } catch (e) { rec("M", tag + ".unSharpMask[charID UnSf]", "FAIL", errOf(e)); }

  // --- C6 AM reduceNoise using "RdNs"
  try {
    app.activeDocument = d; activateSubj(d);
    var rd = new ActionDescriptor();
    var rr = new ActionReference();
    rr.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    rd.putReference(charIDToTypeID("null"), rr);
    rd.putInteger(stringIDToTypeID("quality"), 6);
    rd.putDouble(stringIDToTypeID("strength"), 30);
    rd.putBoolean(stringIDToTypeID("preserveDetails"), true);
    app.executeAction(charIDToTypeID("RdNs"), rd, DialogModes.NO);
    rec("M", tag + ".reduceNoise[charID RdNs]", "OK", "quality=6 strength=30");
  } catch (e) { rec("M", tag + ".reduceNoise[charID RdNs]", "FAIL", errOf(e)); }

  // --- E2 DOM applyUnSharpMask
  try {
    app.activeDocument = d; activateSubj(d);
    d.activeLayer.applyUnSharpMask(80, 1.0, 2);
    rec("M", tag + ".applyUnSharpMask[DOM]", "OK", "80/1.0/2");
  } catch (e) { rec("M", tag + ".applyUnSharpMask[DOM]", "FAIL", errOf(e)); }

  // --- C7 selectSubject retry
  try {
    app.activeDocument = d;
    app.executeAction(stringIDToTypeID("selectSubject"), undefined, DialogModes.NO);
    rec("M", tag + ".selectSubject[retry]", "OK", "sel=" + sq("" + d.selection.bounds));
  } catch (e) { rec("M", tag + ".selectSubject[retry]", "FAIL", errOf(e)); }

  historyReport(tag, d);
  w("MARKER matrix." + tag + " END");
}

w("MARKER C/D/E BEGIN");
var docU = null;
try { docU = newDoc("dsh-probe2-U"); app.activeDocument = docU; rec("SETUP", "docU", "OK", "unsaved"); } catch (e) { rec("SETUP", "docU", "FAIL", errOf(e)); }
if (docU) { runMatrix("UNSAVED", docU); }

var docS = null;
try {
  docS = newDoc("dsh-probe2-S");
  app.activeDocument = docS;
  var psd = new File(OUTFOLDER.fsName + "/dsh-probe2-S.psd");
  if (psd.exists) { psd.remove(); }
  docS.saveAs(psd, new PhotoshopSaveOptions(), true);
  rec("SETUP", "docS", "OK", "saved path=" + sq("" + docS.path) + " fileExists=" + (new File(OUTFOLDER.fsName + "/dsh-probe2-S.psd")).exists);
} catch (e) { rec("SETUP", "docS", "FAIL", errOf(e)); }
if (docS) { runMatrix("SAVED", docS); }
w("MARKER C/D/E END");

// =====================================================================
// F. smart-object USM with the correct 4-char event id
// =====================================================================
w("MARKER F.smartfilter BEGIN");
var docF = null;
try {
  docF = newDoc("dsh-probe2-F");
  app.activeDocument = docF;
  activateSubj(docF);
  app.executeAction(charIDToTypeID("Mk  "), (function () {
    var a = new ActionDescriptor();
    var r = new ActionReference();
    r.putClass(charIDToTypeID("AdjL"));
    a.putReference(charIDToTypeID("null"), r);
    var b = new ActionDescriptor();
    b.putEnumerated(charIDToTypeID("Type"), charIDToTypeID("Type"), charIDToTypeID("HStr"));
    a.putObject(charIDToTypeID("Usng"), charIDToTypeID("AdjL"), b);
    return a;
  })(), DialogModes.NO);
  rec("F", "adjLayer.probe", "OK", "created " + sq(docF.activeLayer.name));
} catch (e) { rec("F", "adjLayer.probe", "FAIL", errOf(e)); }

if (docF) {
  try {
    app.activeDocument = docF; activateSubj(docF);
    app.executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
    rec("F", "newPlacedLayer", "OK", "kind=" + sq("" + docF.activeLayer.kind) + " isSO=" + (("" + docF.activeLayer.kind) === ("" + LayerKind.SMARTOBJECT)));
  } catch (e) { rec("F", "newPlacedLayer", "FAIL", errOf(e)); }

  try {
    app.activeDocument = docF; activateSubj(docF);
    var ud2 = new ActionDescriptor();
    var ur2 = new ActionReference();
    ur2.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    ud2.putReference(charIDToTypeID("null"), ur2);
    ud2.putUnitDouble(charIDToTypeID("Amnt"), charIDToTypeID("#Prc"), 100);
    ud2.putUnitDouble(charIDToTypeID("Rds "), charIDToTypeID("#Pxl"), 2.0);
    ud2.putInteger(charIDToTypeID("Thre"), 0);
    app.executeAction(charIDToTypeID("UnSf"), ud2, DialogModes.NO);
    rec("F", "unSharpMask[sameDoc SO, charID UnSf]", "OK", "amount=100 radius=2 threshold=0");
  } catch (e) { rec("F", "unSharpMask[sameDoc SO, charID UnSf]", "FAIL", errOf(e)); }
  smartFilterReport("F.afterUSM");
  historyReport("F", docF);

  try {
    app.activeDocument = docF; activateSubj(docF);
    var rd2 = new ActionDescriptor();
    var rr2 = new ActionReference();
    rr2.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    rd2.putReference(charIDToTypeID("null"), rr2);
    rd2.putInteger(stringIDToTypeID("quality"), 6);
    rd2.putDouble(stringIDToTypeID("strength"), 30);
    app.executeAction(charIDToTypeID("RdNs"), rd2, DialogModes.NO);
    rec("F", "reduceNoise[sameDoc SO, charID RdNs]", "OK", "");
  } catch (e) { rec("F", "reduceNoise[sameDoc SO, charID RdNs]", "FAIL", errOf(e)); }
  smartFilterReport("F.afterReduceNoise");
  historyReport("F.afterReduceNoise", docF);
}
w("MARKER F.smartfilter END");

// =====================================================================
// cleanup
// =====================================================================
w("MARKER cleanup BEGIN");
try {
  var victims = [], vnames = [];
  for (var ci = 0; ci < app.documents.length; ci++) {
    var nm = app.documents[ci].name;
    if (nm.indexOf("dsh-probe") === 0) { victims.push(app.documents[ci]); vnames.push(nm); }
  }
  rec("CLEANUP", "targets", "INFO", "count=" + victims.length + " | " + sq(vnames.join(" / ")));
  for (var vi = 0; vi < victims.length; vi++) {
    try { victims[vi].close(SaveOptions.DONOTSAVECHANGES); rec("CLEANUP", "closed", "OK", sq(vnames[vi])); }
    catch (e) { rec("CLEANUP", "closed", "FAIL", sq(vnames[vi]) + " | " + errOf(e)); }
  }
} catch (e) { rec("CLEANUP", "enumerate", "FAIL", errOf(e)); }
var POST = [];
try { for (var pi = 0; pi < app.documents.length; pi++) { POST.push(app.documents[pi].name); } } catch (e) {}
rec("CLEANUP", "postDocs", "INFO", "count=" + POST.length + " | " + sq(POST.join(" ;; ")));
w("MARKER cleanup END");
w("PROBE2_END");
"DSH_PROBE2_DONE";
