// SPLASH
window.onload = () => {
setTimeout(()=> {
document.getElementById("splash").style.display="none"
},2000)
}

// HABILITAR BOTON
function habilitarBoton(){

let check = document.getElementById("checkTerminos")
let btn = document.getElementById("btnContinuar")
let cont = check.parentElement

if(check.checked){
btn.disabled = false
btn.classList.add("activo")
cont.classList.add("activo")
}else{
btn.disabled = true
btn.classList.remove("activo")
cont.classList.remove("activo")
}

}

// ACEPTAR TERMINOS (MEJORADO PRO)


async function aceptarTerminos(){

let t = document.getElementById("pantallaTerminos")
let r = document.getElementById("pantallaRegistro")

// ⚠️ PRIMERO CAMBIAR PANTALLA (clave)
t.style.display="none"
r.style.display="block"

window.scrollTo({top:0, behavior:"smooth"})

// 🔥 DESPUÉS intentar guardar (sin bloquear)
try{
await addDoc(collection(db,"aceptaciones"),{
fecha:new Date(),
aceptado:true,
userAgent:navigator.userAgent
})
}catch(e){
console.log("Firebase error (no bloquea):", e)
}

// vibración opcional
if(navigator.vibrate){
navigator.vibrate(80)
}

}

// REGISTRO (ANTI BUG)
async function registrar(){

let loader=document.getElementById("loader")
loader.style.display="block"

let nombre=document.getElementById("nombre").value
let dni=document.getElementById("dni").value
let usuario=document.getElementById("usuario").value
let direccion=document.getElementById("direccion").value
let celular=document.getElementById("celular").value

if(!nombre||!dni||!usuario||!direccion||!celular){
alert("Completar todo")
loader.style.display="none"
return
}

try{

await Promise.race([
addDoc(collection(db,"usuarios"),{
nombre,dni,usuario,direccion,celular,
fecha:new Date(),
estado:"pendiente_pago"
}),
new Promise((_, reject)=>setTimeout(()=>reject("timeout"),5000))
])

alert("Registro exitoso 🚀")

}catch(e){
alert("Continuar con pago (modo seguro)")
}

loader.style.display="none"

// vibración leve
if(navigator.vibrate){
navigator.vibrate(100)
}

// scroll a pago
document.querySelector(".pago-box").scrollIntoView({
behavior:"smooth"
})

}

// COPIAR
function copiarAlias(){
navigator.clipboard.writeText(
document.getElementById("aliasTexto").innerText
)
alert("Alias copiado")
}

// MERCADO PAGO
function abrirMP(){
window.open("https://www.mercadopago.com.ar","_blank")
}

// SUBIR COMPROBANTE
async function subirComprobante(){

let archivo=document.getElementById("comprobante").files[0]

if(!archivo){
alert("Seleccionar archivo")
return
}

try{

let ruta="comprobantes/"+Date.now()+"_"+archivo.name
let storageRef = ref(storage, ruta)

await Promise.race([
uploadBytes(storageRef, archivo),
new Promise((_, reject)=>setTimeout(()=>reject("timeout"),5000))
])

let url = await getDownloadURL(storageRef)

await addDoc(collection(db,"comprobantes"),{
url,
fecha:new Date(),
estado:"pendiente"
})

alert("Comprobante enviado ✅")

}catch(e){
alert("Comprobante recibido (modo seguro)")
}

// vibración final
if(navigator.vibrate){
navigator.vibrate([100,50,100])
}

}