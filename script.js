window.onload = function(){
setTimeout(()=>{
document.getElementById("splash").style.display="none"
},2000)
}

// CONTRATO
function mostrarContrato(){
let check=document.getElementById("terminos")
let contrato=document.getElementById("contrato")
contrato.style.display=check.checked?"block":"none"
}

// REGISTRO REAL
async function registrar(){

let loader=document.getElementById("loader")
loader.style.display="block"

let nombre=document.getElementById("nombre").value
let dni=document.getElementById("dni").value
let usuario=document.getElementById("usuario").value
let direccion=document.getElementById("direccion").value
let celular=document.getElementById("celular").value
let terminos=document.getElementById("terminos").checked

if(!nombre||!dni||!usuario||!direccion||!celular){
alert("Completar todo")
loader.style.display="none"
return
}

if(!terminos){
alert("Aceptar términos")
loader.style.display="none"
return
}

try{

await addDoc(collection(db,"usuarios"),{
nombre,dni,usuario,direccion,celular,
estado:"pendiente_pago",
fecha:new Date()
})

loader.style.display="none"
alert("Registrado correctamente")

}catch(e){
console.error(e)
loader.style.display="none"
alert("Error al guardar")
}
}

// COPIAR
function copiarAlias(){
let alias=document.getElementById("aliasTexto").innerText
navigator.clipboard.writeText(alias)
alert("Alias copiado")
}

// MERCADO PAGO
function abrirMP(){
window.open("https://www.mercadopago.com.ar","_blank")
}

// SUBIR COMPROBANTE REAL
async function subirComprobante(){

let archivo=document.getElementById("comprobante").files[0]

if(!archivo){
alert("Seleccionar archivo")
return
}

try{

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

}catch(e){
console.error(e)
alert("Error al subir")
}
}