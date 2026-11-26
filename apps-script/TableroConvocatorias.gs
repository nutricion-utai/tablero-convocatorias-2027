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
 *   - v2.0.45: cada registro de «últimos registros» trae los paquetes que cambió
 *     ese guardado (p: ['NP', 'P1'…]; vacío = datos de toda la zona), para
 *     agruparlos en la página por UT/OCT, zona y paquete.
 *   - v2.0.46: y el detalle de lo que cambió (d: [[paquete, texto]…]; paquete
 *     vacío = dato de toda la zona). La lista se guarda en varias propiedades
 *     (TC_VIVO, TC_VIVO_2…) porque cada una admite unos 9 KB.
 *   - v2.0.49: cada paquete desierto trae su motivo (md: {paquete: texto}): qué
 *     pasó con cada propuesta (no admitida, no apta o descalificada, en qué etapa
 *     y por qué), y el número de propuestas registradas por paquete (npq), que
 *     incluye las que no llegaron a la evaluación de cotizaciones.
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
  VIVO_MAX: 60,                                         // registros que muestra el aviso en vivo
  VIVO_TROZO: 3000,                                     // v2.0.46: caracteres por propiedad (cada una admite ~9 KB)
  VIVO_PARTES: 15,                                      // v2.0.46: propiedades como máximo para la lista en vivo
  TIEMPO_MAX_MS: 240000,                                // la sincronización se detiene antes del límite de 6 minutos
  LOTE_BYTES: 3000000                                   // tamaño máximo aproximado de cada envío a Firestore
};
var TC_BASE = 'https://firestore.googleapis.com/v1/projects/' + TC.PROYECTO + '/databases/(default)/documents';

// ====================================================================== líneas que llama la herramienta

/** Publica un proceso recién guardado. Nunca lanza errores: el guardado de la herramienta no debe fallar por esto. */
function tcPublicarProceso_(proc, usuario, anterior) {
  try {
    if (!tcActivo_() || !proc || !proc.id) return;
    var cambios;
    if (tcEsPrueba_(proc)) cambios = tcBorrarDocs_(proc.id);
    else {
      var b = tcConstruir_(proc, proc._idx || null, tcContexto_()), paq = [], det = [];
      try { paq = tcPaquetesTocados_(anterior, proc); } catch (e) { console.warn('Paquetes del registro ' + proc.id + ': ' + e.message); }
      // v2.0.46: detalle de lo que cambió; sus paquetes también cuentan para agrupar el registro
      try { det = tcDetalleCambios_(anterior, proc); } catch (e) { console.warn('Detalle del registro ' + proc.id + ': ' + e.message); }
      det.forEach(function (x) { if (x[0] && paq.indexOf(x[0]) < 0) paq.push(x[0]); });
      paq = Calc.PAQUETES.filter(function (c) { return paq.indexOf(c) >= 0; }).concat(paq.filter(function (c) { return Calc.PAQUETES.indexOf(c) < 0; }));
      cambios = tcCambiosDe_(b);
      cambios.push(tcEvento_({ id: proc.id, ut: b.doc.utn, z: b.doc.zona, m: b.doc.mod, c: b.doc.conv,
        a: Number(proc.version) === 1 ? 'Registró el proceso' : tcTextoAvance_(b.doc), u: tcNombreUsuario_(usuario), p: paq, d: det }));
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
      a: 'Eliminó el proceso', u: tcNombreUsuario_(usuario), p: [], d: [] }));
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
  try { tcVivoGuardar_(PropertiesService.getScriptProperties(), ''); } catch (e) { }
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
  var res = [], npq = {};
  try {
    Calc.gruposEvaluacion(proc).forEach(function (g) {
      var nReg = Calc.postoresRegistrados(proc, g.clave).length;   // v2.0.49: propuestas registradas, aunque no lleguen a cotización
      if (nReg) npq[g.clave] = nReg;
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
  // v2.0.49: motivo de cada paquete desierto (solo si hay alguno, para no cambiar los demás documentos)
  var md = {};
  Object.keys(resPaq).forEach(function (k) {
    if (resPaq[k] !== 'desierto') return;
    try { md[k] = tcMotivoDesierto_(proc, k, Calc.evaluar(proc, k, og)); } catch (e) { console.warn('Motivo del desierto de ' + proc.id + ' ' + k + ': ' + e.message); }
  });
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
  if (Object.keys(md).length) doc.md = md;
  if (Object.keys(npq).length) doc.npq = npq;
  var d = JSON.stringify(doc), ahora = tcAhora_();
  var out = { doc: doc, proc: { d: d, h: tcHash_(d), v: doc.ver, t: ahora }, precios: null };
  if (filas.length) {
    var dp = JSON.stringify({ id: doc.id, ut: doc.ut, utn: doc.utn, mod: mod, conv: doc.conv, zona: doc.zona, act: doc.act, f: filas });
    out.precios = { d: dp, h: tcHash_(dp), t: ahora };
  }
  return out;
}

/**
 * v2.0.49: por qué quedó desierto un paquete (o grupo de evaluación): qué pasó con cada propuesta registrada, en qué etapa y por qué.
 * Los nombres de personas naturales (RUC 10 o productor registrado como persona natural) no se publican.
 */
function tcMotivoDesierto_(proc, clave, ev) {
  var reg = Calc.postoresRegistrados(proc, clave);
  if (!reg.length) return 'No se presentaron propuestas.';
  var af = proc.modalidad === 'AF', partes = [], porN = {};
  ((ev && (af ? ev.postores : ev.prelacion)) || []).forEach(function (x) { porN[x.n] = x; });
  var nom = function (p) {
    return p.persona === true || /^10\d{9}$/.test(String(p.ruc || '').trim()) ? 'Postor ' + p.n + ' (persona natural)' : (String(p.nombre || '').trim() || 'Postor ' + p.n);
  };
  var ETAPA = { 'Evaluación documentaria': 'en la evaluación documentaria', 'Evaluación de almacenes': 'en la evaluación de almacenes' };
  var CRIT = ['el sobre no tiene el Anexo N° 6-B', 'el formato de cotización está incompleto', 'el formato de cotización fue modificado'];
  reg.forEach(function (p) {
    var e = Calc.etapaPostor(proc, clave, p), mot = String(e.motivo || '').trim();
    if (!e.pasa) {
      partes.push(nom(p) + ': ' + (e.resultado === 'NO ADMITIDA' ? 'propuesta no admitida' : (e.resultado === 'DESCALIFICADO' ? 'descalificado ' : 'no apto ') + (ETAPA[e.etapa] || '')) +
        (mot ? ' (' + mot.replace(/\.$/, '') + ')' : ''));
      return;
    }
    var x = porN[p.n];
    if (!x) return;
    if (x.resultado === 'DESCALIFICADO') partes.push(nom(p) + ': descalificado en la evaluación de cotizaciones (no cotizó ningún alimento)');
    else if (x.resultado === 'NO APTO') {
      var cs = [];
      (x.c || []).forEach(function (v, i) { if (v === 'NO' && CRIT[i]) cs.push(CRIT[i]); });
      if (!af && ev.total && x.cotizados < ev.total) cs.push('cotizó ' + x.cotizados + ' de ' + ev.total + ' alimentos');
      partes.push(nom(p) + ': no apto en la evaluación de cotizaciones' + (cs.length ? ' (' + cs.join('; ') + ')' : ''));
    } else if (x.resultado === 'APTO' && !af) partes.push(nom(p) + ': apto, pero no suscribe el acta');
  });
  var t = (reg.length === 1 ? 'Única propuesta. ' : reg.length + ' propuestas. ') + (partes.length ? partes.join('; ') + '.' : 'Ninguna propuesta resultó apta.');
  return t.length > 600 ? t.slice(0, 597) + '…' : t;
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
  try { lista = JSON.parse(tcVivoLeer_(props) || '[]'); } catch (x) { lista = []; }
  lista.unshift(e);
  lista = lista.slice(0, TC.VIVO_MAX);
  var d = JSON.stringify(lista), max = TC.VIVO_TROZO * TC.VIVO_PARTES;
  while (d.length > max && lista.length > 5) { lista.pop(); d = JSON.stringify(lista); }
  // si no se puede guardar la lista (cuota de propiedades), el registro igual se publica
  try { tcVivoGuardar_(props, d); } catch (x) { console.warn('Lista en vivo: ' + x.message); }
  return { ruta: TC.RAIZ + '/vivo', datos: { d: d, t: e.t } };
}
/** v2.0.46: la lista en vivo va repartida en TC_VIVO, TC_VIVO_2… (cada propiedad admite unos 9 KB). */
function tcVivoLeer_(props) {
  var s = props.getProperty('TC_VIVO') || '';
  for (var i = 2; i <= TC.VIVO_PARTES; i++) { var x = props.getProperty('TC_VIVO_' + i); if (x === null || x === undefined) break; s += x; }
  return s;
}
function tcVivoGuardar_(props, d) {
  var o = {}, n = Math.max(1, Math.ceil(d.length / TC.VIVO_TROZO));
  for (var i = 0; i < n; i++) o[i ? 'TC_VIVO_' + (i + 1) : 'TC_VIVO'] = d.slice(i * TC.VIVO_TROZO, (i + 1) * TC.VIVO_TROZO);
  props.setProperties(o);
  for (var k = n + 1; k <= TC.VIVO_PARTES; k++) props.deleteProperty('TC_VIVO_' + k);
}
var TC_PASOS = { zona: '7.1.1 Zona o CG', paquete: '7.1.2 Paquete de alimentos', crono: '7.1.3 Cronograma', repres: '7.1.6 Representantes',
  conv: 'Convocatoria o invitación', recep: 'Presentación de propuestas', verif: 'Verificación preliminar', doc: 'Evaluación documentaria',
  alm: 'Evaluación de almacenes', cot: 'Evaluación de cotizaciones', res: 'Resultados', acta: 'Acta de compromiso', herramienta: 'Lista para la herramienta de menú' };
/**
 * v2.0.45: paquetes (NP, P1, P2…) cuyos datos cambiaron entre la versión anterior y la nueva del proceso: alimentos, datos del
 * paquete, paquetes marcados en 7.1.1, documentos generados, invitados y lo que se registra por paquete en la evaluación
 * (postores, etapas, actas…). Lo que no es de un paquete (SA, cronograma, representantes…) no cuenta: con lista vacía, el
 * registro es de toda la zona. Un proceso nuevo (sin versión anterior) también va como toda la zona.
 */
function tcPaquetesTocados_(antes, despues) {
  if (!antes || !despues) return [];
  var out = {}, grupos = {}, validos = {}, j = function (x) { return JSON.stringify(x === undefined ? null : x); };
  Calc.PAQUETES.forEach(function (c) { validos[c] = true; });
  [antes, despues].forEach(function (p) {
    (p.paquetes || []).forEach(function (x) { if (x && x.codigo) validos[x.codigo] = true; });
    try { Calc.gruposEvaluacion(p).forEach(function (g) { grupos[g.clave] = (grupos[g.clave] || []).concat(g.paquetes || []); }); } catch (e) { }
  });
  // una clave de evaluación (p. ej. EXC) cuenta por sus paquetes; las claves que no son paquetes (TODOS, nombres de actos) no cuentan
  var marcar = function (clave) {
    String(clave || '').split('|').forEach(function (k) {
      if (grupos[k] && grupos[k].length) grupos[k].forEach(function (c) { out[c] = true; });
      else if (validos[k]) out[k] = true;
    });
  };
  var dif = function (a, d) { Object.keys(a).concat(Object.keys(d)).forEach(function (k) { if (j(a[k]) !== j(d[k])) marcar(k); }); };
  var porPaq = function (p) { var o = {}; (p.lineas || []).forEach(function (l) { (o[l.paquete] = o[l.paquete] || []).push(l); }); return o; };
  var datosPaq = function (p) { var o = {}; (p.paquetes || []).forEach(function (x) { if (x && x.codigo) o[x.codigo] = x; }); return o; };
  var previstos = function (p) { var o = {}; (p.paquetesPrevistos || []).forEach(function (c) { o[c] = true; }); return o; };
  var lineasD = porPaq(despues);
  dif(porPaq(antes), lineasD);
  dif(datosPaq(antes), datosPaq(despues));
  dif(previstos(antes), previstos(despues));
  ['generados', 'nombresGen', 'postores', 'subsanacion', 'frio', 'firma', 'firmaAF', 'etapas', 'compromiso', 'observaciones', 'firmantes'].forEach(function (campo) {
    var a = antes[campo], d = despues[campo];
    if ((a && (typeof a !== 'object' || Array.isArray(a))) || (d && (typeof d !== 'object' || Array.isArray(d)))) return;
    dif(a || {}, d || {});
  });
  // invitados (agricultura familiar): cuentan los paquetes en que cambió la invitación o el N° de carta; si cambian sus datos
  // (nombre, RUC, invitar…), o se agrega o quita, todos sus paquetes (sin lista de paquetes: todos los paquetes con alimentos)
  var inv = function (p) { var o = {}; (p.invitados || []).forEach(function (x, i) { o[String(x.cod || x.ruc || x.empresa || i)] = x; }); return o; };
  var ia = inv(antes), id = inv(despues), todos = Object.keys(lineasD);
  var paqInv = function (x) { return x ? (x.paquetes || todos) : []; };
  var resto = function (x) { var o = {}; Object.keys(x).forEach(function (k) { if (k !== 'paquetes' && k !== 'numeros') o[k] = x[k]; }); return j(o); };
  Object.keys(ia).concat(Object.keys(id)).forEach(function (k) {
    var xa = ia[k], xd = id[k];
    if (j(xa) === j(xd)) return;
    if (!xa || !xd || resto(xa) !== resto(xd)) { paqInv(xa).concat(paqInv(xd)).forEach(marcar); return; }
    var pa = paqInv(xa), pd = paqInv(xd);
    pa.forEach(function (c) { if (pd.indexOf(c) < 0) marcar(c); });
    pd.forEach(function (c) { if (pa.indexOf(c) < 0) marcar(c); });
    dif(xa.numeros || {}, xd.numeros || {});
  });
  var orden = Calc.PAQUETES.filter(function (c) { return out[c]; });
  return orden.concat(Object.keys(out).filter(function (c) { return orden.indexOf(c) < 0; }).sort());
}
/** v2.0.46: nombres de los documentos generados (clave TIPO|PAQUETE de proc.generados). */
var TC_DOCS = { ANEXO1: 'Anexo 1 (Zona o CG)', COT: 'Anexo 2 (cotización)', CRONO: 'Anexo 3 (cronograma)', CARTA3C: 'Anexo 3-C (cartas de invitación)',
  ANEXO4: 'Anexo 4 (representantes)', REC13A: 'Anexo 13-A (propuestas recibidas)', REC13B: 'Anexo 13-B (propuestas no admitidas)',
  VER13C: 'Anexo 13-C (verificación de impedimentos)', DOC14: 'Anexo 14 (evaluación documentaria)', ACTA15: 'Anexo 15 (acta de evaluación documentaria)',
  ALM16: 'Anexo 16 (evaluación de almacén)', ACTA17: 'Anexo 17 (acta de evaluación de almacenes)', FICHA: 'Anexo 18 (evaluación de cotizaciones)',
  ACTA: 'Anexo 19 (acta de evaluación de cotizaciones)', RESUL: 'Anexo 20 (acta de resultados)', ACTA21: 'Anexo 21 (acta de compromiso)',
  CARTA21F: 'Anexo 21-F (carta de compromiso)' };
/** Nombres de los datos que cambian, para el detalle de cada registro. */
var TC_NOMBRES = {
  linea: { dosif: 'dosificación', forma: 'presentación', unidad: 'unidad', admiteLata: 'lata', lataMin: 'lata', lataMax: 'lata', principal: 'alimento principal',
    precision: 'precisión', tca: 'TCA', nombre: 'nombre', grupo: 'grupo', idMaestra: 'alimento de la lista', tipo: 'tipo', variedad: 'variedad', variedades: 'variedad' },
  postor: { precios: 'precios', doc: 'evaluación documentaria', alm: 'evaluación de almacén', c1: 'criterios de la cotización', c2: 'criterios de la cotización',
    c3: 'criterios de la cotización', d2: 'criterios de la cotización', puntaje: 'puntaje', fechaRec: 'fecha de recepción', horaRec: 'hora de recepción',
    nombre: 'nombre', ruc: 'RUC', representante: 'representante', dniRep: 'DNI del representante', domicilio: 'domicilio', direccionAlmacen: 'dirección del almacén',
    licenciaAF: 'licencia AF', inv: 'invitación' },
  sa: { ninos: 'niñas y niños', direccion: 'dirección', nombre_sa: 'nombre', codigo_sa: 'código', nombre_cg: 'CG', cui_cg: 'CUI del CG', distrito: 'distrito',
    provincia: 'provincia', departamento: 'departamento', ubigeo: 'ubigeo' },
  crono: { inicio: 'fecha de inicio', actos: 'plazos de los actos', fechaElab: 'fecha de elaboración', orientacion: 'orientación', medio: 'medio de presentación',
    lugar: 'lugar', horario: 'horario', almacen: 'evaluación de almacén', afColindante: 'AF colindante', motivoReprog: 'reprogramación', fechaReprog: 'reprogramación',
    actosOriginal: 'reprogramación' },
  anexo4: { fecha: 'fecha', hora: 'hora', lugar: 'lugar', filas: 'integrantes', autCrono: 'autorización del cronograma', autVirtual: 'reunión virtual' },
  anexo1: { fecha: 'fecha de elaboración', zona: 'columna ZONA' },
  invitacion: { cg: 'CG', ciudad: 'ciudad', fecha: 'fecha' },
  porPaquete: { subsanacion: 'la subsanación de observaciones', frio: 'la cadena de frío', firma: 'los firmantes', firmaAF: 'los firmantes', firmantes: 'los firmantes',
    etapas: 'las fechas y horas de las actas', compromiso: 'el acta de compromiso (entregas)', observaciones: 'las observaciones' }
};

/**
 * v2.0.46: qué cambió en un guardado, para el detalle de «últimos registros»: lista de [paquete, texto] (paquete vacío = dato de
 * toda la zona). Compara la versión anterior con la nueva: alimentos, datos y documentos de cada paquete, propuestas, invitados,
 * evaluación, SA, cronograma, representantes y estado. Máximo 8 textos por paquete. Los nombres de personas naturales (RUC 10 o
 * productores registrados como persona natural) no se publican.
 */
function tcDetalleCambios_(antes, despues) {
  if (!antes || !despues) return [];
  var out = [], j = function (x) { return JSON.stringify(x === undefined ? null : x); };
  var unicos = function (xs) { var o = {}; return xs.filter(function (x) { if (o[x]) return false; o[x] = true; return true; }); };
  var lista = function (xs, n) { xs = unicos(xs); n = n || 3; return xs.slice(0, n).join(', ') + (xs.length > n ? ' y ' + (xs.length - n) + ' más' : ''); };
  var plural = function (n, s, p) { return n + ' ' + (n === 1 ? s : (p || s + 's')); };
  var add = function (paq, txt) { out.push([paq || '', String(txt).replace(/\s+/g, ' ').trim().slice(0, 180)]); };
  var fecha = function (s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || '')); return m ? m[3] + '/' + m[2] + '/' + m[1] : (s ? String(s) : 'sin fecha'); };
  var camposDistintos = function (a, d, nombres, excluir) {
    var o = {}; Object.keys(a || {}).concat(Object.keys(d || {})).forEach(function (k) {
      if ((excluir || []).indexOf(k) >= 0 || j((a || {})[k]) === j((d || {})[k])) return;
      o[nombres[k] || 'otros datos'] = true;
    });
    return Object.keys(o);
  };
  var grupos = {}, validos = {};
  Calc.PAQUETES.forEach(function (c) { validos[c] = true; });
  [antes, despues].forEach(function (p) {
    (p.paquetes || []).forEach(function (x) { if (x && x.codigo) validos[x.codigo] = true; });
    try { Calc.gruposEvaluacion(p).forEach(function (g) { grupos[g.clave] = g.paquetes || []; }); } catch (e) { }
  });
  // una clave por paquete (NP), por grupo de evaluación (EXC → sus paquetes) o de toda la zona (TODOS u otra)
  var paqsDe = function (k) {
    var ps = []; String(k || '').split('|').forEach(function (x) { if (grupos[x] && grupos[x].length) ps = ps.concat(grupos[x]); else if (validos[x]) ps.push(x); });
    return ps.length ? unicos(ps) : [''];
  };
  var natural = function (x) { return !!x && (x.persona === true || /^10\d{9}$/.test(String(x.ruc || x.doc || '').trim())); };
  var nomPostor = function (x) { return natural(x) ? 'postor ' + (x.n || '') + ' (persona natural)' : (String(x.nombre || '').trim() || 'postor ' + (x.n || '')); };
  var nomInv = function (x) { return natural(x) ? 'un productor (persona natural)' : (String(x.empresa || x.nombre || '').trim().slice(0, 60) || 'un invitado'); };

  // ------------------------------------------------------------------ alimentos (por paquete)
  var la = {}, ld = {};
  (antes.lineas || []).forEach(function (l) { la[l.id] = l; });
  (despues.lineas || []).forEach(function (l) { ld[l.id] = l; });
  var bol = {}, b = function (c) { return bol[c] = bol[c] || { mas: [], menos: [], mod: [], entra: {}, sale: {} }; };
  Object.keys(ld).forEach(function (id) {
    var d = ld[id], a = la[id];
    if (!a) { b(d.paquete).mas.push(d.nombre); return; }
    if (a.paquete !== d.paquete) {
      (b(d.paquete).entra[a.paquete] = b(d.paquete).entra[a.paquete] || []).push(d.nombre);
      (b(a.paquete).sale[d.paquete] = b(a.paquete).sale[d.paquete] || []).push(d.nombre);
      return;
    }
    if (j(a) === j(d)) return;
    b(d.paquete).mod.push(d.nombre + ' (' + camposDistintos(a, d, TC_NOMBRES.linea, ['paquete', 'orden']).join(', ') + ')');
  });
  Object.keys(la).forEach(function (id) { if (!ld[id]) b(la[id].paquete).menos.push(la[id].nombre); });
  Object.keys(bol).forEach(function (c) {
    var x = bol[c];
    if (x.mas.length) add(c, 'Agregó ' + plural(unicos(x.mas).length, 'alimento') + ': ' + lista(x.mas));
    if (x.menos.length) add(c, 'Quitó ' + plural(unicos(x.menos).length, 'alimento') + ': ' + lista(x.menos));
    Object.keys(x.entra).forEach(function (o) { add(c, 'Pasaron desde ' + o + ': ' + lista(x.entra[o])); });
    Object.keys(x.sale).forEach(function (o) { add(c, 'Pasaron a ' + o + ': ' + lista(x.sale[o])); });
    if (x.mod.length) add(c, 'Modificó ' + plural(x.mod.length, 'alimento') + ': ' + lista(x.mod, 2));
  });

  // ------------------------------------------------------------------ datos del paquete y paquetes marcados en 7.1.1
  var dp = function (p) { var o = {}; (p.paquetes || []).forEach(function (x) { if (x && x.codigo) o[x.codigo] = x; }); return o; };
  var pa = dp(antes), pd = dp(despues);
  Object.keys(pd).forEach(function (c) {
    var a = pa[c] || {}, d = pd[c];
    if (j(a.dias) !== j(d.dias)) add(c, 'Días de pedido: ' + (a.dias === undefined || a.dias === '' ? 'sin dato' : a.dias) + ' → ' + (d.dias === '' ? 'sin dato' : d.dias));
    if (j(a.frecuencia) !== j(d.frecuencia)) add(c, 'Frecuencia de pedido: ' + (a.frecuencia || 'sin dato') + ' → ' + (d.frecuencia || 'sin dato'));
    if (j(a.nombre || '') !== j(d.nombre || '')) add(c, 'Nombre del paquete: ' + (d.nombre ? '“' + d.nombre + '”' : 'sin nombre'));
  });
  var pv = function (p) { return p.paquetesPrevistos || []; };
  pv(despues).forEach(function (c) { if (pv(antes).indexOf(c) < 0) add(c, 'Marcó el paquete en 7.1.1'); });
  pv(antes).forEach(function (c) { if (pv(despues).indexOf(c) < 0) add(c, 'Desmarcó el paquete en 7.1.1'); });

  // ------------------------------------------------------------------ documentos generados
  var ga = antes.generados || {}, gd = despues.generados || {};
  Object.keys(gd).forEach(function (k) {
    if (j(ga[k]) === j(gd[k])) return;
    var t = k.split('|'), nom = TC_DOCS[t[0]] || t[0];
    paqsDe(t.slice(1).join('|')).forEach(function (q) { add(q, (ga[k] ? 'Volvió a generar el ' : 'Generó el ') + nom); });
  });
  Object.keys(ga).forEach(function (k) {
    if (gd[k] !== undefined) return;
    var t = k.split('|');
    paqsDe(t.slice(1).join('|')).forEach(function (q) { add(q, 'Quitó el registro del ' + (TC_DOCS[t[0]] || t[0])); });
  });

  // ------------------------------------------------------------------ propuestas (por paquete o grupo de evaluación)
  var poA = antes.postores || {}, poD = despues.postores || {};
  unicos(Object.keys(poA).concat(Object.keys(poD))).forEach(function (k) {
    var A = poA[k] || [], D = poD[k] || [];
    if (j(A) === j(D)) return;
    var porN = function (xs) { var o = {}; (xs || []).forEach(function (x, i) { if (x) o[String(x.n || i + 1)] = x; }); return o; };
    var oa = porN(A), od = porN(D), msgs = [];
    Object.keys(od).forEach(function (n) {
      var a = oa[n], d = od[n];
      if (!a) { msgs.push('Registró la propuesta de ' + nomPostor(d)); return; }
      if (j(a) === j(d)) return;
      msgs.push('Propuesta de ' + nomPostor(d) + ': ' + camposDistintos(a, d, TC_NOMBRES.postor, ['n']).join(', '));
    });
    Object.keys(oa).forEach(function (n) { if (!od[n]) msgs.push('Quitó la propuesta de ' + nomPostor(oa[n])); });
    paqsDe(k).forEach(function (q) { msgs.forEach(function (m) { add(q, m); }); });
  });

  // ------------------------------------------------------------------ evaluación y actas guardadas por paquete
  var vistos = {};
  Object.keys(TC_NOMBRES.porPaquete).forEach(function (campo) {
    var a = antes[campo], d = despues[campo];
    if ((a && (typeof a !== 'object' || Array.isArray(a))) || (d && (typeof d !== 'object' || Array.isArray(d)))) return;
    a = a || {}; d = d || {};
    unicos(Object.keys(a).concat(Object.keys(d))).forEach(function (k) {
      if (j(a[k]) === j(d[k])) return;
      paqsDe(k).forEach(function (q) {
        var t = 'Actualizó ' + TC_NOMBRES.porPaquete[campo];
        if (vistos[q + t]) return; vistos[q + t] = true; add(q, t);
      });
    });
  });

  // ------------------------------------------------------------------ invitados (agricultura familiar)
  var inv = function (p) { var o = {}; (p.invitados || []).forEach(function (x, i) { o[String(x.cod || x.doc || x.ruc || x.empresa || i)] = x; }); return o; };
  var ia = inv(antes), id = inv(despues), conAli = Object.keys((function () { var o = {}; (despues.lineas || []).forEach(function (l) { o[l.paquete] = 1; }); return o; })());
  var pqI = function (x) { return x ? (x.paquetes || conAli) : []; };
  var bi = {}, bI = function (c) { return bi[c] = bi[c] || { mas: [], menos: [], si: [], no: [], carta: [], mod: [] }; };
  unicos(Object.keys(ia).concat(Object.keys(id))).forEach(function (k) {
    var a = ia[k], d = id[k];
    if (j(a) === j(d)) return;
    if (!a) { pqI(d).forEach(function (c) { bI(c).mas.push(nomInv(d)); }); return; }
    if (!d) { pqI(a).forEach(function (c) { bI(c).menos.push(nomInv(a)); }); return; }
    var pA = pqI(a), pD = pqI(d), nom = nomInv(d);
    pD.forEach(function (c) { if (pA.indexOf(c) < 0) bI(c).mas.push(nom); });
    pA.forEach(function (c) { if (pD.indexOf(c) < 0) bI(c).menos.push(nom); });
    if (!!a.invitar !== !!d.invitar) pD.forEach(function (c) { bI(c)[d.invitar ? 'si' : 'no'].push(nom); });
    var na = a.numeros || {}, nd = d.numeros || {};
    unicos(Object.keys(na).concat(Object.keys(nd))).forEach(function (c) {
      if (j(na[c]) === j(nd[c])) return;
      bI(c).carta.push(nom + (nd[c] ? ' (N° ' + String(nd[c]).split('-')[0] + ')' : ' (sin N°)'));
    });
    if (camposDistintos(a, d, {}, ['paquetes', 'numeros', 'invitar']).length) pD.forEach(function (c) { bI(c).mod.push(nom); });
  });
  Object.keys(bi).forEach(function (c) {
    var x = bi[c];
    if (x.mas.length) add(c, 'Agregó ' + plural(x.mas.length, 'invitado') + ': ' + lista(x.mas));
    if (x.menos.length) add(c, 'Quitó ' + plural(x.menos.length, 'invitado') + ': ' + lista(x.menos));
    if (x.si.length) add(c, 'Marcó para invitar: ' + lista(x.si));
    if (x.no.length) add(c, 'Desmarcó la invitación de: ' + lista(x.no));
    if (x.carta.length) add(c, 'N° de carta: ' + lista(x.carta));
    if (x.mod.length) add(c, 'Actualizó datos de ' + plural(x.mod.length, 'invitado') + ': ' + lista(x.mod));
  });

  // ------------------------------------------------------------------ toda la zona (primero el estado y los datos de la zona)
  if (String(antes.estado || '') !== String(despues.estado || '')) add('', 'Estado: ' + (antes.estado || 'sin estado') + ' → ' + (despues.estado || 'sin estado'));
  if (String(antes.zona || '') !== String(despues.zona || '')) add('', 'Nombre de la zona: ' + antes.zona + ' → ' + despues.zona);
  if (String(antes.convocatoria || '') !== String(despues.convocatoria || '')) add('', 'Convocatoria: ' + antes.convocatoria + ' → ' + despues.convocatoria);
  if (String(antes.fechaEval || '') !== String(despues.fechaEval || '')) add('', 'Fecha de evaluación: ' + fecha(antes.fechaEval) + ' → ' + fecha(despues.fechaEval));
  if (!!antes.liberaCG !== !!despues.liberaCG) add('', despues.liberaCG ? 'Marcó la zona como zona por paquete' : 'Quitó la marca de zona por paquete');
  var sa = function (p) { var o = {}; (p.sa || []).forEach(function (x) { o[x.id] = x; }); return o; };
  var sA = sa(antes), sD = sa(despues), cg = function (x) { return String(x.nombre_cg || x.cui_cg || '').trim(); };
  var masS = Object.keys(sD).filter(function (k) { return !sA[k]; }), menosS = Object.keys(sA).filter(function (k) { return !sD[k]; });
  var modS = Object.keys(sD).filter(function (k) { return sA[k] && j(sA[k]) !== j(sD[k]); });
  if (masS.length) add('', 'Agregó ' + plural(masS.length, 'SA', 'SA') + ' (CG ' + lista(masS.map(function (k) { return cg(sD[k]); })) + ')');
  if (menosS.length) add('', 'Quitó ' + plural(menosS.length, 'SA', 'SA') + ' (CG ' + lista(menosS.map(function (k) { return cg(sA[k]); })) + ')');
  if (modS.length) {
    var cs = []; modS.forEach(function (k) { cs = cs.concat(camposDistintos(sA[k], sD[k], TC_NOMBRES.sa)); });
    add('', 'Actualizó ' + plural(modS.length, 'SA', 'SA') + ': ' + lista(cs, 4));
  }
  var exA = {}; (antes.saExcluidos || []).forEach(function (x) { exA[x.id] = x; });
  (despues.saExcluidos || []).forEach(function (x) { if (!exA[x.id] || exA[x.id].motivo !== x.motivo) add('', 'Quitó del Anexo 1 el SA ' + (x.codigo_sa || x.nombre_sa || x.id) + ': ' + (x.motivo || 'sin motivo')); });
  var ca = antes.crono || {}, cd = despues.crono || {};
  if (j(ca) !== j(cd)) {
    if (!ca.inicio && cd.inicio) add('', 'Registró el cronograma (inicio: ' + fecha(cd.inicio) + ')');
    else {
      if (ca.inicio !== cd.inicio) add('', 'Inicio del cronograma: ' + fecha(ca.inicio) + ' → ' + fecha(cd.inicio));
      var otrosC = camposDistintos(ca, cd, TC_NOMBRES.crono, ['inicio']);
      if (otrosC.length) add('', 'Cronograma: ' + lista(otrosC, 4));
    }
  }
  [['anexo4', 'Anexo 4 (representantes)'], ['anexo1', 'Anexo 1'], ['invitacion', 'Datos de la invitación']].forEach(function (x) {
    var cs = camposDistintos(antes[x[0]], despues[x[0]], TC_NOMBRES[x[0]]);
    if (cs.length) add('', x[1] + ': ' + lista(cs, 4));
  });
  if (j(antes.cgDatos) !== j(despues.cgDatos)) add('', 'Actualizó los datos de los CG');
  if (j(antes.perecPorGrupos) !== j(despues.perecPorGrupos) || j(antes.gruposPaq) !== j(despues.gruposPaq)) add('', 'Cambió la agrupación de los perecibles');
  // lo que no se nombra arriba (sin los datos que cambian solos en cada guardado)
  var conocidos = ['lineas', 'paquetes', 'paquetesPrevistos', 'generados', 'nombresGen', 'postores', 'invitados', 'sa', 'saExcluidos', 'crono', 'anexo4', 'anexo1',
    'invitacion', 'estado', 'zona', 'convocatoria', 'fechaEval', 'liberaCG', 'cgDatos', 'perecPorGrupos', 'gruposPaq', 'id', 'ut', 'utNombre', 'anio', 'modalidad',
    'version', 'actualizado', 'creado', 'propietario', 'propietarioNombre', 'estadoAuto', 'estadoMotivo', 'estadoPor', 'seq', 'provincias', 'distritos',
    'tipoConfirmado', 'prueba', 'renombreVersion', 'zonaAnterior', 'origen', 'cgClave'].concat(Object.keys(TC_NOMBRES.porPaquete));
  var otros = unicos(Object.keys(antes).concat(Object.keys(despues))).filter(function (k) { return conocidos.indexOf(k) < 0 && k.charAt(0) !== '_' && j(antes[k]) !== j(despues[k]); });
  if (otros.length) add('', 'Otros datos: ' + lista(otros, 4));

  // máximo 8 textos por paquete (el resto se cuenta)
  var porQ = {}, res = [];
  out.forEach(function (x) { (porQ[x[0]] = porQ[x[0]] || []).push(x); });
  Object.keys(porQ).forEach(function (q) {
    var xs = porQ[q];
    res = res.concat(xs.length > 8 ? xs.slice(0, 7).concat([[q, 'y ' + (xs.length - 7) + ' cambios más']]) : xs);
  });
  return res;
}
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
