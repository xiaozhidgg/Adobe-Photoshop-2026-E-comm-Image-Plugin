// ascii only. dsh probe: background-layer unlock routes.
var f = new File(Folder.temp + "/dsh-bg-unlock.txt");
f.encoding = "UTF-8";
f.open("w");
function w(s) { f.writeln(String(s)); }
function errOf(e) { try { return String(e.number || '') + " | " + String(e.message || e); } catch (x) { return String(e); } }
function mkDoc(nm) { return app.documents.add(new UnitValue(300, "px"), new UnitValue(200, "px"), 72, nm, NewDocumentMode.RGB, DocumentFill.WHITE); }
function st(tag, doc) {
  var l = doc.layers[0];
  return tag + " :: name=" + l.name + " id=" + l.id + " isBg=" + l.isBackgroundLayer + " pos=" + l.positionLocked + " all=" + l.allLocked;
}
function refId(id) { var r = new ActionReference(); r.putIdentifier(charIDToTypeID("Lyr "), id); return r; }
function refTrgt() { var r = new ActionReference(); r.putEnumerated(charIDToTypeID("Lyr "), charIDToTypeID("Ordn"), charIDToTypeID("Trgt")); return r; }
function toName(nm) { var d = new ActionDescriptor(); d.putString(charIDToTypeID("Nm  "), nm); return d; }

w("start docs=" + app.documents.length);
try {
  var dA = mkDoc("dsh-setdA");
  var idA = dA.layers[0].id;
  w("A before " + st("", dA));
  var d1 = new ActionDescriptor();
  d1.putReference(charIDToTypeID("null"), refId(idA));
  d1.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), toName("dsh-bg-id"));
  try { app.executeAction(charIDToTypeID("setd"), d1, DialogModes.NO); w("A setd id-ref NO-THROW"); } catch (e) { w("A setd id-ref THREW " + errOf(e)); }
  w("A after " + st("", dA));
} catch (eA) { w("A OUTER THREW " + errOf(eA)); }

try {
  var dB = mkDoc("dsh-setdB");
  dB.activeLayer = dB.layers[0];
  w("B before " + st("", dB));
  var d2 = new ActionDescriptor();
  d2.putReference(charIDToTypeID("null"), refTrgt());
  d2.putObject(charIDToTypeID("T   "), charIDToTypeID("Lyr "), toName("dsh-bg-trgt"));
  try { app.executeAction(charIDToTypeID("setd"), d2, DialogModes.NO); w("B setd trgt-ref NO-THROW"); } catch (e) { w("B setd trgt-ref THREW " + errOf(e)); }
  w("B after " + st("", dB));
  var d3 = new ActionDescriptor();
  d3.putReference(charIDToTypeID("null"), refTrgt());
  var t3 = new ActionDescriptor();
  t3.putUnitDouble(charIDToTypeID("Angl"), charIDToTypeID("#Ang"), 5);
  d3.putObject(charIDToTypeID("T   "), charIDToTypeID("Trnf"), t3);
  try { app.executeAction(charIDToTypeID("Trnf"), d3, DialogModes.NO); w("B2 transform NO-THROW bounds=" + dB.layers[0].bounds.join(",")); } catch (e) { w("B2 transform THREW " + errOf(e)); }
} catch (eB) { w("B OUTER THREW " + errOf(eB)); }

try {
  var dC = mkDoc("dsh-setdC");
  w("C before " + st("", dC));
  try { dC.layers[0].isBackgroundLayer = false; w("C dom flag NO-THROW"); } catch (e) { w("C dom flag THREW " + errOf(e)); }
  w("C after " + st("", dC));
} catch (eC) { w("C OUTER THREW " + errOf(eC)); }

try {
  for (var i = app.documents.length - 1; i >= 0; i--) {
    var dd = app.documents[i];
    if (String(dd.name).indexOf("dsh-") === 0) dd.close(SaveOptions.DONOTSAVECHANGES);
  }
  w("docsLeft=" + app.documents.length);
} catch (eZ) { w("cleanup THREW " + errOf(eZ)); }
f.close();
"probe-done";
