// ═══════════════════════════════════════════════════
//  ALDIA APP — script.js v5
//  + Onboarding 3 pasos
//  + Stepper registro (Datos → Pago → Verificar)
//  + SMS boxes individuales con auto-avance
//  + Skeleton loading dashboard
//  + Membresia progress bar
//  + Copy feedback visual
//  + Animación éxito post-registro
// ═══════════════════════════════════════════════════

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, getDocs,
  doc, updateDoc, query, where
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
  sessionKey: "aldia_user_v5",
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
    { id:"n3", tipo:"alerta", titulo:"Corte programado",       cuerpo:"El día 28/01 de 9:00 a 13:00 hs habrá un corte en el barrio Centro para tareas de mantenimiento.", fecha:"20/01/2025" },
    { id:"n2", tipo:"aviso",  titulo:"Actualización de tarifas",cuerpo:"A partir de febrero se aplica el nuevo cuadro tarifario. Tu próxima boleta reflejará los nuevos valores.", fecha:"15/01/2025" },
    { id:"n1", tipo:"info",   titulo:"Nueva función: descarga", cuerpo:"Ya podés descargar tus últimas 4 boletas en PDF desde la app en cualquier momento.", fecha:"01/01/2025" },
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
//  ESTADO
// ════════════════════════════════════════════════════
const State = {
  user:      null,
  fcmToken:  null,
  loading:   false,
  regStep:   1,          // 1=datos 2=pago 3=sms
  smsCode:   null,
  obSlide:   0,
  forgotStep:1,
  forgotSmsCode: null,
};

// ════════════════════════════════════════════════════
//  DOM
// ════════════════════════════════════════════════════
const $ = id => document.getElementById(id);
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
//  SPLASH + ARRANQUE
// ════════════════════════════════════════════════════
window.addEventListener("DOMContentLoaded", () => {
  const aliasEl = $("aliasDisplay");
  if (aliasEl) aliasEl.textContent = CFG.alias;

  // Sesión activa → dashboard directo
  const saved = loadSession();
  if (saved) {
    State.user = saved;
    setTimeout(() => { hideSplash(); showDashboard(saved); }, 700);
    return;
  }

  // Onboarding ya visto → beneficios
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
//  ONBOARDING
// ════════════════════════════════════════════════════
$("btnObNext")?.addEventListener("click", () => {
  if (State.obSlide < 2) {
    goToObSlide(State.obSlide + 1);
  } else {
    finishOnboarding();
  }
});
$("btnObSkip")?.addEventListener("click", finishOnboarding);

function goToObSlide(idx) {
  // Ocultar slide actual
  $(`ob${State.obSlide}`)?.classList.remove("active");
  $(`od${State.obSlide}`)?.classList.remove("active");
  // Mostrar nuevo
  State.obSlide = idx;
  $(`ob${idx}`)?.classList.add("active");
  $(`od${idx}`)?.classList.add("active");
  // Actualizar botón
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
$("btnGoRegister")?.addEventListener("click", () => { goTo("auth"); switchTab("register"); requestFCM(); });
$("btnGoLogin")?.addEventListener("click",    () => { goTo("auth"); switchTab("login"); });
$("btnBackAuth")?.addEventListener("click",   () => goTo("benefits"));
$("btnBackNov")?.addEventListener("click",    () => goTo("dashboard"));
$("btnGoToDash")?.addEventListener("click",   () => { showDashboard(State.user); });

$("btnLogoutUser")?.addEventListener("click", () => {
  clearSession(); State.user = null; State.fcmToken = null;
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
  if (tab === "register") { resetStepper(); requestFCM(); }
};

// ════════════════════════════════════════════════════
//  OJO CONTRASEÑA
// ════════════════════════════════════════════════════
function eyeToggle(id) { const i=$(id); if(i) i.type = i.type==="password"?"text":"password"; }
$("btnEyeLogin")?.addEventListener("click", () => eyeToggle("loginPass"));
$("btnEyeReg")?.addEventListener("click",   () => eyeToggle("password"));

// ════════════════════════════════════════════════════
//  LOGIN
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
    // Login via backend Railway — evita problemas de permisos Firestore
    const resp = await fetch(`${CFG.backendUrl}/login`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        usuario,
        password: pass,
        fcmToken: State.fcmToken || "no-token",
      }),
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (errEl) errEl.textContent = data.error || "Error al ingresar";
      return;
    }
    const found = data.usuario;
    State.user = found; saveSession(found);
    showDashboard(found);
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
//  STEPPER REGISTRO — 3 pasos
// ════════════════════════════════════════════════════
function resetStepper() {
  State.regStep = 1; State.smsCode = null;
  showRegStep(1);
}

function showRegStep(step) {
  State.regStep = step;
  [$("regStep1"), $("regStep2"), $("regStep3")].forEach((el,i) => {
    if (el) el.classList.toggle("hidden", i+1 !== step);
  });
  // Actualizar fill de la barra
  const fill = $("regStepFill");
  if (fill) fill.style.width = `${Math.round((step/3)*100)}%`;
  // Actualizar círculos
  [0,1,2].forEach(i => {
    const circ = $(`rcirc${i}`), step_el = $(`rstep${i}`);
    if (!circ || !step_el) return;
    step_el.classList.remove("active","done");
    if (i+1 === step)       step_el.classList.add("active");
    else if (i+1 < step)    step_el.classList.add("done");
  });
}

// PASO 1 → 2
$("btnRegStep1")?.addEventListener("click", () => {
  if (!validateForm()) return;
  showRegStep(2);
});

// PASO 2 → 3 + envío SMS
// PASO 2 → Registrar directamente (sin verificación SMS)
$("btnRegStep2")?.addEventListener("click", handleRegister);
$("btnRegister")?.addEventListener("click", handleRegister);

async function handleRegister() {
  if (State.loading) return;
  // Usar el error del paso 1 (registerError2 fue eliminado con el paso SMS)
  const errEl = $("registerError") || $("registerError2");
  if (errEl) errEl.textContent = "";

  State.loading = true;
  setLoading("btnRegister", true, "Registrando...");
  try {
    const payload = {
      nroCliente: $("nroCliente")?.value.trim()  || "",
      nombre:     $("nombre")?.value.trim()      || "",
      dni:        $("dni")?.value.trim()         || "",
      usuario:    $("usuario")?.value.trim()     || "",
      celular:    $("celular")?.value.trim()     || "",
      direccion:  $("direccion")?.value.trim()   || "",
      password:   $("password")?.value          || "",
      fcmToken:   State.fcmToken || "no-token",
      estado:     "pendiente",
      creadoEn:   new Date().toISOString(),
      termsAceptados: true,
    };
    // Registrar via backend Railway — Admin SDK sin restricciones de permisos
    const resp = await fetch(`${CFG.backendUrl}/registro`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    const data = await resp.json();
    if (!resp.ok) {
      if (errEl) errEl.textContent = data.error || "Error al registrar. Intentá de nuevo.";
      return;
    }
    payload.id = data.usuarioId;
    State.user = payload; saveSession(payload);
    goTo("pending");
    toast("¡Registro exitoso!", "success");
  } catch(e) {
    console.error("[Registro]", e);
    if(errEl) errEl.textContent = "Error al registrar. Intentá de nuevo.";
  } finally {
    State.loading = false;
    setLoading("btnRegStep2", false, "Ya pagué — Registrarme");
    setLoading("btnRegister", false, "Confirmar y registrar");
  }
}

// SMS verificación desactivada — se activa manualmente por el admin

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
    toast(`Código enviado (demo: ${State.forgotSmsCode})`, "success");
    $("forgotCodeGroup").style.display="block";
    initSmsBoxes("fsms", 4);
    if(btn) btn.querySelector("span").textContent="Confirmar código";
    State.forgotStep=2;
  } else if (State.forgotStep===2) {
    const cod=[0,1,2,3].map(i=>$(`fsms${i}`)?.value||"").join("");
    if(cod!==State.forgotSmsCode){ if(err) err.textContent="Código incorrecto"; shakeSmsBoxes("fsms"); return; }
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
//  DASHBOARD — skeleton → contenido real
// ════════════════════════════════════════════════════
function showDashboard(user) {
  goTo("dashboard");
  // Mostrar skeleton
  $("dashSkeleton") && ($("dashSkeleton").style.display = "");
  $("dashContent")  && ($("dashContent").style.display  = "none");
  // Simular carga (en prod: esperar Firestore)
  setTimeout(() => {
    $("dashSkeleton") && ($("dashSkeleton").style.display = "none");
    $("dashContent")  && ($("dashContent").style.display  = "");
    renderDashboard(user);
  }, db ? 800 : 600);
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
    // Mostrar progress card de membresía en lugar del venc-card
    if(memCard) memCard.style.display = "";
    if(vencCard) vencCard.style.display = "none";

    // Datos de membresía
    const diasNum = 8; // en prod: calcular desde Firestore
    const pct     = Math.round((1 - diasNum/30) * 100);
    $("mcDias")      && ($("mcDias").textContent      = `${diasNum} días`);
    $("mcFechaInicio")&&($("mcFechaInicio").textContent= DEMO.inicioMem);
    $("mcFechaVenc") && ($("mcFechaVenc").textContent  = DEMO.venc.fecha);
    // Animar la barra con delay
    setTimeout(() => {
      const bar=$("mcBarFill"); if(bar) bar.style.width=`${pct}%`;
    }, 300);

    $("statTotal")   && ($("statTotal").textContent   = DEMO.boletas.length);
    $("statDias")    && ($("statDias").textContent     = `${diasNum} días`);
    $("statVencDias")&& ($("statVencDias").textContent = DEMO.venc.fecha);
    // En producción: cargar boletas reales desde backend (Firestore + R2)
    if (db && user.id && !user.id.startsWith("demo-")) {
      cargarBoletasReales(user.id);
    } else {
      renderBoletas(DEMO.boletas);
    }
    checkNovedades();
  } else {
    if(memCard) memCard.style.display = "none";
    if(vencCard) vencCard.style.display = "";
    $("vencDate")   && ($("vencDate").textContent   = "—");
    $("vencDays")   && ($("vencDays").textContent   = "Pendiente de activación");
    $("vencAmount") && ($("vencAmount").textContent = "—");
    renderBoletas([]);
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
//  BOLETAS
// ════════════════════════════════════════════════════
function renderBoletas(boletas) {
  const list=$("boletasList"), count=$("boletasCount");
  if(!list) return;
  if(!boletas.length) {
    if(count) count.textContent="—";
    list.innerHTML=`<div class="pending-banner"><div class="pb-icon">⚡</div><div><div class="pb-title">Sin boletas aún</div><div class="pb-sub">Una vez activa tu cuenta verás tus boletas aquí y las recibirás por WhatsApp.</div></div></div>`;
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
        <div class="boleta-detail-row"><span>Fecha de emisión</span><span>${b.emitida}</span></div>
        <div class="boleta-detail-row"><span>Vencimiento</span><span>${b.vencimiento}</span></div>
        <div class="boleta-detail-row"><span>Estado</span><span id="estado-txt-${b.id}" style="color:${desc?"var(--green)":"var(--text-2)"};${desc?"font-weight:600":""}">${desc?"✓ Descargada":"Disponible para descargar"}</span></div>
        <div class="boleta-detail-actions">
          <button class="${desc?"btn-ver-boleta":"btn-descargar-boleta"}" id="btn-dl-${b.id}" onclick="descargarBoleta('${b.id}','${escHtml(b.periodo)}')">
            <svg viewBox="0 0 20 20" fill="none"><path d="M10 3v10M6 9l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
            ${desc?"Descargar de nuevo":"Descargar PDF"}
          </button>
        </div>
      </div>
    </div>`;
  }).join("");
}

// ════════════════════════════════════════════════════
//  CARGA REAL DE BOLETAS — Firestore metadata + R2 PDF
// ════════════════════════════════════════════════════
async function cargarBoletasReales(usuarioId) {
  const list  = $("boletasList");
  const count = $("boletasCount");
  if (!list) return;

  // Mostrar skeleton mientras carga
  if (count) count.textContent = "Cargando...";
  list.innerHTML = `
    <div class="sk-item"></div>
    <div class="sk-item"></div>
    <div class="sk-item"></div>
    <div class="sk-item"></div>`;

  try {
    const resp = await fetch(`${CFG.backendUrl}/boletas/${usuarioId}`, {
      headers: { Authorization: `Bearer ${State.user?.id || ""}` },
      signal: AbortSignal.timeout(8000), // timeout 8s
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const { boletas } = await resp.json();

    if (!boletas?.length) {
      renderBoletas([]);
      return;
    }

    // Mapear al formato interno
    const mapped = boletas.map(b => ({
      id:          b.id,
      periodo:     b.periodo,
      vencimiento: b.vencimiento,
      emitida:     b.emitida,
      pdfUrl:      b.pdfUrl,   // URL firmada de R2
    }));

    if (count) count.textContent = `${mapped.length} disponibles`;
    const dl = getDescargas();

    list.innerHTML = mapped.map(b => {
      const desc = !!dl[b.id];
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
          <div class="boleta-detail-row"><span>Fecha de emisión</span><span>${b.emitida}</span></div>
          <div class="boleta-detail-row"><span>Vencimiento</span><span>${b.vencimiento}</span></div>
          <div class="boleta-detail-row"><span>Estado</span>
            <span id="estado-txt-${b.id}" style="color:${desc?"var(--green)":"var(--text-2)"};${desc?"font-weight:600":""}">
              ${desc?"✓ Descargada":"Disponible para descargar"}
            </span>
          </div>
          <div class="boleta-detail-actions">
            <button
              class="${desc?"btn-ver-boleta":"btn-descargar-boleta"}"
              id="btn-dl-${b.id}"
              data-url="${escHtml(b.pdfUrl)}"
              onclick="descargarBoleta('${b.id}','${escHtml(b.periodo)}')">
              <svg viewBox="0 0 20 20" fill="none">
                <path d="M10 3v10M6 9l4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
              </svg>
              ${desc?"Descargar de nuevo":"Descargar PDF"}
            </button>
          </div>
        </div>
      </div>`;
    }).join("");

  } catch(e) {
    console.error("[Boletas R2]", e);
    // Fallback a datos demo si falla el backend
    toast("Sin conexión al servidor. Mostrando datos de ejemplo.", "");
    renderBoletas(DEMO.boletas);
  }
}

window.toggleBoleta = id => document.getElementById("bcard-"+id)?.classList.toggle("open");

window.descargarBoleta = async function(id, periodo) {
  const btn=$("btn-dl-"+id);
  if(btn){ btn.disabled=true; btn.innerHTML=`<span style="opacity:.7">Descargando…</span>`; }
  toast("Preparando PDF…","");
  try {
    // Intentar usar URL de R2 directa (guardada en data-url)
    const directUrl = btn?.dataset?.url;

    if (directUrl && directUrl !== "undefined") {
      // Descargar directo desde Cloudflare R2 (más rápido, sin pasar por backend)
      const a = Object.assign(document.createElement("a"), {
        href:     directUrl,
        download: `boleta-${periodo.replace(/\s+/g,"-")}.pdf`,
        target:   "_blank",
      });
      a.click();
    } else if (db && State.user?.id && !State.user.id.startsWith("demo-")) {
      // Fallback: pedir URL al backend
      const resp = await fetch(`${CFG.backendUrl}/boleta/${id}`, {
        headers: { Authorization: `Bearer ${State.user.id}` },
        signal:  AbortSignal.timeout(10000),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      // El backend redirige → blob
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      const a    = Object.assign(document.createElement("a"),{
        href:url, download:`boleta-${periodo.replace(/\s+/g,"-")}.pdf`
      });
      a.click();
      setTimeout(()=>URL.revokeObjectURL(url), 10000);
    } else {
      // Demo mode: simular descarga
      await new Promise(r=>setTimeout(r,1100));
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
//  COPIAR ALIAS — con feedback visual
// ════════════════════════════════════════════════════
$("btnCopy")?.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(CFG.alias); }
  catch {
    const tmp=Object.assign(document.createElement("input"),{value:CFG.alias});
    document.body.appendChild(tmp); tmp.select(); document.execCommand("copy"); tmp.remove();
  }
  // Feedback en el botón
  const sp=$("btnCopy")?.querySelector("span");
  if(sp){ sp.textContent="¡Copiado!"; setTimeout(()=>sp.textContent="Copiar",2200); }
  // Feedback visual debajo de la card de pago
  const cs=$("copySuccess");
  if(cs){ cs.classList.add("show"); setTimeout(()=>cs.classList.remove("show"),2500); }
  toast("Alias copiado ✓","success");
});

// ════════════════════════════════════════════════════
//  BOTÓN MERCADO PAGO
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
    {id:"dni",       errId:"err-dni",       fn:v=>/^\d{7,8}$/.test(v.trim()),             msg:"7 u 8 dígitos sin puntos"},
    {id:"usuario",   errId:"err-usuario",   fn:v=>/^[a-z0-9_.]{3,20}$/i.test(v.trim()),   msg:"3-20 caracteres, sin espacios"},
    {id:"celular",   errId:"err-celular",   fn:v=>/^\d{8,15}$/.test(v.replace(/[\s\-()]/g,"")),msg:"Número válido, solo dígitos"},
    {id:"direccion", errId:"err-direccion", fn:v=>v.trim().length>=5&&v.trim().length<=120,msg:"Entre 5 y 120 caracteres"},
    {id:"password",  errId:"err-password",  fn:v=>v.length>=6&&v.length<=72,              msg:"Entre 6 y 72 caracteres"},
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
//  FCM
// ════════════════════════════════════════════════════
async function requestFCM() {
  if(!messaging||State.fcmToken) return;
  try {
    const perm=await Notification.requestPermission();
    if(perm!=="granted") return;
    State.fcmToken=await getToken(messaging,{vapidKey:CFG.vapidKey});
  } catch(e){ console.warn("[FCM]",e.message); }
}
if(messaging){
  onMessage(messaging,payload=>{
    const{title="AlDía",body=""}=payload.notification||{};
    toast(`${title}: ${body}`,"success",5000);
    if(State.user&&State.user.estado!=="activo"){
      State.user.estado="activo"; saveSession(State.user); renderDashboard(State.user);
    }
    if(["aviso","alerta"].includes(payload.data?.tipo)){
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
const escHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
function saveSession(u)  { try{sessionStorage.setItem(CFG.sessionKey,JSON.stringify(u));}catch{} }
function loadSession()   { try{return JSON.parse(sessionStorage.getItem(CFG.sessionKey));}catch{return null;} }
function clearSession()  { sessionStorage.removeItem(CFG.sessionKey); }
function getDescargas()  { try{return JSON.parse(localStorage.getItem(CFG.dlKey)||"{}");}catch{return{};} }
function saveDescarga(id){ try{const d=getDescargas();d[id]=new Date().toISOString();localStorage.setItem(CFG.dlKey,JSON.stringify(d));}catch{} }

// ════════════════════════════════════════════════════
//  SERVICE WORKER
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
//  PWA — Instalación y actualizaciones
// ════════════════════════════════════════════════════

const INSTALL_DISMISSED_KEY = "aldia_install_dismissed";
let deferredInstallPrompt   = null; // guardamos el evento beforeinstallprompt

// ── Capturar el evento de instalación (Android/Chrome) ──
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); // evitar el prompt automático del browser
  deferredInstallPrompt = e;

  // Solo mostrar si el usuario no lo descartó antes
  const dismissed = localStorage.getItem(INSTALL_DISMISSED_KEY);
  if (!dismissed) {
    // Mostrar banner después de 3 segundos (no interrumpir la llegada)
    setTimeout(() => showInstallBanner(), 3000);
  }
});

// ── Detectar cuando la app fue instalada ────────────────
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  hideInstallBanner();
  toast("✅ AlDía instalada en tu pantalla de inicio", "success", 4000);
  localStorage.removeItem(INSTALL_DISMISSED_KEY);
  console.info("[PWA] App instalada correctamente");
});

// ── Botón Instalar ───────────────────────────────────────
$("btnInstallAccept")?.addEventListener("click", async () => {
  if (!deferredInstallPrompt) return;
  const { outcome } = await deferredInstallPrompt.prompt();
  console.info("[PWA] Resultado install prompt:", outcome);
  if (outcome === "accepted") {
    hideInstallBanner();
  }
  deferredInstallPrompt = null;
});

// ── Botón Descartar ──────────────────────────────────────
$("btnInstallDismiss")?.addEventListener("click", () => {
  hideInstallBanner();
  // No volver a mostrar por 7 días
  const expires = Date.now() + 7 * 24 * 60 * 60 * 1000;
  localStorage.setItem(INSTALL_DISMISSED_KEY, String(expires));
});

function showInstallBanner() {
  // Verificar que el dismiss no esté vigente
  const ts = parseInt(localStorage.getItem(INSTALL_DISMISSED_KEY) || "0");
  if (ts > Date.now()) return;
  $("installBanner")?.classList.remove("hidden");
}
function hideInstallBanner() {
  $("installBanner")?.classList.add("hidden");
}

// ── Detección iOS — mostrar guía manual ─────────────────
function detectiOS() {
  const isIOS        = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isSafari     = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true;
  return isIOS && isSafari && !isStandalone;
}

// Mostrar guía iOS si aplica (primera visita, no instalada)
window.addEventListener("DOMContentLoaded", () => {
  if (detectiOS()) {
    const dismissed = localStorage.getItem("aldia_ios_dismissed");
    const ts        = parseInt(dismissed || "0");
    if (!dismissed || ts < Date.now()) {
      setTimeout(() => $("iosBanner")?.classList.remove("hidden"), 4000);
    }
  }
});

$("btnIosClose")?.addEventListener("click", () => {
  $("iosBanner")?.classList.add("hidden");
  // No volver a mostrar por 3 días
  localStorage.setItem("aldia_ios_dismissed", String(Date.now() + 3*24*60*60*1000));
});

// ── Detectar si ya está instalada como PWA ───────────────
function isInstalledPWA() {
  return window.matchMedia("(display-mode: standalone)").matches
    || window.navigator.standalone === true;
}

// Si ya está instalada, no mostrar ningún banner
if (isInstalledPWA()) {
  localStorage.setItem(INSTALL_DISMISSED_KEY, String(Date.now() + 365*24*60*60*1000));
}

// ════════════════════════════════════════════════════
//  SERVICE WORKER
// ════════════════════════════════════════════════════
if("serviceWorker"in navigator){
  window.addEventListener("load",()=>{
    navigator.serviceWorker.register("/sw.js")
      .then(reg=>{
        console.info("[SW] Registrado:", reg.scope);

        // ── Detectar nueva versión disponible ────────
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          newWorker?.addEventListener("statechange", () => {
            if (newWorker.state === "installed" && navigator.serviceWorker.controller) {
              // Hay una actualización lista → mostrar banner
              $("updateBanner")?.classList.remove("hidden");
            }
          });
        });

        // ── Escuchar mensajes del SW ─────────────────
        navigator.serviceWorker.addEventListener("message", e => {
          if (e.data?.type === "ACCOUNT_ACTIVATED" && State.user) {
            State.user.estado = "activo";
            saveSession(State.user);
            showDashboard(State.user);
            toast("Tu cuenta fue activada ✅", "success", 5000);
          }
          if (e.data?.type === "NOTIFICATION_CLICKED") {
            // Navegar a la sección correspondiente
            if (State.user) showDashboard(State.user);
          }
        });

      }).catch(e => console.warn("[SW] Error:", e));
  });

  // ── Botón actualizar app ─────────────────────────
  $("btnUpdateAccept")?.addEventListener("click", async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    if (reg?.waiting) {
      // Decirle al nuevo SW que tome control
      reg.waiting.postMessage({ type: "SKIP_WAITING" });
    }
    $("updateBanner")?.classList.add("hidden");
    // Recargar para aplicar la actualización
    setTimeout(() => window.location.reload(), 300);
  });
}
