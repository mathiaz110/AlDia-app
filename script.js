async function registrar(){

let nombre=document.getElementById("nombre").value
let dni=document.getElementById("dni").value
let direccion=document.getElementById("direccion").value

if(nombre==""||dni==""||direccion==""){
alert("Completar campos")
return
}

try{

await addDoc(collection(db,"usuarios"),{
nombre,
dni,
direccion,
fecha:new Date()
})

alert("Registrado correctamente")

}catch(e){
console.error(e)
alert("Error")
}

}

document.getElementById("adminBtn").addEventListener("click", ()=>{

let clave = prompt("Clave admin")

if(clave==="admin123"){
alert("Admin activado")
}

})
