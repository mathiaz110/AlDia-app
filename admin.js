// ═══════════════════════════════════════════════════
//  ALDIA APP — admin.js v7
//  Panel administrador expandido:
//  · Resumen: KPIs + gráfico 6 meses ingresos
//  · Clientes activos con botones de acción
//  · Todos los usuarios con filtros
// ═══════════════════════════════════════════════════

import { initializeApp }                        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword,
         signOut, onAuthStateChanged }          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection,
         doc, updateDoc, query,
         orderBy, onSnapshot, addDoc,
         serverTimestamp }                      from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ─── CONFIG ─────────────────────────────────────────
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyB2vua5gMe7hspIMtVunPAmWWkUB3-nt5A",
  authDomain:        "aldia-app1.firebaseapp.com",
  projectId:         "aldia-app1",
  storageBucket:     "aldia-app1.firebasestorage.app",
  messagingSenderId: "1013051386288",
  appId:             "1:1013051386288:web:e588c83d0892d6cbab4e75",
  measurementId:     "G-28VQ7VM4KS",
};
const BACKEND_URL = "https://aldia-app-production-90b0.up.railway.app";
const PRECIO_MES  = 2247.25;

// ─── FIREBASE INIT ───────────────────────────────────
const firebaseApp = initializeApp(FIREBASE_CONFIG);
const auth        = getAuth(firebaseApp);
const db          = getFirestore(firebaseApp);

// ─── ESTADO ──────────────────────────────────────────
let allUsers      = [];
let filteredUsers = [];
let activeFilter  = "all";
let searchQuery   = "";
let unsubscribe   = null;
let selectedUser  = null;
let ingresoChart  = null;

// ─── DOM ─────────────────────────────────────────────
const $ = id => document.getElementById(id);

// ════════════════════════════════════════════════════
//  AUTH
// ════════════════════════════════════════════════════
onAuthStateChanged(auth, user => {
  if (user) showDashboard(user);
  else      showLogin();
});

$("btnLogin")?.addEventListener("click", async () => {
  const email = $("adminEmail")?.value.trim();
  const pass  = $("adminPass")?.value;
  $("loginError").textContent = "";
  if (!email || !pass) { $("loginError").textContent = "Completá email y contraseña"; return; }
  setLoading("btnLogin", true, "Ingresando...");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch(e) {
    $("loginError").textContent = getAuthError(e.code);
    setLoading("btnLogin", false, "Ingresar al panel");
  }
});

$("adminPass")?.addEventListener("keydown", e => { if(e.key==="Enter") $("btnLogin").click(); });

[$("btnLogout"), $("btnLogoutMob")].forEach(btn =>
  btn?.addEventListener("click", async () => {
    if (unsubscribe) unsubscribe();
    await signOut(auth);
  })
);

function getAuthError(code) {
  const map = {
    "auth/invalid-email":      "Email inválido",
    "auth/wrong-password":     "Contraseña incorrecta",
    "auth/user-not-found":     "Usuario no encontrado",
    "auth/too-many-requests":  "Demasiados intentos. Esperá unos minutos.",
    "auth/invalid-credential": "Credenciales inválidas",
  };
  return map[code] || "Error al iniciar sesión";
}

function showLogin() {
  $("adminLogin")?.classList.remove("hidden");
  $("adminDash")?.classList.add("hidden");
  setLoading("btnLogin", false, "Ingresar al panel");
}

function showDashboard(user) {
  $("adminLogin")?.classList.add("hidden");
  $("adminDash")?.classList.remove("hidden");
  const name = user.displayName || user.email?.split("@")[0] || "Admin";
  if ($("adminName"))   $("adminName").textContent   = name;
  if ($("adminAvatar")) $("adminAvatar").textContent = name[0].toUpperCase();
  loadUsers();
  registrarTokenAdmin();
}

async function registrarTokenAdmin() {
  try {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;
    const { getMessaging, getToken } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js");
    const messaging = getMessaging();
    const token = await getToken(messaging, {
      vapidKey: "BCTslJPoTqAMsjQS_J6obznv5ZUDo2o3dYbRNK6cnMJokpsOv0cPKHZNNtPOZ7QbpLFTpu4IfH6UMHhrlo3r0ao"
    });
    if (!token) return;
    await fetch(`${BACKEND_URL}/admin/token`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ fcmToken: token }),
    });
    console.log("[Admin] Token FCM registrado");
  } catch(e) {
    console.warn("[Admin FCM]", e.message);
  }
}

// ════════════════════════════════════════════════════
//  CARGA USUARIOS — realtime Firestore
// ════════════════════════════════════════════════════
function loadUsers() {
  if (unsubscribe) unsubscribe();
  $("usersLoading")?.classList.remove("hidden");
  $("usersList")?.classList.add("hidden");
  $("usersEmpty")?.classList.add("hidden");

  try {
    const q = query(collection(db,"usuarios"), orderBy("creadoEn","desc"));
    unsubscribe = onSnapshot(q, snap => {
      allUsers = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      updateStats();
      renderActivosList();
      applyFilters();
      $("usersLoading")?.classList.add("hidden");
    }, err => {
      console.error("[Firestore]", err);
      $("usersLoading")?.classList.add("hidden");
      showToast("Error al cargar usuarios", "error");
    });
  } catch(e) {
    $("usersLoading")?.classList.add("hidden");
    showToast("Sin conexión a Firestore", "error");
  }
}

// ════════════════════════════════════════════════════
//  ESTADÍSTICAS + GRÁFICO
// ════════════════════════════════════════════════════
function updateStats() {
  const hoy = new Date();

  // Calcular vencidos: activos con membresiaVence < hoy
  const activos   = allUsers.filter(u => u.estado === "activo");
  const vencidos  = activos.filter(u => {
    if (!u.membresiaVence) return false;
    return new Date(u.membresiaVence) < hoy;
  });

  const pendientes = allUsers.filter(u => u.estado === "pendiente");
  const activosVigentes = activos.filter(u => {
    if (!u.membresiaVence) return true; // sin fecha = vigente (activado manualmente)
    return new Date(u.membresiaVence) >= hoy;
  });

  if ($("statTotal"))    $("statTotal").textContent    = allUsers.length;
  if ($("statPending"))  $("statPending").textContent  = pendientes.length;
  if ($("statVencidos")) $("statVencidos").textContent = vencidos.length;

  // Ingresos del mes: clientes activos vigentes × PRECIO_MES
  const ingresosMes = activosVigentes.length * PRECIO_MES;
  if ($("statIngresos")) {
    $("statIngresos").textContent = "$" + ingresosMes.toLocaleString("es-AR", {minimumFractionDigits:0, maximumFractionDigits:0});
  }

  // Gráfico de ingresos 6 meses
  buildChart();
}

function buildChart() {
  // Construir labels de últimos 6 meses
  const labels = [];
  const datos  = [];
  const hoy = new Date();

  for (let i = 5; i >= 0; i--) {
    const fecha = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const mesLabel = fecha.toLocaleString("es-AR", { month:"short", year:"2-digit" });
    labels.push(mesLabel.charAt(0).toUpperCase() + mesLabel.slice(1));

    // Contar clientes que estaban activos en ese mes
    // = activadoEn <= fin del mes && (membresiaVence >= inicio del mes || sin membresiaVence)
    const inicioMes = new Date(fecha.getFullYear(), fecha.getMonth(), 1);
    const finMes    = new Date(fecha.getFullYear(), fecha.getMonth()+1, 0, 23, 59, 59);

    const activosEnMes = allUsers.filter(u => {
      if (u.estado !== "activo" && u.activadoEn == null) return false;
      // Fecha de activación
      const activadoEn = toDate(u.activadoEn);
      if (!activadoEn || activadoEn > finMes) return false; // aún no activado ese mes
      // Membresía: si tiene vence y ya venció antes de inicioMes => no contabilizar
      if (u.membresiaVence) {
        const vence = new Date(u.membresiaVence);
        if (vence < inicioMes) return false;
      }
      return true;
    });

    datos.push(activosEnMes.length * PRECIO_MES);
  }

  const canvas = $("ingresoChart");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  if (ingresoChart) ingresoChart.destroy();

  ingresoChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [{
        label: "Ingresos ($)",
        data: datos,
        backgroundColor: "rgba(57,255,143,0.18)",
        borderColor: "#39ff8f",
        borderWidth: 2,
        borderRadius: 8,
        borderSkipped: false,
        hoverBackgroundColor: "rgba(57,255,143,0.35)",
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => " $" + ctx.parsed.y.toLocaleString("es-AR", {minimumFractionDigits:0})
          }
        }
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: { color: "#7a8499", font: { size: 11 } }
        },
        y: {
          grid: { color: "rgba(255,255,255,0.05)" },
          ticks: {
            color: "#7a8499",
            font: { size: 11 },
            callback: v => "$" + (v/1000).toFixed(0) + "k"
          },
          beginAtZero: true,
        }
      }
    }
  });
}

// ════════════════════════════════════════════════════
//  LISTA CLIENTES ACTIVOS (con botones de acción)
// ════════════════════════════════════════════════════
function renderActivosList() {
  const list = $("activosList");
  const countEl = $("activoCount");
  if (!list) return;

  const hoy = new Date();
  const activos = allUsers.filter(u => u.estado === "activo");

  if (countEl) countEl.textContent = activos.length;
  $("activosLoading")?.remove();

  if (!activos.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🏷</div><div class="empty-title">Sin clientes activos</div></div>`;
    return;
  }

  list.innerHTML = activos.map(u => {
    const vencido = u.membresiaVence && new Date(u.membresiaVence) < hoy;
    const venceStr = u.membresiaVence ? `Vence: ${u.membresiaVence}` : "Membresía activa";
    return `
    <div class="user-card activo-card ${vencido ? 'vencido-card' : ''}">
      <div class="user-avatar" style="background:${vencido ? 'rgba(255,77,109,.15)' : 'rgba(57,255,143,.15)'};color:${vencido ? '#ff4d6d' : '#39ff8f'}">${(u.nombre||"?")[0].toUpperCase()}</div>
      <div class="user-info" style="flex:1;min-width:0">
        <div class="user-name">${escHtml(u.nombre||"Sin nombre")} ${vencido ? '<span style="color:#ff4d6d;font-size:10px">● Vencido</span>' : ''}</div>
        <div class="user-meta">@${escHtml(u.usuario||"—")} · N°${escHtml(u.nroCliente||"—")} · ${venceStr}</div>
      </div>
      <div class="action-btns">
        <button class="action-btn btn-block-sm"   onclick="accion('bloquear','${u.id}','${escHtml(u.nombre||"")}')">🔒 Bloquear</button>
        <button class="action-btn btn-reset-sm"   onclick="accion('reset','${u.id}','${escHtml(u.nombre||"")}')">🔑 Reset</button>
        <button class="action-btn btn-delete-sm"  onclick="accion('borrar','${u.id}','${escHtml(u.nombre||"")}')">🗑️ Borrar</button>
        <button class="action-btn btn-detail-sm"  onclick="openModal('${u.id}')">👁 Ver</button>
      </div>
    </div>`;
  }).join("");
}

// ════════════════════════════════════════════════════
//  ACCIONES POR CLIENTE
// ════════════════════════════════════════════════════
window.accion = async function(tipo, userId, nombre) {
  if (tipo === "bloquear") {
    if (!confirm(`¿Bloquear a ${nombre}?`)) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/usuarios/${userId}/bloquear`, { method:"POST" });
      if (!resp.ok) throw new Error("Error");
      showToast(`🔒 ${nombre} bloqueado`, "");
    } catch(e) { showToast("Error al bloquear", "error"); }
  }

  else if (tipo === "borrar") {
    if (!confirm(`¿ELIMINAR a ${nombre}? Esta acción no se puede deshacer.`)) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/usuarios/${userId}`, { method:"DELETE" });
      if (!resp.ok) throw new Error("Error");
      showToast(`🗑️ ${nombre} eliminado`, "");
    } catch(e) { showToast("Error al eliminar", "error"); }
  }

  else if (tipo === "reset") {
    if (!confirm(`¿Resetear contraseña de ${nombre}? Se generará una temporal.`)) return;
    try {
      const resp = await fetch(`${BACKEND_URL}/usuarios/${userId}/reset-password`, { method:"POST" });
      if (!resp.ok) throw new Error("Error");
      const data = await resp.json();
      // Mostrar modal con contraseña temporal
      $("resetNombre").textContent = nombre;
      $("resetPassDisplay").textContent = data.tempPass;
      $("modalResetPass")?.classList.remove("hidden");
    } catch(e) { showToast("Error al resetear contraseña", "error"); }
  }

  else if (tipo === "habilitar") {
    try {
      const resp = await fetch(`${BACKEND_URL}/usuarios/${userId}/activar`, { method:"POST" });
      if (!resp.ok) throw new Error("Error");
      showToast(`✅ ${nombre} activado`, "success");
    } catch(e) { showToast("Error al activar", "error"); }
  }
};

// Modal reset password
$("btnCloseReset")?.addEventListener("click", () => $("modalResetPass")?.classList.add("hidden"));
$("modalResetPass")?.addEventListener("click", e => { if(e.target===$("modalResetPass")) $("modalResetPass").classList.add("hidden"); });
$("btnCopyPass")?.addEventListener("click", () => {
  const pass = $("resetPassDisplay")?.textContent;
  if (pass) {
    navigator.clipboard.writeText(pass).then(() => showToast("Contraseña copiada", "success")).catch(() => {});
  }
});

// ════════════════════════════════════════════════════
//  FILTROS Y BÚSQUEDA
// ════════════════════════════════════════════════════
$("searchInput")?.addEventListener("input", e => {
  searchQuery = e.target.value.toLowerCase();
  applyFilters();
});

document.querySelectorAll(".filter-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    activeFilter = tab.dataset.filter;
    applyFilters();
  });
});

function applyFilters() {
  filteredUsers = allUsers.filter(u => {
    const matchF = activeFilter==="all" || u.estado===activeFilter;
    const matchS = !searchQuery ||
      u.nombre?.toLowerCase().includes(searchQuery)    ||
      u.dni?.toLowerCase().includes(searchQuery)       ||
      u.usuario?.toLowerCase().includes(searchQuery)   ||
      u.nroCliente?.includes(searchQuery)              ||
      u.celular?.includes(searchQuery);
    return matchF && matchS;
  });
  renderUsers(filteredUsers);
}

// ════════════════════════════════════════════════════
//  RENDER USUARIOS
// ════════════════════════════════════════════════════
function renderUsers(users) {
  const list  = $("usersList");
  const empty = $("usersEmpty");
  if (!list || !empty) return;

  if (!users.length) {
    list.classList.add("hidden");
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.classList.remove("hidden");

  list.innerHTML = users.map(u => `
    <div class="user-card" data-id="${u.id}">
      <div class="user-avatar">${(u.nombre||"?")[0].toUpperCase()}</div>
      <div class="user-info" onclick="openModal('${u.id}')" style="cursor:pointer;flex:1;min-width:0">
        <div class="user-name">${escHtml(u.nombre||"Sin nombre")}</div>
        <div class="user-meta">@${escHtml(u.usuario||"—")} · N°${escHtml(u.nroCliente||"—")} · DNI ${escHtml(u.dni||"—")}</div>
      </div>
      <span class="user-status-badge ${getBadgeClass(u.estado)}">${capitalizar(u.estado)}</span>
      <div class="user-date">${formatDate(u.creadoEn)}</div>
      <div class="action-btns action-btns-row">
        ${u.estado === "pendiente" ? `<button class="action-btn btn-enable-sm" onclick="accion('habilitar','${u.id}','${escHtml(u.nombre||"")}')">✅ Habilitar</button>` : ""}
        ${u.estado === "activo"    ? `<button class="action-btn btn-block-sm"  onclick="accion('bloquear','${u.id}','${escHtml(u.nombre||"")}')">🔒 Bloquear</button>` : ""}
        ${u.estado === "bloqueado" ? `<button class="action-btn btn-enable-sm" onclick="accion('habilitar','${u.id}','${escHtml(u.nombre||"")}')">✅ Activar</button>` : ""}
        <button class="action-btn btn-reset-sm"  onclick="accion('reset','${u.id}','${escHtml(u.nombre||"")}')">🔑</button>
        <button class="action-btn btn-delete-sm" onclick="accion('borrar','${u.id}','${escHtml(u.nombre||"")}')">🗑️</button>
      </div>
    </div>
  `).join("");
}

// ════════════════════════════════════════════════════
//  MODAL USUARIO (detalle + boletas)
// ════════════════════════════════════════════════════
window.openModal = function(userId) {
  selectedUser = allUsers.find(u => u.id === userId);
  if (!selectedUser) return;

  $("modalTitle").textContent = selectedUser.nombre || "Usuario";
  $("modalBody").innerHTML = `
    <div class="detail-row"><span class="detail-label">N° cliente</span><span class="detail-value" style="color:var(--green);font-weight:700">${escHtml(selectedUser.nroCliente||"—")}</span></div>
    <div class="detail-row"><span class="detail-label">Nombre</span><span class="detail-value">${escHtml(selectedUser.nombre||"—")}</span></div>
    <div class="detail-row"><span class="detail-label">DNI</span><span class="detail-value">${escHtml(selectedUser.dni||"—")}</span></div>
    <div class="detail-row"><span class="detail-label">Usuario</span><span class="detail-value">@${escHtml(selectedUser.usuario||"—")}</span></div>
    <div class="detail-row"><span class="detail-label">Celular</span><span class="detail-value">${escHtml(selectedUser.celular||"—")}</span></div>
    <div class="detail-row"><span class="detail-label">Dirección</span><span class="detail-value">${escHtml(selectedUser.direccion||"—")}</span></div>
    <div class="detail-row"><span class="detail-label">Estado</span><span class="detail-value"><span class="user-status-badge ${getBadgeClass(selectedUser.estado)}">${capitalizar(selectedUser.estado)}</span></span></div>
    <div class="detail-row"><span class="detail-label">Registro</span><span class="detail-value">${formatDate(selectedUser.creadoEn, true)}</span></div>
    ${selectedUser.membresiaVence ? `<div class="detail-row"><span class="detail-label">Membresía vence</span><span class="detail-value">${selectedUser.membresiaVence}</span></div>` : ""}
    <div class="detail-row"><span class="detail-label">Telegram</span><span class="detail-value">${selectedUser.telegramChatId ? "✅ Vinculado" : "No vinculado"}</span></div>
  `;

  const actions = $("modalActions");
  actions.innerHTML = `
    ${selectedUser.estado==="pendiente" ? `
      <button class="btn-activate" id="btnActivate">
        <svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M4 10l5 5 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Activar cuenta
      </button>
      <button class="btn-reject" id="btnReject">Rechazar</button>
    ` : selectedUser.estado==="activo" ? `
      <button class="btn-reject" id="btnBloquear" style="background:rgba(255,77,109,.1);border-color:rgba(255,77,109,.3)">🔒 Bloquear</button>
    ` : selectedUser.estado==="bloqueado" ? `
      <button class="btn-activate" id="btnReactivate">✅ Reactivar</button>
    ` : ""}
    <button class="btn-reject" id="btnResetModal" style="background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3);color:#f59e0b">🔑 Reset contraseña</button>
    <button class="btn-reject" id="btnDeleteModal" style="background:rgba(255,77,109,.1);border-color:rgba(255,77,109,.3)">🗑️ Eliminar usuario</button>

    <!-- ─── BOLETAS DEL CLIENTE ─────────────────────── -->
    <div class="upload-boleta-section">
      <div class="upload-section-title">
        <svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M3 4h14M3 8h14M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Boletas del cliente
      </div>
      <div id="adminBoletasList" style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-3)">Cargando boletas...</div>
      </div>

      <div class="upload-section-title" style="margin-top:8px">
        <svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M10 3v10M6 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        Subir nueva boleta PDF → R2
      </div>
      <div class="upload-fields">
        <div class="field-group">
          <label class="field-label">Período (ej: Enero 2025)</label>
          <div class="field-wrap">
            <input type="text" id="uploadPeriodo" class="field-input" placeholder="Enero 2025"/>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Fecha de vencimiento</label>
          <div class="field-wrap">
            <input type="text" id="uploadVenc" class="field-input" placeholder="10/01/2025"/>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Fecha de emisión</label>
          <div class="field-wrap">
            <input type="text" id="uploadEmitida" class="field-input" placeholder="01/01/2025"/>
          </div>
        </div>
        <div class="upload-pdf-drop" id="uploadDrop" style="position:relative;overflow:hidden">
          <input type="file" id="uploadPdfInput" accept=".pdf,application/pdf" style="position:absolute;opacity:0;width:100%;height:100%;top:0;left:0;cursor:pointer;z-index:10" onchange="onPdfSelected(this)"/>
          <svg viewBox="0 0 40 40" fill="none" style="width:32px;height:32px;opacity:.4;pointer-events:none"><path d="M20 8v16M12 16l8-8 8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 30h24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          <div class="upload-drop-text" id="uploadDropText" style="pointer-events:none">Tocá aquí para elegir el PDF</div>
          <div class="upload-drop-sub" style="pointer-events:none">Máximo 5 MB · Solo archivos PDF</div>
        </div>
        <div class="upload-error" id="uploadError"></div>
        <button class="btn-activate" id="btnUploadBoleta" disabled>
          <svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M10 3v10M6 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
          Subir a R2 y notificar cliente
        </button>
      </div>
    </div>
  `;

  $("btnActivate")?.addEventListener("click",   () => activateUser(selectedUser));
  $("btnReject")?.addEventListener("click",     () => rejectUser(selectedUser));
  $("btnReactivate")?.addEventListener("click", () => activateUser(selectedUser));
  $("btnBloquear")?.addEventListener("click",   () => { closeModal(); accion("bloquear", selectedUser.id, selectedUser.nombre); });
  $("btnResetModal")?.addEventListener("click", () => { closeModal(); accion("reset", selectedUser.id, selectedUser.nombre); });
  $("btnDeleteModal")?.addEventListener("click",() => { closeModal(); accion("borrar", selectedUser.id, selectedUser.nombre); });
  $("btnUploadBoleta")?.addEventListener("click", uploadBoleta);

  cargarBoletasAdmin(selectedUser.id);

  const drop = $("uploadDrop");
  if (drop) {
    drop.addEventListener("dragover",  e => { e.preventDefault(); drop.classList.add("drag-over"); });
    drop.addEventListener("dragleave", () => drop.classList.remove("drag-over"));
    drop.addEventListener("drop", e => {
      e.preventDefault(); drop.classList.remove("drag-over");
      const file = e.dataTransfer.files[0];
      if (file) setPdfFile(file);
    });
  }

  $("userModal")?.classList.remove("hidden");
};

let selectedPdfFile = null;

window.onPdfSelected = function(input) {
  const file = input.files[0];
  if (file) setPdfFile(file);
};

function setPdfFile(file) {
  const errEl = $("uploadError");
  if (file.type !== "application/pdf") { if(errEl) errEl.textContent = "Solo se aceptan archivos PDF"; return; }
  if (file.size > 5*1024*1024) { if(errEl) errEl.textContent = "El PDF no puede superar 5 MB"; return; }
  if(errEl) errEl.textContent = "";
  selectedPdfFile = file;
  const txt = $("uploadDropText");
  if(txt) txt.textContent = `✓ ${file.name} (${(file.size/1024).toFixed(0)} KB)`;
  const btn = $("btnUploadBoleta");
  if(btn) btn.disabled = false;
}

async function cargarBoletasAdmin(usuarioId) {
  const list = $("adminBoletasList");
  if (!list) return;
  try {
    const resp = await fetch(`${BACKEND_URL}/admin/boletas/${usuarioId}`);
    if (!resp.ok) throw new Error("Error al cargar");
    const { boletas, total } = await resp.json();
    if (!boletas.length) {
      list.innerHTML = `<div style="font-size:11px;color:var(--text-3);padding:8px 0">Sin boletas cargadas todavía.</div>`;
      return;
    }
    list.innerHTML = `
      <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${total} boleta${total!==1?"s":""} cargada${total!==1?"s":""}</div>
      ${boletas.map(b => `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
          <span style="font-size:16px">⚡</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:11px;font-weight:600;color:var(--text-1)">${escHtml(b.periodo)}</div>
            <div style="font-size:10px;color:var(--text-3)">Vence: ${b.vencimiento} · Emitida: ${b.emitida}</div>
          </div>
          <button onclick="borrarBoleta('${b.id}','${escHtml(b.periodo)}')"
            style="padding:4px 10px;background:rgba(255,77,109,0.12);border:1px solid rgba(255,77,109,0.3);border-radius:6px;color:#ff4d6d;font-size:10px;font-weight:600;cursor:pointer;flex-shrink:0">
            Borrar
          </button>
        </div>
      `).join("")}`;
  } catch(e) {
    if(list) list.innerHTML = `<div style="font-size:11px;color:var(--red)">Error al cargar boletas</div>`;
  }
}

window.borrarBoleta = async function(boletaId, periodo) {
  if (!confirm(`¿Borrar la boleta de ${periodo}?`)) return;
  try {
    const resp = await fetch(`${BACKEND_URL}/boleta/${boletaId}`, { method:"DELETE" });
    if (!resp.ok) throw new Error("Error al borrar");
    showToast(`Boleta ${periodo} eliminada`, "success");
    if (selectedUser) cargarBoletasAdmin(selectedUser.id);
  } catch(e) { showToast("Error al borrar boleta", "error"); }
};

async function uploadBoleta() {
  if (!selectedUser || !selectedPdfFile) return;
  const periodo  = $("uploadPeriodo")?.value.trim();
  const venc     = $("uploadVenc")?.value.trim();
  const emitida  = $("uploadEmitida")?.value.trim();
  const errEl    = $("uploadError");

  if (!periodo || !venc || !emitida) {
    if(errEl) errEl.textContent = "Completá período, vencimiento y emisión";
    return;
  }

  setLoading("btnUploadBoleta", true, "Subiendo a R2...");
  if(errEl) errEl.textContent = "";

  try {
    const formData = new FormData();
    formData.append("pdf",        selectedPdfFile);
    formData.append("usuarioId",  selectedUser.id);
    formData.append("nroCliente", selectedUser.nroCliente || "");
    formData.append("periodo",    periodo);
    formData.append("vencimiento",venc);
    formData.append("emitida",    emitida);

    const resp = await fetch(`${BACKEND_URL}/boleta/subir`, { method:"POST", body:formData });
    if (!resp.ok) { const err = await resp.json(); throw new Error(err.error || `HTTP ${resp.status}`); }

    showToast(`✅ Boleta ${periodo} subida y cliente notificado`, "success");
    selectedPdfFile = null;
    $("uploadPdfInput").value = "";
    $("uploadDropText").textContent = "Arrastrá el PDF o tocá para elegir";
    $("uploadPeriodo").value = "";
    $("uploadVenc").value    = "";
    $("uploadEmitida").value = "";
    $("btnUploadBoleta").disabled = true;
  } catch(e) {
    console.error("[Upload R2]", e);
    if(errEl) errEl.textContent = e.message || "Error al subir. Intentá de nuevo.";
    showToast("Error al subir la boleta", "error");
  } finally {
    setLoading("btnUploadBoleta", false, "Subir a R2 y notificar cliente");
  }
}

// ════════════════════════════════════════════════════
//  ACTIVAR / RECHAZAR USUARIO
// ════════════════════════════════════════════════════
async function activateUser(user) {
  setLoading("btnActivate", true, "Activando...");
  try {
    const resp = await fetch(`${BACKEND_URL}/usuarios/${user.id}/activar`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (!resp.ok) { const err = await resp.json(); throw new Error(err.error || "Error al activar"); }
    showToast(`✅ ${user.nombre} activado y notificado`, "success");
    closeModal();
  } catch(e) {
    console.error("[Activar]", e);
    showToast("Error al activar: " + e.message, "error");
    setLoading("btnActivate", false, "Activar cuenta");
  }
}

async function rejectUser(user) {
  if (!confirm(`¿Rechazar la solicitud de ${user.nombre}?`)) return;
  try {
    await updateDoc(doc(db,"usuarios",user.id), { estado:"rechazado", rechazadoEn:serverTimestamp() });
    showToast(`Usuario ${user.nombre} rechazado`, "");
    closeModal();
  } catch(e) { showToast("Error al rechazar", "error"); }
}

// ════════════════════════════════════════════════════
//  MODAL CIERRE
// ════════════════════════════════════════════════════
$("btnCloseModal")?.addEventListener("click", closeModal);
$("userModal")?.addEventListener("click", e => { if(e.target===$("userModal")) closeModal(); });
function closeModal() {
  $("userModal")?.classList.add("hidden");
  selectedUser    = null;
  selectedPdfFile = null;
}

// ════════════════════════════════════════════════════
//  AVISOS GENERALES
// ════════════════════════════════════════════════════
$("btnEditarAviso")?.addEventListener("click", async () => {
  try {
    const resp = await fetch(`${BACKEND_URL}/avisos/activo`);
    const data = await resp.json();
    if (data.aviso) {
      const a = data.aviso;
      if ($("avisoTipo"))   $("avisoTipo").value   = a.tipo   || "aviso";
      if ($("avisoTitulo")) $("avisoTitulo").value = a.titulo || "";
      if ($("avisoCuerpo")) $("avisoCuerpo").value = a.cuerpo || "";
      if ($("avisoActivo")) $("avisoActivo").checked = a.activo !== false;
    }
  } catch(e) { console.warn("[Aviso]", e); }
  $("modalAviso")?.classList.remove("hidden");
});

// ════════════════════════════════════════════════════
//  SECCIÓN AVISOS GENERALES
// ════════════════════════════════════════════════════
async function loadAvisosHistorial() {
  const loading = $("avisosHistorialLoading");
  const empty   = $("avisosHistorialEmpty");
  const list    = $("avisosHistorialList");
  if (!list) return;
  loading?.classList.remove("hidden");
  empty?.classList.add("hidden");
  list.classList.add("hidden");
  list.innerHTML = "";

  try {
    const resp = await fetch(`${BACKEND_URL}/avisos/generales`);
    const data = resp.ok ? await resp.json() : { avisos: [] };
    const avisos = data.avisos || [];
    loading?.classList.add("hidden");

    if (!avisos.length) { empty?.classList.remove("hidden"); return; }

    const ICONOS = { alerta:"🚨", aviso:"⚠️", info:"ℹ️" };
    list.innerHTML = avisos.map(a => {
      const icono   = ICONOS[a.tipo] || "📣";
      const fecha   = a.creadoEn ? new Date(a.creadoEn).toLocaleString("es-AR",{ day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit" }) : "—";
      const entregados = a.enviados ?? "—";
      const total      = a.destinatarios ?? "—";
      return `<div class="aviso-hist-card">
        <div class="aviso-hist-header">
          <span class="aviso-hist-icono">${icono}</span>
          <div class="aviso-hist-meta">
            <div class="aviso-hist-titulo">${escHtml(a.titulo)}</div>
            <div class="aviso-hist-fecha">${fecha}</div>
          </div>
          <div class="aviso-hist-stats">
            <span title="Entregados / Total tokens">${entregados}/${total} push</span>
          </div>
        </div>
        <div class="aviso-hist-body">${escHtml(a.mensaje)}</div>
      </div>`;
    }).join("");
    list.classList.remove("hidden");
  } catch(e) {
    loading?.classList.add("hidden");
    showToast("Error al cargar historial", "error");
  }
}

// Navegar a secAvisos → cargar historial
document.querySelectorAll(".nav-item[data-sec]").forEach(link => {
  link.addEventListener("click", () => {
    if (link.dataset.sec === "secAvisos") loadAvisosHistorial();
  });
});

$("btnRefreshAvisos")?.addEventListener("click", () => {
  $("btnRefreshAvisos")?.classList.add("spinning");
  loadAvisosHistorial().finally(() => {
    setTimeout(() => $("btnRefreshAvisos")?.classList.remove("spinning"), 800);
  });
});

$("btnEnviarGeneral")?.addEventListener("click", async () => {
  const tipo    = $("generalTipo")?.value    || "aviso";
  const titulo  = $("generalTitulo")?.value?.trim() || "";
  const mensaje = $("generalMensaje")?.value?.trim() || "";
  const errEl   = $("generalError");
  if (errEl) errEl.textContent = "";

  if (!titulo)  { if(errEl) errEl.textContent = "Escribí un título para el aviso"; return; }
  if (!mensaje) { if(errEl) errEl.textContent = "Escribí el mensaje del aviso"; return; }

  setLoading("btnEnviarGeneral", true, "Enviando...");
  try {
    const resp = await fetch(`${BACKEND_URL}/avisos/general`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tipo, titulo, mensaje }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || "Error al enviar");

    // Limpiar form
    if ($("generalTitulo"))  $("generalTitulo").value  = "";
    if ($("generalMensaje")) $("generalMensaje").value = "";
    if ($("generalTipo"))    $("generalTipo").value    = "aviso";

    const msg = `✅ Aviso enviado · ${data.pushEnviados ?? 0} push entregados de ${data.total ?? 0} suscriptos`;
    showToast(msg, "success");
    loadAvisosHistorial();
  } catch(e) {
    if (errEl) errEl.textContent = e.message || "Error al enviar. Intentá de nuevo.";
  } finally {
    setLoading("btnEnviarGeneral", false, '<svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M3 10l14-7-5 7 5 7-14-7z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg> Enviar a todos los clientes');
  }
});

$("btnCloseAviso")?.addEventListener("click", () => $("modalAviso")?.classList.add("hidden"));
$("modalAviso")?.addEventListener("click", e => { if(e.target===$("modalAviso")) $("modalAviso").classList.add("hidden"); });

$("btnGuardarAviso")?.addEventListener("click", async () => {
  const titulo = $("avisoTitulo")?.value.trim();
  const cuerpo = $("avisoCuerpo")?.value.trim();
  const tipo   = $("avisoTipo")?.value  || "aviso";
  const activo = $("avisoActivo")?.checked !== false;
  const errEl  = $("avisoError");

  if (!titulo || !cuerpo) { if(errEl) errEl.textContent = "Completá título y mensaje"; return; }
  if(errEl) errEl.textContent = "";

  try {
    const resp = await fetch(`${BACKEND_URL}/avisos/activo`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ tipo, titulo, cuerpo, activo }),
    });
    if (!resp.ok) throw new Error("Error al guardar");
    const data = await resp.json();
    $("modalAviso")?.classList.add("hidden");
    const msg = data.notificados > 0
      ? `✅ Aviso publicado · ${data.notificados} cliente${data.notificados!==1?"s":""} notificado${data.notificados!==1?"s":""}`
      : "✅ Aviso guardado";
    showToast(msg, "success");
  } catch(e) { if(errEl) errEl.textContent = "Error al guardar. Intentá de nuevo."; }
});

$("btnBorrarAviso")?.addEventListener("click", async () => {
  if (!confirm("¿Quitar el aviso?")) return;
  try {
    await fetch(`${BACKEND_URL}/avisos/activo`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ tipo:"info", titulo:"", cuerpo:"", activo:false }),
    });
    $("modalAviso")?.classList.add("hidden");
    showToast("Aviso quitado", "");
  } catch(e) { showToast("Error al quitar aviso", "error"); }
});

// ════════════════════════════════════════════════════
//  REFRESH + MOBILE MENU
// ════════════════════════════════════════════════════
$("btnRefresh")?.addEventListener("click", () => {
  $("btnRefresh")?.classList.add("spinning");
  loadUsers();
  setTimeout(() => $("btnRefresh")?.classList.remove("spinning"), 1000);
});

$("btnMenu")?.addEventListener("click", () => {
  const sidebar = document.querySelector(".sidebar");
  sidebar?.classList.add("open");
  const overlay = Object.assign(document.createElement("div"),{ className:"sidebar-overlay" });
  document.body.appendChild(overlay);
  overlay.addEventListener("click", () => { sidebar?.classList.remove("open"); overlay.remove(); });
});

// ════════════════════════════════════════════════════
//  UTILS
// ════════════════════════════════════════════════════
function toDate(val) {
  if (!val) return null;
  if (val.toDate) return val.toDate();
  if (val._seconds) return new Date(val._seconds * 1000);
  return new Date(val);
}

function setLoading(btnId, on, label) {
  const btn = $(btnId); if(!btn) return;
  btn.disabled = on;
  if(on) {
    btn.dataset.orig = btn.innerHTML;
    btn.innerHTML = `<div class="loading-spinner" style="width:16px;height:16px;border-color:rgba(7,11,20,.3);border-top-color:#070b14;margin-right:6px"></div>${label}`;
  } else {
    if(btn.dataset.orig) { btn.innerHTML=btn.dataset.orig; delete btn.dataset.orig; }
  }
}

function getBadgeClass(estado) {
  return { pendiente:"badge-pending", activo:"badge-active", rechazado:"badge-rejected", bloqueado:"badge-rejected" }[estado] || "badge-pending";
}
function capitalizar(s)  { return s ? s[0].toUpperCase()+s.slice(1) : "—"; }
function escHtml(s)      { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function formatDate(ts, full=false) {
  if(!ts) return "—";
  const d = toDate(ts);
  if (!d) return "—";
  return full ? d.toLocaleString("es-AR") : d.toLocaleDateString("es-AR",{day:"2-digit",month:"short"});
}

let _tt;
function showToast(msg, type="") {
  clearTimeout(_tt);
  const t=$("toast"); if(!t) return;
  t.textContent=msg; t.className=`toast ${type} show`;
  _tt=setTimeout(()=>t.classList.remove("show"),3500);
}
