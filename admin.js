// ═══════════════════════════════════════════════════
//  ALDIA APP — admin.js v5
//  Panel administrador con subida de boletas a R2
// ═══════════════════════════════════════════════════

import { initializeApp }                        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword,
         signOut, onAuthStateChanged }          from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore, collection, getDocs,
         doc, updateDoc, query, where,
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
const BACKEND_URL = "https://aldia-app-production.up.railway.app"; // ← URL de Railway/Render

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
let selectedUser  = null; // usuario abierto en modal

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
  // Guardar token FCM del admin para recibir notificaciones de nuevos registros
  registrarTokenAdmin();
}

async function registrarTokenAdmin() {
  try {
    if (!("Notification" in window)) return;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return;

    // Importar Firebase Messaging para el admin
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
//  ESTADÍSTICAS
// ════════════════════════════════════════════════════
function updateStats() {
  if ($("statTotal"))   $("statTotal").textContent   = allUsers.length;
  if ($("statPending")) $("statPending").textContent = allUsers.filter(u=>u.estado==="pendiente").length;
  if ($("statActive"))  $("statActive").textContent  = allUsers.filter(u=>u.estado==="activo").length;
  // Contador de ingresos
  const activos = allUsers.filter(u=>u.estado==="activo").length;
  const ingresos = activos * 2247.25;
  if ($("statIngresos")) $("statIngresos").textContent = "$" + ingresos.toLocaleString("es-AR", {minimumFractionDigits:2, maximumFractionDigits:2});
}

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
    <div class="user-card" data-id="${u.id}" onclick="openModal('${u.id}')">
      <div class="user-avatar">${(u.nombre||"?")[0].toUpperCase()}</div>
      <div class="user-info">
        <div class="user-name">${escHtml(u.nombre||"Sin nombre")}</div>
        <div class="user-meta">@${escHtml(u.usuario||"—")} · N°${escHtml(u.nroCliente||"—")} · DNI ${escHtml(u.dni||"—")}</div>
      </div>
      <span class="user-status-badge ${getBadgeClass(u.estado)}">${capitalizar(u.estado)}</span>
      <div class="user-date">${formatDate(u.creadoEn)}</div>
    </div>
  `).join("");
}

// ════════════════════════════════════════════════════
//  MODAL USUARIO
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
    <div class="detail-row"><span class="detail-label">Token FCM</span><span class="detail-value" style="font-size:10px;word-break:break-all">${selectedUser.fcmToken?.substring(0,40)||"—"}…</span></div>
  `;

  // ─── ACCIONES SEGÚN ESTADO ───────────────────────
  const actions = $("modalActions");
  actions.innerHTML = `
    ${selectedUser.estado==="pendiente" ? `
      <button class="btn-activate" id="btnActivate">
        <svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M4 10l5 5 7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Activar cuenta y notificar
      </button>
      <button class="btn-reject" id="btnReject">Rechazar solicitud</button>
    ` : selectedUser.estado==="activo" ? `
      <p style="text-align:center;color:var(--text-3);font-size:12px;padding:4px 0">Cuenta activa ✓</p>
    ` : `
      <button class="btn-activate" id="btnReactivate">Reactivar cuenta</button>
    `}

    <!-- ─── BOLETAS DEL CLIENTE ─────────────────────── -->
    <div class="upload-boleta-section">
      <div class="upload-section-title">
        <svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M3 4h14M3 8h14M3 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        Boletas del cliente
      </div>
      <div id="adminBoletasList" style="margin-bottom:12px">
        <div style="font-size:11px;color:var(--text-3)">Cargando boletas...</div>
      </div>

    <!-- ─── SUBIR BOLETA A R2 ─────────────────────── -->
    <div class="upload-section-title" style="margin-top:8px">
        <svg viewBox="0 0 20 20" fill="none" style="width:15px;height:15px"><path d="M10 3v10M6 7l4-4 4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 15h12" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
        Subir nueva boleta PDF → R2
      </div>
      <div class="upload-fields">
        <div class="field-group">
          <label class="field-label">Período (ej: Enero 2025)</label>
          <div class="field-wrap">
            <svg class="field-icon" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M3 8h14M7 4V2M13 4V2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            <input type="text" id="uploadPeriodo" class="field-input" placeholder="Enero 2025"/>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Fecha de vencimiento</label>
          <div class="field-wrap">
            <svg class="field-icon" viewBox="0 0 20 20" fill="none"><circle cx="10" cy="11" r="6" stroke="currentColor" stroke-width="1.4"/><path d="M10 8v3l2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <input type="text" id="uploadVenc" class="field-input" placeholder="10/01/2025"/>
          </div>
        </div>
        <div class="field-group">
          <label class="field-label">Fecha de emisión</label>
          <div class="field-wrap">
            <svg class="field-icon" viewBox="0 0 20 20" fill="none"><rect x="3" y="4" width="14" height="13" rx="2" stroke="currentColor" stroke-width="1.4"/><path d="M7 10h6M7 13h4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
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
    </div>
  `;

  // Eventos de acción
  $("btnActivate")?.addEventListener("click",   () => activateUser(selectedUser));
  // Cargar boletas del cliente
  cargarBoletasAdmin(selectedUser.id);
  $("btnReject")?.addEventListener("click",     () => rejectUser(selectedUser));
  $("btnReactivate")?.addEventListener("click", () => activateUser(selectedUser));
  $("btnUploadBoleta")?.addEventListener("click", uploadBoleta);

  // Drag & drop en la zona de upload
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
  if (file.type !== "application/pdf") {
    if(errEl) errEl.textContent = "Solo se aceptan archivos PDF";
    return;
  }
  if (file.size > 5*1024*1024) {
    if(errEl) errEl.textContent = "El PDF no puede superar 5 MB";
    return;
  }
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
    // Recargar lista
    if (selectedUser) cargarBoletasAdmin(selectedUser.id);
  } catch(e) {
    showToast("Error al borrar boleta", "error");
  }
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

    const resp = await fetch(`${BACKEND_URL}/boleta/subir`, {
      method: "POST",
      body:   formData,
      // No poner Content-Type — el browser lo pone automático con boundary
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const data = await resp.json();

    showToast(`✅ Boleta ${periodo} subida y cliente notificado`, "success");
    // Reset
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
    // Activar via backend — actualiza Firestore Y envía push notification
    const resp = await fetch(`${BACKEND_URL}/usuarios/${user.id}/activar`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.error || "Error al activar");
    }

    showToast(`✅ ${user.nombre} activado y notificado`, "success");
    closeModal();
  } catch(e) {
    console.error("[Activar]", e);
    showToast("Error al activar: " + e.message, "error");
    setLoading("btnActivate", false, "Activar cuenta y notificar");
  }
}

async function rejectUser(user) {
  if (!confirm(`¿Rechazar la solicitud de ${user.nombre}?`)) return;
  try {
    await updateDoc(doc(db,"usuarios",user.id), {
      estado:       "rechazado",
      rechazadoEn:  serverTimestamp(),
    });
    showToast(`Usuario ${user.nombre} rechazado`, "");
    closeModal();
  } catch(e) { showToast("Error al rechazar", "error"); }
}

// ════════════════════════════════════════════════════
//  CERRAR MODAL
// ════════════════════════════════════════════════════
$("btnCloseModal")?.addEventListener("click", closeModal);
$("userModal")?.addEventListener("click", e => { if(e.target===$("userModal")) closeModal(); });
function closeModal() {
  $("userModal")?.classList.add("hidden");
  selectedUser    = null;
  selectedPdfFile = null;
}

// ════════════════════════════════════════════════════
//  REFRESH + MOBILE MENU
// ════════════════════════════════════════════════════
// ════════════════════════════════════════════════════
//  AVISOS GENERALES — editar desde admin
// ════════════════════════════════════════════════════
$("btnEditarAviso")?.addEventListener("click", async () => {
  // Cargar aviso actual
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

$("btnCloseAviso")?.addEventListener("click", () => {
  $("modalAviso")?.classList.add("hidden");
});
$("modalAviso")?.addEventListener("click", e => {
  if (e.target === $("modalAviso")) $("modalAviso").classList.add("hidden");
});

$("btnGuardarAviso")?.addEventListener("click", async () => {
  const titulo = $("avisoTitulo")?.value.trim();
  const cuerpo = $("avisoCuerpo")?.value.trim();
  const tipo   = $("avisoTipo")?.value  || "aviso";
  const activo = $("avisoActivo")?.checked !== false;
  const errEl  = $("avisoError");

  if (!titulo || !cuerpo) {
    if (errEl) errEl.textContent = "Completá título y mensaje";
    return;
  }
  if (errEl) errEl.textContent = "";

  try {
    const resp = await fetch(`${BACKEND_URL}/avisos/activo`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tipo, titulo, cuerpo, activo }),
    });
    if (!resp.ok) throw new Error("Error al guardar");
    const data = await resp.json();
    $("modalAviso")?.classList.add("hidden");
    const msg = data.notificados > 0
      ? `✅ Aviso publicado · ${data.notificados} cliente${data.notificados!==1?"s":""} notificado${data.notificados!==1?"s":""}`
      : "✅ Aviso guardado (sin clientes activos aún)";
    showToast(msg, "success");
  } catch(e) {
    if (errEl) errEl.textContent = "Error al guardar. Intentá de nuevo.";
  }
});

$("btnBorrarAviso")?.addEventListener("click", async () => {
  if (!confirm("¿Quitar el aviso? Los clientes dejarán de verlo.")) return;
  try {
    await fetch(`${BACKEND_URL}/avisos/activo`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ tipo:"info", titulo:"", cuerpo:"", activo:false }),
    });
    $("modalAviso")?.classList.add("hidden");
    showToast("Aviso quitado", "");
  } catch(e) { showToast("Error al quitar aviso", "error"); }
});

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
  return { pendiente:"badge-pending", activo:"badge-active", rechazado:"badge-rejected" }[estado] || "badge-pending";
}
function capitalizar(s)  { return s ? s[0].toUpperCase()+s.slice(1) : "—"; }
function escHtml(s)      { return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function formatDate(ts, full=false) {
  if(!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return full ? d.toLocaleString("es-AR") : d.toLocaleDateString("es-AR",{day:"2-digit",month:"short"});
}

let _tt;
function showToast(msg, type="") {
  clearTimeout(_tt);
  const t=$("toast"); if(!t) return;
  t.textContent=msg; t.className=`toast ${type} show`;
  _tt=setTimeout(()=>t.classList.remove("show"),3500);
}
