// ═══════════════════════════════════════════════════
//  ALDIA APP — firebase-messaging-sw.js
//  Maneja push notifications en BACKGROUND
// ═══════════════════════════════════════════════════

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey:            "AIzaSyB2vua5gMe7hspIMtVunPAmWWkUB3-nt5A",
  authDomain:        "aldia-app1.firebaseapp.com",
  projectId:         "aldia-app1",
  storageBucket:     "aldia-app1.firebasestorage.app",
  messagingSenderId: "1013051386288",
  appId:             "1:1013051386288:web:e588c83d0892d6cbab4e75",
  measurementId:     "G-28VQ7VM4KS",
});

const messaging = firebase.messaging();

// onBackgroundMessage solo se llama cuando el mensaje NO tiene
// campo "notification" (data-only messages).
// Si el mensaje tiene "notification", FCM lo muestra automáticamente
// sin necesidad de llamar showNotification — evita duplicados.
messaging.onBackgroundMessage((payload) => {
  console.log("[FCM Background] Mensaje data-only recibido:", payload.data);
  // No llamar showNotification aquí para evitar duplicados.
  // FCM ya muestra la notificación automáticamente con el campo notification.
});

// Click en notificación — abrir la app
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const tipo = event.notification.data?.tipo || "";
  const url  = tipo === "nuevo-registro" ? "/admin.html" : "/";
  event.waitUntil(
    clients.matchAll({ type:"window", includeUncontrolled:true })
      .then(list => {
        for (const c of list) {
          if (c.url.includes(self.location.origin) && "focus" in c) {
            c.postMessage({ type:"NOTIFICATION_CLICKED", url, tipo });
            return c.focus();
          }
        }
        return clients.openWindow(url);
      })
  );
});
