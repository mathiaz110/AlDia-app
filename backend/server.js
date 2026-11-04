// ═══════════════════════════════════════════════════
//  ALDIA APP — server.js v5
//  Arquitectura híbrida SIN COSTO:
//  · Firestore  → datos de clientes y metadata
//  · Cloudflare R2 → PDFs de boletas
//  · Firebase FCM  → notificaciones push
//  · Railway/Render → hosting del backend (gratis)
// ═══════════════════════════════════════════════════

"use strict";

const express     = require("express");
const cors        = require("cors");
const helmet      = require("helmet");
const admin       = require("firebase-admin");
const rateLimit   = require("express-rate-limit");
const morgan      = require("morgan");
const multer      = require("multer");
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
require("dotenv").config();

// ════════════════════════════════════════════════════
//  TELEGRAM BOTS
// ════════════════════════════════════════════════════
const TELEGRAM_ADMIN_TOKEN  = process.env.TELEGRAM_ADMIN_TOKEN  || "8729373653:AAFzbKttrnzOE5QPgAzzR3qq9Pdf1p48i7A";
const TELEGRAM_CLIENT_TOKEN = process.env.TELEGRAM_CLIENT_TOKEN || "8500037701:AAE3f_r5SU9pOsxewi2CwK5qAT4IlGo-duU";
const TELEGRAM_ADMIN_CHAT   = process.env.TELEGRAM_ADMIN_CHAT   || "5659534803";

async function telegramAdmin(mensaje) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_ADMIN_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: TELEGRAM_ADMIN_CHAT, text: mensaje, parse_mode: "HTML" }),
    });
  } catch(e) { console.warn("[Telegram Admin]", e.message); }
}

async function telegramCliente(chatId, mensaje) {
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_CLIENT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: mensaje, parse_mode: "HTML" }),
    });
  } catch(e) { console.warn("[Telegram Cliente]", e.message); }
}


// ════════════════════════════════════════════════════
//  FIREBASE ADMIN — Firestore + FCM
// ════════════════════════════════════════════════════
// En Railway: lee credenciales desde variable de entorno
// En local con Docker: lee desde firebase-key.json
let serviceAccount;
const firebaseKeyEnv = process.env.FIREBASE_KEY || process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
if (firebaseKeyEnv) {
  try {
    serviceAccount = JSON.parse(firebaseKeyEnv);
    console.log("[Firebase] Credenciales cargadas desde variable de entorno");
  } catch(e) {
    console.error("[ERROR] No se pudo parsear FIREBASE_KEY:", e.message);
    process.exit(1);
  }
} else {
  try {
    serviceAccount = require("./firebase-key.json");
    console.log("[Firebase] Credenciales cargadas desde firebase-key.json");
  } catch(e) {
    console.error("[ERROR] No se encontró FIREBASE_KEY ni firebase-key.json");
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  storageBucket: `${serviceAccount.project_id}.appspot.com`,
});
const db        = admin.firestore();
const messaging = admin.messaging();

// ════════════════════════════════════════════════════
//  CLOUDFLARE R2 — almacenamiento de PDFs
//  Compatible con API de Amazon S3
//  Plan gratuito: 10 GB storage + descargas ilimitadas
// ════════════════════════════════════════════════════
const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId:     process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const R2_BUCKET   = process.env.R2_BUCKET_NAME || "aldia-boletas";
const R2_PUB_URL  = process.env.R2_PUBLIC_URL  || "";
// R2_PUBLIC_URL: si configuraste un dominio público en R2 (opcional)
// Si no, se generan URLs firmadas temporales

// ════════════════════════════════════════════════════
//  APP EXPRESS
// ════════════════════════════════════════════════════
const app  = express();
const PORT = process.env.PORT || 3000;

// Railway usa un proxy inverso — necesario para rate limiting correcto
app.set("trust proxy", 1);

// Multer: recibir PDFs como multipart (hasta 5 MB)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype !== "application/pdf")
      return cb(new Error("Solo se aceptan archivos PDF"));
    cb(null, true);
  },
});

// ─── MIDDLEWARE ──────────────────────────────────────
app.use(morgan("[:date[iso]] :method :url :status :response-time ms"));
app.use(helmet());
app.use(express.json({ limit: "100kb" }));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",").map(s => s.trim()).filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || !ALLOWED_ORIGINS.length || ALLOWED_ORIGINS.includes(origin))
      return cb(null, true);
    cb(new Error(`CORS: origen no permitido → ${origin}`));
  },
  methods: ["GET","POST","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","Accept"],
  exposedHeaders: ["Content-Disposition","Content-Length"],
  credentials: false,
  preflightContinue: false,
  optionsSuccessStatus: 204,
}));

// Responder preflight OPTIONS explícitamente para uploads desde celular
app.options("*", cors());

// ─── RATE LIMITERS ───────────────────────────────────
const general = rateLimit({ windowMs:15*60*1000, max:200, standardHeaders:true, legacyHeaders:false });
const notifs  = rateLimit({ windowMs:15*60*1000, max:60  });
const auth    = rateLimit({ windowMs:15*60*1000, max:10  });
app.use(general);

// ════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════

/** Valida campos del body y retorna array de errores */
function validate(body, rules) {
  return Object.entries(rules).reduce((errs, [field, r]) => {
    const val = body[field];
    if (r.required && (val == null || val === ""))
      return [...errs, `${field}: requerido`];
    if (val == null) return errs;
    if (r.type    && typeof val !== r.type)              return [...errs, r.msg || `${field}: tipo inválido`];
    if (r.minLen  && String(val).length < r.minLen)      return [...errs, r.msg || `${field}: mínimo ${r.minLen} chars`];
    if (r.maxLen  && String(val).length > r.maxLen)      return [...errs, r.msg || `${field}: máximo ${r.maxLen} chars`];
    if (r.pattern && !r.pattern.test(String(val)))       return [...errs, r.msg || `${field}: formato inválido`];
    return errs;
  }, []);
}

/** Manejador de errores centralizado */
function handleError(res, err, ctx = "") {
  console.error(`[ERROR ${ctx}]`, err.code || "", err.message);
  const fcmMap = {
    "messaging/registration-token-not-registered": { s:410, m:"Token FCM expirado" },
    "messaging/invalid-registration-token":        { s:400, m:"Token FCM inválido" },
    "messaging/message-rate-exceeded":             { s:429, m:"Límite FCM alcanzado" },
  };
  if (err.code && fcmMap[err.code]) {
    const { s, m } = fcmMap[err.code];
    return res.status(s).json({ error: m, code: err.code });
  }
  res.status(500).json({
    error: "Error interno del servidor",
    ...(process.env.NODE_ENV !== "production" && { detail: err.message }),
  });
}

/** Construye la clave S3/R2 de un PDF */
const r2Key = (nroCliente, periodo) =>
  `boletas/${nroCliente}/${periodo.replace(/\s+/g, "-").toLowerCase()}.pdf`;

/** URL pública o firmada según configuración */
async function getPdfUrl(key) {
  if (R2_PUB_URL) return `${R2_PUB_URL}/${key}`;
  // URL firmada válida 7 días (no requiere dominio público)
  return getSignedUrl(R2, new GetObjectCommand({ Bucket:R2_BUCKET, Key:key }), { expiresIn: 604800 });
}

// ════════════════════════════════════════════════════
//  HEALTH CHECK
// ════════════════════════════════════════════════════
app.get("/", (_, res) => res.json({
  app:"AlDía Backend", version:"5.0.0",
  storage:"Cloudflare R2", db:"Firestore",
  status:"online", ts:new Date().toISOString(),
}));
app.get("/health", (_, res) => res.json({
  status:"ok", uptime:process.uptime(),
  mem:Math.round(process.memoryUsage().heapUsed/1024/1024)+"MB",
}));

// ════════════════════════════════════════════════════
//  BOLETAS — subir, descargar, listar, eliminar
// ════════════════════════════════════════════════════

/**
 * POST /boleta/subir
 * Admin sube el PDF de una boleta.
 * Acepta multipart/form-data con campos:
 *   - pdf (archivo)
 *   - usuarioId, nroCliente, periodo, vencimiento, emitida
 */
app.post("/boleta/subir", upload.single("pdf"), async (req, res) => {
  const errs = validate(req.body, {
    usuarioId:   { required:true, type:"string" },
    nroCliente:  { required:true, type:"string" },
    periodo:     { required:true, type:"string", maxLen:30 },
    vencimiento: { required:true, type:"string" },
    emitida:     { required:true, type:"string" },
  });
  if (errs.length) return res.status(400).json({ errors:errs });
  if (!req.file)   return res.status(400).json({ error:"Archivo PDF requerido" });

  const { usuarioId, nroCliente, periodo, vencimiento, emitida } = req.body;

  try {
    // 1 ─── Subir PDF a Cloudflare R2 ────────────────
    const key = r2Key(nroCliente, periodo);
    await R2.send(new PutObjectCommand({
      Bucket:      R2_BUCKET,
      Key:         key,
      Body:        req.file.buffer,
      ContentType: "application/pdf",
      Metadata: {
        "nro-cliente": nroCliente,
        "periodo":     periodo,
        "usuario-id":  usuarioId,
      },
    }));

    const pdfUrl = await getPdfUrl(key);

    // 2 ─── Guardar metadata en Firestore ────────────
    const boletaRef = await db.collection("boletas").add({
      usuarioId, nroCliente, periodo, vencimiento, emitida,
      r2Key:         key,
      pdfUrl,
      alertaEnviada: false,
      tamañoBytes:   req.file.size,
      creadoEn:      admin.firestore.FieldValue.serverTimestamp(),
    });

    // 3 ─── Notificar al usuario ──────────────────────
    const userDoc = await db.collection("usuarios").doc(usuarioId).get();
    if (userDoc.exists) {
      const { fcmToken, nombre = "Cliente" } = userDoc.data();
      console.log(`[Push boleta] Token: ${fcmToken?.substring(0,20)}... largo: ${fcmToken?.length}`);
      if (fcmToken && fcmToken !== "no-token" && fcmToken.length > 50) {
        try {
          const msgId = await messaging.send({
            token: fcmToken,
            webpush: { headers:{ Urgency:"high" }, fcmOptions:{ link:"/" } },
            data: { tipo:"nueva-boleta", boletaId:boletaRef.id, titulo:"⚡ Nueva boleta disponible", cuerpo:`Tu boleta de ${periodo} ya está lista. Vence el ${vencimiento}.` },
          });
          console.log(`[Push OK] Nueva boleta enviada a ${nombre}: ${msgId.substring(0,20)}...`);
        } catch(pushErr) {
          console.error("[Push ERROR boleta]", pushErr.code, pushErr.message);
          // Si el token es inválido, eliminarlo de Firestore
          if (pushErr.code === "messaging/registration-token-not-registered") {
            await db.collection("usuarios").doc(usuarioId).update({ fcmToken: "no-token" });
            console.log(`[Token] Eliminado token vencido de ${nombre}`);
          }
        }
      } else {
        console.warn(`[Push SKIP] Token inválido para ${nombre}`);
      }
    }

    console.log(`[R2] Subida → ${key} (${Math.round(req.file.size/1024)} KB)`);

    // Telegram al admin y al cliente — fuera del if para tener nombre disponible
    const nombreCliente = userDoc.exists ? (userDoc.data()?.nombre || "Cliente") : "Cliente";
    const telegramChatId = userDoc.exists ? userDoc.data()?.telegramChatId : null;

    await telegramAdmin(
      `📄 <b>Boleta subida</b>\n` +
      `👤 Cliente: <b>${nombreCliente}</b>\n` +
      `📅 Período: ${periodo}\n` +
      `💳 Vence: ${vencimiento}`
    );

    if (telegramChatId) {
      try {
        await telegramCliente(telegramChatId,
          `⚡ <b>Nueva boleta disponible</b>\n\n` +
          `Hola <b>${nombreCliente.split(" ")[0]}</b>, tu boleta de <b>${periodo}</b> ya está lista.\n` +
          `📅 Vence el ${vencimiento}\n\n` +
          `Ingresá a la app para verla: https://aldia-app1.web.app`
        );
      } catch(e) { console.warn("[Telegram cliente boleta]", e.message); }
    }

    res.json({
      success:  true,
      boletaId: boletaRef.id,
      r2Key:    key,
      pdfUrl,
      periodo,
      ts:       new Date().toISOString(),
    });

  } catch(e) { handleError(res, e, "boleta/subir"); }
});

/**
 * GET /boleta/:id
 * Cliente descarga su boleta — stream con headers de descarga forzada
 */
app.get("/boleta/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || id.length > 100) return res.status(400).json({ error:"ID invalido" });

  try {
    const snap = await db.collection("boletas").doc(id).get();
    if (!snap.exists) return res.status(404).json({ error:"Boleta no encontrada" });

    const { r2Key: key, periodo } = snap.data();
    const fileName = "boleta-" + (periodo || "sin-periodo").replace(/\s+/g, "-") + ".pdf";

    // Obtener PDF de R2 y hacer stream al cliente
    const r2Resp = await R2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: key }));

    // Headers que fuerzan descarga en todos los navegadores y dispositivos
    res.setHeader("Content-Type",        "application/octet-stream");
    res.setHeader("Content-Disposition", "attachment; filename=" + fileName);
    res.setHeader("Cache-Control",       "no-cache");

    if (r2Resp.ContentLength) {
      res.setHeader("Content-Length", r2Resp.ContentLength);
    }

    // Stream directo sin cargar todo en memoria
    r2Resp.Body.pipe(res);

    console.log("[Boleta] Descarga: " + fileName);

  } catch(e) { handleError(res, e, "boleta/get"); }
});

/**
 * GET /boletas/:usuarioId
 * Retorna las últimas 4 boletas de un cliente con sus URLs
 */
app.get("/boletas/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  if (!usuarioId) return res.status(400).json({ error:"usuarioId requerido" });

  try {
    const snap = await db.collection("boletas")
      .where("usuarioId", "==", usuarioId)
      .orderBy("creadoEn", "desc")
      .limit(4)
      .get();

    const boletas = await Promise.all(snap.docs.map(async d => {
      const data = d.data();
      // Renovar URL firmada si no hay dominio público
      const url = R2_PUB_URL
        ? `${R2_PUB_URL}/${data.r2Key}`
        : await getSignedUrl(R2, new GetObjectCommand({ Bucket:R2_BUCKET, Key:data.r2Key }), { expiresIn:604800 });
      return {
        id:          d.id,
        periodo:     data.periodo,
        vencimiento: data.vencimiento,
        emitida:     data.emitida,
        pdfUrl:      url,
      };
    }));

    res.json({ success:true, boletas, total:boletas.length });

  } catch(e) { handleError(res, e, "boletas/list"); }
});

/**
 * DELETE /boleta/:id
 * Admin elimina una boleta (de R2 y Firestore)
 */
app.delete("/boleta/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const snap = await db.collection("boletas").doc(id).get();
    if (!snap.exists) return res.status(404).json({ error:"Boleta no encontrada" });

    const { r2Key: key } = snap.data();

    // Eliminar de R2
    await R2.send(new DeleteObjectCommand({ Bucket:R2_BUCKET, Key:key }));
    // Eliminar de Firestore
    await snap.ref.delete();

    console.log(`[R2] Eliminada → ${key}`);
    res.json({ success:true, deleted:key });

  } catch(e) { handleError(res, e, "boleta/delete"); }
});

/**
 * GET /storage/stats
 * Admin: ver cuánto espacio se usa en R2
 */
app.get("/storage/stats", async (req, res) => {
  try {
    let totalBytes = 0, totalFiles = 0;
    let continuationToken;

    do {
      const resp = await R2.send(new ListObjectsV2Command({
        Bucket:            R2_BUCKET,
        Prefix:            "boletas/",
        ContinuationToken: continuationToken,
      }));
      (resp.Contents || []).forEach(obj => {
        totalBytes += obj.Size || 0;
        totalFiles++;
      });
      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    const totalMB = (totalBytes / 1024 / 1024).toFixed(2);
    const totalGB = (totalBytes / 1024 / 1024 / 1024).toFixed(3);

    res.json({
      success:    true,
      archivos:   totalFiles,
      totalMB:    parseFloat(totalMB),
      totalGB:    parseFloat(totalGB),
      limiteGB:   10,
      usoPorc:    Math.round((totalBytes / (10*1024*1024*1024)) * 100),
      ts:         new Date().toISOString(),
    });
  } catch(e) { handleError(res, e, "storage/stats"); }
});

// ════════════════════════════════════════════════════
//  NOTIFICACIONES PUSH
// ════════════════════════════════════════════════════

/** POST /notificar — push a 1 dispositivo */
app.post("/notificar", notifs, async (req, res) => {
  const errs = validate(req.body, {
    token:   { required:true, type:"string", minLen:100, msg:"Token FCM inválido" },
    titulo:  { required:true, type:"string", maxLen:100 },
    mensaje: { required:true, type:"string", maxLen:500 },
  });
  if (errs.length) return res.status(400).json({ errors:errs });

  const { token, titulo, mensaje, data={} } = req.body;
  try {
    const msgId = await messaging.send({
      token,
      webpush: { headers:{ Urgency:"high" }, fcmOptions:{ link:"/" } },
      data: { tipo:"general", ...data, titulo:titulo.substring(0,100), cuerpo:mensaje.substring(0,200), ts:Date.now().toString() },
    });
    res.json({ success:true, messageId:msgId, ts:new Date().toISOString() });
  } catch(e) { handleError(res, e, "notificar"); }
});

/** POST /notificar-masivo — push a N tokens (lotes de 500) */
app.post("/notificar-masivo", notifs, async (req, res) => {
  const { tokens, titulo, mensaje } = req.body;
  if (!Array.isArray(tokens) || !tokens.length)
    return res.status(400).json({ error:"tokens: array no vacío requerido" });
  if (tokens.length > 5000)
    return res.status(400).json({ error:"Máximo 5000 tokens por llamada" });

  let enviados = 0, fallidos = 0;
  try {
    // Enviar en lotes de 500 (límite FCM)
    for (let i = 0; i < tokens.length; i += 500) {
      const lote = tokens.slice(i, i+500);
      const resp = await messaging.sendEachForMulticast({
        tokens: lote,
        webpush: { headers:{ Urgency:"high" }, fcmOptions:{ link:"/" } },
        data: { tipo: tipo || "aviso", titulo:`${icono} ${titulo}`, cuerpo:cuerpo.substring(0,200), ts:Date.now().toString() },
      });
      enviados += resp.successCount;
      fallidos += resp.failureCount;
    }
    console.log(`[Masivo] OK:${enviados} Fail:${fallidos}`);
    res.json({ success:true, enviados, fallidos, ts:new Date().toISOString() });
  } catch(e) { handleError(res, e, "notificar-masivo"); }
});

// ════════════════════════════════════════════════════
//  AVISOS MASIVOS
// ════════════════════════════════════════════════════

/** POST /avisos — publicar aviso y notificar a activos */
// ─── POST /login — autenticación de usuario ─────────
app.post("/login", auth, async (req, res) => {
  const { usuario, password, fcmToken } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: "Usuario y contraseña requeridos" });
  }

  try {
    // Buscar por usuario O por celular
    const [snapU, snapC] = await Promise.all([
      db.collection("usuarios").where("usuario","==",usuario).limit(1).get(),
      db.collection("usuarios").where("celular","==",usuario).limit(1).get(),
    ]);
    const docSnap = snapU.empty ? (snapC.empty ? null : snapC.docs[0]) : snapU.docs[0];

    if (!docSnap) {
      return res.status(401).json({ error: "Usuario no encontrado" });
    }

    const data = docSnap.data();

    // Verificar contraseña (en producción usar bcrypt)
    if (data.password !== password) {
      return res.status(401).json({ error: "Contraseña incorrecta" });
    }

    // Actualizar token FCM si cambió de dispositivo
    if (fcmToken && fcmToken !== "no-token" && fcmToken !== data.fcmToken) {
      docSnap.ref.update({ fcmToken }).catch(() => {});
    }

    console.log(`[Login] ${usuario} → OK`);
    res.json({
      success: true,
      usuario: { id: docSnap.id, ...data },
    });

  } catch(e) { handleError(res, e, "login"); }
});

// ─── POST /usuario/:id/token — actualizar FCM token ──
app.post("/usuario/:id/token", async (req, res) => {
  const { id } = req.params;
  const { fcmToken } = req.body;
  if (!fcmToken || fcmToken.length < 100) {
    return res.status(400).json({ error: "Token inválido" });
  }
  try {
    await db.collection("usuarios").doc(id).update({ fcmToken });
    console.log(`[Token] Actualizado para ${id.substring(0,8)}...`);
    res.json({ success: true });
  } catch(e) { handleError(res, e, "usuario/token"); }
});

// ─── POST /usuarios/:id/activar — activar cuenta ─────
app.post("/usuarios/:id/activar", async (req, res) => {
  const { id } = req.params;
  try {
    const userRef = db.collection("usuarios").doc(id);
    const snap    = await userRef.get();
    if (!snap.exists) return res.status(404).json({ error:"Usuario no encontrado" });

    await userRef.update({
      estado:     "activo",
      activadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    const { fcmToken, nombre="Cliente" } = snap.data();
    console.log(`[Activar] ${nombre} | fcmToken: ${fcmToken?.substring(0,20) || "NO TOKEN"}... | largo: ${fcmToken?.length}`);

    if (fcmToken && fcmToken !== "no-token" && fcmToken.length > 50) {
      try {
        const msgId = await messaging.send({
          token: fcmToken,
          webpush: { headers:{ Urgency:"high" }, fcmOptions:{ link:"/" } },
          data: { tipo:"cuenta-activada", titulo:"✅ Cuenta AlDía activada", cuerpo:`¡Hola ${nombre.split(" ")[0]}! Tu cuenta ya está activa.` },
        });
        console.log(`[Push OK] Cuenta activada enviada: ${msgId.substring(0,20)}...`);
      } catch(pushErr) {
        console.error("[Push ERROR activar]", pushErr.code, pushErr.message);
      }
    } else {
      console.warn(`[Push SKIP] Token inválido para ${nombre}`);
    }

    // Telegram al admin — cuenta activada
    await telegramAdmin(
      `✅ <b>Cuenta activada</b>\n` +
      `👤 <b>${nombre}</b> ya está activa.\n` +
      `💰 +$2.247/mes`
    );

    // Telegram al cliente — si tiene chatId guardado
    try {
      const userSnap = await db.collection("usuarios").doc(req.params.id).get();
      const telegramChatId = userSnap.exists ? userSnap.data()?.telegramChatId : null;
      if (telegramChatId) {
        await telegramCliente(telegramChatId,
          `✅ <b>¡Tu cuenta AlDía está activa!</b>\n\n` +
          `Hola <b>${nombre.split(" ")[0]}</b>, ya podés acceder a todas las funciones.\n` +
          `Entrá a la app: https://aldia-app1.web.app`
        );
      }
    } catch(e) { console.warn("[Telegram cliente activar]", e.message); }

    res.json({ success:true, mensaje:`Cuenta de ${nombre} activada` });
  } catch(e) { handleError(res, e, "usuarios/activar"); }
});

// ─── POST /admin/token — guardar token FCM del admin ─
app.post("/admin/token", async (req, res) => {
  const { fcmToken } = req.body;
  if (!fcmToken || fcmToken.length < 100) {
    return res.status(400).json({ error: "Token inválido" });
  }
  try {
    await db.collection("admins").doc("config").set({ fcmToken }, { merge: true });
    console.log(`[Admin] Token FCM guardado: ${fcmToken.substring(0,20)}...`);
    res.json({ success: true });
  } catch(e) { handleError(res, e, "admin/token"); }
});

// ─── POST /telegram/webhook — bot de clientes ────────
// Recibe el /start del cliente con su usuarioId y guarda su chatId
app.post("/telegram/webhook", async (req, res) => {
  try {
    const msg = req.body?.message;
    if (!msg) return res.sendStatus(200);
    const chatId = msg.chat?.id?.toString();
    const text   = msg.text || "";
    // /start USUARIO_ID
    if (text.startsWith("/start ")) {
      const usuarioId = text.split(" ")[1]?.trim();
      if (usuarioId && usuarioId.length > 5) {
        await db.collection("usuarios").doc(usuarioId).update({ telegramChatId: chatId });
        console.log(`[Telegram] chatId ${chatId} vinculado a usuario ${usuarioId}`);
        await telegramCliente(chatId,
          `✅ <b>¡Listo! Ya vas a recibir notificaciones de AlDía Digital.</b>\n\n` +
          `Te vamos a avisar cuando tengas una nueva boleta o cuando haya un aviso importante.`
        );
      }
    }
    res.sendStatus(200);
  } catch(e) {
    console.warn("[Telegram webhook]", e.message);
    res.sendStatus(200);
  }
});

// ─── GET /usuario/:id — obtener estado actualizado ──
app.get("/usuario/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || id.length > 100) return res.status(400).json({ error:"ID inválido" });
  try {
    const snap = await db.collection("usuarios").doc(id).get();
    if (!snap.exists) return res.status(404).json({ error:"Usuario no encontrado" });
    const data = snap.data();
    const { password, ...resto } = data;

    // Convertir Timestamps de Firestore a strings ISO para el frontend
    const convertTimestamp = (val) => {
      if (!val) return null;
      if (val._seconds) return new Date(val._seconds * 1000).toISOString();
      if (val.toDate)   return val.toDate().toISOString();
      return val;
    };

    const usuario = {
      id:         snap.id,
      ...resto,
      creadoEn:   convertTimestamp(resto.creadoEn),
      activadoEn: convertTimestamp(resto.activadoEn),
    };

    res.json({ success:true, usuario });
  } catch(e) { handleError(res, e, "usuario/get"); }
});

// ─── POST /registro — nuevo usuario desde el frontend ──
app.post("/registro", async (req, res) => {
  const { nroCliente, nombre, dni, usuario, celular,
          direccion, password, fcmToken } = req.body;

  if (!nombre || !dni || !usuario || !celular || !password) {
    return res.status(400).json({ error: "Faltan campos requeridos" });
  }

  try {
    // Verificar duplicado
    const dup = await db.collection("usuarios")
      .where("usuario", "==", usuario).limit(1).get();
    if (!dup.empty) {
      return res.status(409).json({ error: "Ese nombre de usuario ya existe. Elegí otro." });
    }

    // Guardar con Admin SDK (sin restricciones de reglas Firestore)
    const ref = await db.collection("usuarios").add({
      nroCliente:     nroCliente || "",
      nombre,
      dni,
      usuario,
      celular,
      direccion:      direccion || "",
      password,
      fcmToken:       fcmToken || "no-token",
      estado:         "pendiente",
      creadoEn:       admin.firestore.FieldValue.serverTimestamp(),
      termsAceptados: true,
    });

    console.log(`[Registro] ${usuario} → ${ref.id} | fcmToken: ${fcmToken?.substring(0,20) || "NO TOKEN"}...`);
    
    // Notificar al admin que hay un nuevo registro
    try {
      const adminSnap = await db.collection("admins").doc("config").get();
      const adminToken = adminSnap.exists ? adminSnap.data()?.fcmToken : null;
      if (adminToken && adminToken.length > 100) {
        await messaging.send({
          token: adminToken,
          webpush: { headers:{ Urgency:"high" }, fcmOptions:{ link:"/admin.html" } },
          data: { tipo:"nuevo-registro", usuarioId:ref.id, titulo:"📋 Nuevo cliente registrado", cuerpo:`${nombre} se registró y está esperando activación.` },
        }).catch(e => console.warn("[Push admin]", e.code));
      }
    } catch(e) { /* silencioso si no hay config admin */ }

    // Telegram al admin — nuevo registro
    await telegramAdmin(
      `📋 <b>Nuevo cliente registrado</b>\n` +
      `👤 <b>${nombre}</b>\n` +
      `🪪 Usuario: ${usuario}\n` +
      `🔢 N° cliente: ${nroCliente}\n` +
      `📱 Celular: ${celular}\n` +
      `📍 Dirección: ${direccion}\n` +
      `⏳ Estado: Pendiente de activación`
    );

    res.json({ success: true, usuarioId: ref.id });

  } catch(e) { handleError(res, e, "registro"); }
});

// ─── DELETE /boleta/:id — admin borra una boleta ─────
app.delete("/boleta/:id", async (req, res) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error:"ID requerido" });
  try {
    const snap = await db.collection("boletas").doc(id).get();
    if (!snap.exists) return res.status(404).json({ error:"Boleta no encontrada" });
    const { r2Key: key } = snap.data();
    if (key) {
      const { DeleteObjectCommand } = require("@aws-sdk/client-s3");
      await R2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key })).catch(e => console.warn("[R2 delete]", e.message));
    }
    await snap.ref.delete();
    console.log(`[Boleta] Eliminada: ${id}`);
    res.json({ success:true, deleted:id });
  } catch(e) { handleError(res, e, "boleta/delete"); }
});

// ─── GET /avisos/activo — obtener aviso activo ───────
app.get("/avisos/activo", async (req, res) => {
  try {
    const snap = await db.collection("avisos_config").doc("activo").get();
    if (!snap.exists) return res.json({ aviso: null });
    res.json({ aviso: snap.data() });
  } catch(e) { handleError(res, e, "avisos/activo"); }
});

// ─── POST /avisos/activo — admin actualiza aviso + push ─
app.post("/avisos/activo", async (req, res) => {
  const { tipo, titulo, cuerpo, activo } = req.body;
  try {
    // Guardar aviso
    await db.collection("avisos_config").doc("activo").set({
      tipo:      tipo    || "aviso",
      titulo:    titulo  || "",
      cuerpo:    cuerpo  || "",
      activo:    activo !== false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log(`[Aviso] Actualizado: ${titulo}`);

    // Notificar a todos los clientes activos si el aviso está activo
    if (activo !== false && titulo && cuerpo) {
      const iconos = { alerta:"🚨", aviso:"⚠️", info:"ℹ️", novedad:"📢" };
      const icono  = iconos[tipo] || "📢";

      const snap   = await db.collection("usuarios").where("estado","==","activo").get();
      const tokens = snap.docs
        .map(d => d.data().fcmToken)
        .filter(t => t && t !== "no-token" && t.length > 50);

      let enviados = 0;
      for (let i = 0; i < tokens.length; i += 500) {
        try {
          const resp = await messaging.sendEachForMulticast({
            tokens: tokens.slice(i, i+500),
            webpush: {
              headers: { Urgency: "high" },
              fcmOptions: { link: "/" },
            },
            data: {
              tipo:   tipo || "aviso",
              titulo: `${icono} ${titulo}`,
              cuerpo: cuerpo.substring(0, 200),
              ts:     Date.now().toString(),
            },
          });
          enviados += resp.successCount;
          console.log(`[Push Aviso] Lote ${i/500+1}: ${resp.successCount} OK, ${resp.failureCount} fail`);
          // Limpiar tokens inválidos
          resp.responses.forEach((r, idx) => {
            if (!r.success && r.error?.code === "messaging/registration-token-not-registered") {
              const tokenVencido = tokens.slice(i, i+500)[idx];
              db.collection("usuarios").where("fcmToken","==",tokenVencido).limit(1).get()
                .then(s => s.forEach(d => d.ref.update({ fcmToken:"no-token" })))
                .catch(() => {});
            }
          });
        } catch(pushErr) {
          console.error("[Push Aviso Error]", pushErr.message);
        }
      }
      console.log(`[Aviso] Push enviado a ${enviados}/${tokens.length} clientes`);

      // Telegram masivo — a todos los clientes activos con chatId vinculado
      try {
        const iconos = { alerta:"🚨", aviso:"⚠️", info:"ℹ️", novedad:"📢" };
        const icono  = iconos[tipo] || "📢";
        let telegramEnviados = 0;
        for (const doc of snap.docs) {
          const { telegramChatId, nombre = "Cliente" } = doc.data();
          if (telegramChatId) {
            await telegramCliente(telegramChatId,
              `${icono} <b>${titulo}</b>\n\n${cuerpo}\n\nIngresá a la app: https://aldia-app1.web.app`
            );
            telegramEnviados++;
          }
        }
        console.log(`[Telegram Aviso] Enviado a ${telegramEnviados} clientes con Telegram vinculado`);
      } catch(tErr) { console.warn("[Telegram Aviso]", tErr.message); }

      res.json({ success: true, notificados: enviados, total: tokens.length });
    } else {
      res.json({ success: true, notificados: 0 });
    }

  } catch(e) { handleError(res, e, "avisos/activo/post"); }
});

// ─── GET /admin/boletas/:usuarioId — boletas de un cliente ─
app.get("/admin/boletas/:usuarioId", async (req, res) => {
  const { usuarioId } = req.params;
  try {
    const snap = await db.collection("boletas")
      .where("usuarioId","==",usuarioId)
      .orderBy("creadoEn","desc")
      .get();
    const boletas = snap.docs.map(d => ({ id:d.id, ...d.data(), creadoEn: d.data().creadoEn?.toDate?.()?.toLocaleDateString("es-AR") || "—" }));
    res.json({ success:true, boletas, total:boletas.length });
  } catch(e) { handleError(res, e, "admin/boletas"); }
});

app.use((req, res) => res.status(404).json({ error:"Endpoint no encontrado", path:req.path }));
app.use((err, req, res, next) => {
  if (err.message?.includes("CORS"))   return res.status(403).json({ error:err.message });
  if (err.message?.includes("PDF"))    return res.status(400).json({ error:err.message });
  if (err.code === "LIMIT_FILE_SIZE")  return res.status(413).json({ error:"PDF demasiado grande (máx 5 MB)" });
  handleError(res, err, "global");
});

// ════════════════════════════════════════════════════
//  START
// ════════════════════════════════════════════════════
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║  AlDía Backend v5.0.0                    ║
║  Puerto  : ${PORT}                           ║
║  Entorno : ${(process.env.NODE_ENV||"development").padEnd(12)}              ║
║  BD      : Firestore (gratis)            ║
║  Storage : Cloudflare R2 (gratis)        ║
║  Push    : Firebase FCM (gratis)         ║
╚══════════════════════════════════════════╝`);
});

module.exports = app;
