// ascii only. dsh probe: does suspendHistory (or the selection wrapper) block the setd background->layer conversion?
var f = new File(Folder.temp + "/dsh-suspend-unlock.txt");
f.encoding = "UTF-8";
f.open("w");
function w(s) { f.writeln(String(s)); }
function errOf(e) { try { return String(e.number || "") + " | " + String(e.message || e); } catch (x) { return String(e); } }
function mkDoc(nm) { return app.documents.add(new UnitValue(300, "px"), new UnitValue(200, "px"), 72, nm, NewDocumentMode.RGB, DocumentFill.WHITE); }
function st(tag, doc) {
  var l = doc.layers[0];
  return tag + " :: name=" + l.name + " id=" + l.id + " isBg=" + l.isBackgroundLayer + " pos=" + l.positionLocked;
}
function refId(id) { var r = new ActionReference(); r.putIdentifier(charIDToTypeID("Lyr "), id); return r; }
function toName(nm) { var d = new ActionDescriptor(); d.putString(charIDToTypeID("Nm  "), nm); return d; }
function setdDesc(id, nm) {
  var d = new ActionDescriptor();
  d.putReference(charIDToTypeID("null"), refId(id));
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), toName(nm));
  return d;
}
function plain(evt) {
  var d = new ActionDescriptor();
  app.executeAction(charIDToTypeID(evt), d, DialogModes.NO);
}
// globals used from inside suspendHistory's code string
var G_DOC = null;
var G_ID = 0;
function gSetd() { app.executeAction(charIDToTypeID("setd"), setdDesc(G_ID, "dsh-sus-bg"), DialogModes.NO); }

w("start docs=" + app.documents.length);

// A: baseline, no wrapper
try {
  var dA = mkDoc("dsh-susA");
  w("A before " + st("", dA));
  try { app.executeAction(charIDToTypeID("setd"), setdDesc(dA.layers[0].id, "dsh-A-bg"), DialogModes.NO); w("A setd NO-THROW"); } catch (e) { w("A setd THREW " + errOf(e)); }
  w("A after " + st("", dA));
} catch (eA) { w("A OUTER " + errOf(eA)); }

// B: setd INSIDE doc.suspendHistory (string form) -- emulates ps.run history:"suspend"
try {
  var dB = mkDoc("dsh-susB");
  G_DOC = dB; G_ID = dB.layers[0].id;
  w("B before " + st("", dB));
  try { dB.suspendHistory("dsh-suspend-test", "gSetd()"); w("B suspendHistory NO-THROW"); } catch (e) { w("B suspendHistory THREW " + errOf(e)); }
  w("B after " + st("", dB));
} catch (eB) { w("B OUTER " + errOf(eB)); }

// C: function form of suspendHistory (if supported)
try {
  var dC = mkDoc("dsh-susC");
  var idC = dC.layers[0].id;
  var cf = function () { app.executeAction(charIDToTypeID("setd"), setdDesc(idC, "dsh-C-bg"), DialogModes.NO); };
  w("C before " + st("", dC));
  try { dC.suspendHistory("dsh-suspend-fn", cf); w("C suspendHistory(fn) NO-THROW"); } catch (e) { w("C suspendHistory(fn) THREW " + errOf(e)); }
  w("C after " + st("", dC));
} catch (eC) { w("C OUTER " + errOf(eC)); }

// D: same action list as the plugin: saveDocumentSelection -> setd -> restoreDocumentSelection
try {
  var dD = mkDoc("dsh-susD");
  var idD = dD.layers[0].id;
  w("D before " + st("", dD));
  try {
    plain("saveDocumentSelection");
    app.executeAction(charIDToTypeID("setd"), setdDesc(idD, "dsh-D-bg"), DialogModes.NO);
    plain("restoreDocumentSelection");
    w("D seq(save/setd/restore) NO-THROW");
  } catch (e) { w("D seq THREW " + errOf(e)); }
  w("D after " + st("", dD));
} catch (eD) { w("D OUTER " + errOf(eD)); }

// E: convert via DOM then transform with the plugin's full descriptor (sanity)
try {
  var dE = mkDoc("dsh-susE");
  dE.layers[0].isBackgroundLayer = false;
  var d = new ActionDescriptor();
  d.putReference(charIDToTypeID("null"), refId(dE.layers[0].id));
  var inner = new ActionDescriptor();
  inner.putUnitDouble(charIDToTypeID("Angl"), charIDToTypeID("#Ang"), 5);
  inner.putEnumerated(charIDToTypeID("FTcs"), charIDToTypeID("QCSt"), charIDToTypeID("QCSAverage"));
  d.putObject(charIDToTypeID("T   "), charIDToTypeID("Trnf"), inner);
  try { app.executeAction(charIDToTypeID("Trnf"), d, DialogModes.NO); w("E transform NO-THROW bounds=" + dE.layers[0].bounds.join(",")); } catch (e) { w("E transform THREW " + errOf(e)); }
} catch (eE) { w("E OUTER " + errOf(eE)); }

try {
  for (var i = app.documents.length - 1; i >= 0; i--) {
    var dd = app.documents[i];
    if (String(dd.name).indexOf("dsh-") === 0) dd.close(SaveOptions.DONOTSAVECHANGES);
  }
  w("docsLeft=" + app.documents.length);
} catch (eZ) { w("cleanup THREW " + errOf(eZ)); }
f.close();
"probe2-done";
