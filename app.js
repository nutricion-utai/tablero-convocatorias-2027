/*
 * Tablero de convocatorias de alimentos 2027 (PNCM): pantalla.
 * Recibe los datos de boot.mjs (Firestore) y dibuja las cinco pestañas. No conoce Firebase.
 */
(function () {
  'use strict';
  var L = window.Logica, esc = L.esc, num = L.num;
  /** Texto de datos dentro de data-tip: se escapa dos veces porque el tooltip vuelve a interpretar el atributo como HTML. */
  var et = function (s) { return esc(esc(s)); };
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var S = {
    meta: null, P: new Map(), PR: new Map(), vivo: [], estado: null,
    preciosPedidos: false, preciosListos: false, listo: false,
    f: { ut: '', sect: '', mod: '', est: '', q: '', paso: '', acto: '' },
    vista: 'res', orden: 'ut', diasAg: 14, abierto: null, abiertoPre: {}, recientes: new Map(), ultimoAviso: '', qPre: '',
    actCerradas: new Set(), actAbiertos: new Set()
  };
  var H = {};      // acciones que entrega boot.mjs: pedirPrecios(), salir()
  var VISTAS = { res: ['#vRes', 'resumen'], pro: ['#vPro', 'procesos'], cro: ['#vCro', 'cronograma'], pre: ['#vPre', 'resultados'], act: ['#vAct', 'actividad'] };
  var NOMBRE_EST = { curso: 'en curso', alerta: 'con alerta de agricultura familiar', alta: 'con convocatoria pública iniciada sin AF' };

  // ==================================================================== datos que llegan
  function setMeta(m) { S.meta = m; opcionesFiltros(); programar(); }
  function setProceso(id, doc, enVivo) {
    if (doc) S.P.set(id, doc); else S.P.delete(id);
    if (enVivo && S.listo) S.recientes.set(id, Date.now());
    programar();
  }
  function setPrecios(id, doc) { if (doc) S.PR.set(id, doc); else S.PR.delete(id); programar(); }
  function preciosListos() { S.preciosListos = true; programar(); }
  /** nuevo: true cuando el aviso llega en vivo (no en la carga inicial ni al reconectar). */
  function setVivo(lista, nuevo) {
    S.vivo = lista || [];
    var u = S.vivo[0];
    if (u && nuevo && S.listo && u.t > S.ultimoAviso) aviso('<b>' + esc(u.ut) + ' · ' + esc(u.z) + '</b>: ' + esc(u.a) + (u.u ? ' <span class="muted">(' + esc(u.u) + ')</span>' : ''));
    if (u && u.t > S.ultimoAviso) S.ultimoAviso = u.t;
    pintarVivo(); if (S.vista === 'act') programar();
  }
  function setEstado(e) { S.estado = e; if (S.vista === 'act') programar(); }
  function listo() { S.listo = true; $('#cargando').hidden = true; programar(); }
  function conexion(txt, nivel) { var e = $('#vivo'); if (!e) return; e.className = 'vivo ' + (nivel || ''); e.innerHTML = '<span class="pv"></span><span>' + txt + '</span>'; }

  // ==================================================================== procesos con datos derivados
  function sectoristaDe(ut) { var u = S.meta && S.meta.uts.find(function (x) { return x.c === ut; }); return u ? u.s : ''; }
  function utNombre(ut) { var u = S.meta && S.meta.uts.find(function (x) { return x.c === ut; }); return u ? u.n : ut; }
  function todos() {
    var hoy = L.hoyLima(), arr = Array.from(S.P.values()).map(function (p) {
      return Object.assign({}, p, { e: L.estadoHoy(p, hoy), acto: L.actoHoy(p, hoy), sect: sectoristaDe(p.ut) });
    });
    var al = L.alertasAF(arr, hoy), nivel = {};
    al.forEach(function (a) { nivel[a.id] = a.nivel; });
    arr.forEach(function (p) { p.alerta = nivel[p.id] || ''; });
    arr.alertas = al;
    return arr;
  }
  /** Acto del cronograma de hoy de un proceso en curso, como en el gráfico del resumen (null si ya tiene resultado o está cancelado). */
  var ACTO_TXT = { _antes: 'Entre actos o por iniciar', _fin: 'Cronograma concluido', _sin: 'Sin cronograma registrado' };
  function actoClave(p) {
    if (L.FINALES.test(p.e)) return null;
    var a = p.acto || {};
    if (a.tipo === 'curso') return a.i === 0 && p.mod === 'AF' ? 'Invitación directa' : a.nombre;
    return a.tipo === 'sin' ? '_sin' : a.tipo === 'fin' ? '_fin' : '_antes';
  }
  function actoTxt(k) { return ACTO_TXT[k] || k; }
  /** sinPaso: sin los filtros que se eligen en los gráficos del resumen (paso del registro y acto de hoy). */
  function filtrar(arr, sinEstado, sinPaso) {
    var f = S.f, q = L.norm(f.q);
    return arr.filter(function (p) {
      if (f.ut && p.ut !== f.ut) return false;
      if (f.sect && p.sect !== f.sect) return false;
      if (f.mod && !(f.mod === 'CP' ? p.mod !== 'AF' : p.mod === f.mod)) return false;
      if (q && L.norm([p.utn, p.zona, p.conv, p.prov, p.dist, p.esp, p.id].join(' ')).indexOf(q) < 0) return false;
      if (!sinEstado && f.est) {
        if (f.est === 'curso' ? !L.enCurso(p.e) : f.est === 'alerta' ? !p.alerta : f.est === 'alta' ? p.alerta !== 'alta' : p.e !== f.est) return false;
      }
      if (!sinPaso && f.paso && (p.paso !== f.paso || L.FINALES.test(p.e))) return false;
      if (!sinPaso && f.acto && actoClave(p) !== f.acto) return false;
      return true;
    });
  }
  function ordenar(arr) {
    var o = S.orden;
    return arr.slice().sort(function (a, b) {
      if (o === 'act') return a.act < b.act ? 1 : a.act > b.act ? -1 : 0;
      if (o === 'ini') return (a.ini || '9999') < (b.ini || '9999') ? -1 : (a.ini || '9999') > (b.ini || '9999') ? 1 : 0;
      if (o === 'avance') return b.pasosOk - a.pasosOk || String(a.utn).localeCompare(String(b.utn), 'es');
      return String(a.utn).localeCompare(String(b.utn), 'es') || (a.mod === 'AF' ? 0 : 1) - (b.mod === 'AF' ? 0 : 1) ||
        String(a.conv).localeCompare(String(b.conv)) || String(a.zona).localeCompare(String(b.zona), 'es', { numeric: true });
    });
  }

  // ==================================================================== piezas comunes
  function chipMod(m) { return '<span class="chip ' + (m === 'AF' ? 'af' : 'cp') + '" title="' + esc(L.MODALIDAD[m] || m) + '"><i></i>' + esc(L.MOD_CORTA[m] || m) + '</span>'; }
  var ICO_EST = { 'Adjudicado': '✓', 'Desierto': '○', 'Cancelado': '×', 'Convocado': '●', 'En evaluación': '●', 'En elaboración': '○' };
  function badgeEst(e) { return '<span class="est e-' + L.norm(e).replace(/[^a-z]/g, '') + '"><span aria-hidden="true">' + (ICO_EST[e] || '') + '</span>' + esc(e) + '</span>'; }
  function barraAvance(n) { return '<span class="av" role="img" aria-label="' + n + ' de 12 pasos completos"><span style="width:' + Math.round(100 * n / 12) + '%"></span></span>'; }
  function kpi(valor, texto, attrs, extra) {
    if (attrs === 'data-noop') return '<div class="kpi fijo"><b>' + valor + '</b><span>' + texto + '</span></div>';
    return '<button class="kpi' + (extra || '') + '" ' + (attrs || '') + '><b>' + valor + '</b><span>' + texto + '</span></button>';
  }
  function vacio(txt) { return '<div class="vacio">' + txt + '</div>'; }
  function resultadoTxt(p, sinCodigo) {
    var r = p.resPaq || {}, k = Object.keys(r);
    if (!k.length) return '<span class="muted">-</span>';
    return k.map(function (c) { return '<span class="rp r-' + L.norm(r[c]).replace(/[^a-z]/g, '') + '">' + (sinCodigo ? '' : esc(c) + ': ') + esc(r[c]) + '</span>'; }).join(' ');
  }
  /** Proveedores adjudicados en un paquete: en AF, los que tienen alimentos con precio adjudicado (se adjudica por alimento); en CP, el que suscribe el acta. */
  function ganadores(p, k) {
    if (p.mod === 'AF') {
      var pr = S.PR.get(p.id), c = {};
      (pr ? pr.f : []).forEach(function (f) { if (f[0] === k) c[f[7]] = (c[f[7]] || 0) + 1; });
      return Object.keys(c).sort().map(function (n) { return { nom: n, k: c[n] }; });
    }
    return (p.res || []).filter(function (r) { return r.p === k && r.s; }).map(function (r) { return { nom: r.nom, pf: r.pf }; });
  }
  function tituloProc(p) { return esc(p.zona || '(sin zona)') + ' <span class="muted">· ' + esc(String(p.conv || '').toLowerCase()) + '</span>'; }
  function filtroActivoTxt() {
    var f = S.f, t = [];
    if (f.ut) t.push(utNombre(f.ut)); else if (f.sect) t.push('UT/OCT de ' + f.sect);
    if (f.mod) t.push(f.mod === 'CP' ? 'convocatorias públicas' : (L.MODALIDAD[f.mod] || f.mod).toLowerCase());
    if (f.est) t.push(NOMBRE_EST[f.est] || f.est.toLowerCase());
    if (f.paso) t.push('paso ' + L.PASO_CORTO[f.paso]);
    if (f.acto) t.push('acto de hoy: ' + actoTxt(f.acto).toLowerCase());
    if (f.q) t.push('búsqueda “' + f.q + '”');
    return t.length ? t.join(' · ') : 'todas las UT/OCT';
  }

  // ==================================================================== RESUMEN
  function vistaResumen(arr) {
    var base = filtrar(arr, true, true), sel = filtrar(arr);
    var cuenta = function (fn) { return base.filter(fn).length; };
    var nAlta = cuenta(function (p) { return p.alerta === 'alta'; }), nAl = cuenta(function (p) { return !!p.alerta; });
    var f = S.f, act = function (e) { return f.est === e ? ' activo' : ''; };
    var h = '<div class="kpis">' +
      kpi(num(base.length), 'procesos registrados', 'data-est=""', f.est ? '' : ' activo') +
      kpi(num(cuenta(function (p) { return L.enCurso(p.e); })), 'en curso', 'data-est="curso"', act('curso')) +
      kpi(num(cuenta(function (p) { return p.e === 'Convocado'; })), 'convocados hoy', 'data-est="Convocado"', act('Convocado')) +
      kpi(num(cuenta(function (p) { return p.e === 'Adjudicado'; })), 'adjudicados', 'data-est="Adjudicado"', act('Adjudicado')) +
      kpi(num(cuenta(function (p) { return p.e === 'Desierto'; })), 'desiertos', 'data-est="Desierto"', act('Desierto')) +
      kpi(num(nAl), 'con alerta de agricultura familiar' + (nAlta ? ' <em class="crit">(' + nAlta + ' iniciada' + (nAlta > 1 ? 's' : '') + ')</em>' : ''), 'data-est="alerta"', act('alerta')) +
      '</div>';
    // cobertura de los procesos filtrados
    var nin = sel.reduce(function (s, p) { return s + (p.nin || 0); }, 0), nsa = sel.reduce(function (s, p) { return s + (p.nsa || 0); }, 0), ncg = sel.reduce(function (s, p) { return s + (p.ncg || 0); }, 0);
    h += '<p class="cobertura">Los ' + num(sel.length) + ' procesos de ' + esc(filtroActivoTxt()) + ' abarcan <b>' + num(ncg) + '</b> CG, <b>' + num(nsa) + '</b> servicios alimentarios y <b>' + num(nin) +
      '</b> niñas y niños (referencial, del Anexo 1).</p>';

    // gráficos: paso del registro y acto del cronograma
    var conPaso = filtrar(arr, false, true), enProc = conPaso.filter(function (p) { return !L.FINALES.test(p.e); });
    var filasPaso = L.PASOS.map(function (k) { return { k: k, t: L.PASO_CORTO[k], n: enProc.filter(function (p) { return p.paso === k; }).length }; });
    ['Adjudicado', 'Desierto', 'Cancelado'].forEach(function (e) { var n = conPaso.filter(function (p) { return p.e === e; }).length; if (n) filasPaso.push({ est: e, t: e, n: n }); });
    var max = Math.max.apply(null, filasPaso.map(function (x) { return x.n; }).concat([1]));
    var barras = filasPaso.map(function (x, i) {
      var sepa = x.est && !filasPaso[i - 1].est ? '<div class="hb-sep">Con resultado</div>' : (i === 0 ? '<div class="hb-sep">7.1 Actos previos</div>' : i === 4 ? '<div class="hb-sep">7.2 Selección de proveedores</div>' : '');
      var on = x.k ? S.f.paso === x.k : S.f.est === x.est;
      return sepa + '<button class="hb' + (on ? ' on' : '') + (x.n ? '' : ' cero') + '" ' + (x.k ? 'data-paso="' + x.k + '"' : 'data-est="' + esc(x.est) + '"') +
        ' data-tip="<b>' + num(x.n) + '</b> proceso' + (x.n === 1 ? '' : 's') + ' · ' + et(x.t) + '"><span class="hb-l">' + esc(x.t) + '</span><span class="hb-t"><span class="hb-f" style="width:' +
        (x.n ? Math.max(2, 100 * x.n / max) : 0) + '%"></span></span><span class="hb-v">' + num(x.n) + '</span></button>';
    }).join('');
    var nombres = {}, cnt = { antes: 0, sin: 0, fin: 0 };
    conPaso.forEach(function (p) {
      var k = actoClave(p); if (k === null) return;
      if (k === '_sin') cnt.sin++; else if (k === '_fin') cnt.fin++; else if (k === '_antes') cnt.antes++; else nombres[k] = (nombres[k] || 0) + 1;
    });
    var ordenActos = ['Invitación directa'].concat(L.ACTOS_CP);
    var filasActo = ordenActos.map(function (n) { return { t: n, n: nombres[n] || 0 }; }).filter(function (x, i) { return x.n || i > 0; })
      .map(function (x) { x.k = x.t; return x; })
      .concat([{ k: '_antes', t: ACTO_TXT._antes, n: cnt.antes, gris: 1 }, { k: '_fin', t: ACTO_TXT._fin, n: cnt.fin, gris: 1 }, { k: '_sin', t: ACTO_TXT._sin, n: cnt.sin, gris: 1 }]);
    var maxA = Math.max.apply(null, filasActo.map(function (x) { return x.n; }).concat([1]));
    var barrasA = filasActo.map(function (x) {
      // v2: clic → filtro por ese acto y pestaña Cronograma
      return '<button class="hb' + (x.gris ? ' gris' : '') + (S.f.acto === x.k ? ' on' : '') + (x.n ? '' : ' cero') + '" data-acto="' + esc(x.k) + '" data-tip="<b>' + num(x.n) + '</b> proceso' + (x.n === 1 ? '' : 's') + ' · ' + et(x.t) +
        '<br><i>Clic: ver en el cronograma</i>"><span class="hb-l">' + esc(x.t) + '</span><span class="hb-t"><span class="hb-f" style="width:' + (x.n ? Math.max(2, 100 * x.n / maxA) : 0) + '%"></span></span><span class="hb-v">' + num(x.n) + '</span></button>';
    }).join('');
    h += '<div class="g2"><div class="card"><h2>¿En qué paso está el registro?</h2><p class="nota">Paso vigente de cada proceso en la herramienta (los 12 pasos del numeral 7 de la Directiva). Haga clic en una barra para ver esos procesos.</p><div class="hbars">' + barras + '</div></div>' +
      '<div class="card"><h2>¿Qué acto del cronograma se realiza hoy?</h2><p class="nota">Según las fechas del cronograma (Anexo 3) de cada proceso en curso, al ' + L.fecha(L.hoyLima()) + '. Haga clic en una barra para ver esos procesos en el cronograma.</p><div class="hbars">' + barrasA + '</div></div></div>';

    // alertas de agricultura familiar
    var al = arr.alertas.filter(function (a) { return base.some(function (p) { return p.id === a.id; }); });
    if (al.length) {
      h += '<div class="card alerta"><h2><span class="ico-crit" aria-hidden="true">!</span>Convocatoria pública sin invitación previa a la agricultura familiar</h2>' +
        '<p class="nota">La Directiva v8 empieza el año por la invitación directa a la agricultura familiar (Ley N° 31071, Ley de Compras Estatales de Alimentos de Origen en la Agricultura Familiar). ' +
        'Se lista cada convocatoria pública que empezó o está programada sin una invitación AF de la misma UT/OCT que empiece antes o el mismo día.</p><ul class="lista-al">' +
        al.map(function (a) {
          return '<li><span class="tag ' + (a.nivel === 'alta' ? 'crit' : 'warn') + '">' + (a.nivel === 'alta' ? 'Iniciada' : 'Programada') + '</span> <button class="lnk" data-abrir="' + esc(a.id) + '">' +
            esc(a.utn) + ' · ' + esc(a.zona) + '</button>: ' + (a.nivel === 'alta' ? 'empezó' : 'empieza') + ' el ' + L.fecha(a.inicio) +
            (a.af ? '; su invitación AF ' + esc(a.af.zona) + ' empieza el ' + L.fecha(a.af.inicio) : a.nAF ? '; su invitación AF aún no tiene cronograma' : '; no registra invitaciones AF') + '.</li>';
        }).join('') + '</ul></div>';
    }

    // avance por UT/OCT
    var uts = (S.meta ? S.meta.uts : []).filter(function (u) { return (!S.f.ut || u.c === S.f.ut) && (!S.f.sect || u.s === S.f.sect); });
    var filas = uts.map(function (u) {
      var ps = sel.filter(function (p) { return p.ut === u.c; });
      var prom = ps.length ? ps.reduce(function (s, p) { return s + (p.pasosOk || 0); }, 0) / ps.length : 0;
      var prox = ps.map(function (p) { return p.acto; }).filter(function (a) { return a.tipo === 'curso' || a.tipo === 'antes' || a.tipo === 'entre'; })
        .sort(function (a, b) { return (a.tipo === 'curso' ? a.hasta : a.desde) < (b.tipo === 'curso' ? b.hasta : b.desde) ? -1 : 1; })[0];
      return { u: u, ps: ps, prom: prom, prox: prox };
    }).filter(function (x) { return x.ps.length || (!S.f.est && !S.f.paso && !S.f.q && !S.f.mod); });
    h += '<div class="card"><div class="cab"><h2>Avance por UT/OCT</h2><span class="nota">' + esc(filtroActivoTxt()) + '</span></div><div class="scroll"><table class="tb"><thead><tr>' +
      '<th>UT/OCT</th><th>Sectorista</th><th class="n">Procesos</th><th class="n">AF</th><th class="n">CP</th><th class="n">En curso</th><th class="n">Adjudicados</th><th class="n">Desiertos</th><th>Avance promedio del registro</th><th>Acto vigente o próximo</th></tr></thead><tbody>' +
      filas.map(function (x) {
        var ps = x.ps, c = function (fn) { var n = ps.filter(fn).length; return n ? num(n) : '<span class="muted">0</span>'; };
        if (!ps.length) return '<tr class="sinp"><td><button class="lnk" data-ut="' + esc(x.u.c) + '">' + esc(x.u.n) + '</button></td><td>' + esc(x.u.s) + '</td><td class="n muted">0</td><td colspan="7" class="muted">Sin procesos registrados</td></tr>';
        return '<tr><td><button class="lnk" data-ut="' + esc(x.u.c) + '">' + esc(x.u.n) + '</button></td><td>' + esc(x.u.s) + '</td><td class="n">' + num(ps.length) + '</td><td class="n">' + c(function (p) { return p.mod === 'AF'; }) +
          '</td><td class="n">' + c(function (p) { return p.mod !== 'AF'; }) + '</td><td class="n">' + c(function (p) { return L.enCurso(p.e); }) + '</td><td class="n">' + c(function (p) { return p.e === 'Adjudicado'; }) +
          '</td><td class="n">' + c(function (p) { return p.e === 'Desierto'; }) + '</td><td class="avc">' + barraAvance(x.prom) + ' <span class="tn">' + num(x.prom, 1) + ' de 12</span></td><td class="sm">' +
          (x.prox ? esc(x.prox.tipo === 'curso' ? x.prox.nombre + ', hasta el ' + L.fechaCorta(x.prox.hasta) : x.prox.nombre + ', desde el ' + L.fechaCorta(x.prox.desde)) : '<span class="muted">Sin cronograma registrado</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return h;
  }

  // ==================================================================== PROCESOS
  function vistaProcesos(arr) {
    var ps = ordenar(filtrar(arr));
    var h = '<div class="card"><div class="cab"><h2>' + num(ps.length) + ' proceso' + (ps.length === 1 ? '' : 's') + '</h2><span class="nota">' + esc(filtroActivoTxt()) + '</span>' +
      '<span class="der"><label class="sel">Ordenar por <select id="orden"><option value="ut">UT/OCT</option><option value="act">Última actualización</option><option value="ini">Inicio del cronograma</option><option value="avance">Avance del registro</option></select></label>' +
      '<button class="btn" id="csv">Descargar CSV</button></span></div>';
    if (!ps.length) return h + vacio('No hay procesos con estos filtros.') + '</div>';
    var ahora = Date.now();
    h += '<div class="scroll"><table class="tb procs"><thead><tr><th class="nro">N°</th><th>UT/OCT · Zona o CG</th><th>Estado a la fecha</th><th>Avance del registro</th><th>Cronograma</th><th class="n">CG</th><th class="n">SA</th><th class="n">Niñas y niños</th><th>Resultado</th><th>Actualizado</th></tr></thead><tbody>' +
      ps.map(function (p, i) {
        var rec = S.recientes.get(p.id), nuevo = rec && ahora - rec < 8000;
        return '<tr class="fila' + (nuevo ? ' nuevo' : '') + '" data-abrir="' + esc(p.id) + '" tabindex="0"><td class="nro">' + (i + 1) + '</td><td><div class="t1">' + esc(p.utn) + ' ' + chipMod(p.mod) + '</div><div class="t2">' + tituloProc(p) + '</div>' +
          (p.alerta ? '<div class="t3"><span class="tag ' + (p.alerta === 'alta' ? 'crit' : 'warn') + '">' + (p.alerta === 'alta' ? 'Iniciada sin AF previa' : 'Programada sin AF previa') + '</span></div>' : '') +
          '</td><td>' + badgeEst(p.e) + (p.reprog ? '<div class="t3">Reprogramado</div>' : '') + '</td><td class="avt"><div class="t2">' + esc(L.PASO_CORTO[p.paso] || '') + '</div>' + barraAvance(p.pasosOk) +
          ' <span class="tn">' + p.pasosOk + '/12</span>' + (p.pend && !L.FINALES.test(p.e) ? '<div class="t3">Pendiente: ' + esc(p.pend) + '</div>' : '') + '</td><td class="sm act-' + p.acto.tipo + '">' + esc(p.acto.texto) + '</td>' +
          '<td class="n">' + num(p.ncg) + '</td><td class="n">' + num(p.nsa) + '</td><td class="n">' + num(p.nin) + '</td><td class="sm">' + resultadoTxt(p) + '</td><td class="sm"><div>' + esc(L.haceCuanto(p.act)) + '</div><div class="t3">' + esc(p.esp || '') + '</div></td></tr>';
      }).join('') + '</tbody></table></div></div>';
    return h;
  }
  function descargarCSV() {
    var ps = ordenar(filtrar(todos()));
    var cab = ['UT/OCT', 'Sectorista', 'Modalidad', 'Convocatoria', 'Zona o CG', 'Provincias', 'Distritos', 'Estado a la fecha', 'Paso vigente', 'Pasos completos (de 12)', 'Pendiente', 'Inicio del cronograma',
      'Fin del cronograma', 'Acto a la fecha', 'Reprogramado', 'N° de CG', 'N° de SA', 'N° de niñas y niños', 'N° de alimentos', 'N° de propuestas', 'Resultado por paquete', 'Alerta AF', 'Especialista', 'Actualizado', 'ID'];
    var filas = ps.map(function (p) {
      return [p.utn, p.sect, L.MODALIDAD[p.mod] || p.mod, p.conv, p.zona, p.prov, p.dist, p.e, L.nombrePaso(p.mod, p.paso), p.pasosOk, p.pend, L.fecha(p.ini), L.fecha(p.fin), p.acto.texto, p.reprog ? 'Sí' : '',
        p.ncg, p.nsa, p.nin, p.nali, p.npos, Object.keys(p.resPaq || {}).map(function (k) { return k + ': ' + p.resPaq[k]; }).join('; '),
        p.alerta === 'alta' ? 'Iniciada sin AF previa' : p.alerta === 'previa' ? 'Programada sin AF previa' : '', p.esp, L.fechaHora(p.act), p.id];
    });
    var csv = '﻿' + [cab].concat(filas).map(function (r) { return r.map(function (v) { v = v === null || v === undefined ? '' : String(v); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'convocatorias-2027_' + L.hoyLima() + '.csv';
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  // ==================================================================== CRONOGRAMA
  function vistaCronograma(arr) {
    var hoy = L.hoyLima(), ps = filtrar(arr), con = ps.filter(function (p) { return p.actos && p.actos.length; }), sin = ps.length - con.length;
    var ag = L.agenda(con, hoy, S.diasAg), h = '';
    // agenda
    var dias = {}; ag.forEach(function (x) { (dias[x.fecha] = dias[x.fecha] || []).push(x); });
    var DSEM = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    h += '<div class="card"><div class="cab"><h2>Agenda de los próximos ' + S.diasAg + ' días</h2><span class="nota">Actos del cronograma de ' + esc(filtroActivoTxt()) + '</span>' +
      '<span class="der"><label class="sel">Mostrar <select id="diasAg">' + [7, 14, 30].map(function (n) { return '<option value="' + n + '"' + (n === S.diasAg ? ' selected' : '') + '>' + n + ' días</option>'; }).join('') + '</select></label></span></div>' +
      (ag.length ? '<div class="agenda">' + Object.keys(dias).sort().map(function (d) {
        var dt = new Date(L.diaUTC(d)), nom = d === hoy ? 'Hoy' : d === L.sumarDias(hoy, 1) ? 'Mañana' : DSEM[dt.getUTCDay()];
        return '<div class="ag-dia"><div class="ag-f"><b>' + nom.charAt(0).toUpperCase() + nom.slice(1) + '</b><span>' + L.fecha(d) + '</span></div><ul>' + dias[d].map(function (x) {
          var cierra = x.hasta === d, empieza = x.desde === d;
          return '<li><div><button class="lnk" data-abrir="' + esc(x.p.id) + '">' + esc(x.p.utn) + ' · ' + esc(x.p.zona) + '</button> ' + chipMod(x.p.mod) + '</div><div class="ag-l2"><span class="ag-a">' + esc(x.acto) + '</span> <span class="muted">' +
            (empieza && cierra ? '(un día)' : empieza ? '(empieza; hasta el ' + L.fechaCorta(x.hasta) + ')' : cierra ? '(último día)' : '(en curso; hasta el ' + L.fechaCorta(x.hasta) + ')') + '</span></div></li>';
        }).join('') + '</ul></div>';
      }).join('') + '</div>' : vacio('No hay actos programados en los próximos ' + S.diasAg + ' días.')) + '</div>';

    // diagrama de Gantt
    h += '<div class="card"><div class="cab"><h2>Cronogramas de los procesos</h2><span class="ley"><span><i class="sw af"></i>Invitación directa AF</span><span><i class="sw cp"></i>Convocatoria pública</span><span><i class="sw hoy"></i>Hoy</span></span></div>' +
      '<p class="nota">Cada barra es un proceso y cada tramo, un acto de su cronograma (Anexo 3). Los tramos ya realizados y el acto en curso van en color pleno; los siguientes, en tono claro. ' +
      (sin ? num(sin) + ' proceso' + (sin === 1 ? '' : 's') + ' de este filtro aún no registra' + (sin === 1 ? '' : 'n') + ' cronograma.' : '') + '</p>';
    var sinCro = ps.filter(function (p) { return !(p.actos && p.actos.length); });
    var listaSin = sinCro.length ? '<ul class="sin-cro">' + sinCro.sort(function (a, b) { return String(a.utn).localeCompare(String(b.utn), 'es') || String(a.zona).localeCompare(String(b.zona), 'es'); }).map(function (p) {
      return '<li><button class="lnk" data-abrir="' + esc(p.id) + '">' + esc(p.utn) + ' · ' + esc(p.zona) + '</button> ' + chipMod(p.mod) + ' <span class="muted">' + esc(L.PASO_CORTO[p.paso] || '') + '</span></li>';
    }).join('') + '</ul>' : '';
    if (!con.length) return h + vacio('Ningún proceso de este filtro tiene cronograma registrado.') + listaSin + '</div>';
    con.sort(function (a, b) { return a.actos[0][0] < b.actos[0][0] ? -1 : a.actos[0][0] > b.actos[0][0] ? 1 : String(a.utn).localeCompare(String(b.utn), 'es'); });
    var ini = con.reduce(function (m, p) { return p.actos[0][0] < m ? p.actos[0][0] : m; }, hoy), fin = con.reduce(function (m, p) { var f = p.actos[p.actos.length - 1][1]; return f > m ? f : m; }, hoy);
    ini = L.sumarDias(ini, -2); fin = L.sumarDias(fin, 3);
    var D = L.diasEntre(ini, fin) + 1, x = function (d) { return 100 * L.diasEntre(ini, d) / D; }, w = function (a, b) { return 100 * (L.diasEntre(a, b) + 1) / D; };
    // marcas de semana (lunes)
    var marcas = '', d0 = ini, dow = new Date(L.diaUTC(d0)).getUTCDay(), lunes = L.sumarDias(d0, (8 - dow) % 7), paso = D > 120 ? 14 : 7;
    for (var d = lunes; d <= fin; d = L.sumarDias(d, paso)) marcas += '<span class="gx" style="left:' + x(d) + '%">' + (Math.abs(x(d) - x(hoy)) < 3.5 ? '' : '<span>' + L.fechaCorta(d) + '</span>') + '</span>';
    var nAct = function (p) { return L.actos(p.mod); };
    h += '<div class="scroll"><div class="gantt" style="--hoy:' + x(hoy).toFixed(3) + '"><div class="g-ej"><div class="g-l"></div><div class="g-t">' + marcas + '<span class="g-hoy-l" style="left:' + x(hoy) + '%">Hoy</span></div></div>' +
      con.map(function (p) {
        var segs = p.actos.map(function (a, i) {
          var est = a[1] < hoy ? 'pas' : a[0] <= hoy ? 'cur' : 'fut';
          return '<span class="sg ' + est + '" style="left:' + x(a[0]) + '%;width:' + w(a[0], a[1]) + '%" data-tip="<b>' + et(nAct(p)[i]) + '</b><br>' + L.fecha(a[0]) + (a[1] !== a[0] ? ' al ' + L.fecha(a[1]) : '') +
            '<br>' + et(p.utn) + ' · ' + et(p.zona) + (est === 'cur' ? '<br><i>En curso</i>' : '') + '"></span>';
        }).join('');
        return '<div class="g-f ' + (p.mod === 'AF' ? 'af' : 'cp') + '" data-abrir="' + esc(p.id) + '" tabindex="0"><div class="g-l"><b>' + esc(p.utn.replace(/^(UT|OCT) /, '')) + '</b> ' + esc(p.zona) +
          (p.reprog ? ' <span class="tag info" title="Cronograma reprogramado">R</span>' : '') + '</div><div class="g-t">' + segs + '</div></div>';
      }).join('') + '<div class="g-linea" aria-hidden="true"></div></div></div>' +
      (listaSin ? '<details class="sin-cro-d"><summary>Ver los ' + num(sinCro.length) + ' proceso' + (sinCro.length === 1 ? '' : 's') + ' sin cronograma</summary>' + listaSin + '</details>' : '') + '</div>';
    return h;
  }

  // ==================================================================== RESULTADOS Y PRECIOS
  function vistaPrecios(arr) {
    if (!S.preciosPedidos && H.pedirPrecios) { S.preciosPedidos = true; H.pedirPrecios(); }
    var ps = filtrar(arr), ids = {}; ps.forEach(function (p) { ids[p.id] = p; });
    var h = '';
    var conRes = ps.filter(function (p) { return Object.keys(p.resPaq || {}).length; });
    var paqs = []; conRes.forEach(function (p) { Object.keys(p.resPaq).forEach(function (k) { paqs.push({ p: p, k: k, r: p.resPaq[k] }); }); });
    var filas = [];
    S.PR.forEach(function (d, id) {
      var p = ids[id]; if (!p) return;
      (d.f || []).forEach(function (r) { filas.push({ id: id, ut: p.ut, utn: p.utn, zona: p.zona, mod: p.mod, paq: r[0], ali: r[1], eq: r[2], env: r[3], pres: r[4], u: r[5], precio: r[6], prov: r[7], ruc: r[8] }); });
    });
    var provs = {}; filas.forEach(function (f) { provs[f.ruc || f.prov] = true; });
    var nAF = filas.filter(function (f) { return f.mod === 'AF'; }).length;
    h += '<div class="kpis">' + kpi(num(conRes.length), 'procesos con resultado registrado', 'data-noop') +
      kpi(num(paqs.filter(function (x) { return x.r === 'adjudicado'; }).length), 'paquetes adjudicados', 'data-noop') +
      kpi(num(paqs.filter(function (x) { return x.r === 'desierto'; }).length), 'paquetes desiertos', 'data-noop') +
      kpi(S.preciosListos ? num(filas.length) : '…', 'alimentos con precio adjudicado', 'data-noop') +
      kpi(S.preciosListos ? num(Object.keys(provs).length) : '…', 'proveedores adjudicados', 'data-noop') +
      kpi(S.preciosListos ? (filas.length ? L.pct(nAF, filas.length) : '-') : '…', 'de los alimentos adjudicados, por invitación AF', 'data-noop') + '</div>';
    if (!S.preciosListos) return h + '<div class="card">' + vacio('Cargando los precios adjudicados…') + '</div>';
    if (!conRes.length && !filas.length) return h + '<div class="card">' + vacio('Aún no hay resultados registrados en ' + esc(filtroActivoTxt()) + '. Aparecerán aquí en cuanto una UT/OCT registre la evaluación de cotizaciones.') + '</div>';

    // alimentos adjudicados a la AF por UT/OCT
    var porUT = {};
    filas.forEach(function (f) { var u = porUT[f.ut] = porUT[f.ut] || { ut: f.ut, n: f.utn, t: 0, af: 0 }; u.t++; if (f.mod === 'AF') u.af++; });
    var lu = Object.keys(porUT).map(function (k) { return porUT[k]; }).sort(function (a, b) { return a.n.localeCompare(b.n, 'es'); });
    if (lu.length) h += '<div class="card"><h2>Alimentos adjudicados por invitación directa a la agricultura familiar, por UT/OCT</h2>' +
      '<p class="nota">Proporción de los alimentos con precio adjudicado (líneas de los paquetes) que provienen de procesos de invitación directa AF. Es un indicador de seguimiento: el cumplimiento de la Ley N° 31071, Ley de Compras Estatales de Alimentos de Origen en la Agricultura Familiar, se mide sobre el presupuesto.</p><div class="hbars">' +
      lu.map(function (u) {
        var v = 100 * u.af / u.t;
        return '<div class="hb fija" tabindex="0" data-tip="<b>' + L.pct(u.af, u.t) + '</b> · ' + et(u.n) + '<br>' + num(u.af) + ' de ' + num(u.t) + ' alimentos adjudicados"><span class="hb-l">' + esc(u.n) +
          '</span><span class="hb-t"><span class="hb-f afc" style="width:' + (u.af ? Math.max(1.5, v) : 0) + '%"></span></span><span class="hb-v">' + L.pct(u.af, u.t) + ' <span class="muted">(' + num(u.af) + '/' + num(u.t) + ')</span></span></div>';
      }).join('') + '</div></div>';

    // precios por alimento
    var lista = L.preciosPorAlimento(filas), q = L.norm(S.qPre);
    var vis = lista.filter(function (x) { return !q || L.norm(x.alimento).indexOf(q) >= 0; });
    h += '<div class="card"><div class="cab"><h2>Precios adjudicados por alimento</h2><span class="nota">Precio por presentación (S/), agrupado por la equivalencia en la herramienta de menú. Haga clic en un alimento para ver cada adjudicación.</span>' +
      '<span class="der"><input id="qPre" type="search" placeholder="Buscar alimento" value="' + esc(S.qPre) + '"></span></div>';
    h += vis.length ? '<div class="scroll"><table class="tb"><thead><tr><th>Alimento</th><th>Unidad</th><th class="n">Adjudicaciones</th><th class="n">UT/OCT</th><th class="n">Mínimo</th><th class="n">Mediana</th><th class="n">Máximo</th><th>Rango</th></tr></thead><tbody>' +
      vis.map(function (x) {
        var abierto = !!S.abiertoPre[x.alimento], r = x.max - x.min, pos = r > 0 ? 100 * (x.mediana - x.min) / r : 50;
        var main = '<tr class="fila' + (abierto ? ' abierta' : '') + '" data-ali="' + esc(x.alimento) + '" tabindex="0"><td><span class="flecha" aria-hidden="true">' + (abierto ? '▾' : '▸') + '</span> ' + esc(x.alimento) + '</td><td>' + esc(x.unidad) +
          '</td><td class="n">' + num(x.n) + (x.af ? ' <span class="muted">(' + num(x.af) + ' AF)</span>' : '') + '</td><td class="n">' + num(x.nUT) + '</td><td class="n">' + L.soles(x.min) + '</td><td class="n"><b>' + L.soles(x.mediana) +
          '</b></td><td class="n">' + L.soles(x.max) + '</td><td><span class="rango' + (r > 0 ? '' : ' uno') + '" data-tip="Mínimo ' + L.soles(x.min) + ' · mediana ' + L.soles(x.mediana) + ' · máximo ' + L.soles(x.max) + '"><span class="rg-l"></span><span class="rg-m" style="left:' + pos + '%"></span></span>' +
          (x.min > 0 && x.max / x.min >= 1.5 ? ' <span class="tn muted">×' + num(x.max / x.min, 1) + '</span>' : '') + '</td></tr>';
        if (!abierto) return main;
        return main + '<tr class="det"><td colspan="8"><table class="tb in"><thead><tr><th>UT/OCT · Zona o CG</th><th>Modalidad</th><th>Paq.</th><th>Alimento en la convocatoria</th><th>Presentación</th><th>Proveedor</th><th>RUC</th><th class="n">Precio</th></tr></thead><tbody>' +
          x.filas.map(function (f) {
            return '<tr><td><button class="lnk" data-abrir="' + esc(f.id) + '">' + esc(f.utn) + ' · ' + esc(f.zona) + '</button></td><td>' + chipMod(f.mod) + '</td><td>' + esc(f.paq) + '</td><td>' + esc(f.ali) + '</td><td>' + esc(f.env) + ' ' +
              esc(f.pres) + ' ' + esc(f.u) + '</td><td>' + esc(f.prov) + '</td><td class="tn">' + esc(f.ruc) + '</td><td class="n">' + L.soles(f.precio) + '</td></tr>';
          }).join('') + '</tbody></table></td></tr>';
      }).join('') + '</tbody></table></div>' : vacio(lista.length ? 'Ningún alimento coincide con la búsqueda.' : 'Aún no hay precios adjudicados en este filtro.');
    h += '</div>';

    // resultados por paquete
    if (paqs.length) {
      h += '<div class="card"><h2>Resultados por paquete</h2><div class="scroll"><table class="tb"><thead><tr><th>UT/OCT · Zona o CG</th><th>Modalidad</th><th>Paquete</th><th>Resultado</th><th>Proveedor(es) adjudicado(s)</th><th class="n">Precio final ofertado</th><th class="n">Propuestas</th></tr></thead><tbody>' +
        ordenar(conRes).map(function (p) {
          return Object.keys(p.resPaq).map(function (k) {
            var rs = (p.res || []).filter(function (r) { return r.p === k; }), gan = ganadores(p, k), o = {}; o[k] = p.resPaq[k];
            return '<tr><td><button class="lnk" data-abrir="' + esc(p.id) + '">' + esc(p.utn) + ' · ' + esc(p.zona) + '</button></td><td>' + chipMod(p.mod) + '</td><td>' + esc(k) + ' <span class="muted">' + esc((rs[0] || {}).np || '') + '</span></td><td>' +
              resultadoTxt({ resPaq: o }, true) + '</td><td class="sm">' + (gan.length ? gan.map(function (g) { return esc(g.nom) + (g.k ? ' <span class="muted">(' + num(g.k) + ' alimento' + (g.k === 1 ? '' : 's') + ')</span>' : ''); }).join('<br>') : '<span class="muted">-</span>') +
              '</td><td class="n">' + (p.mod !== 'AF' && gan.length === 1 && gan[0].pf !== null && gan[0].pf !== undefined ? L.soles(gan[0].pf) : '<span class="muted">-</span>') + '</td><td class="n">' + num(rs.length) + '</td></tr>';
          }).join('');
        }).join('') + '</tbody></table></div></div>';
    }
    return h;
  }

  // ==================================================================== ACTIVIDAD
  /** Hora de un registro: «13:40» si es de hoy; si no, «21/11 13:40». */
  function horaRegistro(t) { var s = String(t || ''); return s.slice(0, 10) === L.hoyLima() ? s.slice(11, 16) : L.fechaCorta(s) + ' ' + s.slice(11, 16); }
  /** Lo que cambió un registro en un paquete (c) o en toda la zona (c = ''); los registros anteriores a la versión 2.0.46 no lo traen. */
  function detalleRegistro(v, c) {
    if (/^(Registró|Eliminó) el proceso/.test(v.a || '')) return '<span class="muted">' + esc(v.a) + '</span>';
    if (!Array.isArray(v.d) || c === '?') return '<span class="muted">Sin detalle del cambio (registro anterior a esta función)</span>';
    var xs = v.d.filter(function (x) { return x && x[0] === c; });
    if (xs.length) return '<ul class="cambios">' + xs.map(function (x) { return '<li>' + esc(x[1]) + '</li>'; }).join('') + '</ul>';
    return '<span class="muted">' + (c ? 'Cambió otros datos de este paquete' : v.d.length ? 'Sin cambios de la zona' : 'Guardó sin cambios en los datos') + '</span>';
  }
  /** Una fila por paso del registro (p. ej. «7.1.2 Paquete de alimentos»), que se despliega con cada guardado y lo que cambió. */
  function filaPaso(z, q, g) {
    var clave = z.id + '|' + q.c + '|' + g.k, varios = g.regs.length > 1, etq = g.k.replace(/^Actualizó: /, '');
    return '<details class="act-g" data-actg="' + esc(clave) + '"' + (S.actAbiertos.has(clave) ? ' open' : '') + '><summary>' +
      '<span class="hora" title="' + esc(varios ? 'Del ' + L.fechaHora(g.t0) + ' al ' + L.fechaHora(g.t) : L.fechaHora(g.t)) + '">' + esc(L.haceCuanto(g.t)) + '</span>' +
      '<span class="act-gt"><b>' + esc(etq) + '</b>' + (g.n !== null ? ' <span class="muted">· ' + g.n + ' de 12 pasos</span>' : '') +
      (varios ? ' <span class="cnt">' + g.regs.length + ' registros</span>' : '') + (g.usuarios.length ? ' <span class="muted">· ' + esc(g.usuarios.join(', ')) + '</span>' : '') + '</span></summary>' +
      '<ul class="act-det">' + g.regs.map(function (v) {
        return '<li><span class="hora" title="' + esc(L.fechaHora(v.t)) + '">' + esc(horaRegistro(v.t)) + '</span><div>' +
          (g.usuarios.length > 1 && v.u ? '<div class="muted">' + esc(v.u) + '</div>' : '') + detalleRegistro(v, q.c) + '</div></li>';
      }).join('') + '</ul></details>';
  }
  /** Últimos registros por UT/OCT y, dentro, por zona, paquete y paso (lo que cambió cada guardado). Se recuerda qué se plegó o desplegó. */
  function vistaActividad() {
    var e = S.estado;
    var h = '<div class="card"><div class="cab"><h2>Últimos registros en la herramienta</h2><span class="nota">Por UT/OCT, zona, paquete y paso: haga clic en una fila para ver cada guardado y lo que cambió. Cada vez que una especialista guarda un proceso, aparece aquí y el tablero se actualiza.' +
      (e && e.sinc ? ' Revisión completa de todos los procesos: ' + esc(L.fechaHora(e.sinc)) + '.' : '') + '</span></div>';
    if (!S.vivo.length) return h + vacio('Todavía no hay registros desde que se activó el tablero.') + '</div>';
    var hoy = L.hoyLima(), uts = L.agruparVivo(S.vivo, function (id) { return S.P.get(id); });
    return h + uts.map(function (u) {
      return '<details class="act-ut" data-actut="' + esc(u.ut) + '"' + (S.actCerradas.has(u.ut) ? '' : ' open') + '><summary><span class="act-utn">' + esc(u.ut) + '</span>' +
        '<span class="muted">' + num(u.zonas.length) + ' zona' + (u.zonas.length === 1 ? '' : 's') + ' · ' + num(u.n) + ' registro' + (u.n === 1 ? '' : 's') + ' · último ' + esc(L.haceCuanto(u.t)) + '</span></summary>' +
        u.zonas.map(function (z) {
          var p = S.P.get(z.id);
          return '<div class="act-zona"><div class="act-zc"><button class="lnk" data-abrir="' + esc(z.id) + '">' + esc(z.z) + '</button> ' + chipMod(z.m) +
            ' <span class="muted">' + esc(String(z.c || '').toLowerCase()) + '</span>' + (p ? ' ' + badgeEst(L.estadoHoy(p, hoy)) : ' <span class="muted">· ya no está en el tablero</span>') + '</div>' +
            z.paquetes.map(function (q) {
              var paq = q.c && q.c !== '?';
              return '<div class="act-paq' + (paq ? '' : ' gen') + '"><div class="act-pt">' + (paq ? '<span class="pq">' + esc(q.c) + '</span> ' + esc(q.n) : esc(q.n)) + '</div>' +
                q.pasos.map(function (g) { return filaPaso(z, q, g); }).join('') + '</div>';
            }).join('') + '</div>';
        }).join('') + '</details>';
    }).join('') + '</div>';
  }

  // ==================================================================== DETALLE DE UN PROCESO
  function abrir(id) { S.abierto = id; pintarModal(); var m = $('#modal'); m.hidden = false; document.body.classList.add('con-modal'); setTimeout(function () { var c = $('#modal .cerrar'); if (c) c.focus(); }, 0); if (!S.preciosPedidos && H.pedirPrecios) { S.preciosPedidos = true; H.pedirPrecios(); } }
  function cerrar() { S.abierto = null; $('#modal').hidden = true; document.body.classList.remove('con-modal'); }
  function pintarModal() {
    var m = $('#modal .caja'); if (!m || !S.abierto) return;
    var p0 = S.P.get(S.abierto), y = m.scrollTop;
    if (!p0) { m.innerHTML = '<button class="cerrar" aria-label="Cerrar">×</button>' + vacio('Este proceso ya no está en el tablero (se eliminó o se marcó como proceso de prueba).'); return; }
    var hoy = L.hoyLima(), p = Object.assign({}, p0, { e: L.estadoHoy(p0, hoy), acto: L.actoHoy(p0, hoy), sect: sectoristaDe(p0.ut) });
    var h = '<button class="cerrar" aria-label="Cerrar">×</button><div class="m-cab"><div class="eyebrow">' + esc(p.utn) + ' · ' + esc(L.MODALIDAD[p.mod] || p.mod) + '</div><h2>' + esc(p.zona) + ' <span class="muted">' + esc(String(p.conv).toLowerCase()) + '</span></h2>' +
      '<div class="m-est">' + badgeEst(p.e) + ' <span class="muted">' + esc(p.acto.texto) + '</span></div>' +
      '<div class="m-dat"><span>Especialista: <b>' + esc(p.esp || 'sin dato') + '</b></span><span>Sectorista: <b>' + esc(p.sect || '') + '</b></span><span title="' + esc(L.fechaHora(p.act)) + '">Actualizado ' + esc(L.haceCuanto(p.act)) + '</span></div>' +
      (p.estM ? '<div class="m-nota">Motivo del estado: ' + esc(p.estM) + '</div>' : '') + '</div>';
    // pasos
    h += '<section><h3>Avance del registro: ' + p.pasosOk + ' de 12 pasos completos</h3><div class="pasos">' + L.etapas(p.mod).map(function (e) {
      return '<div class="etapa"><div class="et-t">' + esc(e.n + ' ' + e.t) + '</div><ol>' + e.pasos.map(function (s) {
        var x = (p.pasos || {})[s.k] || [0, 0], vig = p.paso === s.k && !L.FINALES.test(p.e);
        var cls = x[0] ? 'ok' : vig ? 'vig' : x[1] ? 'dat' : 'pen', ico = x[0] ? '✓' : vig ? '●' : x[1] ? '' : '○';
        var txt = x[0] ? 'Completo' : vig ? 'Paso vigente' : x[1] ? 'Con registro, incompleto' : 'Pendiente';
        return '<li class="' + cls + '"><span class="pi" aria-hidden="true">' + ico + '</span><span class="ptx"><span class="pn">' + esc(s.n) + '</span> ' + esc(s.t) + '</span><span class="pe">' + txt + '</span>' +
          (vig && p.pend ? '<div class="t3">Falta: ' + esc(p.pend) + '</div>' : '') + '</li>';
      }).join('') + '</ol></div>';
    }).join('') + '</div></section>';
    // cronograma
    var n = L.actos(p.mod);
    h += '<section><h3>Cronograma (Anexo ' + (p.mod === 'AF' ? '3-B' : '3-A') + ')' + (p.reprog ? ' <span class="tag info">Reprogramado</span>' : '') + '</h3>' +
      (p.reprog && p.reprogM ? '<p class="m-nota">Motivo de la reprogramación: ' + esc(p.reprogM) + (p.reprogF ? ' (' + esc(L.fecha(p.reprogF)) + ')' : '') + '</p>' : '') +
      ((p.actos || []).length ? '<table class="tb"><thead><tr><th>Acto</th><th>Desde</th><th>Hasta</th><th>A la fecha</th></tr></thead><tbody>' + p.actos.map(function (a, i) {
        var e = a[1] < hoy ? 'Realizado' : a[0] <= hoy ? 'En curso' : 'Por realizar';
        return '<tr class="' + (e === 'En curso' ? 'cur' : '') + '"><td>' + esc(n[i]) + '</td><td>' + L.fecha(a[0]) + '</td><td>' + L.fecha(a[1]) + '</td><td>' + e + '</td></tr>';
      }).join('') + '</tbody></table>' : '<p class="muted">Aún no tiene cronograma registrado.</p>') + '</section>';
    // ámbito
    h += '<section><h3>Ámbito y paquetes</h3><div class="m-amb"><span><b>' + num(p.ncg) + '</b> CG</span><span><b>' + num(p.nsa) + '</b> SA</span><span><b>' + num(p.nin) + '</b> niñas y niños</span><span><b>' + num(p.nali) + '</b> alimentos</span><span><b>' + num(p.npos) + '</b> propuestas</span></div>' +
      (p.prov ? '<p><span class="muted">Provincias:</span> ' + esc(p.prov) + '</p>' : '') + (p.dist ? '<p><span class="muted">Distritos:</span> ' + esc(p.dist) + '</p>' : '') +
      ((p.paqs || []).length ? '<ul class="paqs">' + p.paqs.map(function (q) { return '<li><b>' + esc(q.c) + '</b> ' + esc(q.n) + (p.resPaq && p.resPaq[q.c] ? ' · ' + resultadoTxt({ resPaq: (function () { var o = {}; o[q.c] = p.resPaq[q.c]; return o; })() }) : '') + '</li>'; }).join('') + '</ul>' : '') + '</section>';
    // resultados
    if ((p.res || []).length) {
      var g = {}; p.res.forEach(function (r) { (g[r.p] = g[r.p] || []).push(r); });
      h += '<section><h3>Postores y resultados</h3>' + Object.keys(g).map(function (k) {
        var af = p.mod === 'AF';
        var adj = {}; ganadores(p, k).forEach(function (x) { if (x.k) adj[x.nom] = x.k; });
        return '<h4>' + esc(k) + ' <span class="muted">' + esc(g[k][0].np || '') + '</span></h4><div class="scroll"><table class="tb"><thead><tr>' + (af ? '' : '<th class="n">Orden</th>') + '<th>Postor</th><th>RUC</th>' + (af ? '' : '<th class="n">Precio final ofertado</th>') +
          '<th>Resultado</th>' + (af ? '<th class="n">Alimentos adjudicados</th>' : '<th>Suscribe el acta</th>') + '</tr></thead><tbody>' + g[k].slice().sort(function (a, b) { return (a.o || 99) - (b.o || 99) || (adj[b.nom] || 0) - (adj[a.nom] || 0) || a.n - b.n; }).map(function (r) {
            return '<tr class="' + (r.s || (af && adj[r.nom]) ? 'cur' : '') + '">' + (af ? '' : '<td class="n">' + (r.o === null ? '' : num(r.o)) + '</td>') + '<td>' + esc(r.nom) + '</td><td class="tn">' + esc(r.ruc) + '</td>' + (af ? '' : '<td class="n">' + L.soles(r.pf) + '</td>') +
              '<td>' + esc(r.r) + '</td>' + (af ? '<td class="n">' + (adj[r.nom] ? num(adj[r.nom]) : '<span class="muted">-</span>') + '</td>' : '<td>' + (r.s ? '✓ Sí' : '') + '</td>') + '</tr>';
          }).join('') + '</tbody></table></div>';
      }).join('') + '</section>';
    }
    // precios
    var pr = S.PR.get(p.id);
    if (p.nAdj) {
      h += '<section><h3>Precios adjudicados (' + num(p.nAdj) + ' alimentos)</h3>' + (!pr ? '<p class="muted">' + (S.preciosListos ? 'Sin precios publicados.' : 'Cargando…') + '</p>' :
        '<div class="scroll"><table class="tb"><thead><tr><th>Paq.</th><th>Alimento en la convocatoria</th><th>Equivalencia en la herramienta</th><th>Presentación</th><th>Proveedor</th><th class="n">Precio</th></tr></thead><tbody>' +
        pr.f.map(function (f) { return '<tr><td>' + esc(f[0]) + '</td><td>' + esc(f[1]) + '</td><td class="sm">' + esc(f[2]) + '</td><td>' + esc(f[3]) + ' ' + esc(f[4]) + ' ' + esc(f[5]) + '</td><td class="sm">' + esc(f[7]) + '</td><td class="n">' + L.soles(f[6]) + '</td></tr>'; }).join('') +
        '</tbody></table></div>') + '</section>';
    }
    h += '<p class="m-pie muted">ID del proceso: ' + esc(p.id) + ' · versión ' + num(p.ver) + ' · creado ' + esc(L.fechaHora(p.cre)) + '</p>';
    m.innerHTML = h; m.scrollTop = y;
  }

  // ==================================================================== pintar
  var pend = 0;
  function programar() { if (pend) return; pend = requestAnimationFrame(function () { pend = 0; pintar(); }); }
  function pintar() {
    if (!S.listo || !S.meta) return;
    var arr = todos();
    var html = S.vista === 'res' ? vistaResumen(arr) : S.vista === 'pro' ? vistaProcesos(arr) : S.vista === 'cro' ? vistaCronograma(arr) : S.vista === 'pre' ? vistaPrecios(arr) : vistaActividad();
    var cont = $(VISTAS[S.vista][0]), foco = document.activeElement && document.activeElement.id;
    cont.innerHTML = html;
    var o = $('#orden'); if (o) o.value = S.orden;
    if (foco === 'qPre') { var q = $('#qPre'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    if (S.abierto) pintarModal();
    pintarChips();
    var e = $('#hFiltro'); if (e) e.textContent = filtroActivoTxt();
    // las filas recién actualizadas pierden el resaltado después de unos segundos
    if (S.recientes.size) setTimeout(function () { var t = Date.now(), cambio = false; S.recientes.forEach(function (v, k) { if (t - v >= 8000) { S.recientes.delete(k); cambio = true; } }); if (cambio) programar(); }, 8200);
  }
  function pintarVivo() {
    var u = S.vivo[0];
    conexion(u ? 'En vivo · último registro ' + esc(L.haceCuanto(u.t)) + ': ' + esc(u.ut) : 'En vivo: se actualiza solo con cada registro', 'ok');
  }
  function pintarChips() {
    var c = $('#chips'), f = S.f, t = [];
    if (f.est) t.push(['est', 'Estado: ' + (NOMBRE_EST[f.est] || f.est)]);
    if (f.paso) t.push(['paso', 'Paso: ' + L.PASO_CORTO[f.paso]]);
    if (f.acto) t.push(['acto', 'Acto de hoy: ' + actoTxt(f.acto)]);
    c.innerHTML = t.map(function (x) { return '<button class="fchip" data-quitar="' + x[0] + '">' + esc(x[1]) + ' <span aria-hidden="true">×</span><span class="sr">Quitar filtro</span></button>'; }).join('');
    c.hidden = !t.length;
    var hay = f.ut || f.sect || f.mod || f.est || f.q || f.paso || f.acto;
    $('#limpiar').disabled = !hay;
  }
  function opcionesFiltros() {
    if (!S.meta) return;
    var sects = []; S.meta.uts.forEach(function (u) { if (u.s && sects.indexOf(u.s) < 0) sects.push(u.s); });
    sects.sort(function (a, b) { return a.localeCompare(b, 'es'); });
    var fs = $('#fSect'); fs.innerHTML = '<option value="">Todos</option>' + sects.map(function (s) { return '<option>' + esc(s) + '</option>'; }).join(''); fs.value = S.f.sect;
    var fu = $('#fUT'), lista = S.meta.uts.filter(function (u) { return !S.f.sect || u.s === S.f.sect; }).slice().sort(function (a, b) { return a.n.localeCompare(b.n, 'es'); });
    fu.innerHTML = '<option value="">Todas</option>' + lista.map(function (u) { return '<option value="' + esc(u.c) + '">' + esc(u.n) + '</option>'; }).join('');
    if (S.f.ut && !lista.some(function (u) { return u.c === S.f.ut; })) S.f.ut = '';
    fu.value = S.f.ut; $('#fMod').value = S.f.mod; $('#fQ').value = S.f.q;
  }
  function guardarFiltros() { try { localStorage.setItem('conv2027_f', JSON.stringify(S.f)); } catch (e) { } }

  // ==================================================================== interacción
  function cambiarVista(v, sinHash) {
    if (!VISTAS[v]) v = 'res';
    S.vista = v;
    Object.keys(VISTAS).forEach(function (k) { $(VISTAS[k][0]).hidden = k !== v; var t = $('[data-vista="' + k + '"]'); t.setAttribute('aria-selected', k === v ? 'true' : 'false'); t.classList.toggle('on', k === v); });
    if (!sinHash) try { history.replaceState(null, '', '#' + VISTAS[v][1]); } catch (e) { }
    programar();
  }
  function vistaDeHash() { var h = (location.hash || '').slice(1); var k = Object.keys(VISTAS).find(function (x) { return VISTAS[x][1] === h; }); return k || 'res'; }
  function aviso(html) {
    var t = $('#toast'); t.innerHTML = '<span class="pv nuevo"></span><span>' + html + '</span>'; t.hidden = false; t.classList.remove('sale'); void t.offsetWidth; t.classList.add('entra');
    clearTimeout(aviso._t); aviso._t = setTimeout(function () { t.classList.add('sale'); setTimeout(function () { t.hidden = true; }, 400); }, 6000);
  }

  function iniciar(acciones) {
    H = acciones || {};
    try { var g = JSON.parse(localStorage.getItem('conv2027_f') || 'null'); if (g) Object.keys(S.f).forEach(function (k) { if (typeof g[k] === 'string') S.f[k] = g[k]; }); } catch (e) { }
    $$('[data-vista]').forEach(function (b) { b.onclick = function () { cambiarVista(b.getAttribute('data-vista')); window.scrollTo({ top: 0 }); }; });
    $('#fUT').onchange = function () { S.f.ut = this.value; guardarFiltros(); programar(); };
    $('#fSect').onchange = function () { S.f.sect = this.value; opcionesFiltros(); guardarFiltros(); programar(); };
    $('#fMod').onchange = function () { S.f.mod = this.value; guardarFiltros(); programar(); };
    var tq = 0; $('#fQ').oninput = function () { var v = this.value; clearTimeout(tq); tq = setTimeout(function () { S.f.q = v.trim(); guardarFiltros(); programar(); }, 200); };
    $('#limpiar').onclick = function () { S.f = { ut: '', sect: '', mod: '', est: '', q: '', paso: '', acto: '' }; opcionesFiltros(); guardarFiltros(); programar(); };
    $('#btnSalir').onclick = function () { if (H.salir) H.salir(); };
    // delegación de clics
    // últimos registros: se recuerda qué UT/OCT plegó el usuario (el evento toggle no burbujea: se escucha en captura)
    document.addEventListener('toggle', function (ev) {
      var d = ev.target; if (!d || !d.matches) return;
      if (d.matches('details[data-actut]')) { if (d.open) S.actCerradas.delete(d.getAttribute('data-actut')); else S.actCerradas.add(d.getAttribute('data-actut')); }
      if (d.matches('details[data-actg]')) { if (d.open) S.actAbiertos.add(d.getAttribute('data-actg')); else S.actAbiertos.delete(d.getAttribute('data-actg')); }
    }, true);
    document.addEventListener('click', function (ev) {
      var t = ev.target.closest('[data-abrir],[data-est],[data-paso],[data-acto],[data-ut],[data-quitar],[data-ali],#csv,.cerrar,#modal');
      if (!t) return;
      if (t.id === 'modal') { if (ev.target === t) cerrar(); return; }
      if (t.classList.contains('cerrar')) { cerrar(); return; }
      if (t.id === 'csv') { descargarCSV(); return; }
      if (t.hasAttribute('data-abrir')) { abrir(t.getAttribute('data-abrir')); return; }
      if (t.hasAttribute('data-quitar')) { S.f[t.getAttribute('data-quitar')] = ''; guardarFiltros(); programar(); return; }
      if (t.hasAttribute('data-ut')) { S.f.ut = t.getAttribute('data-ut'); opcionesFiltros(); guardarFiltros(); cambiarVista('pro'); window.scrollTo({ top: 0 }); return; }
      if (t.hasAttribute('data-ali')) { var k = t.getAttribute('data-ali'); S.abiertoPre[k] = !S.abiertoPre[k]; programar(); return; }
      if (t.hasAttribute('data-paso')) { var p = t.getAttribute('data-paso'); S.f.paso = S.f.paso === p ? '' : p; if (S.f.paso) { S.f.est = ''; S.f.acto = ''; } guardarFiltros(); if (S.f.paso) cambiarVista('pro'); else programar(); return; }
      if (t.hasAttribute('data-acto')) { var ak = t.getAttribute('data-acto'); S.f.acto = S.f.acto === ak ? '' : ak; if (S.f.acto) { S.f.est = ''; S.f.paso = ''; } guardarFiltros(); if (S.f.acto) { cambiarVista('cro'); window.scrollTo({ top: 0 }); } else programar(); return; }
      if (t.hasAttribute('data-est')) { var e = t.getAttribute('data-est'); S.f.est = S.f.est === e ? '' : e; if (e) { S.f.paso = ''; S.f.acto = ''; } guardarFiltros(); programar(); }
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && S.abierto) { cerrar(); return; }
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.matches('tr[data-abrir],div[data-abrir],tr[data-ali]')) { ev.preventDefault(); ev.target.click(); }
    });
    document.addEventListener('change', function (ev) {
      if (ev.target.id === 'orden') { S.orden = ev.target.value; programar(); }
      if (ev.target.id === 'diasAg') { S.diasAg = Number(ev.target.value) || 14; programar(); }
    });
    document.addEventListener('input', function (ev) { if (ev.target.id === 'qPre') { S.qPre = ev.target.value; programar(); } });
    // tooltip
    var tip = $('#tip');
    var mostrar = function (el, x, y) { tip.innerHTML = el.getAttribute('data-tip'); tip.hidden = false; var r = tip.getBoundingClientRect(), W = window.innerWidth;
      var left = Math.min(W - r.width - 8, Math.max(8, x + 14)), top = y + 16 + r.height > window.innerHeight ? y - r.height - 12 : y + 16; tip.style.left = left + 'px'; tip.style.top = top + 'px'; };
    document.addEventListener('pointermove', function (ev) { var el = ev.target.closest && ev.target.closest('[data-tip]'); if (el) mostrar(el, ev.clientX, ev.clientY); else tip.hidden = true; });
    document.addEventListener('focusin', function (ev) { var el = ev.target.closest && ev.target.closest('[data-tip]'); if (el) { var r = el.getBoundingClientRect(); mostrar(el, r.left + r.width / 2, r.bottom); } else tip.hidden = true; });
    window.addEventListener('scroll', function () { tip.hidden = true; }, { passive: true });
    // la hora relativa y el estado a la fecha se refrescan cada minuto
    setInterval(function () { pintarVivo(); programar(); }, 60000);
    cambiarVista(vistaDeHash(), true);
    opcionesFiltros();
  }

  window.Tablero = { iniciar: iniciar, setMeta: setMeta, setProceso: setProceso, setPrecios: setPrecios, preciosListos: preciosListos, setVivo: setVivo, setEstado: setEstado, listo: listo, conexion: conexion, abrir: abrir };
})();
