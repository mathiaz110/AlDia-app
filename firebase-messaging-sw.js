// ═══════════════════════════════════════════════════
//  ALDIA APP — firebase-messaging-sw.js
//  Maneja push notifications en BACKGROUND
//  (debe estar en la raíz del proyecto)
// ═══════════════════════════════════════════════════

importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

// REEMPLAZAR con tu config
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

// Maneja mensajes en background (cuando la app está cerrada/minimizada)
messaging.onBackgroundMessage((payload) => {
  console.log("[FCM Background]", payload);

  const { title, body, icon } = payload.notification || {};

  self.registration.showNotification(title || "AlDía", {
    body:    body || "Tenés una notificación nueva",
    icon:    icon || "/icons/notification-icon.png",
    badge:   "/icons/notification-icon.png",
    tag:     "aldia-bg",
    vibrate: [200, 100, 200],
    data: payload.data || {},
    actions: [
      { action: "open", title: "Abrir AlDía" }
    ]
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
