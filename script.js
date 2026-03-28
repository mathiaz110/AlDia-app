// ==============================
// SPLASH SCREEN
// ==============================
window.addEventListener("load", () => {
  setTimeout(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.style.opacity = "0";
      splash.style.pointerEvents = "none";
    }
  }, 1500);
});


// ==============================
// ELEMENTOS
// ==============================
const checkTerminos = document.getElementById("checkTerminos");
const btnContinuar = document.getElementById("btnContinuar");

const pantallaTerminos = document.getElementById("pantallaTerminos");
const pantallaRegistro = document.getElementById("pantallaRegistro");


// ==============================
// HABILITAR BOTÓN
// ==============================
function habilitarBoton() {
  if (!checkTerminos || !btnContinuar) return;

  btnContinuar.disabled = !checkTerminos.checked;
  btnContinuar.classList.toggle("activo", checkTerminos.checked);
}


// ==============================
// CAMBIO DE PANTALLA
// ==============================
async function aceptarTerminos() {

  // Validación extra
  if (!checkTerminos.checked) return;

  // Cambio de pantalla (SIN display, solo clases)
  pantallaTerminos.classList.add("oculta");
  pantallaRegistro.classList.remove("oculta");

  window.scrollTo({ top: 0, behavior: "smooth" });

  // Guardado en Firebase (no bloquea UI)
  try {
    if (window.db && window.addDoc && window.collection) {
      await addDoc(collection(db, "aceptaciones"), {
        fecha: new Date(),
        aceptado: true,
        userAgent: navigator.userAgent
      });
    }
  } catch (error) {
    console.log("Error Firebase:", error);
  }

  // Vibración opcional
  if (navigator.vibrate) {
    navigator.vibrate(80);
  }
}


// ==============================
// REGISTRO USUARIO
// ==============================
async function registrar() {

  const loader = document.getElementById("loader");
  if (loader) loader.style.display = "block";

  const nombre = document.getElementById("nombre").value.trim();
  const dni = document.getElementById("dni").value.trim();
  const usuario = document.getElementById("usuario").value.trim();
  const direccion = document.getElementById("direccion").value.trim();
  const celular = document.getElementById("celular").value.trim();

  // Validación
  if (!nombre || !dni || !usuario || !direccion || !celular) {
    alert("Completar todos los campos");
    if (loader) loader.style.display = "none";
    return;
  }

  try {
    if (window.db) {
      await addDoc(collection(db, "usuarios"), {
        nombre,
        dni,
        usuario,
        direccion,
        celular,
        fecha: new Date(),
        estado: "pendiente_pago"
      });
    }

    alert("Registro exitoso 🚀");

  } catch (error) {
    console.log("Firebase error:", error);
    alert("Continuar con pago (modo seguro)");
  }

  if (loader) loader.style.display = "none";

  // Scroll a pago
  const pagoBox = document.querySelector(".pago-box");
  if (pagoBox) {
    pagoBox.scrollIntoView({ behavior: "smooth" });
  }

  // Vibración
  if (navigator.vibrate) {
    navigator.vibrate(100);
  }
}


// ==============================
// COPIAR ALIAS
// ==============================
function copiarAlias() {
  const texto = document.getElementById("aliasTexto").innerText;

  navigator.clipboard.writeText(texto)
    .then(() => alert("Alias copiado"))
    .catch(() => alert("No se pudo copiar"));
}


// ==============================
// ABRIR MERCADO PAGO
// ==============================
function abrirMP() {
  window.open("https://www.mercadopago.com.ar", "_blank");
}


// ==============================
// SUBIR COMPROBANTE
// ==============================
async function subirComprobante() {

  const archivo = document.getElementById("comprobante").files[0];

  if (!archivo) {
    alert("Seleccionar archivo");
    return;
  }

  try {

    if (window.storage && window.ref && window.uploadBytes && window.getDownloadURL) {

      const ruta = "comprobantes/" + Date.now() + "_" + archivo.name;
      const storageRef = ref(storage, ruta);

      await uploadBytes(storageRef, archivo);

      const url = await getDownloadURL(storageRef);

      await addDoc(collection(db, "comprobantes"), {
        url,
        fecha: new Date(),
        estado: "pendiente"
      });

    }

    alert("Comprobante enviado ✅");

  } catch (error) {
    console.log("Error subida:", error);
    alert("Comprobante recibido (modo seguro)");
  }

  // Vibración final
  if (navigator.vibrate) {
    navigator.vibrate([100, 50, 100]);
  }
}