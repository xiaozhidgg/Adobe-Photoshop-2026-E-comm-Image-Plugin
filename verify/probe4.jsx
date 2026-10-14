#target photoshop
// =====================================================================
// probe4.jsx - run with:  verify\probe.ps1 -JsxPath verify\probe4.jsx
//
// probe3 aborted (uncaught 1320 inside a catch block) before sections I/J/K
// ran. This run repairs that and settles:
//   G2. Which LayerKind members exist (typeof only - never index the enum)
//   H2. Is layer.kind assignment limited to TEXT/NORMAL? (probe3 said yes)
//   I.  Does a DOM filter on a SMART OBJECT become a SMART FILTER?  <-- key
//   J.  suspendHistory-wrapped AM calls (the one untried modality lever)
//   L.  class-3 DOM facts (id/name/w/h/resolution/path) + AM mask flags
//   M.  destructive DOM adjust* fallbacks (LAST - a dialog here must not
//       hide earlier results)
// Pure ASCII; output to %TEMP%\dsh-ps-probe\result.txt
// =====================================================================

var OUTFOLDER = new Folder(Folder.temp.fsName + "/dsh-ps-probe");
if (!OUTFOLDER.exists) { OUTFOLDER.create(); }
var OUTFILE = new File(OUTFOLDER.fsName + "/result.txt");
OUTFILE.encoding = "UTF-8";
OUTFILE.open("w");
OUTFILE.write("PROBE4_START\n");
OUTFILE.close();

function w(line) {
  try { OUTFILE.open("a"); OUTFILE.write(line + "\n"); OUTFILE.close(); } catch (e) {}
}
function sq(v) {
  if (v === null) { return "<null>"; }
  if (v === undefined) { return "<undefined>"; }
  var s = "" + v;
  s = s.replace(/\r/g, "\\r"); s = s.replace(/\n/g, "\\n"); s = s.replace(/\t/g, "\\t");
  if (s.length > 900) { s = s.substring(0, 900) + "...<TRUNC>"; }
  return s;
}
function errOf(e) {
  var p = [];
  try { var t = e.toString(); p.push("toString={" + sq(t) + "}"); } catch (x) { p.push("toString=<none>"); }
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
function activateSubj(d) { var l = findLayer(d, "ProbeSubject"); if (l) { d.activeLayer = l; } return l; }
function smartFilterReport(label) {
  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var d = executeActionGet(ref);
    var soKey = stringIDToTypeID("smartObject");
    if (!d.hasKey(soKey)) { rec("SMARTFILTER", label, "NO_smartObject_key", ""); return; }
    var so = d.getObjectValue(soKey);
    var names = [];
    for (var i = 0; i < so.count; i++) { var k = so.getKey(i); var ks; try { ks = typeIDToStringID(k); } catch (e2) { ks = "?"; } names.push(ks); }
    rec("SMARTFILTER", label, "smartObjectKeys", "n=" + so.count + " | " + sq(names.join(",")));
    var fx = stringIDToTypeID("filterFX");
    if (!so.hasKey(fx)) { rec("SMARTFILTER", label, "NO_filterFX", "no filterFX key -> NOT a smart filter"); return; }
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
function maskFlags(label) {
  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var d = executeActionGet(ref);
    var hm = stringIDToTypeID("hasUserMask"), um = stringIDToTypeID("userMaskEnabled");
    rec("MASK", label, "INFO", "hasUserMask=" + (d.hasKey(hm) ? sq(d.getBoolean(hm)) : "<absent>") + " userMaskEnabled=" + (d.hasKey(um) ? sq(d.getBoolean(um)) : "<absent>"));
  } catch (e) { rec("MASK", label, "FAIL", errOf(e)); }
}

// =====================================================================
// G2. LayerKind members (typeof only)
// =====================================================================
w("MARKER G2.layerkind BEGIN");
var LK = ["NORMAL", "TEXT", "SOLIDFILL", "HUE_SATURATION", "BRIGHTNESS_CONTRAST", "PHOTO_FILTER",
          "COLOR_BALANCE", "EXPOSURE", "LEVELS", "CURVES", "CHANNEL_MIXER", "SELECTIVE_COLOR",
          "GRADIENTFILL", "PATTERNFILL", "INVERSION", "POSTERIZE", "THRESHOLD", "VIBRANCE",
          "SMARTOBJECT", "LAYER3D", "VIDEO", "GROUP", "SMARTFILTER"];
var lkOut = [];
for (var gi = 0; gi < LK.length; gi++) {
  var t = "<threw>";
  try { t = typeof LayerKind[LK[gi]]; } catch (e) { t = "<ERR " + errOf(e) + ">"; }
  lkOut.push(LK[gi] + ":" + t);
}
rec("LK", "LayerKind members via typeof", "INFO", sq(lkOut.join(" | ")));
w("MARKER G2.layerkind END");

// =====================================================================
// G3 + L. doc-level DOM facts  (class-3 questions)
// =====================================================================
w("MARKER L.domfacts BEGIN");
var docL = null;
try { docL = newDoc("dsh-probe4-L"); app.activeDocument = docL; } catch (e) { rec("SETUP", "docL", "FAIL", errOf(e)); }
if (docL) {
  try { rec("DOC", "id", "=" + sq(docL.id), ""); } catch (e) { rec("DOC", "id", "FAIL", errOf(e)); }
  try { rec("DOC", "name", "=" + sq(docL.name), ""); } catch (e) { rec("DOC", "name", "FAIL", errOf(e)); }
  try { rec("DOC", "width", "=" + uv(docL.width), ""); } catch (e) { rec("DOC", "width", "FAIL", errOf(e)); }
  try { rec("DOC", "height", "=" + uv(docL.height), ""); } catch (e) { rec("DOC", "height", "FAIL", errOf(e)); }
  try { rec("DOC", "resolution", "=" + sq("" + docL.resolution), ""); } catch (e) { rec("DOC", "resolution", "FAIL", errOf(e)); }
  try { rec("DOC", "saved", "=" + sq("" + docL.saved), ""); } catch (e) { rec("DOC", "saved", "FAIL", errOf(e)); }
  try { var pv = docL.path; rec("DOC", "path", "rawType=" + (typeof pv) + " value=" + sq("" + pv), ""); }
  catch (e) { rec("DOC", "path", "THREW (expected for unsaved)", errOf(e)); }
  try { var fv = docL.fullName; rec("DOC", "fullName", "value=" + sq("" + fv), ""); }
  catch (e) { rec("DOC", "fullName", "THREW", errOf(e)); }
  try { rec("DOC", "mode", "=" + sq("" + docL.mode), " bitsPerChannel=" + sq("" + docL.bitsPerChannel)); } catch (e) { rec("DOC", "mode", "FAIL", errOf(e)); }
  try { rec("DOC", "backgroundLayer", "=" + sq("" + docL.backgroundLayer.name), ""); } catch (e) { rec("DOC", "backgroundLayer", "FAIL", errOf(e)); }
  try { rec("DOC", "activeLayer", "=" + sq("" + docL.activeLayer.name), " kind=" + sq("" + docL.activeLayer.kind)); } catch (e) { rec("DOC", "activeLayer", "FAIL", errOf(e)); }
  try { rec("DOC", "artLayers.count", "=" + docL.artLayers.length, ""); } catch (e) { rec("DOC", "artLayers.count", "FAIL", errOf(e)); }
  try { rec("DOC", "suspendHistory", "typeof=" + typeof docL.suspendHistory, ""); } catch (e) { rec("DOC", "suspendHistory", "FAIL", errOf(e)); }
  try { rec("DOC", "historyStates.count", "=" + docL.historyStates.length, ""); } catch (e) { rec("DOC", "historyStates.count", "FAIL", errOf(e)); }
  maskFlags("docL.ProbeSubject.fresh");

  // H2: kind assignment isolation
  try { var n1 = docL.artLayers.add(); var v1 = LayerKind.TEXT; n1.kind = v1; rec("KIND2", "TEXT", "OK", "name=" + sq(n1.name) + " kind=" + sq("" + n1.kind)); }
  catch (e) { rec("KIND2", "TEXT", "FAIL", errOf(e)); }
  try { var n2 = docL.artLayers.add(); var v2 = LayerKind.SOLIDFILL; n2.kind = v2; rec("KIND2", "SOLIDFILL", "OK", "name=" + sq(n2.name)); }
  catch (e) { rec("KIND2", "SOLIDFILL", "FAIL", errOf(e)); }
  try { var n3 = docL.artLayers.add(); var v3 = LayerKind.HUE_SATURATION; n3.kind = v3; rec("KIND2", "HUE_SATURATION", "OK", "name=" + sq(n3.name)); }
  catch (e) { rec("KIND2", "HUE_SATURATION", "FAIL", errOf(e)); }
  historyReport("L", docL);
}
w("MARKER L.domfacts END");

// =====================================================================
// I. DOM filter on SMART OBJECT -> smart filter ?   <-- key question
// =====================================================================
w("MARKER I.smartfilter BEGIN");
var docI = null;
try { docI = newDoc("dsh-probe4-I"); app.activeDocument = docI; activateSubj(docI); } catch (e) { rec("SETUP", "docI", "FAIL", errOf(e)); }
if (docI) {
  try {
    app.executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
    rec("I", "newPlacedLayer", "OK", "kind=" + sq("" + docI.activeLayer.kind));
  } catch (e) { rec("I", "newPlacedLayer", "FAIL", errOf(e)); }
  smartFilterReport("I.beforeFilter");

  // I1: non-destructive filter via DOM on a smart object
  try {
    app.activeDocument = docI; activateSubj(docI);
    app.activeDocument.activeLayer.applyUnSharpMask(100, 2.0, 0);
    rec("I", "applyUnSharpMask[DOM] on SO", "OK", "amount=100 radius=2.0px threshold=0");
  } catch (e) { rec("I", "applyUnSharpMask[DOM] on SO", "FAIL", errOf(e)); }
  smartFilterReport("I.afterUSM");
  historyReport("I.afterUSM", docI);

  try {
    app.activeDocument = docI; activateSubj(docI);
    app.activeDocument.activeLayer.applyGaussianBlur(4);
    rec("I", "applyGaussianBlur[DOM] on SO", "OK", "radius=4px");
  } catch (e) { rec("I", "applyGaussianBlur[DOM] on SO", "FAIL", errOf(e)); }
  smartFilterReport("I.afterGaussian");
  historyReport("I.afterGaussian", docI);

  try {
    app.activeDocument = docI; activateSubj(docI);
    app.activeDocument.activeLayer.applyMedianNoise(2);
    rec("I", "applyMedianNoise[DOM] on SO", "OK", "radius=2");
  } catch (e) { rec("I", "applyMedianNoise[DOM] on SO", "FAIL", errOf(e)); }
  smartFilterReport("I.afterMedian");
}
w("MARKER I.smartfilter END");

// =====================================================================
// J. suspendHistory-wrapped AM calls + properly-saved doc
// =====================================================================
w("MARKER J.saved BEGIN");
var docJ = null;
try {
  docJ = newDoc("dsh-probe4-J");
  app.activeDocument = docJ;
  var psd = new File(OUTFOLDER.fsName + "/dsh-probe4-J.psd");
  if (psd.exists) { psd.remove(); }
  docJ.saveAs(psd, new PhotoshopSaveOptions(), false);
  var pth = "<threw>"; try { pth = "" + docJ.path; } catch (e9) { pth = "<ERR " + errOf(e9) + ">"; }
  var svd = "<threw>"; try { svd = "" + docJ.saved; } catch (e10) { svd = "<ERR " + errOf(e10) + ">"; }
  rec("SAVE", "asCopy=false", "OK", "fileExists=" + psd.exists + " doc.path=" + sq(pth) + " doc.saved=" + sq(svd));
} catch (e) { rec("SAVE", "asCopy=false", "FAIL", errOf(e)); }

if (docJ) {
  // J1: adjLayer inside suspendHistory
  var code1 = "var D=new ActionDescriptor();var R=new ActionReference();" +
    "R.putClass(stringIDToTypeID('adjustmentLayer'));D.putReference(charIDToTypeID('null'),R);" +
    "var D2=new ActionDescriptor();D2.putEnumerated(charIDToTypeID('Type'),charIDToTypeID('Type'),stringIDToTypeID('hueSaturation'));" +
    "D.putObject(charIDToTypeID('Usng'),stringIDToTypeID('adjustmentLayer'),D2);" +
    "app.executeAction(charIDToTypeID('Mk  '),D,DialogModes.NO);";
  try {
    app.activeDocument = docJ; activateSubj(docJ);
    docJ.suspendHistory("probe4 adjLayer", code1);
    rec("J", "adjLayer[SUSPENDHISTORY]", "OK", "name=" + sq(docJ.activeLayer.name));
  } catch (e) { rec("J", "adjLayer[SUSPENDHISTORY]", "FAIL", errOf(e)); }

  // J2: layer mask inside suspendHistory
  var code2 = "var D=new ActionDescriptor();var R=new ActionReference();" +
    "R.putClass(charIDToTypeID('Chnl'));D.putReference(charIDToTypeID('null'),R);" +
    "var A=new ActionReference();A.putEnumerated(charIDToTypeID('Chnl'),charIDToTypeID('Chnl'),charIDToTypeID('Msk '));" +
    "D.putReference(charIDToTypeID('At  '),A);" +
    "D.putEnumerated(charIDToTypeID('Usng'),charIDToTypeID('UsrM'),charIDToTypeID('RvlA'));" +
    "app.executeAction(charIDToTypeID('Mk  '),D,DialogModes.NO);";
  try {
    app.activeDocument = docJ; activateSubj(docJ);
    docJ.suspendHistory("probe4 layerMask", code2);
    rec("J", "layerMask[SUSPENDHISTORY]", "OK", "on " + sq(docJ.activeLayer.name));
  } catch (e) { rec("J", "layerMask[SUSPENDHISTORY]", "FAIL", errOf(e)); }
  maskFlags("docJ.afterMask");

  // J3: AM move inside suspendHistory
  var code3 = "var D=new ActionDescriptor();var R=new ActionReference();" +
    "R.putEnumerated(charIDToTypeID('Lyr '),charIDToTypeID('Ordn'),charIDToTypeID('Trgt'));" +
    "D.putReference(charIDToTypeID('null'),R);" +
    "var O=new ActionDescriptor();O.putUnitDouble(charIDToTypeID('Hrzn'),charIDToTypeID('#Pxl'),25);" +
    "O.putUnitDouble(charIDToTypeID('Vrtc'),charIDToTypeID('#Pxl'),15);" +
    "D.putObject(charIDToTypeID('Ofst'),charIDToTypeID('Ofst'),O);" +
    "app.executeAction(charIDToTypeID('move'),D,DialogModes.NO);";
  try {
    app.activeDocument = docJ; activateSubj(docJ);
    var b9 = boundsStr(docJ.activeLayer);
    docJ.suspendHistory("probe4 move", code3);
    rec("J", "move[SUSPENDHISTORY]", "OK", "before{" + b9 + "} after{" + boundsStr(docJ.activeLayer) + "}");
  } catch (e) { rec("J", "move[SUSPENDHISTORY]", "FAIL", errOf(e)); }

  historyReport("J", docJ);
}
w("MARKER J.saved END");

// =====================================================================
// M. destructive DOM adjust* fallbacks  (LAST: a dialog must not hide the rest)
// =====================================================================
w("MARKER M.domadject BEGIN");
if (docL) {
  try {
    app.activeDocument = docL; activateSubj(docL);
    docL.activeLayer.adjustHueSaturation(20, 10, 0, true);
    rec("M", "adjustHueSaturation[DOM]", "OK", "hue=20 sat=10 light=0 colorize=true");
  } catch (e) { rec("M", "adjustHueSaturation[DOM]", "FAIL", errOf(e)); }
  try {
    app.activeDocument = docL; activateSubj(docL);
    docL.activeLayer.adjustBrightnessContrast(12, 8);
    rec("M", "adjustBrightnessContrast[DOM]", "OK", "brightness=12 contrast=8");
  } catch (e) { rec("M", "adjustBrightnessContrast[DOM]", "FAIL", errOf(e)); }
  try {
    app.activeDocument = docL; activateSubj(docL);
    var fc = new SolidColor();
    fc.rgb.red = 240; fc.rgb.green = 200; fc.rgb.blue = 150;
    docL.activeLayer.photoFilter(fc, 25, false);
    rec("M", "photoFilter[DOM]", "OK", "warm rgb(240,200,150) density=25");
  } catch (e) { rec("M", "photoFilter[DOM]", "FAIL", errOf(e)); }
  try {
    app.activeDocument = docL; activateSubj(docL);
    docL.activeLayer.adjustColorBalance([0, 0, 0], [1, 0, 0], [0, 0, 0], false);
    rec("M", "adjustColorBalance[DOM]", "OK", "highlights red +1, preserveLuminosity=false");
  } catch (e) { rec("M", "adjustColorBalance[DOM]", "FAIL", errOf(e)); }
  historyReport("M", docL);
}
w("MARKER M.domadject END");

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
try { for (var qi = 0; qi < app.documents.length; qi++) { POST.push(app.documents[qi].name); } } catch (e) {}
rec("CLEANUP", "postDocs", "INFO", "count=" + POST.length + " | " + sq(POST.join(" ;; ")));
w("MARKER cleanup END");
w("PROBE4_END");
"DSH_PROBE4_DONE";
