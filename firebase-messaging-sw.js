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

// Todos los mensajes son data-only — siempre mostrar manualmente
// con el título y cuerpo del campo data
messaging.onBackgroundMessage((payload) => {
  const titulo = payload.data?.titulo || payload.notification?.title || "AlDía";
  const cuerpo = payload.data?.cuerpo || payload.notification?.body  || "Tenés una notificación nueva";
  const tipo   = payload.data?.tipo   || "";

  console.log("[FCM BG] Mostrando:", titulo, "|", cuerpo);

  self.registration.showNotification(titulo, {
    body:    cuerpo,
    icon:    "/icons/notification-icon.png",
    badge:   "/icons/notification-icon.png",
    tag:     "aldia-" + tipo,
    renotify: true,
    vibrate: [200, 100, 200],
    data:    payload.data || {},
  });
});

// Click en notificación
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
