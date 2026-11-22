// Conexión con Firebase: ingreso con la clave del tablero y lectura en vivo de Firestore.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

// Configuración web del proyecto de Firebase (no es secreta). Los datos solo se leen con la clave:
// las reglas de Firestore exigen haber ingresado como el usuario lector.
const app = initializeApp({
  apiKey: "AIzaSyAQ2IYB4dWpYN9cd2QVOaGM6qV3VNKS1ZE",
  authDomain: "tablero-envios-pncm.firebaseapp.com",
  projectId: "tablero-envios-pncm",
  storageBucket: "tablero-envios-pncm.firebasestorage.app",
  messagingSenderId: "451578736279",
  appId: "1:451578736279:web:fc61c6f9ee23564bee43d2"
});
const LECTOR = "lector@nutricion-utai.github.io";   // usuario de Firebase Authentication cuya contraseña es la clave del tablero
const RAIZ = "conv2027";
const auth = getAuth(app), db = getFirestore(app);
const $ = s => document.querySelector(s);
const T = window.Tablero;

let subs = [], subPre = null, cortado = false;

// enlace con la clave (#clave=...): se usa una vez y se borra de la barra de direcciones
let claveEnlace = "";
const m = (location.hash || "").match(/^#clave=(.+)$/);
if (m) { claveEnlace = decodeURIComponent(m[1]); try { history.replaceState(null, "", location.pathname + location.search); } catch (_) {} }

T.iniciar({ pedirPrecios, salir });

function leer(sn) { try { return JSON.parse(sn.data().d); } catch (_) { return null; } }

function escuchar() {
  cortado = false;
  T.conexion("Conectando con la base de datos…");
  let primero = true;
  subs.push(onSnapshot(doc(db, RAIZ, "meta"), sn => T.setMeta(sn.exists() ? leer(sn) : { uts: [] }), errorLectura));
  subs.push(onSnapshot(collection(db, RAIZ, "datos", "procesos"), { includeMetadataChanges: true }, qs => {
    qs.docChanges().forEach(ch => T.setProceso(ch.doc.id, ch.type === "removed" ? null : leer(ch.doc), !primero));
    if (primero && !qs.metadata.fromCache) { primero = false; T.listo(); }
    else if (primero && qs.metadata.fromCache && qs.size) { T.listo(); }
    if (qs.metadata.fromCache) T.conexion("Sin conexión: se muestra lo último recibido", "err");
    else T.setVivo(ultimoVivo);
  }, errorLectura));
  let vivoIni = true;
  subs.push(onSnapshot(doc(db, RAIZ, "vivo"), sn => { ultimoVivo = sn.exists() ? (leer(sn) || []) : []; T.setVivo(ultimoVivo, !vivoIni); vivoIni = false; }, () => {}));
  subs.push(onSnapshot(doc(db, RAIZ, "estado"), sn => T.setEstado(sn.exists() ? leer(sn) : null), () => {}));
}
let ultimoVivo = [];

function pedirPrecios() {
  if (subPre || cortado) return;
  subPre = onSnapshot(collection(db, RAIZ, "datos", "precios"), qs => {
    qs.docChanges().forEach(ch => T.setPrecios(ch.doc.id, ch.type === "removed" ? null : leer(ch.doc)));
    T.preciosListos();
  }, errorLectura);
}

function cortar() {
  cortado = true;
  subs.forEach(u => u()); subs = [];
  if (subPre) { subPre(); subPre = null; }
}

function errorLectura(err) {
  if (err && err.code === "permission-denied") {
    cortar();
    signOut(auth).finally(() => mostrarIngreso("La clave del tablero cambió o esta sesión ya no tiene acceso. Ingrese la clave vigente."));
    return;
  }
  T.conexion("No se pudo leer la base de datos: " + (err && err.message || err), "err");
}

function salir() { cortar(); signOut(auth).finally(() => location.reload()); }

function mostrarIngreso(msg) {
  $("#login").hidden = false;
  $("#lgErr").textContent = msg || "";
  $("#lgBtn").disabled = false;
  setTimeout(() => $("#lgClave").focus(), 50);
}

async function ingresar(clave) {
  $("#lgBtn").disabled = true; $("#lgErr").textContent = "";
  try { await signInWithEmailAndPassword(auth, LECTOR, clave); }
  catch (e) {
    const c = e && e.code || "";
    const txt = /invalid-credential|wrong-password|user-not-found|invalid-login/.test(c) ? "La clave no es correcta."
      : /too-many-requests/.test(c) ? "Demasiados intentos. Espere unos minutos y vuelva a intentarlo."
      : /network/.test(c) ? "Sin conexión a internet."
      : "No se pudo ingresar (" + (c || e.message) + ").";
    mostrarIngreso(txt);
  }
}

$("#lgForm").addEventListener("submit", ev => { ev.preventDefault(); const v = $("#lgClave").value; if (v) ingresar(v); });

onAuthStateChanged(auth, u => {
  if (u) {
    $("#login").hidden = true; $("#lgClave").value = "";
    if (!subs.length) escuchar();
  } else {
    cortar();
    if (claveEnlace) { const c = claveEnlace; claveEnlace = ""; ingresar(c); }
    else mostrarIngreso();
  }
});
