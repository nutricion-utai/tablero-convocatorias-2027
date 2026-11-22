/*
 * Lógica del tablero de convocatorias 2027 (sin pantalla): estados a la fecha, actos del cronograma,
 * alertas de agricultura familiar, agregados y formatos. Las reglas son las mismas de la herramienta
 * (Calc.estadoPorFechas y Calc.alertasAgriculturaFamiliar, versión 2.0.36).
 */
(function (raiz) {
  'use strict';

  var MODALIDAD = {
    AF: 'Invitación directa a la agricultura familiar',
    CP_ZONA: 'Convocatoria pública por zona',
    CP_CG: 'Convocatoria pública por CG',
    EXC: 'Modalidad excepcional'
  };
  var MOD_CORTA = { AF: 'AF', CP_ZONA: 'CP zona', CP_CG: 'CP CG', EXC: 'Excepcional' };
  var ACTOS_CP = ['Convocatoria y publicación', 'Presentación de propuestas', 'Evaluación documentaria', 'Evaluación de almacenes',
    'Evaluación de cotizaciones', 'Resultados de la selección', 'Comunicación de resultados', 'Firma del acta de compromiso'];
  var ACTOS_AF = ['Invitación directa'].concat(ACTOS_CP.slice(1));
  var PASOS = ['zona', 'paquete', 'crono', 'repres', 'conv', 'recep', 'verif', 'doc', 'alm', 'cot', 'res', 'acta'];
  var ESTADOS = ['En elaboración', 'Convocado', 'En evaluación', 'Adjudicado', 'Desierto', 'Cancelado'];
  var FINALES = /^(Adjudicado|Desierto|Cancelado)$/;

  /** Etapas y pasos del numeral 7 de la Directiva (mismos textos de la herramienta). */
  function etapas(mod) {
    var af = mod === 'AF', exc = mod === 'EXC', L = function (cp, a) { return af ? a : cp; };
    return [
      { n: '7.1', t: 'Actos previos', pasos: [
        { k: 'zona', n: '7.1.1', t: 'Conformación de zona o CG' },
        { k: 'paquete', n: '7.1.2', t: 'Conformación del paquete de alimentos' },
        { k: 'crono', n: '7.1.3', t: 'Cronograma del proceso' },
        { k: 'repres', n: '7.1.6', t: 'Conformación de representantes' }] },
      { n: af ? '7.2.2' : exc ? '7.2.3' : '7.2.1', t: 'Selección de proveedores', pasos: [
        { k: 'conv', n: L('d)', 'B.4'), t: af ? 'Invitación' : 'Convocatoria y publicación' },
        { k: 'recep', n: L('e)', 'B.5'), t: 'Presentación de propuestas' },
        { k: 'verif', n: L('f)', 'B.10'), t: 'Verificación preliminar' },
        { k: 'doc', n: L('g)', 'B.11'), t: 'Evaluación documentaria' },
        { k: 'alm', n: L('h)', 'B.12'), t: 'Evaluación de almacenes' },
        { k: 'cot', n: L('i)', 'B.13'), t: 'Evaluación de cotizaciones' },
        { k: 'res', n: L('j-k)', 'B.14-B.15'), t: 'Resultado y comunicación' },
        { k: 'acta', n: L('l-m)', 'B.16-B.17'), t: 'Acta de compromiso y antisoborno' }] }
    ];
  }
  /** Nombre corto de un paso, común a todas las modalidades (para gráficos y filtros). */
  var PASO_CORTO = { zona: '7.1.1 Zona o CG', paquete: '7.1.2 Paquete de alimentos', crono: '7.1.3 Cronograma', repres: '7.1.6 Representantes',
    conv: 'Convocatoria o invitación', recep: 'Presentación de propuestas', verif: 'Verificación preliminar', doc: 'Evaluación documentaria',
    alm: 'Evaluación de almacenes', cot: 'Evaluación de cotizaciones', res: 'Resultado y comunicación', acta: 'Acta de compromiso',
    herramienta: 'Lista para la herramienta de menú' };
  function nombrePaso(mod, k) {
    var r = null;
    etapas(mod).forEach(function (e) { e.pasos.forEach(function (p) { if (p.k === k) r = p; }); });
    return r ? r.n + ' ' + r.t : (PASO_CORTO[k] || k || '');
  }
  function actos(mod) { return mod === 'AF' ? ACTOS_AF : ACTOS_CP; }
  function esAF(p) { return p.mod === 'AF'; }

  // ------------------------------------------------------------------ fechas
  function hoyLima(d) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
  }
  function horaLima(d) {
    return new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Lima', hour: '2-digit', minute: '2-digit' }).format(d || new Date());
  }
  function fecha(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
  function fechaCorta(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + '/' + m[2] : ''; }
  function fechaHora(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/); return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : fecha(s); }
  function diaUTC(s) { var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  function sumarDias(s, n) { var t = diaUTC(s); if (isNaN(t)) return ''; return new Date(t + n * 864e5).toISOString().slice(0, 10); }
  function diasEntre(a, b) { return Math.round((diaUTC(b) - diaUTC(a)) / 864e5); }
  /** "hace 5 min", "hace 2 h", "ayer", "el 12/11" a partir de 'aaaa-mm-ddThh:mm:ss' (hora de Lima). */
  function haceCuanto(s, ahora) {
    var m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
    if (!m) return fecha(s);
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 5, +m[5], +(m[6] || 0)); // Lima = UTC-5
    var min = Math.floor(((ahora || Date.now()) - t) / 60000);
    if (min < 1) return 'hace un momento';
    if (min < 60) return 'hace ' + min + ' min';
    var h = Math.floor(min / 60);
    if (h < 24 && m[1] + '-' + m[2] + '-' + m[3] === hoyLima(new Date(ahora || Date.now()))) return 'hace ' + h + ' h';
    var d = diasEntre(m[1] + '-' + m[2] + '-' + m[3], hoyLima(new Date(ahora || Date.now())));
    if (d === 1) return 'ayer, ' + m[4] + ':' + m[5];
    return 'el ' + m[3] + '/' + m[2] + ', ' + m[4] + ':' + m[5];
  }

  // ------------------------------------------------------------------ estado y cronograma
  /** Estado a la fecha con las fechas del cronograma (Calc.estadoPorFechas). */
  function estadoHoy(p, hoy) {
    var a = p.actos || [];
    if (FINALES.test(String(p.est || '')) || a.length < 2) return p.est || 'En elaboración';
    if (hoy < a[0][0]) return 'En elaboración';
    if (hoy <= a[1][1]) return 'Convocado';
    return 'En evaluación';
  }
  function enCurso(e) { return /elaboración|Convocado|evaluación/.test(e); }
  /** Acto del cronograma a la fecha: { tipo: 'sin'|'antes'|'curso'|'entre'|'fin', i, nombre, desde, hasta, texto }. */
  function actoHoy(p, hoy) {
    var a = p.actos || [], n = actos(p.mod);
    if (!a.length) return { tipo: 'sin', texto: 'Sin cronograma' };
    if (hoy < a[0][0]) return { tipo: 'antes', i: 0, nombre: n[0], desde: a[0][0], hasta: a[0][1], texto: 'Inicia el ' + fecha(a[0][0]) };
    var cur = [];
    for (var i = 0; i < a.length; i++) if (hoy >= a[i][0] && hoy <= a[i][1]) cur.push(i);
    if (cur.length) { var k = cur[cur.length - 1]; return { tipo: 'curso', i: k, nombre: n[k], desde: a[k][0], hasta: a[k][1], texto: n[k] + ' (hasta el ' + fecha(a[k][1]) + ')' }; }
    for (var j = 0; j < a.length; j++) if (a[j][0] > hoy) return { tipo: 'entre', i: j, nombre: n[j], desde: a[j][0], hasta: a[j][1], texto: 'Siguiente: ' + n[j] + ' (' + fecha(a[j][0]) + ')' };
    return { tipo: 'fin', i: a.length - 1, texto: 'Cronograma concluido el ' + fecha(a[a.length - 1][1]) };
  }

  /**
   * Convocatorias públicas iniciadas ('alta') o programadas ('previa') sin una invitación directa a la agricultura familiar
   * de la misma UT/OCT que empiece antes o el mismo día (Ley N° 31071, Ley de Compras Estatales de Alimentos de Origen en la
   * Agricultura Familiar; numeral 7 de la Directiva v8). Mismo criterio que la herramienta.
   */
  function alertasAF(procesos, hoy) {
    var ini = function (p) { return p.actos && p.actos.length ? p.actos[0][0] : ''; };
    var porUT = {};
    procesos.filter(function (p) { return String(p.est) !== 'Cancelado'; }).forEach(function (p) {
      var u = porUT[p.ut] = porUT[p.ut] || { af: [], cp: [] };
      u[esAF(p) ? 'af' : 'cp'].push(p);
    });
    var out = [];
    Object.keys(porUT).forEach(function (k) {
      var u = porUT[k];
      u.cp.forEach(function (p) {
        var i0 = ini(p); if (!i0) return;
        if (u.af.some(function (a) { return ini(a) && ini(a) <= i0; })) return;
        var af = u.af.filter(ini).sort(function (a, b) { return ini(a) < ini(b) ? -1 : 1; })[0] || null;
        out.push({ nivel: i0 > hoy ? 'previa' : 'alta', id: p.id, ut: p.ut, utn: p.utn, zona: p.zona, conv: p.conv, inicio: i0, nAF: u.af.length,
          af: af ? { id: af.id, zona: af.zona, conv: af.conv, inicio: ini(af) } : null });
      });
    });
    return out.sort(function (a, b) { return (a.nivel === 'alta' ? 0 : 1) - (b.nivel === 'alta' ? 0 : 1) || String(a.utn).localeCompare(String(b.utn), 'es') || (a.inicio < b.inicio ? -1 : 1); });
  }

  /** Actos que se realizan en los próximos `dias` días calendario (incluido hoy), para la agenda. */
  function agenda(procesos, hoy, dias) {
    var tope = sumarDias(hoy, dias), out = [];
    procesos.forEach(function (p) {
      if (FINALES.test(String(p.est || ''))) return;
      var n = actos(p.mod);
      (p.actos || []).forEach(function (a, i) {
        if (a[1] < hoy || a[0] > tope) return;
        out.push({ fecha: a[0] < hoy ? hoy : a[0], desde: a[0], hasta: a[1], acto: n[i], i: i, p: p, enCurso: a[0] <= hoy });
      });
    });
    return out.sort(function (x, y) { return x.fecha < y.fecha ? -1 : x.fecha > y.fecha ? 1 : String(x.p.utn).localeCompare(String(y.p.utn), 'es') || x.i - y.i; });
  }

  // ------------------------------------------------------------------ agregados
  function mediana(v) {
    var s = v.slice().sort(function (a, b) { return a - b; }), m = s.length;
    if (!m) return null;
    return m % 2 ? s[(m - 1) / 2] : (s[m / 2 - 1] + s[m / 2]) / 2;
  }
  /** Precios adjudicados por alimento (equivalencia de la herramienta de menú; si no tiene, nombre en la convocatoria). */
  function preciosPorAlimento(filas) {
    var g = {};
    filas.forEach(function (f) {
      if (f.precio === null || f.precio === undefined || !isFinite(f.precio)) return;
      var k = f.eq || f.ali;
      var x = g[k] = g[k] || { alimento: k, unidades: {}, presentaciones: {}, valores: [], uts: {}, af: 0, filas: [] };
      x.valores.push(f.precio); x.uts[f.ut] = true; if (f.mod === 'AF') x.af++;
      x.unidades[f.u || ''] = true; x.presentaciones[(f.env || '') + ' ' + (f.pres || '')] = true; x.filas.push(f);
    });
    return Object.keys(g).map(function (k) {
      var x = g[k], v = x.valores.slice().sort(function (a, b) { return a - b; });
      return { alimento: x.alimento, unidad: Object.keys(x.unidades).filter(String).join(' / '), n: v.length, min: v[0], mediana: mediana(v), max: v[v.length - 1],
        nUT: Object.keys(x.uts).length, af: x.af, filas: x.filas.sort(function (a, b) { return a.precio - b.precio; }) };
    }).sort(function (a, b) { return b.n - a.n || a.alimento.localeCompare(b.alimento, 'es'); });
  }

  // ------------------------------------------------------------------ formatos (convención peruana: punto decimal y coma de millares)
  function num(n, dec) {
    if (n === null || n === undefined || n === '' || !isFinite(n)) return '';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: dec || 0, maximumFractionDigits: dec || 0 });
  }
  function soles(n) { return n === null || n === undefined || !isFinite(n) ? '' : 'S/ ' + num(n, 2); }
  function pct(a, b, dec) { if (!b) return ''; return num(100 * a / b, dec === undefined ? 1 : dec) + ' %'; }
  function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  var L = {
    MODALIDAD: MODALIDAD, MOD_CORTA: MOD_CORTA, ACTOS_CP: ACTOS_CP, ACTOS_AF: ACTOS_AF, PASOS: PASOS, PASO_CORTO: PASO_CORTO, ESTADOS: ESTADOS, FINALES: FINALES,
    etapas: etapas, nombrePaso: nombrePaso, actos: actos, esAF: esAF,
    hoyLima: hoyLima, horaLima: horaLima, fecha: fecha, fechaCorta: fechaCorta, fechaHora: fechaHora, sumarDias: sumarDias, diasEntre: diasEntre, diaUTC: diaUTC, haceCuanto: haceCuanto,
    estadoHoy: estadoHoy, enCurso: enCurso, actoHoy: actoHoy, alertasAF: alertasAF, agenda: agenda,
    mediana: mediana, preciosPorAlimento: preciosPorAlimento,
    num: num, soles: soles, pct: pct, esc: esc, norm: norm
  };
  if (typeof module === 'object' && module.exports) module.exports = L;
  else raiz.Logica = L;
})(this);
