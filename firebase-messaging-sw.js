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

// Cuando la app está en background — FCM muestra automáticamente
// la notificación si tiene campo "notification".
// onBackgroundMessage solo se llama para mensajes data-only (sin "notification")
messaging.onBackgroundMessage((payload) => {
  // Si ya tiene notification, FCM lo muestra solo — no hacer nada
  if (payload.notification?.title) return;

  // Solo mostrar manualmente si es data-only
  const titulo = payload.data?.titulo || "AlDía";
  const cuerpo = payload.data?.cuerpo || "Tenés una notificación nueva";

  self.registration.showNotification(titulo, {
    body:    cuerpo,
    icon:    "/icons/notification-icon.png",
    badge:   "/icons/notification-icon.png",
    tag:     "aldia-notif",
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
