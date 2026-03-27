async function registrar(){

let loader=document.getElementById("loader")
loader.style.display="block"

let nombre=document.getElementById("nombre").value
let dni=document.getElementById("dni").value
let usuario=document.getElementById("usuario").value
let direccion=document.getElementById("direccion").value
let celular=document.getElementById("celular").value
let terminos=document.getElementById("terminos").checked

if(!nombre||!dni||!usuario||!direccion||!celular||!terminos){
alert("Completar todo")
loader.style.display="none"
return
}

await addDoc(collection(db,"usuarios"),{
nombre,dni,usuario,direccion,celular,
estado:"pendiente_pago",
fecha:new Date()
})

loader.style.display="none"
alert("Registrado correctamente")
}

function copiarAlias(){
let alias=document.getElementById("aliasTexto").innerText
navigator.clipboard.writeText(alias)
alert("Alias copiado")
}

function abrirMP(){
window.location.href="mercadopago://"
}

async function subirComprobante(){

let archivo=document.getElementById("comprobante").files[0]

if(!archivo){
alert("Seleccionar archivo")
return
}

let ruta="comprobantes/"+Date.now()+"_"+archivo.name
let referencia=ref(storage,ruta)

await uploadBytes(referencia,archivo)

let url=await getDownloadURL(referencia)

await addDoc(collection(db,"comprobantes"),{
url,
fecha:new Date(),
estado:"pendiente"
})

alert("Comprobante enviado")
}
