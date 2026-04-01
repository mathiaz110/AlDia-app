const check = document.getElementById("checkTerminos");
const btn = document.getElementById("btnContinuar");

const btnEnviar = document.getElementById("btnEnviar");
const btnCopiar = document.getElementById("btnCopiar");
const btnMP = document.getElementById("btnMP");

// habilitar botón
check.addEventListener("change", () => {
  btn.disabled = !check.checked;
});

// cambiar pantalla
function cambiar(actual, siguiente){
  document.getElementById(actual).classList.remove("activa");
  document.getElementById(siguiente).classList.add("activa");
}

// continuar
btn.addEventListener("click", () => {
  cambiar("pantallaTerminos","pantallaRegistro");
});

// copiar alias
btnCopiar.addEventListener("click", () => {
  navigator.clipboard.writeText(document.getElementById("aliasTexto").innerText);
  alert("Alias copiado");
});

// abrir MP
btnMP.addEventListener("click", () => {
  window.open("https://www.mercadopago.com.ar");
});

// enviar comprobante + FIREBASE
btnEnviar.addEventListener("click", async () => {

  cambiar("pantallaRegistro","pantallaEstado");

  const nombre = document.getElementById("nombre").value;
  const dni = document.getElementById("dni").value;
  const usuario = document.getElementById("usuario").value;
  const direccion = document.getElementById("direccion").value;
  const celular = document.getElementById("celular").value;

  const archivo = document.getElementById("comprobante").files[0];

  try {

    let url = "";

    if(archivo){
      const storageRef = ref(storage, "comprobantes/" + Date.now());
      await uploadBytes(storageRef, archivo);
      url = await getDownloadURL(storageRef);
    }

    await addDoc(collection(db, "usuarios"), {
      nombre, dni, usuario, direccion, celular,
      comprobante: url,
      fecha: new Date(),
      estado: "pendiente"
    });

    setTimeout(()=>{
      document.getElementById("estadoTitulo").innerText = "Pago recibido ✅";
      document.getElementById("estadoTexto").innerText = "En breve recibirás tu boleta";
    },2000);

  } catch (error) {
    console.log(error);

    document.getElementById("estadoTitulo").innerText = "Error ❌";
    document.getElementById("estadoTexto").innerText = "Intentá nuevamente";
  }

});