/**
 * =========================================================================
 * TABLERO DE CONVOCATORIAS 2027 EN FIRESTORE (PNCM)
 * =========================================================================
 * Publica en Firestore el avance de los procesos de adquisición de alimentos
 * 2027 que registran las especialistas en nutrición en esta herramienta. La
 * página https://nutricion-utai.github.io/tablero-convocatorias-2027/ lo lee
 * y se actualiza sola, al instante, con cada guardado.
 *
 * Cómo funciona
 *   - Cada vez que la herramienta guarda un proceso (escribirProceso_), la
 *     línea tcPublicarProceso_(proc, usuario) publica ese proceso: avance de
 *     los 12 pasos, cronograma, resultados por paquete y precios adjudicados.
 *     Si Firestore no responde, el guardado sigue normal: el error queda
 *     anotado y la sincronización de cada hora lo corrige.
 *   - Al eliminar un proceso, tcRetirarProceso_(p, usuario) lo quita.
 *   - Los procesos de prueba no se publican (y se retiran si cambian a prueba).
 *   - Un activador revisa cada hora todos los procesos y corrige diferencias
 *     (cambios hechos a mano en la base, usuarios, sectorización).
 *   - Los RUC de personas naturales (que empiezan con 10) no se publican.
 *
 * Dónde escribe (proyecto Firebase "tablero-envios-pncm", el mismo del
 * tablero de envíos):
 *   conv2027/meta                      UT/OCT, sectorización y feriados
 *   conv2027/vivo                      últimos registros (aviso en vivo)
 *   conv2027/datos/procesos/{id}       un documento por proceso real
 *   conv2027/datos/precios/{id}        precios adjudicados del proceso
 * Las reglas de Firestore solo dejan leer conv2027 con la clave del tablero
 * (usuario lector de Firebase Authentication). Estas escrituras no pasan por
 * esas reglas porque van con la cuenta del propietario.
 *
 * Requisitos (una sola vez)
 *   - appsscript.json debe incluir el permiso
 *       https://www.googleapis.com/auth/datastore
 *   - Dos líneas en el código de la herramienta (ver INSTALACION.md).
 *
 * Funciones para ejecutar desde el editor
 *   tcProbarConexion()        escribe y lee un documento de prueba
 *   tcInstalarTablero()       activa la publicación, crea el activador de cada
 *                             hora y publica todo por primera vez
 *   tcSincronizarTodo()       vuelve a publicar todo lo que cambió
 *   tcDiagnosticoTablero()    muestra en el registro el estado de la publicación
 *   tcQuitarTablero()         detiene la publicación y quita el activador
 *                             (no borra lo publicado)
 *   tcBorrarTablero()         borra todo lo publicado en conv2027
 * =========================================================================
 */

var TC = {
  PROYECTO: 'tablero-envios-pncm',
  RAIZ: 'conv2027',
  SECTORISTA_RESTO: 'Luis Enrique Gutiérrez López',   // UT/OCT sin sectorista registrado en USUARIOS
  VIVO_MAX: 40,                                         // registros que muestra el aviso en vivo
  TIEMPO_MAX_MS: 240000,                                // la sincronización se detiene antes del límite de 6 minutos
  LOTE_BYTES: 3000000                                   // tamaño máximo aproximado de cada envío a Firestore
};
var TC_BASE = 'https://firestore.googleapis.com/v1/projects/' + TC.PROYECTO + '/databases/(default)/documents';

// ====================================================================== líneas que llama la herramienta

/** Publica un proceso recién guardado. Nunca lanza errores: el guardado de la herramienta no debe fallar por esto. */
function tcPublicarProceso_(proc, usuario) {
  try {
    if (!tcActivo_() || !proc || !proc.id) return;
    var cambios;
    if (tcEsPrueba_(proc)) cambios = tcBorrarDocs_(proc.id);
    else {
      var b = tcConstruir_(proc, proc._idx || null, tcContexto_());
      cambios = tcCambiosDe_(b);
      cambios.push(tcEvento_({ id: proc.id, ut: b.doc.utn, z: b.doc.zona, m: b.doc.mod, c: b.doc.conv,
        a: Number(proc.version) === 1 ? 'Registró el proceso' : tcTextoAvance_(b.doc), u: tcNombreUsuario_(usuario) }));
    }
    tcLote_(cambios, 1);
  } catch (e) { tcError_('Publicar ' + (proc && proc.id), e); }
}

/** Quita del tablero un proceso eliminado. Nunca lanza errores. */
function tcRetirarProceso_(p, usuario) {
  try {
    if (!tcActivo_() || !p || !p.id) return;
    var cambios = tcBorrarDocs_(p.id);
    if (!tcEsPrueba_(p)) cambios.push(tcEvento_({ id: p.id, ut: p.utNombre || p.ut, z: p.zona, m: p.modalidad, c: p.convocatoria,
      a: 'Eliminó el proceso', u: tcNombreUsuario_(usuario) }));
    tcLote_(cambios, 1);
  } catch (e) { tcError_('Retirar ' + (p && p.id), e); }
}

// ====================================================================== funciones para el editor

function tcProbarConexion() {
  var ruta = TC.RAIZ + '/prueba';
  var hora = Utilities.formatDate(new Date(), 'America/Lima', "yyyy-MM-dd'T'HH:mm:ss");
  tcLote_([{ ruta: ruta, datos: { d: JSON.stringify({ hora: hora }), t: hora } }], 3);
  var leido = tcPedir_('get', TC_BASE + '/' + tcRuta_(ruta), undefined, 3);
  tcLote_([{ ruta: ruta, borrar: true }], 3);
  console.log(leido ? 'Conexión correcta con Firestore (' + TC.PROYECTO + '). Escrito y leído a las ' + hora + '.' : 'No se pudo leer el documento de prueba.');
}

function tcInstalarTablero() {
  prop_('TC_ACTIVO', 'Sí');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tcSincronizarTodo') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('tcSincronizarTodo').timeBased().everyHours(1).create();
  var r = tcSincronizarTodo();
  console.log('Tablero instalado: la herramienta publica cada guardado y revisa todo cada hora. ' + JSON.stringify(r));
}

function tcQuitarTablero() {
  prop_('TC_ACTIVO', 'No');
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'tcSincronizarTodo') ScriptApp.deleteTrigger(t); });
  console.log('Publicación detenida y activador quitado. Lo ya publicado sigue en Firestore (para borrarlo: tcBorrarTablero).');
}

function tcBorrarTablero() {
  var cambios = [];
  ['procesos', 'precios'].forEach(function (c) {
    tcListar_(TC.RAIZ + '/datos/' + c).forEach(function (d) { cambios.push({ ruta: TC.RAIZ + '/datos/' + c + '/' + d.id, borrar: true }); });
  });
  ['meta', 'vivo', 'estado'].forEach(function (n) { cambios.push({ ruta: TC.RAIZ + '/' + n, borrar: true }); });
  tcLote_(cambios, 3);
  try { PropertiesService.getScriptProperties().deleteProperty('TC_VIVO'); } catch (e) { }
  console.log('Se borraron ' + cambios.length + ' documentos del tablero.');
}

function tcDiagnosticoTablero() {
  var procs = tcListar_(TC.RAIZ + '/datos/procesos'), precios = tcListar_(TC.RAIZ + '/datos/precios');
  var reales = indiceProcesos_().filter(function (p) { return !tcEsPrueba_(p); });
  var activ = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'tcSincronizarTodo'; }).length;
  console.log([
    'Publicación activa: ' + (tcActivo_() ? 'sí' : 'no'),
    'Activador de cada hora: ' + (activ ? 'sí' : 'no'),
    'Procesos reales en la base: ' + reales.length,
    'Procesos publicados: ' + procs.length + ' (con precios adjudicados: ' + precios.length + ')',
    'Última sincronización completa: ' + (prop_('TC_ULTIMA_SINC') || 'ninguna'),
    'Último error: ' + (prop_('TC_ULTIMO_ERROR') || 'ninguno')
  ].join('\n'));
}

/**
 * Revisa todos los procesos y publica solo lo que cambió. La lectura y el cálculo se hacen sin bloquear la herramienta;
 * solo la escritura final toma el bloqueo un momento y descarta los procesos que alguien guardó mientras tanto
 * (esos ya los publicó su propio guardado).
 */
function tcSincronizarTodo() {
  var t0 = Date.now(), ctx = tcContexto_(true), err = 0, construidos = {}, incompleta = false;
  var indice = indiceProcesos_();
  for (var i = 0; i < indice.length; i++) {
    var x = indice[i];
    if (tcEsPrueba_(x) || !x.archivo_id) continue;
    if (Date.now() - t0 > TC.TIEMPO_MAX_MS) { incompleta = true; break; }
    try {
      var proc = JSON.parse(DriveApp.getFileById(x.archivo_id).getBlob().getDataAsString('UTF-8'));
      try { Calc.normalizarPaquetes(proc); } catch (e) { }
      try { Calc.fijarDosificaciones(proc, catalogo_().maestra); } catch (e) { }
      var idx = { actos: '', crono_inicio: '', crono_fin: '' };
      resumenIndice_(proc, idx);
      construidos[x.id] = tcConstruir_(proc, idx, ctx);
    } catch (e) { err++; console.warn('Sincronización, proceso ' + x.id + ': ' + e.message); }
  }
  // lo que ya está publicado (huella y versión), para escribir solo lo que cambió
  var pub = {}, pubPre = {};
  tcListar_(TC.RAIZ + '/datos/procesos', ['h', 'v']).forEach(function (d) { pub[d.id] = d; });
  tcListar_(TC.RAIZ + '/datos/precios', ['h']).forEach(function (d) { pubPre[d.id] = d; });
  var meta = tcMeta_(ctx), metaPub = tcPedir_('get', TC_BASE + '/' + tcRuta_(TC.RAIZ + '/meta') + '?mask.fieldPaths=h', undefined, 3);
  var res = { escritos: 0, retirados: 0, sinCambio: 0, errores: err, incompleta: incompleta };
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    // versión vigente de cada proceso en este momento (dentro del bloqueo nadie más guarda)
    var vig = {};
    indiceProcesos_().forEach(function (p) { if (!tcEsPrueba_(p)) vig[p.id] = Number(p.version) || 0; });
    var cambios = [];
    Object.keys(construidos).forEach(function (id) {
      var b = construidos[id];
      if (!(id in vig) || vig[id] !== b.doc.ver) return;   // se guardó o se eliminó mientras tanto
      var h = pub[id] ? tcCampo_(pub[id].fields, 'h') : null, hp = pubPre[id] ? tcCampo_(pubPre[id].fields, 'h') : null;
      var pre = tcCambiosDe_(b).filter(function (c) {
        if (/\/procesos\//.test(c.ruta)) return h !== c.datos.h;
        return c.borrar ? !!pubPre[id] : hp !== c.datos.h;
      });
      if (pre.length) { cambios = cambios.concat(pre); res.escritos++; } else res.sinCambio++;
    });
    if (!incompleta) {
      Object.keys(pub).forEach(function (id) { if (!(id in vig)) { cambios = cambios.concat(tcBorrarDocs_(id)); res.retirados++; } });
      Object.keys(pubPre).forEach(function (id) { if (!(id in vig) && pub[id] === undefined) cambios.push({ ruta: TC.RAIZ + '/datos/precios/' + id, borrar: true }); });
    }
    if (!metaPub || tcCampo_(metaPub.fields, 'h') !== meta.h) cambios.push({ ruta: TC.RAIZ + '/meta', datos: meta });
    var ahora = tcAhora_();
    cambios.push({ ruta: TC.RAIZ + '/estado', datos: { d: JSON.stringify({ sinc: ahora, procesos: Object.keys(vig).length, incompleta: incompleta }), t: ahora } });
    tcLote_(cambios, 3);
    prop_('TC_ULTIMA_SINC', ahora + ' · ' + JSON.stringify(res));
  } finally { lock.releaseLock(); }
  return res;
}

// ====================================================================== armado de los documentos

/** Datos de apoyo: nombres de los usuarios, sectorización, orden de grupos y feriados. */
function tcContexto_(fresco) {
  var cache = CacheService.getScriptCache(), c = fresco ? null : cache.get('tc_ctx');
  if (c) { try { return tcConOg_(JSON.parse(c)); } catch (e) { } }
  var usuarios = {}, sect = {};
  leerTabla_('USUARIOS').forEach(function (u) {
    var correo = normCorreo_(u.correo);
    if (correo) usuarios[correo] = String(u.nombre || '').trim();
    if (String(u.activo) !== 'No' && rolDe_(u.rol) === 'SECTORISTA')
      utsDeTexto_(u.uts).forEach(function (ut) { sect[ut] = String(u.nombre || '').trim(); });
  });
  var cat = catalogo_();
  var ctx = { usuarios: usuarios, sect: sect, feriados: cat.feriados || [], anio: cat.anio || 2027 };
  try { cache.put('tc_ctx', JSON.stringify(ctx), 600); } catch (e) { }
  return tcConOg_(ctx);
}
function tcConOg_(ctx) { ctx.og = ordenGrupos_(); return ctx; }

/** Documento conv2027/meta: UT/OCT con su sectorista, feriados y datos generales. */
function tcMeta_(ctx) {
  var uts = leerTabla_('UT').filter(function (u) { return String(u.activo) !== 'No'; }).map(function (u) {
    var cod = String(u.codigo).toUpperCase();
    return { c: cod, n: String(u.nombre || cod), t: String(u.tipo || ''), s: ctx.sect[cod] || TC.SECTORISTA_RESTO };
  });
  var datos = { uts: uts, fer: ctx.feriados, anio: ctx.anio, ver: typeof APP_VERSION === 'string' ? APP_VERSION : '' };
  var d = JSON.stringify(datos);
  return { d: d, h: tcHash_(d), t: tcAhora_() };
}

/**
 * Arma el documento del proceso y el de sus precios a partir del proceso (JSON) y su resumen de índice (idx).
 * Los resultados y los precios se calculan igual que en actualizarConsolidados_ (hojas RESULTADOS y ADJUDICADOS).
 */
function tcConstruir_(proc, idx, ctx) {
  idx = idx || {};
  if (!idx.paso && !idx.n_cg) { idx = Object.assign({}, idx); resumenIndice_(proc, idx); }
  var og = ctx.og, mod = proc.modalidad, af = mod === 'AF';
  var nombrePaq = function (cod) { try { return nombrePaquete_(proc, cod); } catch (e) { return ''; } };
  var ruc = function (r) { r = String(r || '').trim(); return /^10/.test(r) ? '' : r; };
  var num = function (v) { var n = Number(v); return v === '' || v === null || v === undefined || !isFinite(n) ? null : n; };

  // avance de los 12 pasos (sin la herramienta de menú)
  var pasos = {}, pr = null;
  try { pr = Calc.progresoProceso(proc, { feriados: ctx.feriados, og: og }); } catch (e) { }
  Calc.PASOS_PROCESO.forEach(function (k) {
    if (k === 'herramienta') return;
    var x = pr && pr.pasos[k];
    pasos[k] = x ? [x.ok ? 1 : 0, x.datos ? 1 : 0] : [0, 0];
  });

  // resultados por paquete (prelación en convocatoria pública; postores en agricultura familiar)
  var res = [];
  try {
    Calc.gruposEvaluacion(proc).forEach(function (g) {
      var ev = Calc.evaluar(proc, g.clave, og);
      var np = g.paquetes.map(nombrePaq).filter(String).join(' / ');
      (af ? ev.postores : ev.prelacion).forEach(function (p) {
        res.push({ p: g.clave, np: np, n: p.n, nom: String(p.nombre || ''), ruc: ruc(p.ruc), pf: af ? null : num(p.precioFinal),
          r: String(p.resultado || ''), o: af ? null : num(p.orden), s: !af && ev.firma === p.n ? 1 : 0 });
      });
    });
  } catch (e) { console.warn('Resultados de ' + proc.id + ': ' + e.message); }

  // precios adjudicados (mismas filas que ADJUDICADOS)
  var filas = [];
  try {
    Calc.exportarProceso(proc, og).filas.forEach(function (f) {
      if (f.precio === null) return;
      filas.push([f.paquete || '', f.nombreConv || '', f.alimento || '', f.envase || '', f.presentacion || '', f.unidad || '', num(f.precio), f.proveedor || '', ruc(f.ruc)]);
    });
  } catch (e) { console.warn('Precios de ' + proc.id + ': ' + e.message); }

  var resPaq = {};
  String(idx.resultado || '').split(/\s+/).filter(String).forEach(function (x) { var y = x.split(':'); if (y[0]) resPaq[y[0]] = y[1] || ''; });
  var actos = String(idx.actos || '').split('|').filter(String).map(function (x) { var y = x.split('~'); return [y[0] || '', y[1] || '']; });
  var c = proc.crono || {}, reprog = false;
  try { reprog = Calc.reprogramado(c); } catch (e) { }
  var paqs = (proc.paquetes || []).filter(function (p) { return (proc.lineas || []).some(function (l) { return l.paquete === p.codigo; }); })
    .map(function (p) { return { c: p.codigo, n: nombrePaq(p.codigo) }; });
  if (!paqs.length) Calc.gruposEvaluacion(proc).forEach(function (g) { paqs.push({ c: g.clave, n: g.paquetes.map(nombrePaq).filter(String).join(' / ') }); });

  var doc = {
    id: proc.id, ut: String(proc.ut || ''), utn: String(proc.utNombre || proc.ut || ''), mod: mod, conv: String(proc.convocatoria || ''), zona: String(proc.zona || ''),
    prov: String(proc.provincias || ''), dist: String(proc.distritos || ''),
    est: String(proc.estado || 'En elaboración'), estM: String(proc.estadoMotivo || ''), estAuto: proc.estadoAuto !== false,
    ini: String(idx.crono_inicio || ''), fin: String(idx.crono_fin || ''), actos: actos,
    reprog: reprog ? 1 : 0, reprogM: reprog ? String(c.motivoReprog || '') : '', reprogF: reprog ? String(c.fechaReprog || '') : '',
    ncg: Number(idx.n_cg) || 0, nsa: Number(idx.n_sa) || 0, nin: Number(idx.ninos) || 0, nali: (proc.lineas || []).length, npos: Number(idx.n_postores) || 0,
    resPaq: resPaq, paso: String(idx.paso || ''), pasosOk: Number(idx.pasos_ok) || 0, pend: String(idx.pendiente || ''), pasos: pasos,
    esp: ctx.usuarios[normCorreo_(proc.propietario)] || '', cre: String(proc.creado || ''), act: String(proc.actualizado || ''), ver: Number(proc.version) || 0,
    fEval: String(proc.fechaEval || ''), paqs: paqs, res: res, nAdj: filas.length
  };
  var d = JSON.stringify(doc), ahora = tcAhora_();
  var out = { doc: doc, proc: { d: d, h: tcHash_(d), v: doc.ver, t: ahora }, precios: null };
  if (filas.length) {
    var dp = JSON.stringify({ id: doc.id, ut: doc.ut, utn: doc.utn, mod: mod, conv: doc.conv, zona: doc.zona, act: doc.act, f: filas });
    out.precios = { d: dp, h: tcHash_(dp), t: ahora };
  }
  return out;
}

/** Escrituras de un proceso armado: su documento y el de precios (o el borrado de precios si ya no tiene). */
function tcCambiosDe_(b) {
  var id = b.doc.id, r = [{ ruta: TC.RAIZ + '/datos/procesos/' + id, datos: b.proc }];
  r.push(b.precios ? { ruta: TC.RAIZ + '/datos/precios/' + id, datos: b.precios } : { ruta: TC.RAIZ + '/datos/precios/' + id, borrar: true });
  return r;
}
function tcBorrarDocs_(id) {
  return [{ ruta: TC.RAIZ + '/datos/procesos/' + id, borrar: true }, { ruta: TC.RAIZ + '/datos/precios/' + id, borrar: true }];
}

/** Agrega un registro al aviso en vivo (últimos TC.VIVO_MAX) y devuelve la escritura del documento conv2027/vivo. */
function tcEvento_(e) {
  e.t = tcAhora_();
  var props = PropertiesService.getScriptProperties(), lista = [];
  try { lista = JSON.parse(props.getProperty('TC_VIVO') || '[]'); } catch (x) { lista = []; }
  lista.unshift(e);
  lista = lista.slice(0, TC.VIVO_MAX);
  var d = JSON.stringify(lista);
  while (d.length > 8500 && lista.length > 5) { lista.pop(); d = JSON.stringify(lista); }
  props.setProperty('TC_VIVO', d);
  return { ruta: TC.RAIZ + '/vivo', datos: { d: d, t: e.t } };
}
var TC_PASOS = { zona: '7.1.1 Zona o CG', paquete: '7.1.2 Paquete de alimentos', crono: '7.1.3 Cronograma', repres: '7.1.6 Representantes',
  conv: 'Convocatoria o invitación', recep: 'Presentación de propuestas', verif: 'Verificación preliminar', doc: 'Evaluación documentaria',
  alm: 'Evaluación de almacenes', cot: 'Evaluación de cotizaciones', res: 'Resultados', acta: 'Acta de compromiso', herramienta: 'Lista para la herramienta de menú' };
function tcTextoAvance_(doc) {
  if (/Adjudicado|Desierto|Cancelado/.test(doc.est)) return 'Actualizó el proceso (' + doc.est.toLowerCase() + ')';
  return 'Actualizó: ' + (TC_PASOS[doc.paso] || doc.paso || 'registro') + ' · ' + doc.pasosOk + ' de 12 pasos';
}

// ====================================================================== utilidades

function tcActivo_() { return String(prop_('TC_ACTIVO') || '') === 'Sí'; }
function tcEsPrueba_(p) { return !!p && (p.prueba === true || String(p.prueba) === 'Sí'); }
function tcNombreUsuario_(u) { return String(u || '').replace(/\s*<[^>]*>\s*$/, '').trim(); }
function tcAhora_() { return Utilities.formatDate(new Date(), 'America/Lima', "yyyy-MM-dd'T'HH:mm:ss"); }
function tcHash_(txt) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, txt, Utilities.Charset.UTF_8)); }
function tcError_(donde, e) {
  var m = tcAhora_() + ' · ' + donde + ': ' + (e && e.message || e);
  console.warn('Tablero de convocatorias: ' + m);
  try { prop_('TC_ULTIMO_ERROR', m.slice(0, 500)); } catch (x) { }
}
function tcCampo_(fields, k) { var f = (fields || {})[k]; return f ? (f.stringValue !== undefined ? f.stringValue : f.integerValue !== undefined ? Number(f.integerValue) : null) : null; }

function tcValor_(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return isFinite(v) ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v }) : { nullValue: null };
  return { stringValue: String(v) };
}
function tcCampos_(obj) { var f = {}; Object.keys(obj || {}).forEach(function (k) { if (obj[k] !== undefined) f[k] = tcValor_(obj[k]); }); return f; }
function tcRuta_(ruta) { return String(ruta).split('/').map(encodeURIComponent).join('/'); }

/** Pide a la API REST de Firestore con la cuenta del propietario. intentos: 1 en los guardados (rápido), 3 en la sincronización. */
function tcPedir_(metodo, url, cuerpo, intentos) {
  var op = { method: metodo, contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'X-Goog-User-Project': TC.PROYECTO } };
  if (cuerpo !== undefined) op.payload = JSON.stringify(cuerpo);
  var r = null;
  for (var i = 1; i <= (intentos || 1); i++) {
    r = UrlFetchApp.fetch(url, op);
    var c = r.getResponseCode();
    if (c < 500 && c !== 429) break;
    if (i < intentos) Utilities.sleep(700 * i);
  }
  var cod = r.getResponseCode(), txt = r.getContentText();
  if (cod === 404 && metodo === 'get') return null;
  if (cod >= 300) throw new Error('Firestore respondió ' + cod + ': ' + txt.substring(0, 400));
  return txt ? JSON.parse(txt) : {};
}

/** Escribe y borra documentos en operaciones atómicas (hasta 450 escrituras y ~3 MB por operación). */
function tcLote_(cambios, intentos) {
  var raiz = 'projects/' + TC.PROYECTO + '/databases/(default)/documents/', grupo = [], largo = 0;
  var enviar = function () {
    if (!grupo.length) return;
    tcPedir_('post', TC_BASE + ':commit', { writes: grupo }, intentos);
    grupo = []; largo = 0;
  };
  (cambios || []).forEach(function (c) {
    var nombre = raiz + tcRuta_(c.ruta);
    var w = c.borrar ? { delete: nombre } : { update: { name: nombre, fields: tcCampos_(c.datos) } };
    var n = c.datos ? JSON.stringify(c.datos).length : 200;
    if (grupo.length >= 450 || (grupo.length && largo + n > TC.LOTE_BYTES)) enviar();
    grupo.push(w); largo += n;
  });
  enviar();
}

/** Lista los documentos de una colección (solo los campos pedidos). Devuelve [{ id, fields }]. */
function tcListar_(coleccion, campos) {
  var out = [], token = '';
  do {
    var url = TC_BASE + '/' + tcRuta_(coleccion) + '?pageSize=300' + (campos || ['h']).map(function (k) { return '&mask.fieldPaths=' + k; }).join('') +
      (token ? '&pageToken=' + encodeURIComponent(token) : '');
    var r = tcPedir_('get', url, undefined, 3) || {};
    (r.documents || []).forEach(function (d) { out.push({ id: decodeURIComponent(d.name.split('/').pop()), fields: d.fields || {} }); });
    token = r.nextPageToken || '';
  } while (token);
  return out;
}
