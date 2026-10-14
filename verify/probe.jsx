#target photoshop
// =====================================================================
// probe.jsx - Photoshop 2026 Action Manager capability probe
// Invoked by verify/probe.ps1 through Photoshop COM DoJavaScriptFile.
// Output: %TEMP%\dsh-ps-probe\result.txt   (UTF-8, one record per line)
// Source is deliberately pure ASCII: the workspace path contains CJK
// characters, so all file I/O targets the ASCII temp folder instead.
// Every probe is independently try/catch'd; one failure never aborts.
// =====================================================================

var OUTFOLDER = new Folder(Folder.temp.fsName + "/dsh-ps-probe");
if (!OUTFOLDER.exists) { OUTFOLDER.create(); }
var OUTFILE = new File(OUTFOLDER.fsName + "/result.txt");
OUTFILE.encoding = "UTF-8";
OUTFILE.open("w");
OUTFILE.write("PROBE_START\n");
OUTFILE.close();

function w(line) {
  try { OUTFILE.open("a"); OUTFILE.write(line + "\n"); OUTFILE.close(); } catch (e) {}
}
function sq(v) {
  if (v === null) { return "<null>"; }
  if (v === undefined) { return "<undefined>"; }
  var s = "" + v;
  s = s.replace(/\r/g, "\\r");
  s = s.replace(/\n/g, "\\n");
  s = s.replace(/\t/g, "\\t");
  if (s.length > 700) { s = s.substring(0, 700) + "...<TRUNC>"; }
  return s;
}
function errOf(e) {
  var p = [];
  try { p.push("toString={" + sq(e.toString()) + "}"); } catch (x) { p.push("toString=<none>"); }
  try { p.push("message={" + sq(e.message) + "}"); } catch (x) {}
  try { p.push("number={" + sq(e.number) + "}"); } catch (x) {}
  try { p.push("line={" + sq(e.line) + "}"); } catch (x) {}
  return p.join(" ");
}
function rec(tag, name, status, detail) {
  w(tag + " " + name + " | " + status + (detail === undefined ? "" : (" | " + detail)));
}
function uv(x) { try { return "" + x.as("px"); } catch (e) { return "" + x; } }
function boundsStr(l) {
  try {
    var b = l.bounds;
    return "L=" + uv(b[0]) + " T=" + uv(b[1]) + " R=" + uv(b[2]) + " B=" + uv(b[3]);
  } catch (e) { return "boundsERR{" + errOf(e) + "}"; }
}

// ---------------------------------------------------------------- env
w("PROBE_VERSION=1");
try { rec("ENV", "app.name", "OK", sq(app.name)); } catch (e) { rec("ENV", "app.name", "FAIL", errOf(e)); }
try { rec("ENV", "app.version", "OK", sq(app.version)); } catch (e) { rec("ENV", "app.version", "FAIL", errOf(e)); }
try { rec("ENV", "app.build", "OK", sq(app.build)); } catch (e) { rec("ENV", "app.build", "FAIL", errOf(e)); }
try { rec("ENV", "scriptingVersion", "OK", sq(app.scriptingVersion)); } catch (e) { rec("ENV", "scriptingVersion", "FAIL", errOf(e)); }
try { rec("ENV", "app.preferences.rulerUnits", "OK", sq(app.preferences.rulerUnits)); } catch (e) { rec("ENV", "rulerUnits", "FAIL", errOf(e)); }

var PRE_DOCS = [];
try { for (var i = 0; i < app.documents.length; i++) { PRE_DOCS.push(app.documents[i].name); } } catch (e) {}
rec("ENV", "preexistingDocs", "INFO", "count=" + PRE_DOCS.length + " | " + sq(PRE_DOCS.join(" ;; ")));

var ORIG_ACTIVE = null;
try { ORIG_ACTIVE = app.activeDocument; rec("ENV", "preexistingActiveDoc", "OK", sq(ORIG_ACTIVE.name)); }
catch (e) { rec("ENV", "preexistingActiveDoc", "NONE", errOf(e)); }

try { app.displayDialogs = DialogModes.NO; rec("ENV", "displayDialogs", "OK", "set to NO"); }
catch (e) { rec("ENV", "displayDialogs", "FAIL", errOf(e)); }

// ------------------------------------------------- class 1: event names
var EVENT_NAMES = [
  "removeBackground", "selectSubject", "setSelection", "make", "move", "delete",
  "duplicate", "imageSize", "canvasSize", "flattenImage", "save", "close",
  "select", "fill", "gaussianBlur", "unSharpMask", "reduceNoise",
  "newPlacedLayer", "placedLayerConvertToLayers", "selectHistoryState",
  "colorBalance", "hueSaturation", "brightnessContrast", "photoFilter",
  "exposure", "solidColorLayer", "contentLayer", "dropShadow",
  // controls + auxiliary keys used by later probes
  "zzzTotalGarbageStringID_XYZ_123", "zzzq", "null", "adjustmentLayer",
  "layerKind", "presetKind", "radius", "amount", "threshold", "to", "offset",
  "hasUserMask", "userMaskEnabled", "filterFX", "smartObject", "layerID"
];

w("MARKER class1.event-names BEGIN");
for (var n = 0; n < EVENT_NAMES.length; n++) {
  var nm = EVENT_NAMES[n];
  try {
    var tid = stringIDToTypeID(nm);
    var back = "<roundtrip-threw>";
    try { back = typeIDToStringID(tid); } catch (e2) { back = "<ERR " + errOf(e2) + ">"; }
    rec("EVENT", nm, "EXISTS", "typeID=" + tid + " | roundtrip=" + sq(back) + " | match=" + (back === nm));
  } catch (e) {
    rec("EVENT", nm, "MISSING", errOf(e));
  }
}
// controls that establish what a MISSING result means
try { rec("CTRL", "typeIDToStringID(0)", "OK", sq(typeIDToStringID(0))); } catch (e) { rec("CTRL", "typeIDToStringID(0)", "FAIL", errOf(e)); }
try { rec("CTRL", "charIDToTypeID('ZZZZ')", "OK", "typeID=" + charIDToTypeID("ZZZZ")); } catch (e) { rec("CTRL", "charIDToTypeID('ZZZZ')", "FAIL", errOf(e)); }
try { rec("CTRL", "charIDToTypeID('Mk  ')", "OK", "typeID=" + charIDToTypeID("Mk  ")); } catch (e) { rec("CTRL", "charIDToTypeID('Mk  ')", "FAIL", errOf(e)); }
try { rec("CTRL", "stringIDToTypeID('make')==charIDToTypeID('Mk  ')", "OK", "equal=" + (stringIDToTypeID("make") === charIDToTypeID("Mk  ")) + " stringID=" + stringIDToTypeID("make") + " charID=" + charIDToTypeID("Mk  ")); } catch (e) { rec("CTRL", "make-vs-Mk", "FAIL", errOf(e)); }
w("MARKER class1.event-names END");

// ------------------------------------------------------------ helpers
function newProbeDoc(name) {
  var d = app.documents.add(900, 900, 72, name, NewDocumentMode.RGB, DocumentFill.WHITE);
  return d;
}
function paintEllipse(doc, layerName, cr, cg, cb) {
  var lay = doc.artLayers.add();
  lay.name = layerName;
  var pts = [];
  var cx = 450, cy = 450, rx = 250, ry = 250;
  for (var a = 0; a < 72; a++) {
    var th = (a / 72) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(th), cy + ry * Math.sin(th)]);
  }
  var oldSel = null;
  doc.selection.select(pts, SelectionType.REPLACE, 0, true);
  var col = new SolidColor();
  col.rgb.red = cr; col.rgb.green = cg; col.rgb.blue = cb;
  doc.selection.fill(col);
  doc.selection.deselect();
  return lay;
}
function findLayer(doc, name) {
  for (var i = 0; i < doc.artLayers.length; i++) {
    if (doc.artLayers[i].name === name) { return doc.artLayers[i]; }
  }
  return null;
}
function docInfo(label, d) {
  try { rec("DOC", label + ".name", "OK", sq(d.name)); } catch (e) { rec("DOC", label + ".name", "FAIL", errOf(e)); }
  try { rec("DOC", label + ".id", "OK", sq(d.id)); } catch (e) { rec("DOC", label + ".id", "FAIL", errOf(e)); }
  try { rec("DOC", label + ".width", "OK", sq(d.width) + " (" + uv(d.width) + "px)"); } catch (e) { rec("DOC", label + ".width", "FAIL", errOf(e)); }
  try { rec("DOC", label + ".height", "OK", sq(d.height) + " (" + uv(d.height) + "px)"); } catch (e) { rec("DOC", label + ".height", "FAIL", errOf(e)); }
  try { rec("DOC", label + ".resolution", "OK", sq(d.resolution)); } catch (e) { rec("DOC", label + ".resolution", "FAIL", errOf(e)); }
  try { rec("DOC", label + ".path", "OK", sq(d.path)); } catch (e) { rec("DOC", label + ".path", "FAIL", errOf(e)); }
  try { rec("DOC", label + ".fullName", "OK", sq(d.fullName)); } catch (e) { rec("DOC", label + ".fullName", "FAIL", errOf(e)); }
  try { rec("DOC", label + ".layers", "OK", "count=" + d.layers.length + " names=" + sq((function () { var a = []; for (var i = 0; i < d.layers.length; i++) { a.push(d.layers[i].name); } return a.join(" / "); })())); } catch (e) { rec("DOC", label + ".layers", "FAIL", errOf(e)); }
}
function selBoundsStr(d) {
  try {
    if (!d.selection) { return "selection-object=<null>"; }
    var b = d.selection.bounds;
    if (!b) { return "bounds=<null> (nothing selected)"; }
    return "L=" + uv(b[0]) + " T=" + uv(b[1]) + " R=" + uv(b[2]) + " B=" + uv(b[3]);
  } catch (e) { return "boundsERR{" + errOf(e) + "}"; }
}
function dumpDescKeys(label, d) {
  try {
    var cnt = d.count;
    var names = [];
    for (var i = 0; i < cnt; i++) {
      var k = d.getKey(i);
      var ks;
      try { ks = typeIDToStringID(k); } catch (e2) { try { ks = "charID:" + typeIDToCharID(k); } catch (e3) { ks = "?"; } }
      names.push(ks);
    }
    rec("DESC", label, "KEYS", "n=" + cnt + " | " + sq(names.join(",")));
  } catch (e) { rec("DESC", label, "FAIL", errOf(e)); }
}
function layerDescriptor(label) {
  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var d = executeActionGet(ref);
    dumpDescKeys(label, d);
    var probes = ["name", "layerKind", "hasUserMask", "userMaskEnabled", "smartObject", "visible", "mode"];
    for (var j = 0; j < probes.length; j++) {
      var tk = stringIDToTypeID(probes[j]);
      if (d.hasKey(tk)) {
        var v = "<unreadable>";
        try { v = d.getBoolean(tk); } catch (e1) { try { v = d.getInteger(tk); } catch (e2) { try { v = d.getString(tk); } catch (e3) { v = "<object/enum/list>"; } } }
        rec("LAYERKEY", label + "." + probes[j], "PRESENT", sq(v));
      } else {
        rec("LAYERKEY", label + "." + probes[j], "ABSENT", "");
      }
    }
    return d;
  } catch (e) { rec("LAYERKEY", label, "FAIL", errOf(e)); return null; }
}
function smartFilterReport(label) {
  try {
    var ref = new ActionReference();
    ref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
    var d = executeActionGet(ref);
    var soKey = stringIDToTypeID("smartObject");
    if (!d.hasKey(soKey)) { rec("SMARTFILTER", label, "NO_SMARTOBJECT_KEY", "layer descriptor has no smartObject key"); return; }
    var so = d.getObjectValue(soKey);
    dumpDescKeys(label + ".smartObject", so);
    var fx = stringIDToTypeID("filterFX");
    if (!so.hasKey(fx)) { rec("SMARTFILTER", label, "NO_filterFX", "smartObject descriptor has no filterFX key"); return; }
    var lst = so.getList(fx);
    rec("SMARTFILTER", label, "filterFX_COUNT", "" + lst.count);
    for (var i = 0; i < lst.count; i++) {
      var item = lst.getObjectValue(i);
      dumpDescKeys(label + ".filterFX[" + i + "]", item);
      try { rec("SMARTFILTER", label + ".filterFX[" + i + "].name", "OK", sq(item.getString(stringIDToTypeID("name")))); } catch (e2) { rec("SMARTFILTER", label + ".filterFX[" + i + "].name", "FAIL", errOf(e2)); }
      try { rec("SMARTFILTER", label + ".filterFX[" + i + "].filterID", "OK", sq(item.getString(stringIDToTypeID("filterID")))); } catch (e3) { rec("SMARTFILTER", label + ".filterFX[" + i + "].filterID", "FAIL", errOf(e3)); }
      try { rec("SMARTFILTER", label + ".filterFX[" + i + "].enabled", "OK", sq(item.getBoolean(stringIDToTypeID("enabled")))); } catch (e4) { rec("SMARTFILTER", label + ".filterFX[" + i + "].enabled", "FAIL", errOf(e4)); }
      try { rec("SMARTFILTER", label + ".filterFX[" + i + "].hasOptions", "OK", sq(item.getBoolean(stringIDToTypeID("hasOptions")))); } catch (e5) { rec("SMARTFILTER", label + ".filterFX[" + i + "].hasOptions", "FAIL", errOf(e5)); }
    }
  } catch (e) { rec("SMARTFILTER", label, "FAIL", errOf(e)); }
}
function historyReport(label, d) {
  try {
    var hs = d.historyStates;
    var names = [];
    for (var i = 0; i < hs.length; i++) { names.push(hs[i].name); }
    rec("HISTORY", label, "OK", "count=" + hs.length + " | " + sq(names.join(" > ")));
  } catch (e) { rec("HISTORY", label, "FAIL", errOf(e)); }
}

// -------------------------------------------------------- adjustment AM
function buildAdjustDesc(sv) {
  var d = new ActionDescriptor();
  if (sv.presetKind) {
    d.putEnumerated(stringIDToTypeID("presetKind"), stringIDToTypeID("presetKindType"), stringIDToTypeID(sv.presetKind));
  }
  for (var i = 0; i < sv.keys.length; i++) {
    var k = sv.keys[i];
    var kid = stringIDToTypeID(k[0]);
    if (k[1] === "int") { d.putInteger(kid, k[2]); }
    else if (k[1] === "double") { d.putDouble(kid, k[2]); }
    else if (k[1] === "bool") { d.putBoolean(kid, k[2]); }
    else if (k[1] === "percent") { d.putUnitDouble(kid, stringIDToTypeID("percentUnit"), k[2]); }
    else if (k[1] === "rgbc") {
      var c = new ActionDescriptor();
      c.putDouble(charIDToTypeID("Rd  "), k[2][0]);
      c.putDouble(charIDToTypeID("Grn "), k[2][1]);
      c.putDouble(charIDToTypeID("Bl  "), k[2][2]);
      d.putObject(kid, charIDToTypeID("RGBC"), c);
    } else if (k[1] === "levels") {
      var l = new ActionDescriptor();
      l.putInteger(stringIDToTypeID("cyanRed"), k[2][0]);
      l.putInteger(stringIDToTypeID("magentaGreen"), k[2][1]);
      l.putInteger(stringIDToTypeID("yellowBlue"), k[2][2]);
      d.putObject(kid, kid, l);
    }
  }
  return d;
}
function tryAdjustmentLayer(label, typeStr, variants) {
  try {
    var idMk = charIDToTypeID("Mk  ");
    var desc = new ActionDescriptor();
    var ref = new ActionReference();
    var idAdjL = stringIDToTypeID("adjustmentLayer");
    ref.putClass(idAdjL);
    desc.putReference(charIDToTypeID("null"), ref);
    var d2 = new ActionDescriptor();
    var idType = charIDToTypeID("Type");
    d2.putEnumerated(idType, idType, stringIDToTypeID(typeStr));
    desc.putObject(charIDToTypeID("Usng"), idAdjL, d2);
    app.executeAction(idMk, desc, DialogModes.NO);
    var lname = "";
    try { lname = app.activeDocument.activeLayer.name; } catch (e2) {}
    rec("ADJ", label + ".make", "OK", "enumType=" + typeStr + " | newLayerName=" + sq(lname));
  } catch (e) {
    rec("ADJ", label + ".make", "FAIL", "enumType=" + typeStr + " | " + errOf(e));
    return;
  }
  for (var i = 0; i < variants.length; i++) {
    var sv = variants[i];
    var keyCheck = [];
    for (var k = 0; k < sv.keys.length; k++) {
      try { stringIDToTypeID(sv.keys[k][0]); keyCheck.push(sv.keys[k][0] + "=reg"); }
      catch (e4) { keyCheck.push(sv.keys[k][0] + "=UNREG"); }
    }
    var keyList = keyCheck.join(",");
    try {
      var idSet = charIDToTypeID("setd");
      var sd = new ActionDescriptor();
      var sref = new ActionReference();
      sref.putEnumerated(stringIDToTypeID("adjustmentLayer"), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      sd.putReference(charIDToTypeID("null"), sref);
      sd.putObject(charIDToTypeID("T   "), stringIDToTypeID(typeStr), buildAdjustDesc(sv));
      app.executeAction(idSet, sd, DialogModes.NO);
      rec("ADJ", label + ".set[" + sv.label + "]", "OK", "keys=" + keyList);
    } catch (e) {
      rec("ADJ", label + ".set[" + sv.label + "]", "FAIL", "keys=" + keyList + " | " + errOf(e));
    }
  }
}

// =====================================================================
// DOC A : selectSubject + removeBackground
// =====================================================================
w("MARKER docA BEGIN");
var docA = null;
try {
  docA = newProbeDoc("dsh-probe-A");
  app.activeDocument = docA;
  paintEllipse(docA, "ProbeSubject", 220, 60, 60);
  rec("DOCA", "setup", "OK", "ellipse r=250 center=450,450 on layer ProbeSubject");
  docInfo("A", docA);
} catch (e) {
  rec("DOCA", "setup", "FAIL", errOf(e));
}

if (docA) {
  // --- selectSubject variant 1: bare event, no descriptor
  try { app.activeDocument.selection.deselect(); } catch (e0) {}
  try {
    app.activeDocument = docA;
    app.executeAction(stringIDToTypeID("selectSubject"), undefined, DialogModes.NO);
    rec("EXEC", "selectSubject[bare]", "OK", "selBounds=" + selBoundsStr(docA));
  } catch (e) { rec("EXEC", "selectSubject[bare]", "FAIL", errOf(e)); }

  // --- selectSubject variant 2: sampleAllLayers + selectSubjectAuto enum
  try { app.activeDocument.selection.deselect(); } catch (e0) {}
  try {
    app.activeDocument = docA;
    var ss = new ActionDescriptor();
    ss.putBoolean(stringIDToTypeID("sampleAllLayers"), true);
    ss.putEnumerated(stringIDToTypeID("selectSubjectAuto"), stringIDToTypeID("selectSubjectAuto"), stringIDToTypeID("selectSubjectAutoSubject"));
    app.executeAction(stringIDToTypeID("selectSubject"), ss, DialogModes.NO);
    rec("EXEC", "selectSubject[sampleAllLayers+auto]", "OK", "selBounds=" + selBoundsStr(docA));
  } catch (e) { rec("EXEC", "selectSubject[sampleAllLayers+auto]", "FAIL", errOf(e)); }

  // --- selectSubject variant 3: selectSubjectAuto only
  try { app.activeDocument.selection.deselect(); } catch (e0) {}
  try {
    app.activeDocument = docA;
    var ss3 = new ActionDescriptor();
    ss3.putEnumerated(stringIDToTypeID("selectSubjectAuto"), stringIDToTypeID("selectSubjectAuto"), stringIDToTypeID("selectSubjectAutoSubject"));
    app.executeAction(stringIDToTypeID("selectSubject"), ss3, DialogModes.NO);
    rec("EXEC", "selectSubject[auto-only]", "OK", "selBounds=" + selBoundsStr(docA));
  } catch (e) { rec("EXEC", "selectSubject[auto-only]", "FAIL", errOf(e)); }

  // --- removeBackground (layer must be the pixel layer)
  try { app.activeDocument.selection.deselect(); } catch (e0) {}
  try {
    app.activeDocument = docA;
    var subjL = findLayer(docA, "ProbeSubject");
    if (subjL) { docA.activeLayer = subjL; }
    rec("EXEC", "removeBackground.pre", "INFO", "activeLayer=" + sq(docA.activeLayer.name) + " kind=" + sq(docA.activeLayer.kind) + " " + boundsStr(docA.activeLayer));
    app.executeAction(stringIDToTypeID("removeBackground"), undefined, DialogModes.NO);
    rec("EXEC", "removeBackground", "OK", "activeLayer=" + sq(docA.activeLayer.name) + " kind=" + sq(docA.activeLayer.kind));
  } catch (e) { rec("EXEC", "removeBackground", "FAIL", errOf(e)); }

  // --- post-removeBackground layer evidence
  try {
    app.activeDocument = docA;
    rec("EXEC", "removeBackground.postLayers", "INFO", "count=" + docA.layers.length + " names=" + sq((function () { var a = []; for (var i = 0; i < docA.layers.length; i++) { a.push(docA.layers[i].name + "[kind=" + docA.layers[i].kind + "]"); } return a.join(" / "); })()));
    layerDescriptor("A.activeLayer");
  } catch (e) { rec("EXEC", "removeBackground.postLayers", "FAIL", errOf(e)); }

  historyReport("A", docA);

  // ===================================================================
  // DOC B : DOM facts / fill layer / adjustment layers / mask / blur /
  //         imageSize / canvasSize / move / align
  // ===================================================================
  w("MARKER docB BEGIN");
  var docB = null;
  try {
    docB = newProbeDoc("dsh-probe-B");
    app.activeDocument = docB;
    paintEllipse(docB, "ProbeSubject", 60, 120, 220);
    rec("DOCB", "setup", "OK", "ellipse on layer ProbeSubject");
    docInfo("B", docB);
  } catch (e) { rec("DOCB", "setup", "FAIL", errOf(e)); }

  if (docB) {
    // --- solid color fill layer
    try {
      app.activeDocument = docB;
      var idMk = charIDToTypeID("Mk  ");
      var desc = new ActionDescriptor();
      var ref = new ActionReference();
      var idCL = stringIDToTypeID("contentLayer");
      ref.putClass(idCL);
      desc.putReference(charIDToTypeID("null"), ref);
      var d2 = new ActionDescriptor();
      var d3 = new ActionDescriptor();
      var d4 = new ActionDescriptor();
      d4.putDouble(charIDToTypeID("Rd  "), 250);
      d4.putDouble(charIDToTypeID("Grn "), 250);
      d4.putDouble(charIDToTypeID("Bl  "), 250);
      d3.putObject(charIDToTypeID("Clr "), charIDToTypeID("RGBC"), d4);
      d2.putObject(charIDToTypeID("Type"), stringIDToTypeID("solidColorLayer"), d3);
      desc.putObject(charIDToTypeID("Usng"), idCL, d2);
      app.executeAction(idMk, desc, DialogModes.NO);
      rec("EXEC", "solidColorLayer.make", "OK", "newLayerName=" + sq(docB.activeLayer.name) + " kind=" + sq(docB.activeLayer.kind));
    } catch (e) { rec("EXEC", "solidColorLayer.make", "FAIL", errOf(e)); }

    // --- 5 adjustment layers + candidate key-name sets
    w("MARKER adjustments BEGIN");
    try {
      app.activeDocument = docB;
      tryAdjustmentLayer("hueSaturation", "hueSaturation", [
        { label: "V1-presetKind+4keys", presetKind: "presetKindCustom", keys: [["hue", "int", 10], ["saturation", "int", 20], ["lightness", "int", 0], ["colorize", "bool", false]] },
        { label: "V2-4keys-noPreset", keys: [["hue", "int", -5], ["saturation", "int", -15], ["lightness", "int", 5], ["colorize", "bool", false]] }
      ]);
    } catch (e) { rec("ADJ", "hueSaturation.outer", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      tryAdjustmentLayer("brightnessContrast", "brightnessContrast", [
        { label: "V1-presetKind+3keys", presetKind: "presetKindCustom", keys: [["brightness", "int", 8], ["contrast", "int", 12], ["useLegacy", "bool", false]] },
        { label: "V2-2keys-noPreset", keys: [["brightness", "int", 3], ["contrast", "int", 4]] }
      ]);
    } catch (e) { rec("ADJ", "brightnessContrast.outer", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      tryAdjustmentLayer("photoFilter", "photoFilter", [
        { label: "V1-presetKind+filter+density+preserveLum", presetKind: "presetKindCustom", keys: [["filter", "rgbc", [236, 138, 0]], ["density", "percent", 25], ["preserveLuminosity", "bool", true]] },
        { label: "V2-density+preserveLum", keys: [["density", "percent", 15], ["preserveLuminosity", "bool", true]] }
      ]);
    } catch (e) { rec("ADJ", "photoFilter.outer", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      tryAdjustmentLayer("colorBalance", "colorBalance", [
        { label: "V1-presetKind+3levels+preserveLum", presetKind: "presetKindCustom", keys: [["shadowLevels", "levels", [5, 0, -5]], ["midtoneLevels", "levels", [3, 0, -3]], ["highlightLevels", "levels", [0, 0, 0]], ["preserveLuminosity", "bool", true]] },
        { label: "V2-3levels", keys: [["shadowLevels", "levels", [2, 0, -2]], ["midtoneLevels", "levels", [2, 0, -2]], ["highlightLevels", "levels", [1, 0, -1]]] }
      ]);
    } catch (e) { rec("ADJ", "colorBalance.outer", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      tryAdjustmentLayer("exposure", "exposure", [
        { label: "V1-presetKind+3keys", presetKind: "presetKindCustom", keys: [["exposure", "double", 0.25], ["offset", "double", 0.01], ["gammaCorrection", "double", 1.05]] },
        { label: "V2-exposure-only", keys: [["exposure", "double", -0.1]] }
      ]);
    } catch (e) { rec("ADJ", "exposure.outer", "FAIL", errOf(e)); }
    w("MARKER adjustments END");

    // --- layer mask creation + mask facts
    w("MARKER mask BEGIN");
    try {
      app.activeDocument = docB;
      var ml = findLayer(docB, "ProbeSubject");
      if (ml) { docB.activeLayer = ml; }
      rec("MASK", "preActiveLayer", "INFO", sq(docB.activeLayer.name));
      var idMk2 = charIDToTypeID("Mk  ");
      var md = new ActionDescriptor();
      var mref = new ActionReference();
      mref.putClass(charIDToTypeID("Chnl"));
      md.putReference(charIDToTypeID("null"), mref);
      var atref = new ActionReference();
      atref.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), stringIDToTypeID("mask"));
      md.putReference(charIDToTypeID("At  "), atref);
      md.putEnumerated(charIDToTypeID("Usng"), stringIDToTypeID("userMaskEnabled"), stringIDToTypeID("revealAll"));
      app.executeAction(idMk2, md, DialogModes.NO);
      rec("MASK", "make.revealAll", "OK", "applied to " + sq(docB.activeLayer.name));
    } catch (e) { rec("MASK", "make.revealAll", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      var ml2 = findLayer(docB, "ProbeSubject");
      if (ml2) { docB.activeLayer = ml2; }
      var ld = layerDescriptor("B.ProbeSubject-afterMask");
      if (ld) {
        var hk = stringIDToTypeID("hasUserMask");
        rec("MASK", "hasUserMask", "READ", ld.hasKey(hk) ? sq(ld.getBoolean(hk)) : "<key absent>");
        var uk = stringIDToTypeID("userMaskEnabled");
        rec("MASK", "userMaskEnabled", "READ", ld.hasKey(uk) ? sq(ld.getBoolean(uk)) : "<key absent>");
        // mask name via channel enumeration
        try {
          var mnames = [];
          for (var ci = 0; ci < docB.channels.length; ci++) { mnames.push(docB.channels[ci].name + "[kind=" + docB.channels[ci].kind + "]"); }
          rec("MASK", "doc.channels", "OK", "count=" + docB.channels.length + " | " + sq(mnames.join(" / ")));
        } catch (e5) { rec("MASK", "doc.channels", "FAIL", errOf(e5)); }
        // layer descriptor dump for mask sub-objects
        for (var mi = 0; mi < ld.count; mi++) {
          var mk = ld.getKey(mi);
          var mks;
          try { mks = typeIDToStringID(mk); } catch (e6) { mks = "?"; }
          if (mks.indexOf("mask") >= 0 || mks.indexOf("Mask") >= 0) {
            try { dumpDescKeys("B.maskField." + mks, ld.getObjectValue(mk)); } catch (e7) { rec("MASK", "maskField." + mks, "FAIL", errOf(e7)); }
          }
        }
      }
    } catch (e) { rec("MASK", "post-dump", "FAIL", errOf(e)); }
    w("MARKER mask END");

    // --- gaussianBlur on the pixel layer
    try {
      app.activeDocument = docB;
      var gl = findLayer(docB, "ProbeSubject");
      if (gl) { docB.activeLayer = gl; }
      var gd = new ActionDescriptor();
      gd.putUnitDouble(stringIDToTypeID("radius"), charIDToTypeID("#Pxl"), 6.0);
      app.executeAction(stringIDToTypeID("gaussianBlur"), gd, DialogModes.NO);
      rec("EXEC", "gaussianBlur[noNullRef]", "OK", "radius=6px on " + sq(docB.activeLayer.name));
    } catch (e) { rec("EXEC", "gaussianBlur[noNullRef]", "FAIL", errOf(e)); }

    // --- imageSize (AM + DOM)
    try {
      app.activeDocument = docB;
      var isd = new ActionDescriptor();
      isd.putUnitDouble(charIDToTypeID("Wdth"), charIDToTypeID("#Pxl"), 800);
      isd.putUnitDouble(charIDToTypeID("Hght"), charIDToTypeID("#Pxl"), 800);
      isd.putBoolean(charIDToTypeID("CnsP"), true);
      isd.putEnumerated(charIDToTypeID("Intr"), stringIDToTypeID("interpolationType"), stringIDToTypeID("bicubicSmoother"));
      app.executeAction(stringIDToTypeID("imageSize"), isd, DialogModes.NO);
      rec("EXEC", "imageSize[AM,900->800 constrain]", "OK", "now W=" + uv(docB.width) + " H=" + uv(docB.height));
    } catch (e) { rec("EXEC", "imageSize[AM,900->800 constrain]", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      docB.resizeImage(UnitValue(800, "px"), UnitValue(800, "px"), null, ResampleMethod.BICUBICSMOOTHER);
      rec("EXEC", "resizeImage[DOM,->800]", "OK", "now W=" + uv(docB.width) + " H=" + uv(docB.height));
    } catch (e) { rec("EXEC", "resizeImage[DOM,->800]", "FAIL", errOf(e)); }

    // --- canvasSize (AM + DOM)
    try {
      app.activeDocument = docB;
      var csd = new ActionDescriptor();
      csd.putUnitDouble(charIDToTypeID("Wdth"), charIDToTypeID("#Pxl"), 800);
      csd.putUnitDouble(charIDToTypeID("Hght"), charIDToTypeID("#Pxl"), 800);
      csd.putEnumerated(charIDToTypeID("Anch"), charIDToTypeID("Anch"), charIDToTypeID("MidC"));
      app.executeAction(stringIDToTypeID("canvasSize"), csd, DialogModes.NO);
      rec("EXEC", "canvasSize[AM,->800 MidC]", "OK", "now W=" + uv(docB.width) + " H=" + uv(docB.height));
    } catch (e) { rec("EXEC", "canvasSize[AM,->800 MidC]", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      docB.resizeCanvas(UnitValue(800, "px"), UnitValue(800, "px"), AnchorPosition.MIDDLECENTER);
      rec("EXEC", "resizeCanvas[DOM,->800 MidC]", "OK", "now W=" + uv(docB.width) + " H=" + uv(docB.height));
    } catch (e) { rec("EXEC", "resizeCanvas[DOM,->800 MidC]", "FAIL", errOf(e)); }

    // --- move layer by offset + align to canvas center
    w("MARKER move-align BEGIN");
    try {
      app.activeDocument = docB;
      var mvl = findLayer(docB, "ProbeSubject");
      if (mvl) { docB.activeLayer = mvl; }
      rec("MOVE", "before", "INFO", boundsStr(docB.activeLayer));
      var mv = new ActionDescriptor();
      var mrefA = new ActionReference();
      mrefA.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      mv.putReference(charIDToTypeID("null"), mrefA);
      var mrefB = new ActionReference();
      mrefB.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("fsel"));
      mv.putReference(stringIDToTypeID("to"), mrefB);
      mv.putBoolean(charIDToTypeID("PrgP"), true);
      var offd = new ActionDescriptor();
      offd.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), 40);
      offd.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), 25);
      mv.putObject(stringIDToTypeID("offset"), stringIDToTypeID("offset"), offd);
      app.executeAction(charIDToTypeID("move"), mv, DialogModes.NO);
      rec("MOVE", "move[withTo+offset+PrgP]", "OK", "after " + boundsStr(docB.activeLayer));
    } catch (e) { rec("MOVE", "move[withTo+offset+PrgP]", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      var mvl2 = findLayer(docB, "ProbeSubject");
      if (mvl2) { docB.activeLayer = mvl2; }
      var mvd = new ActionDescriptor();
      var mvra = new ActionReference();
      mvra.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      mvd.putReference(charIDToTypeID("null"), mvra);
      var offd2 = new ActionDescriptor();
      offd2.putUnitDouble(charIDToTypeID("Hrzn"), charIDToTypeID("#Pxl"), -40);
      offd2.putUnitDouble(charIDToTypeID("Vrtc"), charIDToTypeID("#Pxl"), -25);
      mvd.putObject(stringIDToTypeID("offset"), stringIDToTypeID("offset"), offd2);
      app.executeAction(charIDToTypeID("move"), mvd, DialogModes.NO);
      rec("MOVE", "move[offset-only]", "OK", "after " + boundsStr(docB.activeLayer));
    } catch (e) { rec("MOVE", "move[offset-only]", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      var alv = findLayer(docB, "ProbeSubject");
      if (alv) { docB.activeLayer = alv; }
      var ad = new ActionDescriptor();
      var aref = new ActionReference();
      aref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      ad.putReference(charIDToTypeID("null"), aref);
      ad.putEnumerated(charIDToTypeID("Algn"), charIDToTypeID("Algn"), charIDToTypeID("AdCH"));
      ad.putBoolean(stringIDToTypeID("alignToCanvas"), true);
      app.executeAction(charIDToTypeID("Algn"), ad, DialogModes.NO);
      rec("MOVE", "align[AdCH horizontal center]", "OK", "after " + boundsStr(docB.activeLayer));
    } catch (e) { rec("MOVE", "align[AdCH horizontal center]", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      var alv2 = findLayer(docB, "ProbeSubject");
      if (alv2) { docB.activeLayer = alv2; }
      var ad2 = new ActionDescriptor();
      var aref2 = new ActionReference();
      aref2.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      ad2.putReference(charIDToTypeID("null"), aref2);
      ad2.putEnumerated(charIDToTypeID("Algn"), charIDToTypeID("Algn"), charIDToTypeID("AdCV"));
      ad2.putBoolean(stringIDToTypeID("alignToCanvas"), true);
      app.executeAction(charIDToTypeID("Algn"), ad2, DialogModes.NO);
      rec("MOVE", "align[AdCV vertical center]", "OK", "after " + boundsStr(docB.activeLayer));
    } catch (e) { rec("MOVE", "align[AdCV vertical center]", "FAIL", errOf(e)); }

    try {
      app.activeDocument = docB;
      var alv3 = findLayer(docB, "ProbeSubject");
      if (alv3) { docB.activeLayer = alv3; }
      var ad3 = new ActionDescriptor();
      var aref3 = new ActionReference();
      aref3.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      ad3.putReference(charIDToTypeID("null"), aref3);
      ad3.putEnumerated(charIDToTypeID("Algn"), charIDToTypeID("Algn"), charIDToTypeID("AdCH"));
      app.executeAction(charIDToTypeID("Algn"), ad3, DialogModes.NO);
      rec("MOVE", "align[AdCH without alignToCanvas]", "OK", "after " + boundsStr(docB.activeLayer));
    } catch (e) { rec("MOVE", "align[AdCH without alignToCanvas]", "FAIL", errOf(e)); }
    w("MARKER move-align END");

    historyReport("B", docB);
  }

  // ===================================================================
  // DOC C : smart object + smart filters + export (duplicate/flatten/JPEG)
  // ===================================================================
  w("MARKER docC BEGIN");
  var docC = null;
  try {
    docC = newProbeDoc("dsh-probe-C");
    app.activeDocument = docC;
    paintEllipse(docC, "ProbeSubject", 40, 180, 90);
    rec("DOCC", "setup", "OK", "ellipse on layer ProbeSubject");
    docInfo("C", docC);
    layerDescriptor("C.ProbeSubject-beforeSO");
  } catch (e) { rec("DOCC", "setup", "FAIL", errOf(e)); }

  if (docC) {
    // --- newPlacedLayer -> smart object
    try {
      app.activeDocument = docC;
      var sl = findLayer(docC, "ProbeSubject");
      if (sl) { docC.activeLayer = sl; }
      app.executeAction(stringIDToTypeID("newPlacedLayer"), undefined, DialogModes.NO);
      var kindAfter = "";
      try { kindAfter = "" + docC.activeLayer.kind; } catch (e2) {}
      rec("EXEC", "newPlacedLayer", "OK", "layer=" + sq(docC.activeLayer.name) + " kind=" + kindAfter + " LayerKind.SMARTOBJECT=" + LayerKind.SMARTOBJECT + " isSmartObject=" + (kindAfter === ("" + LayerKind.SMARTOBJECT)));
    } catch (e) { rec("EXEC", "newPlacedLayer", "FAIL", errOf(e)); }
    layerDescriptor("C.ProbeSubject-asSO");

    // --- unSharpMask as smart filter, 2 descriptor variants
    w("MARKER smartfilter BEGIN");
    try {
      app.activeDocument = docC;
      var usd = new ActionDescriptor();
      var uref = new ActionReference();
      uref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      usd.putReference(charIDToTypeID("null"), uref);
      usd.putUnitDouble(stringIDToTypeID("amount"), charIDToTypeID("#Prc"), 80.0);
      usd.putUnitDouble(stringIDToTypeID("radius"), charIDToTypeID("#Pxl"), 1.0);
      usd.putInteger(stringIDToTypeID("threshold"), 2);
      app.executeAction(stringIDToTypeID("unSharpMask"), usd, DialogModes.NO);
      rec("EXEC", "unSharpMask[withNullRef]", "OK", "amount=80% radius=1px threshold=2");
    } catch (e) { rec("EXEC", "unSharpMask[withNullRef]", "FAIL", errOf(e)); }
    try { smartFilterReport("C.afterUSM"); } catch (e) { rec("SMARTFILTER", "C.afterUSM", "FAIL", errOf(e)); }
    historyReport("C.afterUSM", docC);

    try {
      app.activeDocument = docC;
      var usd2 = new ActionDescriptor();
      usd2.putUnitDouble(stringIDToTypeID("amount"), charIDToTypeID("#Prc"), 60.0);
      usd2.putUnitDouble(stringIDToTypeID("radius"), charIDToTypeID("#Pxl"), 1.5);
      usd2.putInteger(stringIDToTypeID("threshold"), 0);
      app.executeAction(stringIDToTypeID("unSharpMask"), usd2, DialogModes.NO);
      rec("EXEC", "unSharpMask[noNullRef]", "OK", "amount=60% radius=1.5px threshold=0");
    } catch (e) { rec("EXEC", "unSharpMask[noNullRef]", "FAIL", errOf(e)); }

    // --- reduceNoise as smart filter
    try {
      app.activeDocument = docC;
      var rnd = new ActionDescriptor();
      var rref = new ActionReference();
      rref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      rnd.putReference(charIDToTypeID("null"), rref);
      rnd.putInteger(stringIDToTypeID("quality"), 6);
      rnd.putDouble(stringIDToTypeID("strength"), 30);
      rnd.putBoolean(stringIDToTypeID("preserveDetails"), true);
      rnd.putDouble(stringIDToTypeID("reduceColorNoise"), 40);
      rnd.putDouble(stringIDToTypeID("sharpenDetails"), 20);
      app.executeAction(stringIDToTypeID("reduceNoise"), rnd, DialogModes.NO);
      rec("EXEC", "reduceNoise[withNullRef]", "OK", "quality=6 strength=30 preserveDetails=true reduceColorNoise=40 sharpenDetails=20");
    } catch (e) { rec("EXEC", "reduceNoise[withNullRef]", "FAIL", errOf(e)); }
    try { smartFilterReport("C.afterReduceNoise"); } catch (e) { rec("SMARTFILTER", "C.afterReduceNoise", "FAIL", errOf(e)); }
    historyReport("C.afterReduceNoise", docC);

    // --- smart object DOM property probe
    try {
      app.activeDocument = docC;
      var so = docC.activeLayer.smartObject;
      rec("SMARTFILTER", "DOM.smartObject", "OK", "typeof=" + (typeof so) + " keys=" + sq((function () { var a = []; for (var k in so) { a.push(k); } return a.join(","); })()));
    } catch (e) { rec("SMARTFILTER", "DOM.smartObject", "FAIL", errOf(e)); }
    w("MARKER smartfilter END");

    // --- export: duplicate -> flatten -> saveAs JPEG -> close
    w("MARKER export BEGIN");
    var expPath = OUTFOLDER.fsName + "/probe-export.jpg";
    var dup = null;
    var dupName = "";
    try {
      app.activeDocument = docC;
      dup = docC.duplicate("dsh-probe-export", false);
      dupName = dup.name;
      app.activeDocument = dup;
      rec("EXPORT", "duplicate", "OK", "name=" + sq(dup.name) + " layers=" + dup.layers.length);
    } catch (e) { rec("EXPORT", "duplicate", "FAIL", errOf(e)); }

    if (dup) {
      try { app.activeDocument = dup; dup.flatten(); rec("EXPORT", "flatten[DOM]", "OK", "layers=" + dup.layers.length); }
      catch (e) { rec("EXPORT", "flatten[DOM]", "FAIL", errOf(e)); }
      try { app.activeDocument = dup; app.executeAction(stringIDToTypeID("flattenImage"), undefined, DialogModes.NO); rec("EXPORT", "flattenImage[AM]", "OK", "layers=" + dup.layers.length); }
      catch (e) { rec("EXPORT", "flattenImage[AM]", "FAIL", errOf(e)); }

      for (var qi = 0; qi < 4; qi++) {
        var qval = [10, 12, 0, 13][qi];
        var label = "quality=" + qval + (qval === 13 ? "(out-of-range-control)" : "");
        try {
          app.activeDocument = dup;
          var jf = new File(expPath);
          if (jf.exists) { jf.remove(); }
          var jo = new JPEGSaveOptions();
          jo.quality = qval;
          jo.embedColorProfile = true;
          jo.formatOptions = FormatOptions.STANDARDBASELINE;
          jo.matte = MatteType.NONE;
          dup.saveAs(jf, jo, true);
          rec("EXPORT", "saveAs[JPEG " + label + "]", "OK", "path=" + sq(jf.fsName) + " exists=" + jf.exists + " bytes=" + jf.length);
        } catch (e) { rec("EXPORT", "saveAs[JPEG " + label + "]", "FAIL", errOf(e)); }
      }

      // saved-file facts
      try {
        var checkF = new File(expPath);
        rec("EXPORT", "finalFile", "OK", "exists=" + checkF.exists + " bytes=" + checkF.length);
      } catch (e) { rec("EXPORT", "finalFile", "FAIL", errOf(e)); }

      try { app.activeDocument = dup; dup.close(SaveOptions.DONOTSAVECHANGES); rec("EXPORT", "close[save=false]", "OK", "closed " + sq(dupName)); }
      catch (e) { rec("EXPORT", "close[save=false]", "FAIL", errOf(e)); }
    }
    w("MARKER export END");

    // --- placedLayerConvertToLayers (destroys the SO; last on purpose)
    try {
      app.activeDocument = docC;
      var pl = findLayer(docC, "ProbeSubject");
      if (pl) { docC.activeLayer = pl; }
      var pld = new ActionDescriptor();
      var plref = new ActionReference();
      plref.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt"));
      pld.putReference(charIDToTypeID("null"), plref);
      app.executeAction(stringIDToTypeID("placedLayerConvertToLayers"), pld, DialogModes.NO);
      rec("EXEC", "placedLayerConvertToLayers[withNullRef]", "OK", "layers now=" + docC.layers.length);
    } catch (e) { rec("EXEC", "placedLayerConvertToLayers[withNullRef]", "FAIL", errOf(e)); }
    try {
      app.activeDocument = docC;
      app.executeAction(stringIDToTypeID("placedLayerConvertToLayers"), undefined, DialogModes.NO);
      rec("EXEC", "placedLayerConvertToLayers[bare]", "OK", "layers now=" + docC.layers.length);
    } catch (e) { rec("EXEC", "placedLayerConvertToLayers[bare]", "FAIL", errOf(e)); }
  }
  w("MARKER docC END");
}
w("MARKER docA END");

// =====================================================================
// cleanup: close ONLY documents whose name starts with dsh-probe
// =====================================================================
w("MARKER cleanup BEGIN");
try {
  var victims = [];
  var vnames = [];
  for (var ci2 = 0; ci2 < app.documents.length; ci2++) {
    var dnm = app.documents[ci2].name;
    if (dnm.indexOf("dsh-probe") === 0) { victims.push(app.documents[ci2]); vnames.push(dnm); }
  }
  rec("CLEANUP", "targets", "INFO", "count=" + victims.length + " | " + sq(vnames.join(" / ")));
  for (var vi = 0; vi < victims.length; vi++) {
    try { victims[vi].close(SaveOptions.DONOTSAVECHANGES); rec("CLEANUP", "closed", "OK", sq(vnames[vi])); }
    catch (e) { rec("CLEANUP", "closed", "FAIL", sq(vnames[vi]) + " | " + errOf(e)); }
  }
} catch (e) { rec("CLEANUP", "enumerate", "FAIL", errOf(e)); }
try {
  if (ORIG_ACTIVE) { app.activeDocument = ORIG_ACTIVE; rec("CLEANUP", "restoreActiveDoc", "OK", sq(ORIG_ACTIVE.name)); }
} catch (e) { rec("CLEANUP", "restoreActiveDoc", "SKIP", errOf(e)); }

var POST_DOCS = [];
try { for (var pi = 0; pi < app.documents.length; pi++) { POST_DOCS.push(app.documents[pi].name); } } catch (e) {}
rec("CLEANUP", "postDocs", "INFO", "count=" + POST_DOCS.length + " | " + sq(POST_DOCS.join(" ;; ")));
rec("CLEANUP", "preDocsUnchanged", "INFO", "pre=" + sq(PRE_DOCS.join(" ;; ")));
w("MARKER cleanup END");

w("PROBE_END");
var _dshReturn = "DSH_PROBE_DONE";
_dshReturn;
