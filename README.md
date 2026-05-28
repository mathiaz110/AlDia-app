# AlDía App — v5.0.0

**PWA para gestión de boletas de luz con arquitectura híbrida sin costo.**

---

## 🏗️ Arquitectura híbrida — $0/mes

```
┌─────────────────────────────────────────────────────────┐
│                    CLIENTE (PWA)                         │
│  index.html · style.css · script.js → Firebase Hosting  │
└──────────────────────┬──────────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
┌──────────────┐ ┌──────────┐ ┌─────────────┐
│  Firestore   │ │  R2 PDF  │ │  FCM Push   │
│  (gratis)    │ │ (gratis) │ │  (gratis)   │
│              │ │          │ │             │
│ · usuarios   │ │boletas/  │ │Notif. push  │
│ · boletas*   │ │000123/   │ │WhatsApp     │
│   metadata   │ │ene-25.pdf│ │             │
│ · avisos     │ │          │ │             │
│ · sms_codigos│ │10 GB free│ │ilimitado    │
└──────────────┘ └──────────┘ └─────────────┘
         ▲             ▲             ▲
         └─────────────┼─────────────┘
                       │
┌──────────────────────┴──────────────────────────────────┐
│              BACKEND Node.js (Railway — gratis)          │
│  server.js · Firestore SDK · R2 SDK · FCM Admin SDK      │
└─────────────────────────────────────────────────────────┘
                       ▲
┌──────────────────────┴──────────────────────────────────┐
│                  ADMIN (PWA)                             │
│  admin.html · admin.js → Firebase Hosting               │
└─────────────────────────────────────────────────────────┘
```

---

## 💰 Costos reales con 5000 clientes

| Servicio            | Uso                          | Límite gratis | Costo   |
|---------------------|------------------------------|---------------|---------|
| Firebase Firestore  | ~15 MB datos de texto        | 1 GB          | **$0**  |
| Firebase Hosting    | App web estática             | 10 GB         | **$0**  |
| Firebase FCM        | Push ilimitadas              | Ilimitado     | **$0**  |
| Cloudflare R2       | ~6 GB PDFs (5000×4×300KB)    | 10 GB         | **$0**  |
| Railway (backend)   | Node.js liviano              | $5 crédito/mes| **$0**  |
| **TOTAL**           |                              |               | **$0**  |

---

## 🚀 Setup paso a paso

### 1. Firebase
```bash
# Crear proyecto en console.firebase.google.com
# Activar: Firestore · Authentication · Hosting · FCM
firebase login
firebase init
firebase deploy --only hosting,firestore:rules
```

### 2. Cloudflare R2
```
1. cloudflare.com → R2 → Create bucket → "aldia-boletas"
2. R2 → Manage R2 API Tokens → Create token
   Permisos: Object Read & Write
3. Copiar: Account ID, Access Key ID, Secret Access Key
4. (Opcional) Conectar dominio propio para URLs públicas
```

### 3. Backend en Railway
```bash
cd backend
npm install

# En Railway dashboard → New Project → Deploy from GitHub
# O con CLI:
npm install -g railway
railway login
railway init
railway up

# Configurar variables de entorno en Railway dashboard:
# CF_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
# R2_BUCKET_NAME, R2_PUBLIC_URL, ALLOWED_ORIGINS
# NODE_ENV=production
```

### 4. Variables de entorno backend
```bash
cp backend/.env.example backend/.env
# Editar .env con los valores reales
```

---

## 📁 Estructura Firestore

### Colección `usuarios`
```json
{
  "nroCliente":     "000123456",
  "nombre":         "Juan Pérez",
  "dni":            "12345678",
  "usuario":        "juanperez99",
  "celular":        "1130001234",
  "direccion":      "Av. Corrientes 1234",
  "password":       "hash_en_produccion",
  "fcmToken":       "token_fcm_dispositivo",
  "estado":         "pendiente | activo | rechazado",
  "creadoEn":       "Timestamp",
  "activadoEn":     "Timestamp (opcional)",
  "termsAceptados": true
}
```

### Colección `boletas` (solo metadata — PDF en R2)
```json
{
  "usuarioId":      "id_del_usuario",
  "nroCliente":     "000123456",
  "periodo":        "Enero 2025",
  "vencimiento":    "10/01/2025",
  "emitida":        "01/01/2025",
  "r2Key":          "boletas/000123456/enero-2025.pdf",
  "pdfUrl":         "https://boletas.tudominio.com/...",
  "alertaEnviada":  false,
  "tamañoBytes":    245678,
  "creadoEn":       "Timestamp"
}
```

---

## 🗂️ Estructura R2

```
aldia-boletas/           ← nombre del bucket
└── boletas/
    ├── 000123456/       ← carpeta por N° cliente
    │   ├── enero-2025.pdf
    │   ├── diciembre-2024.pdf
    │   ├── noviembre-2024.pdf
    │   └── octubre-2024.pdf
    ├── 000456789/
    │   └── ...
    └── ...
```

---

## 🔌 API Endpoints

| Método   | Endpoint                    | Descripción                          |
|----------|-----------------------------|--------------------------------------|
| `POST`   | `/boleta/subir`             | Admin sube PDF → R2 + notifica       |
| `GET`    | `/boleta/:id`               | Cliente descarga PDF desde R2        |
| `GET`    | `/boletas/:usuarioId`       | Lista las 4 boletas de un cliente    |
| `DELETE` | `/boleta/:id`               | Admin elimina boleta                 |
| `GET`    | `/storage/stats`            | Estadísticas de uso R2               |
| `POST`   | `/notificar`                | Push a 1 dispositivo                 |
| `POST`   | `/notificar-masivo`         | Push a N dispositivos (lotes 500)    |
| `POST`   | `/avisos`                   | Publicar aviso + push masivo         |
| `POST`   | `/alertas-vencimiento`      | Alertas 3 días antes (Scheduler)     |
| `POST`   | `/usuarios/:id/activar`     | Activar cuenta + push                |
| `POST`   | `/sms/enviar`               | Enviar código SMS                    |
| `POST`   | `/sms/verificar`            | Verificar código SMS                 |
| `POST`   | `/reset-password`           | Cambiar contraseña                   |

---

## 📲 Flujo de subida de boletas (Admin)

```
Admin abre modal del cliente
  → Completa período, vencimiento, emisión
  → Arrastra o selecciona el PDF
  → Toca "Subir a R2 y notificar cliente"

Backend recibe multipart/form-data:
  1. Sube PDF a R2 → boletas/{nroCliente}/{periodo}.pdf
  2. Guarda metadata en Firestore (r2Key, pdfUrl, etc.)
  3. Envía push al cliente: "⚡ Nueva boleta disponible"

Cliente recibe notificación:
  → Abre la app → ve la boleta como "Nueva"
  → Toca "Descargar PDF"
  → Descarga directo desde R2 (URL firmada 7 días)
```

---

## 🔒 .gitignore recomendado

```
backend/firebase-key.json
backend/.env
backend/node_modules/
.firebase/
*.log
```

---

*AlDía App v5.0.0 — Firestore + Cloudflare R2 + Firebase FCM + Railway*
