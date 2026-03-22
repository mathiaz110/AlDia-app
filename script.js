let usuarios=[]

function scrollRegistro(){

document.getElementById("registro")
.scrollIntoView({behavior:"smooth"})

}


async function registrar(){

let nombre = document.getElementById("nombre").value
let dni = document.getElementById("dni").value
let direccion = document.getElementById("direccion").value

if(nombre=="" || dni=="" || direccion==""){
alert("Completar todos los campos")
return
}

try{

await addDoc(collection(db,"usuarios"),{
nombre,
dni,
direccion,
fecha: new Date()
})

alert("Usuario registrado correctamente")

}catch(error){

console.error(error)
alert("Error al guardar")

}

}


function actualizarTabla(){

let tabla=document.getElementById("tablaUsuarios")

tabla.innerHTML=""

usuarios.forEach(u=>{

tabla.innerHTML+=`

<tr>

<td>${u.nombre}</td>
<td>${u.dni}</td>
<td>${u.direccion}</td>

</tr>

`

})

}

function pagar(){

alert("Aquí se conectará el pago con Mercado Pago")

}

/* modo oscuro */

document.getElementById("themeBtn")
.addEventListener("click",()=>{

document.body.classList.toggle("light")

})

/* login admin */

let clave=prompt("Panel administrador: ingrese clave")

if(clave=="admin123"){

document.querySelector(".admin").style.display="block"

}