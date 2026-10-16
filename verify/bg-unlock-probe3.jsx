// ascii only. dsh probe3: is the UXP descriptor JSON itself rejected, or the UXP runtime?
var f = new File(Folder.temp + "/dsh-batchplay-unlock.txt");
f.encoding = "UTF-8";
f.open("w");
function w(s) { f.writeln(String(s)); }
function errOf(e) { try { return String(e.number || "") + " | " + String(e.message || e); } catch (x) { return String(e); } }
function mkDoc(nm) { return app.documents.add(new UnitValue(300, "px"), new UnitValue(200, "px"), 72, nm, NewDocumentMode.RGB, DocumentFill.WHITE); }
function st(tag, doc) {
  var out = [];
  for (var i = 0; i < Math.min(doc.layers.length, 3); i++) {
    var l = doc.layers[i];
    out.push("#" + i + " name=" + l.name + " id=" + l.id + " isBg=" + l.isBackgroundLayer + " pos=" + l.positionLocked);
  }
  return tag + " :: " + out.join(" ] [ ") + " ]";
}
var G_ID = 0;
var G_JSON = "";
function gBatch() { return app.batchPlay(G_JSON, {}); }
function gSetd() {
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putIdentifier(charIDToTypeID("Lyr "), G_ID);
  d.putReference(charIDToTypeID("null"), r);
  var t = new ActionDescriptor();
  t.putString(charIDToTypeID("Nm  "), "dsh-bp-bg");
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), t);
  app.executeAction(charIDToTypeID("setd"), d, DialogModes.NO);
}

w("start docs=" + app.documents.length);
w("typeof app.batchPlay = " + (typeof app.batchPlay));

// A: the exact UXP descriptor via app.batchPlay (if available)
try {
  var dA = mkDoc("dsh-bpA");
  G_ID = dA.layers[0].id;
  w("A before " + st("", dA));
  if (typeof app.batchPlay === "function") {
    var json = JSON.stringify([{ _obj: "set", _target: [{ _ref: "layer", _id: G_ID }], to: { _obj: "layer", name: "dsh-bp-bg" } }]);
    try {
      var res = app.batchPlay(json, {});
      w("A batchPlay NO-THROW res=" + String(res).substring(0, 300));
    } catch (e) { w("A batchPlay THREW " + errOf(e)); }
  } else {
    w("A batchPlay not available");
  }
  w("A after " + st("", dA));
} catch (eA) { w("A OUTER " + errOf(eA)); }

// B: same JSON but inside suspendHistory (string form), emulating ps.runOnce
try {
  var dB = mkDoc("dsh-bpB");
  G_ID = dB.layers[0].id;
  G_JSON = JSON.stringify([{ _obj: "saveDocumentSelection" },
    { _obj: "set", _target: [{ _ref: "layer", _id: G_ID }], to: { _obj: "layer", name: "dsh-bp-sus" } },
    { _obj: "restoreDocumentSelection" }]);
  w("B before " + st("", dB));
  try { dB.suspendHistory("dsh-ecom-test", "gBatch()"); w("B suspendHistory NO-THROW"); } catch (e) { w("B suspendHistory THREW " + errOf(e)); }
  w("B after " + st("", dB));
} catch (eB) { w("B OUTER " + errOf(eB)); }

// C: fallback route -- duplicate the background layer (copy should be an ordinary layer)
try {
  var dC = mkDoc("dsh-bpC");
  var idC = dC.layers[0].id;
  w("C before " + st("", dC));
  var d = new ActionDescriptor();
  var r = new ActionReference();
  r.putIdentifier(charIDToTypeID("Lyr "), idC);
  d.putReference(charIDToTypeID("null"), r);
  d.putString(charIDToTypeID("Nm  "), "dsh-dup");
  try { app.executeAction(charIDToTypeID("Dplc"), d, DialogModes.NO); w("C duplicate NO-THROW"); } catch (e) { w("C duplicate THREW " + errOf(e)); }
  w("C after " + st("", dC));
} catch (eC) { w("C OUTER " + errOf(eC)); }

try {
  for (var i = app.documents.length - 1; i >= 0; i--) {
    var dd = app.documents[i];
    if (String(dd.name).indexOf("dsh-") === 0) dd.close(SaveOptions.DONOTSAVECHANGES);
  }
  w("docsLeft=" + app.documents.length);
} catch (eZ) { w("cleanup THREW " + errOf(eZ)); }
f.close();
"probe3-done";
