// ═══════════════════════════════════════════════════
//  ALDIA APP — script.js v6
//  Fix completo notificaciones push + auto-refresh
// ═══════════════════════════════════════════════════

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, getDocs, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  getMessaging, getToken, onMessage
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js";

// ════════════════════════════════════════════════════
//  CONFIG
// ════════════════════════════════════════════════════
const CFG = Object.freeze({
  firebase: {
    apiKey:            "AIzaSyB2vua5gMe7hspIMtVunPAmWWkUB3-nt5A",
    authDomain:        "aldia-app1.firebaseapp.com",
    projectId:         "aldia-app1",
    storageBucket:     "aldia-app1.firebasestorage.app",
    messagingSenderId: "1013051386288",
    appId:             "1:1013051386288:web:e588c83d0892d6cbab4e75",
    measurementId:     "G-28VQ7VM4KS",
  },
  alias:      "contrerassmathias",
  monto:      "$2.200",
  mpLink:     "https://mpago.la/2bugXHU",
  vapidKey:   "BCTslJPoTqAMsjQS_J6obznv5ZUDo2o3dYbRNK6cnMJokpsOv0cPKHZNNtPOZ7QbpLFTpu4IfH6UMHhrlo3r0ao",
  backendUrl: "https://aldia-app-production.up.railway.app",
  empresaUrl: "https://www.edenor.com.ar/pagos",
  soporteWA:  "5491112345678",
  sessionKey: "aldia_user_v6",
  dlKey:      "aldia_descargas_v4",
  obKey:      "aldia_ob_done",
});

// ════════════════════════════════════════════════════
//  DATOS DEMO
// ════════════════════════════════════════════════════
const DEMO = Object.freeze({
  boletas: [
    { id:"b4", periodo:"Enero 2025",     vencimiento:"10/01/2025", emitida:"01/01/2025" },
    { id:"b3", periodo:"Diciembre 2024", vencimiento:"10/12/2024", emitida:"01/12/2024" },
    { id:"b2", periodo:"Noviembre 2024", vencimiento:"10/11/2024", emitida:"01/11/2024" },
    { id:"b1", periodo:"Octubre 2024",   vencimiento:"10/10/2024", emitida:"01/10/2024" },
  ],
  venc:      { fecha:"10/02/2025", dias:"8 días" },
  inicioMem: "01/01/2025",
  novedades: [
    { id:"n3", tipo:"alerta", titulo:"Corte programado",        cuerpo:"El día 28/01 de 9:00 a 13:00 hs habrá un corte en el barrio Centro.", fecha:"20/01/2025" },
    { id:"n2", tipo:"aviso",  titulo:"Actualización de tarifas",cuerpo:"A partir de febrero se aplica el nuevo cuadro tarifario.", fecha:"15/01/2025" },
    { id:"n1", tipo:"info",   titulo:"Nueva función: descarga", cuerpo:"Ya podés descargar tus últimas 4 boletas en PDF desde la app.", fecha:"01/01/2025" },
  ],
});

// ════════════════════════════════════════════════════
//  FIREBASE
// ════════════════════════════════════════════════════
let db = null, messaging = null;
try {
  const app = initializeApp(CFG.firebase);
  db        = getFirestore(app);
  messaging = getMessaging(app);
} catch(e) { console.warn("[AlDía] Demo mode:", e.message); }

// ════════════════════════════════════════════════════
//  ESTADO GLOBAL
// ════════════════════════════════════════════════════
const State = {
  user:        null,
  fcmToken:    null,
  loading:     false,
  regStep:     1,
  obSlide:     0,
  forgotStep:  1,
  forgotSmsCode: null,
  refreshTimer:  null,
};

// ════════════════════════════════════════════════════
//  DOM HELPERS
// ════════════════════════════════════════════════════
const $  = id => document.getElementById(id);
const SCREENS = {
  onboarding: $("screen-onboarding"),
  benefits:   $("screen-benefits"),
  auth:       $("screen-auth"),
  dashboard:  $("screen-dashboard"),
  novedades:  $("screen-novedades"),
  pending:    $("screen-pending"),
};

function goTo(name) {
  Object.values(SCREENS).forEach(s => s?.classList.remove("active"));
  SCREENS[name]?.classList.add("active");
  window.scrollTo({ top:0, behavior:"smooth" });
}

// ════════════════════════════════════════════════════
//  FCM TOKEN — obtener y guardar
// ════════════════════════════════════════════════════
async function obtenerFCMToken() {
  if (State.fcmToken) return State.fcmToken;
  if (!messaging) return null;
  try {
    // Primero registrar el SW
    let swReg = null;
    if ("serviceWorker" in navigator) {
      try {
        swReg = await navigator.serviceWorker.register("/firebase-messaging-sw.js");
        await navigator.serviceWorker.ready;
      } catch(e) { console.warn("[SW FCM]", e.message); }
    }

    const perm = await Notification.requestPermission();
    if (perm !== "granted") {
      console.warn("[FCM] Permiso denegado");
      return null;
    }

    const token = await getToken(messaging, {
      vapidKey:        CFG.vapidKey,
      serviceWorkerRegistration: swReg || undefined,
    });

    if (token) {
      State.fcmToken = token;
      console.info("[FCM] Token obtenido:", token.substring(0,20) + "…");
    }
    return token;
  } catch(e) {
    console.warn("[FCM] Error:", e.message);
    return null;
  }
}

async function actualizarTokenBackend(usuarioId, token) {
  if (!usuarioId || !token || token.length < 100) return;
  try {
    await fetch(`${CFG.backendUrl}/usuario/${usuarioId}/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fcmToken: token }),
      signal:  AbortSignal.timeout(5000),
    });
    console.info("[FCM] Token actualizado en backend");
  } catch(e) { console.warn("[FCM] No se pudo actualizar token:", e.message); }
}

// ════════════════════════════════════════════════════
//  SPLASH + ARRANQUE
// ════════════════════════════════════════════════════
window.addEventListener("DOMContentLoaded", async () => {
  const aliasEl = $("aliasDisplay");
  if (aliasEl) aliasEl.textContent = CFG.alias;

  const saved = loadSession();
  if (saved) {
    State.user = saved;
    setTimeout(async () => {
      hideSplash();
      // Verificar estado actualizado
      const actualizado = await verificarEstadoUsuario(saved);
      State.user = actualizado;
      saveSession(actualizado);
      showDashboard(actualizado);
      // Actualizar FCM token si cambió
      const token = await obtenerFCMToken();
      if (token && token !== actualizado.fcmToken) {
        actualizarTokenBackend(actualizado.id, token);
      }
    }, 700);
    return;
  }

  const obDone = localStorage.getItem(CFG.obKey);
  setTimeout(() => {
    hideSplash();
    if (obDone) goTo("benefits");
    else        goTo("onboarding");
  }, 1400);
});

function hideSplash() {
  const s = $("splash");
  if (!s) return;
  s.classList.add("exit");
  $("app")?.classList.remove("hidden");
  setTimeout(() => { s.style.display = "none"; }, 500);
}

// ════════════════════════════════════════════════════
//  VERIFICAR ESTADO USUARIO — desde backend
// ════════════════════════════════════════════════════
async function verificarEstadoUsuario(user) {
  if (!user?.id || user.id.startsWith("demo-")) return user;
  try {
    const resp = await fetch(`${CFG.backendUrl}/usuario/${user.id}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) return user;
    const data = await resp.json();
    if (data.usuario) return { ...user, ...data.usuario };
  } catch(e) { console.warn("[Estado]", e.message); }
  return user;
}

// ════════════════════════════════════════════════════
//  AUTO-REFRESH — verifica estado cada 30s si pendiente
// ════════════════════════════════════════════════════
function startPendingCheck() {
  stopPendingCheck();
  State.refreshTimer = setInterval(async () => {
    if (!State.user?.id || State.user.estado === "activo") {
      stopPendingCheck(); return;
    }
    const actualizado = await verificarEstadoUsuario(State.user);
    if (actualizado.estado === "activo") {
      State.user = actualizado;
      saveSession(actualizado);
      stopPendingCheck();
      renderDashboard(actualizado);
      toast("✅ Tu cuenta fue activada", "success", 5000);
    }
  }, 30000);
}

function stopPendingCheck() {
  if (State.refreshTimer) { clearInterval(State.refreshTimer); State.refreshTimer = null; }
}

// ════════════════════════════════════════════════════
//  ONBOARDING
// ════════════════════════════════════════════════════
$("btnObNext")?.addEventListener("click", () => {
  if (State.obSlide < 2) goToObSlide(State.obSlide + 1);
  else finishOnboarding();
});
$("btnObSkip")?.addEventListener("click", finishOnboarding);

function goToObSlide(idx) {
  $(`ob${State.obSlide}`)?.classList.remove("active");
  $(`od${State.obSlide}`)?.classList.remove("active");
  State.obSlide = idx;
  $(`ob${idx}`)?.classList.add("active");
  $(`od${idx}`)?.classList.add("active");
  const lbl = $("btnObLabel");
  if (lbl) lbl.textContent = idx === 2 ? "¡Empezar ahora!" : "Siguiente";
}

function finishOnboarding() {
  localStorage.setItem(CFG.obKey, "1");
  goTo("benefits");
}

// ════════════════════════════════════════════════════
//  NAVEGACIÓN
// ════════════════════════════════════════════════════
$("btnGoRegister")?.addEventListener("click", () => {
  goTo("auth"); switchTab("register");
  obtenerFCMToken(); // pedir permiso notificaciones al registrarse
});
$("btnGoLogin")?.addEventListener("click",    () => { goTo("auth"); switchTab("login"); });
$("btnBackAuth")?.addEventListener("click",   () => goTo("benefits"));
$("btnBackNov")?.addEventListener("click",    () => goTo("dashboard"));
$("btnGoToDash")?.addEventListener("click",   () => showDashboard(State.user));

$("btnLogoutUser")?.addEventListener("click", () => {
  clearSession(); stopPendingCheck();
  State.user = null; State.fcmToken = null;
  goTo("benefits"); toast("Sesión cerrada", "");
});
$("btnNovAvisos")?.addEventListener("click", () => {
  renderNovedades(); goTo("novedades");
  const nd = $("notifDot"); if (nd) nd.style.display = "none";
});
$("btnSupport")?.addEventListener("click", () => {
  const n = State.user?.nombre || "Cliente";
  const c = State.user?.nroCliente || "—";
  window.open(`https://wa.me/${CFG.soporteWA}?text=${encodeURIComponent(`Hola AlDía, soy ${n} (N° ${c}). Necesito ayuda con:`)}`, "_blank");
});
$("btnPayLink")?.addEventListener("click", () => window.open(CFG.empresaUrl, "_blank"));

// ════════════════════════════════════════════════════
//  AUTH TABS
// ════════════════════════════════════════════════════
window.switchTab = function(tab) {
  $("tabIndicator")?.classList.toggle("right", tab === "register");
  $("tabLogin")?.classList.toggle("active",     tab === "login");
  $("tabRegister")?.classList.toggle("active",  tab === "register");
  $("loginForm")?.classList.toggle("hidden",    tab !== "login");
  $("registerForm")?.classList.toggle("hidden", tab !== "register");
  if (tab === "register") { resetStepper(); obtenerFCMToken(); }
};

// ════════════════════════════════════════════════════
//  OJO CONTRASEÑA
// ════════════════════════════════════════════════════
function eyeToggle(id) { const i=$(id); if(i) i.type = i.type==="password"?"text":"password"; }
$("btnEyeLogin")?.addEventListener("click", () => eyeToggle("loginPass"));
$("btnEyeReg")?.addEventListener("click",   () => eyeToggle("password"));

// ════════════════════════════════════════════════════
//  LOGIN — via backend
// ════════════════════════════════════════════════════
$("btnLogin")?.addEventListener("click", handleLogin);
$("loginPass")?.addEventListener("keydown", e => { if (e.key==="Enter") handleLogin(); });

async function handleLogin() {
  if (State.loading) return;
  const usuario = $("loginUser")?.value.trim() || "";
  const pass    = $("loginPass")?.value        || "";
  const errEl   = $("loginError");
  if (errEl) errEl.textContent = "";
  if (!usuario || !pass) { if(errEl) errEl.textContent="Completá usuario y contraseña"; return; }

  State.loading = true;
  setLoading("btnLogin", true, "Ingresando...");
  try {
    // Obtener token FCM antes del login
    const token = await obtenerFCMToken();

    const resp = await fetch(`${CFG.backendUrl}/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ usuario, password: pass, fcmToken: token || "no-token" }),
      signal:  AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (!resp.ok) { if(errEl) errEl.textContent = data.error || "Error al ingresar"; return; }

    State.user = data.usuario;
    saveSession(data.usuario);
    showDashboard(data.usuario);
    toast("Bienvenido ✓", "success");
  } catch(e) {
    console.error("[Login]", e);
    if(errEl) errEl.textContent = "Error al ingresar. Intentá de nuevo.";
  } finally {
    State.loading = false;
    setLoading("btnLogin", false, "Ingresar");
  }
}

// ════════════════════════════════════════════════════
//  STEPPER REGISTRO
// ════════════════════════════════════════════════════
function resetStepper() {
  State.regStep = 1;
  showRegStep(1);
}

function showRegStep(step) {
  State.regStep = step;
  [$("regStep1"), $("regStep2"), $("regStep3")].forEach((el,i) => {
    if (el) el.classList.toggle("hidden", i+1 !== step);
  });
  const fill = $("regStepFill");
  if (fill) fill.style.width = `${Math.round((step/3)*100)}%`;
  [0,1,2].forEach(i => {
    const step_el = $(`rstep${i}`);
    if (!step_el) return;
    step_el.classList.remove("active","done");
    if (i+1 === step)    step_el.classList.add("active");
    else if (i+1 < step) step_el.classList.add("done");
  });
}

$("btnRegStep1")?.addEventListener("click", () => {
  if (!validateForm()) return;
  showRegStep(2);
});

// PASO 2 → Registrar directamente
$("btnRegStep2")?.addEventListener("click", handleRegister);
$("btnRegister")?.addEventListener("click", handleRegister);

async function handleRegister() {
  if (State.loading) return;
  const errEl = $("registerError2") || $("registerError");
  if (errEl) errEl.textContent = "";

  State.loading = true;
  setLoading("btnRegStep2", true, "Registrando...");

  try {
    // Obtener FCM token ANTES de registrar
    const token = await obtenerFCMToken();
    console.info("[Registro] FCM Token:", token ? token.substring(0,20)+"…" : "NO TOKEN");

    const payload = {
      nroCliente: $("nroCliente")?.value.trim()  || "",
      nombre:     $("nombre")?.value.trim()      || "",
      dni:        $("dni")?.value.trim()         || "",
      usuario:    $("usuario")?.value.trim()     || "",
      celular:    $("celular")?.value.trim()     || "",
      direccion:  $("direccion")?.value.trim()   || "",
      password:   $("password")?.value          || "",
      fcmToken:   token || "no-token",
    };

    const resp = await fetch(`${CFG.backendUrl}/registro`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
      signal:  AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (errEl) errEl.textContent = data.error || "Error al registrar. Intentá de nuevo.";
      return;
    }

    State.user = { ...payload, id: data.usuarioId, estado: "pendiente" };
    saveSession(State.user);
    goTo("pending");
    toast("¡Registro exitoso!", "success");
    // Iniciar verificación de estado
    startPendingCheck();

  } catch(e) {
    console.error("[Registro]", e);
    if(errEl) errEl.textContent = "Error al registrar. Intentá de nuevo.";
  } finally {
    State.loading = false;
    setLoading("btnRegStep2", false, "Ya pagué — Registrarme");
    setLoading("btnRegister", false, "Confirmar y registrar");
  }
}

// ════════════════════════════════════════════════════
//  RECUPERAR CONTRASEÑA
// ════════════════════════════════════════════════════
$("btnForgot")?.addEventListener("click",      openForgot);
$("btnCloseForgot")?.addEventListener("click", closeForgot);
$("modalForgot")?.addEventListener("click", e => { if(e.target===$("modalForgot")) closeForgot(); });

function openForgot() {
  State.forgotStep = 1; State.forgotSmsCode = null;
  ["forgotCelular","forgotNewPass"].forEach(id=>{ const el=$(id); if(el) el.value=""; });
  const err=$("forgotError"); if(err) err.textContent="";
  $("forgotCodeGroup")   && ($("forgotCodeGroup").style.display="none");
  $("forgotNewPassGroup")&& ($("forgotNewPassGroup").style.display="none");
  const btn=$("btnForgotAction");
  if(btn) btn.querySelector("span").textContent="Enviar código por WhatsApp";
  $("modalForgot")?.classList.remove("hidden");
}
function closeForgot() { $("modalForgot")?.classList.add("hidden"); State.forgotStep=1; }

$("btnForgotAction")?.addEventListener("click", async () => {
  const err=$("forgotError"); if(err) err.textContent="";
  const btn=$("btnForgotAction");
  if (State.forgotStep===1) {
    const cel=$("forgotCelular")?.value.trim()||"";
    if (!/^\d{8,15}$/.test(cel)) { if(err) err.textContent="Ingresá un número válido"; return; }
    State.forgotSmsCode = String(Math.floor(1000+Math.random()*9000));
    toast(`Código demo: ${State.forgotSmsCode}`, "success");
    $("forgotCodeGroup").style.display="block";
    if(btn) btn.querySelector("span").textContent="Confirmar código";
    State.forgotStep=2;
  } else if (State.forgotStep===2) {
    const cod=[0,1,2,3].map(i=>$(`fsms${i}`)?.value||"").join("");
    if(cod!==State.forgotSmsCode){ if(err) err.textContent="Código incorrecto"; return; }
    $("forgotNewPassGroup").style.display="block";
    if(btn) btn.querySelector("span").textContent="Cambiar contraseña";
    State.forgotStep=3;
  } else if (State.forgotStep===3) {
    const np=$("forgotNewPass")?.value||"";
    if(np.length<6){ if(err) err.textContent="Mínimo 6 caracteres"; return; }
    closeForgot();
    toast("Contraseña actualizada. Ingresá con la nueva clave.", "success", 5000);
  }
});

// ════════════════════════════════════════════════════
//  DASHBOARD
// ════════════════════════════════════════════════════
function showDashboard(user) {
  goTo("dashboard");
  $("dashSkeleton") && ($("dashSkeleton").style.display = "");
  $("dashContent")  && ($("dashContent").style.display  = "none");

  setTimeout(() => {
    $("dashSkeleton") && ($("dashSkeleton").style.display = "none");
    $("dashContent")  && ($("dashContent").style.display  = "");
    renderDashboard(user);
  }, 600);
}

function renderDashboard(user) {
  if (!user) return;
  const nombre = user.nombre || "Usuario";
  const activo = user.estado === "activo";

  $("dashAvatar") && ($("dashAvatar").textContent = nombre[0].toUpperCase());
  $("dashName")   && ($("dashName").textContent   = nombre.split(" ")[0]);
  if (user.nroCliente) {
    const el=$("dashClienteNum"); if(el) el.innerHTML=`N° cliente: <strong>${escHtml(user.nroCliente)}</strong>`;
  }

  const dot=$("dashDot"), txt=$("dashStatusText"), ban=$("pendingBanner");
  const stats=$("dashStatsRow"), payLink=$("payLinkCard");
  const memCard=$("membresiaCard"), vencCard=$("vencCard");

  if(dot)     dot.className   = `status-dot ${activo?"active":"pending"}`;
  if(txt)     txt.textContent = activo?"Cuenta activa":"Cuenta pendiente";
  if(ban)     ban.style.display   = activo?"none":"";
  if(stats)   stats.style.display = activo?"":"none";
  if(payLink) payLink.style.display = activo?"":"none";

  if (activo) {
    stopPendingCheck();
    if(memCard) memCard.style.display="";
    if(vencCard) vencCard.style.display="none";
    const diasNum = 8;
    const pct = Math.round((1 - diasNum/30) * 100);
    $("mcDias")       && ($("mcDias").textContent       = `${diasNum} días`);
    $("mcFechaInicio")&& ($("mcFechaInicio").textContent = DEMO.inicioMem);
    $("mcFechaVenc")  && ($("mcFechaVenc").textContent   = DEMO.venc.fecha);
    setTimeout(() => { const bar=$("mcBarFill"); if(bar) bar.style.width=`${pct}%`; }, 300);
    $("statTotal")    && ($("statTotal").textContent    = DEMO.boletas.length);
    $("statDias")     && ($("statDias").textContent     = `${diasNum} días`);
    $("statVencDias") && ($("statVencDias").textContent = DEMO.venc.fecha);
    renderBoletas(user);
    checkNovedades();
  } else {
    if(memCard) memCard.style.display="none";
    if(vencCard) vencCard.style.display="";
    $("vencDate")   && ($("vencDate").textContent   = "—");
    $("vencDays")   && ($("vencDays").textContent   = "Pendiente de activación");
    $("vencAmount") && ($("vencAmount").textContent = "—");
    renderBoletas(null);
    startPendingCheck(); // verificar cada 30s
  }
}

function checkNovedades() {
  const nov=DEMO.novedades[0], ban=$("novedadesBanner");
  if(!nov||!ban) return;
  ban.style.display="";
  $("novTitle") && ($("novTitle").textContent = nov.titulo);
  $("novSub")   && ($("novSub").textContent   = nov.cuerpo.substring(0,90)+"…");
  $("notifDot") && ($("notifDot").style.display="");
  $("novClose")?.addEventListener("click",()=>{ ban.style.display="none"; },{ once:true });
}

// ════════════════════════════════════════════════════
//  NOVEDADES
// ════════════════════════════════════════════════════
function renderNovedades() {
  const list=$("novedadesList"); if(!list) return;
  const iconMap={alerta:"🚨",aviso:"⚠️",info:"ℹ️",novedad:"📢"};
  list.innerHTML = DEMO.novedades.map(n=>`
    <div class="novedad-card tipo-${n.tipo}">
      <div class="nov-card-header">
        <span class="nov-card-icon">${iconMap[n.tipo]||"📢"}</span>
        <span class="nov-card-title">${escHtml(n.titulo)}</span>
        <span class="nov-card-fecha">${n.fecha}</span>
      </div>
      <div class="nov-card-body">${escHtml(n.cuerpo)}</div>
      <span class="nov-card-badge badge-${n.tipo}">${cap(n.tipo)}</span>
    </div>`).join("");
}

// ════════════════════════════════════════════════════
//  BOLETAS — carga real desde backend
// ════════════════════════════════════════════════════
function renderBoletas(user) {
  const list=$("boletasList"), count=$("boletasCount");
  if(!list) return;

  if(!user || user.estado !== "activo") {
    if(count) count.textContent="—";
    list.innerHTML=`<div class="pending-banner"><div class="pb-icon">⚡</div><div><div class="pb-title">Sin boletas aún</div><div class="pb-sub">Una vez activa tu cuenta verás tus boletas aquí.</div></div></div>`;
    return;
  }

  // Cargar boletas reales del backend
  if(count) count.textContent="Cargando...";
  list.innerHTML=`<div class="sk-item"></div><div class="sk-item"></div><div class="sk-item"></div>`;

  cargarBoletasReales(user.id);
}

async function cargarBoletasReales(usuarioId) {
  const list=$("boletasList"), count=$("boletasCount");
  if(!list) return;

  try {
    const resp = await fetch(`${CFG.backendUrl}/boletas/${usuarioId}`, {
      headers: { Authorization: `Bearer ${State.user?.id||""}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { boletas } = await resp.json();

    if (!boletas?.length) {
      if(count) count.textContent="0 disponibles";
      list.innerHTML=`<div class="pending-banner"><div class="pb-icon">⚡</div><div><div class="pb-title">Sin boletas todavía</div><div class="pb-sub">Tu proveedor aún no subió boletas a tu cuenta.</div></div></div>`;
      return;
    }

    if(count) count.textContent=`${boletas.length} disponibles`;
    const dl=getDescargas();
    list.innerHTML = boletas.map(b=>{
      const desc=!!dl[b.id];
      return `
      <div class="boleta-card-expanded" id="bcard-${b.id}">
        <div class="boleta-card-header" onclick="toggleBoleta('${b.id}')">
          <div class="boleta-icon" style="font-size:19px;width:36px;height:36px;background:rgba(57,255,143,.08);border:1px solid rgba(57,255,143,.15);border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0">⚡</div>
          <div class="boleta-info" style="flex:1;min-width:0">
            <div class="boleta-periodo">${escHtml(b.periodo)}</div>
            <div class="boleta-fecha">Vence: ${b.vencimiento}</div>
          </div>
          <span class="boleta-estado ${desc?"estado-descargada":"estado-nueva"}">${desc?"✓ Descargada":"Nueva"}</span>
          <div class="boleta-chevron"><svg viewBox="0 0 20 20" fill="none"><path d="M5 8l5 5 5-5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
        </div>
        <div class="boleta-detail">
          <div class="boleta-detail-row"><span>Período</span><span>${escHtml(b.periodo)}</span></div>
          <div class="boleta-detail-row"><span>Emisión</span><span>${b.emitida}</span></div>
          <div class="boleta-detail-row"><span>Vencimiento</span><span>${b.vencimiento}</span></div>
          <div class="boleta-detail-row"><span>Estado</span>
            <span id="estado-txt-${b.id}" style="color:${desc?"var(--green)":"var(--text-2)"};${desc?"font-weight:600":""}">
              ${desc?"✓ Descargada":"Disponible para descargar"}
            </span>
          </div>
          <div class="boleta-detail-actions">
            <button class="${desc?"btn-ver-boleta":"btn-descargar-boleta"}" id="btn-dl-${b.id}"
                    data-url="${escHtml(b.pdfUrl||"")}"
                    onclick="descargarBoleta('${b.id}','${escHtml(b.periodo)}')">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 3v10M6 9l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
              ${desc?"Descargar de nuevo":"Descargar PDF"}
            </button>
          </div>
        </div>
      </div>`;
    }).join("");

  } catch(e) {
    console.error("[Boletas]", e);
    if(count) count.textContent="—";
    list.innerHTML=`<div class="pending-banner"><div class="pb-icon">⚠️</div><div><div class="pb-title">Error al cargar boletas</div><div class="pb-sub">Intentá de nuevo en unos segundos.</div></div></div>`;
  }
}

window.toggleBoleta = id => document.getElementById("bcard-"+id)?.classList.toggle("open");

window.descargarBoleta = async function(id, periodo) {
  const btn=$("btn-dl-"+id);
  if(btn){ btn.disabled=true; btn.innerHTML=`<span style="opacity:.7">Descargando…</span>`; }
  toast("Preparando PDF…","");
  try {
    const directUrl = btn?.dataset?.url;
    if (directUrl && directUrl !== "undefined" && directUrl.startsWith("http")) {
      const a = Object.assign(document.createElement("a"), {
        href:directUrl, download:`boleta-${periodo.replace(/\s+/g,"-")}.pdf`, target:"_blank"
      });
      a.click();
    } else {
      const resp = await fetch(`${CFG.backendUrl}/boleta/${id}`, {
        headers:{ Authorization:`Bearer ${State.user?.id||""}` },
        signal: AbortSignal.timeout(10000),
      });
      if(!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob=await resp.blob();
      const url=URL.createObjectURL(blob);
      const a=Object.assign(document.createElement("a"),{href:url,download:`boleta-${periodo.replace(/\s+/g,"-")}.pdf`});
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url),10000);
    }
    saveDescarga(id);
    const badge=document.querySelector(`#bcard-${id} .boleta-estado`);
    if(badge){ badge.className="boleta-estado estado-descargada"; badge.textContent="✓ Descargada"; }
    const etxt=$("estado-txt-"+id);
    if(etxt){ etxt.textContent="✓ Descargada"; etxt.style.color="var(--green)"; etxt.style.fontWeight="600"; }
    if(btn){
      btn.className="btn-ver-boleta"; btn.disabled=false;
      btn.innerHTML=`<svg viewBox="0 0 20 20" fill="none" style="width:14px;height:14px"><path d="M10 3v10M6 9l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg> Descargar de nuevo`;
    }
    toast(`Boleta ${periodo} descargada ✓`,"success");
  } catch(e) {
    console.error("[Descarga]",e);
    toast("Error al descargar. Intentá de nuevo.","error");
    if(btn){ btn.disabled=false; btn.textContent="Reintentar"; }
  }
};

// ════════════════════════════════════════════════════
//  COPIAR ALIAS
// ════════════════════════════════════════════════════
$("btnCopy")?.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(CFG.alias); }
  catch {
    const tmp=Object.assign(document.createElement("input"),{value:CFG.alias});
    document.body.appendChild(tmp); tmp.select(); document.execCommand("copy"); tmp.remove();
  }
  const sp=$("btnCopy")?.querySelector("span");
  if(sp){ sp.textContent="¡Copiado!"; setTimeout(()=>sp.textContent="Copiar",2200); }
  const cs=$("copySuccess");
  if(cs){ cs.classList.add("show"); setTimeout(()=>cs.classList.remove("show"),2500); }
  toast("Alias copiado ✓","success");
});

// ════════════════════════════════════════════════════
//  MERCADO PAGO
// ════════════════════════════════════════════════════
$("btnMP")?.addEventListener("click", () => {
  const isMobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isMobile) window.location.href = CFG.mpLink;
  else           window.open(CFG.mpLink, "_blank", "noopener,noreferrer");
});

// ════════════════════════════════════════════════════
//  VALIDACIONES
// ════════════════════════════════════════════════════
function validateForm() {
  const rules=[
    {id:"nroCliente",errId:"err-nroCliente",fn:v=>/^\d{4,12}$/.test(v.trim()),msg:"Solo números, entre 4 y 12 dígitos"},
    {id:"nombre",    errId:"err-nombre",    fn:v=>v.trim().length>=3&&v.trim().length<=80,msg:"Entre 3 y 80 caracteres"},
    {id:"dni",       errId:"err-dni",       fn:v=>/^\d{7,8}$/.test(v.trim()),msg:"7 u 8 dígitos sin puntos"},
    {id:"usuario",   errId:"err-usuario",   fn:v=>/^[a-z0-9_.]{3,20}$/i.test(v.trim()),msg:"3-20 caracteres, sin espacios"},
    {id:"celular",   errId:"err-celular",   fn:v=>/^\d{8,15}$/.test(v.replace(/[\s\-()]/g,"")),msg:"Número válido, solo dígitos"},
    {id:"direccion", errId:"err-direccion", fn:v=>v.trim().length>=5&&v.trim().length<=120,msg:"Entre 5 y 120 caracteres"},
    {id:"password",  errId:"err-password",  fn:v=>v.length>=6&&v.length<=72,msg:"Entre 6 y 72 caracteres"},
  ];
  let ok=true;
  rules.forEach(({id,errId,fn,msg})=>{
    const v=$(id)?.value||"", err=$(errId), valid=fn(v);
    if(err) err.textContent=valid?"":msg;
    if(!valid) ok=false;
  });
  return ok;
}

// ════════════════════════════════════════════════════
//  FCM — mensajes en foreground
// ════════════════════════════════════════════════════
if(messaging){
  onMessage(messaging, payload=>{
    const{title="AlDía",body=""}=payload.notification||{};
    toast(`${title}: ${body}`,"success",5000);
    // Si se activó la cuenta, actualizar dashboard
    if(payload.data?.tipo==="cuenta-activada" && State.user){
      State.user.estado="activo";
      saveSession(State.user);
      stopPendingCheck();
      renderDashboard(State.user);
    }
    // Si hay nueva boleta, recargar lista
    if(payload.data?.tipo==="nueva-boleta" && State.user?.estado==="activo"){
      cargarBoletasReales(State.user.id);
      const nd=$("notifDot"); if(nd) nd.style.display="";
    }
  });
}

// ════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════
function setLoading(btnId,on,label){
  const btn=$(btnId); if(!btn) return;
  btn.disabled=on;
  if(on){ btn.dataset.orig=btn.innerHTML; btn.innerHTML=`<div class="loading-spinner" style="width:18px;height:18px;border-color:rgba(7,11,20,.3);border-top-color:#070b14"></div><span>${label}</span>`; }
  else  { if(btn.dataset.orig){ btn.innerHTML=btn.dataset.orig; delete btn.dataset.orig; } }
}

let _tt;
function toast(msg,type="",ms=3200){
  clearTimeout(_tt);
  const t=$("toast"); if(!t) return;
  t.textContent=msg; t.className=`toast ${type} show`;
  _tt=setTimeout(()=>t.classList.remove("show"),ms);
}

const cap     = s => s?s[0].toUpperCase()+s.slice(1):"";
const escHtml = s => String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function saveSession(u)  { try{sessionStorage.setItem(CFG.sessionKey,JSON.stringify(u));}catch{} }
function loadSession()   { try{return JSON.parse(sessionStorage.getItem(CFG.sessionKey));}catch{return null;} }
function clearSession()  { sessionStorage.removeItem(CFG.sessionKey); }
function getDescargas()  { try{return JSON.parse(localStorage.getItem(CFG.dlKey)||"{}");}catch{return{};} }
function saveDescarga(id){ try{const d=getDescargas();d[id]=new Date().toISOString();localStorage.setItem(CFG.dlKey,JSON.stringify(d));}catch{} }

// ════════════════════════════════════════════════════
//  SERVICE WORKER
// ════════════════════════════════════════════════════
if("serviceWorker"in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("/sw.js")
      .then(reg=>{
        reg.addEventListener("updatefound",()=>{
          const nw=reg.installing;
          nw?.addEventListener("statechange",()=>{
            if(nw.state==="installed"&&navigator.serviceWorker.controller){
              $("updateBanner")?.classList.remove("hidden");
            }
          });
        });
        navigator.serviceWorker.addEventListener("message",e=>{
          if(e.data?.type==="ACCOUNT_ACTIVATED"&&State.user){
            State.user.estado="activo";
            saveSession(State.user);
            stopPendingCheck();
            showDashboard(State.user);
            toast("Tu cuenta fue activada ✅","success",5000);
          }
        });
      }).catch(e=>console.warn("[SW]",e));
  });

  $("btnUpdateAccept")?.addEventListener("click",async()=>{
    const reg=await navigator.serviceWorker.getRegistration();
    if(reg?.waiting) reg.waiting.postMessage({type:"SKIP_WAITING"});
    $("updateBanner")?.classList.add("hidden");
    setTimeout(()=>window.location.reload(),300);
  });
}
