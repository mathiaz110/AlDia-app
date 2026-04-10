function el(id){ return document.getElementById(id); }

window.habilitarBoton = function(){
  const check = el("checkTerminos");
  el("btnContinuar").disabled = !check.checked;
};

function cambiar(a,b){
  el(a).classList.remove("activa");
  el(b).classList.add("activa");
}

window.aceptarTerminos = function(){
  if(!el("checkTerminos").checked) return;
  cambiar("pantallaTerminos","pantallaRegistro");
};

window.registrar = function(){

  const campos = ["nombre","dni","usuario","direccion","celular"];

  for(let c of campos){
    if(!el(c).value.trim()){
      alert("Completar todos los campos");
      return;
    }
  }

  alert("Datos correctos ✔");
};

window.copiarAlias = function(){
  navigator.clipboard.writeText(el("aliasTexto").innerText)
    .then(()=>alert("Alias copiado ✔"))
    .catch(()=>alert("Error al copiar"));
};

window.abrirMP = function(){
  window.open("https://www.mercadopago.com.ar","_blank");
};

window.subirComprobante = async function(){

  const archivo = el("comprobante").files[0];

  if(!archivo){
    alert("Seleccionar comprobante");
    return;
  }

  cambiar("pantallaRegistro","pantallaEstado");

  try{

    let url = "";

    if(window.storage){
      const storageRef = ref(storage, "comprobantes/"+Date.now());
      await uploadBytes(storageRef, archivo);
      url = await getDownloadURL(storageRef);
    }

    if(window.db){
      await addDoc(collection(db,"usuarios"),{
        nombre:el("nombre").value,
        dni:el("dni").value,
        usuario:el("usuario").value,
        direccion:el("direccion").value,
        celular:el("celular").value,
        comprobante:url,
        fecha:new Date(),
        estado:"pendiente"
      });
    }

    setTimeout(()=>{
      el("estadoTitulo").innerText="Pago recibido ✅";
      el("estadoTexto").innerText="En breve recibirás tu boleta";
    },1500);

  }catch(e){
    el("estadoTitulo").innerText="Error ❌";
    el("estadoTexto").innerText="Intentá nuevamente";
  }
};