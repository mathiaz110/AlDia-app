// =======================
// 🔥 FIREBASE IMPORTS
// =======================
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-app.js";
import { getFirestore, collection, addDoc } from "https://www.gstatic.com/firebasejs/12.12.0/firebase-firestore.js";

// =======================
// 🔥 CONFIG REAL (LA TUYA)
// =======================
const firebaseConfig = {
  apiKey: "AIzaSyB2vua5gMe7hspIMtVunPAmWWkUB3-nt5A",
  authDomain: "aldia-app1.firebaseapp.com",
  projectId: "aldia-app1",
  storageBucket: "aldia-app1.firebasestorage.app",
  messagingSenderId: "1013051386288",
  appId: "1:1013051386288:web:e588c83d0892d6cbab4e75",
  measurementId: "G-28VQ7VM4KS"
};

// =======================
// 🔥 INIT FIREBASE
// =======================
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// =======================
// 🖥️ ELEMENTOS
// =======================
const pantallaTerminos = document.getElementById("pantallaTerminos");
const pantallaRegistro = document.getElementById("pantallaRegistro");
const pantallaEstado = document.getElementById("pantallaEstado");

const check = document.getElementById("checkTerminos");
const btnContinuar = document.getElementById("btnContinuar");
const btnEnviar = document.getElementById("btnEnviar");
const btnCopiar = document.getElementById("btnCopiar");
const btnMP = document.getElementById("btnMP");

const aliasTexto = document.getElementById("aliasTexto");

// =======================
// ✅ CHECK
// =======================
check.addEventListener("change", () => {
  btnContinuar.disabled = !check.checked;
});

// =======================
// ➡️ CAMBIO PANTALLA
// =======================
btnContinuar.addEventListener("click", () => {
  pantallaTerminos.classList.remove("activa");
  pantallaRegistro.classList.add("activa");
});

// =======================
// 📋 COPIAR ALIAS
// =======================
btnCopiar.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(aliasTexto.innerText);
    alert("Alias copiado ✅");
  } catch {
    alert("Error al copiar");
  }
});

// =======================
// 💰 MERCADO PAGO
// =======================
btnMP.addEventListener("click", () => {
  window.open("https://www.mercadopago.com.ar", "_blank");
});

// =======================
// ☁️ GUARDAR EN FIRESTORE
// =======================
async function subirDatos() {

  const nombre = document.getElementById("nombre").value.trim();
  const dni = document.getElementById("dni").value.trim();
  const usuario = document.getElementById("usuario").value.trim();
  const direccion = document.getElementById("direccion").value.trim();
  const celular = document.getElementById("celular").value.trim();

  if (!nombre || !dni || !usuario) {
    alert("Completá los datos obligatorios");
    return;
  }

  try {

    await addDoc(collection(db, "usuarios"), {
      nombre,
      dni,
      usuario,
      direccion,
      celular,
      alias: aliasTexto.innerText,
      fecha: new Date(),
      estado: "pendiente"
    });

    pantallaRegistro.classList.remove("activa");
    pantallaEstado.classList.add("activa");

    document.getElementById("estadoTitulo").innerText = "Pago recibido ✅";
    document.getElementById("estadoTexto").innerText = "Estamos verificando tu pago";

  } catch (error) {
    console.error(error);
    alert("Error al guardar en Firebase");
  }
}

// =======================
// 🔘 BOTÓN FINAL
// =======================
btnEnviar.addEventListener("click", subirDatos);

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js");
}

let deferredPrompt;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;

  const btn = document.getElementById("btnInstalar");
  btn.style.display = "block";

  btn.addEventListener("click", () => {
    deferredPrompt.prompt();
  });
});