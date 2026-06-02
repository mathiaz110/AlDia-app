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
//  FIREBASE ADMIN — Firestore + FCM
// ════════════════════════════════════════════════════
// En Railway: lee credenciales desde variable de entorno
// En local con Docker: lee desde firebase-key.json
let serviceAccount;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON) {
  serviceAccount = JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
} else {
  try {
    serviceAccount = require("./firebase-key.json");
  } catch(e) {
    console.error("[ERROR] No se encontró firebase-key.json ni GOOGLE_APPLICATION_CREDENTIALS_JSON");
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
  methods: ["GET","POST","DELETE"],
  allowedHeaders: ["Content-Type","Authorization"],
}));

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
      if (fcmToken && fcmToken !== "no-token" && fcmToken.length > 100) {
        await messaging.send({
          token: fcmToken,
          notification: {
            title: "⚡ Nueva boleta disponible",
            body:  `Tu boleta de ${periodo} ya está lista para descargar. Vence el ${vencimiento}.`,
          },
          android: { priority:"high", notification:{ channelId:"aldia_main", sound:"default", color:"#39ff8f" } },
          apns:    { payload: { aps: { badge:1, sound:"default" } } },
          webpush: {
            notification: { icon:"/icons/notification-icon.png", badge:"/icons/notification-icon.png", vibrate:[200,100,200] },
            fcmOptions:   { link:"/" },
          },
          data: { tipo:"nueva-boleta", boletaId:boletaRef.id },
        }).catch(e => console.warn("[Push boleta]", e.code));
      }
    }

    console.log(`[R2] Subida → ${key} (${Math.round(req.file.size/1024)} KB)`);
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
      notification: { title:titulo.substring(0,100), body:mensaje.substring(0,500) },
      android:  { priority:"high", notification:{ channelId:"aldia_main", sound:"default", color:"#39ff8f" } },
      apns:     { headers:{ "apns-priority":"10" }, payload:{ aps:{ badge:1, sound:"default" } } },
      webpush:  {
        headers: { Urgency:"high" },
        notification: { icon:"/icons/notification-icon.png", badge:"/icons/notification-icon.png", vibrate:[200,100,200] },
        fcmOptions: { link:"/" },
      },
      data: { tipo:"general", ...data, ts:Date.now().toString() },
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
        notification: { title:titulo, body:mensaje.substring(0,200) },
        webpush: {
          notification: { icon:"/icons/notification-icon.png" },
          fcmOptions:   { link:"/" },
        },
        data: { tipo:"masivo", ts:Date.now().toString() },
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
app.post("/avisos", async (req, res) => {
  const errs = validate(req.body, {
    tipo:   { required:true, pattern:/^(alerta|aviso|info|novedad)$/, msg:"tipo: alerta|aviso|info|novedad" },
    titulo: { required:true, type:"string", maxLen:120 },
    cuerpo: { required:true, type:"string", maxLen:1000 },
  });
  if (errs.length) return res.status(400).json({ errors:errs });

  const { tipo, titulo, cuerpo } = req.body;
  try {
    // Guardar en Firestore
    await db.collection("avisos").add({
      tipo, titulo, cuerpo,
      fecha:    new Date().toLocaleDateString("es-AR"),
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Obtener tokens de usuarios activos
    const snap   = await db.collection("usuarios").where("estado","==","activo").get();
    const tokens = snap.docs
      .map(d => d.data().fcmToken)
      .filter(t => t && t !== "no-token" && t.length > 100);

    let enviados = 0;
    for (let i = 0; i < tokens.length; i += 500) {
      const resp = await messaging.sendEachForMulticast({
        tokens: tokens.slice(i, i+500),
        notification: { title:titulo, body:cuerpo.substring(0,200) },
        data: { tipo, ts:Date.now().toString() },
        webpush: {
          notification: { icon:"/icons/notification-icon.png" },
          fcmOptions:   { link:"/novedades" },
        },
      });
      enviados += resp.successCount;
    }

    console.log(`[Aviso] "${titulo}" → ${enviados}/${tokens.length}`);
    res.json({ success:true, avisadoA:enviados, total:tokens.length });

  } catch(e) { handleError(res, e, "avisos"); }
});

// ════════════════════════════════════════════════════
//  ALERTAS DE VENCIMIENTO — Cloud Scheduler
// ════════════════════════════════════════════════════

/** POST /alertas-vencimiento — correr cada día a las 9AM */
app.post("/alertas-vencimiento", async (req, res) => {
  try {
    const en3  = new Date(Date.now() + 3*24*60*60*1000);
    const f3   = en3.toLocaleDateString("es-AR", { day:"2-digit", month:"2-digit", year:"numeric" });

    const snap = await db.collection("boletas")
      .where("vencimiento",   "==", f3)
      .where("alertaEnviada", "==", false)
      .get();

    if (snap.empty) {
      return res.json({ success:true, enviados:0, fecha:f3, msg:"Sin vencimientos en 3 días" });
    }

    const batch = db.batch();
    let enviados = 0;

    for (const boletaDoc of snap.docs) {
      const { usuarioId, periodo, vencimiento } = boletaDoc.data();
      try {
        const userDoc = await db.collection("usuarios").doc(usuarioId).get();
        if (!userDoc.exists) continue;
        const { fcmToken, nombre="Cliente" } = userDoc.data();

        if (fcmToken && fcmToken !== "no-token" && fcmToken.length > 100) {
          await messaging.send({
            token: fcmToken,
            notification: {
              title: "⚠️ Boleta próxima a vencer",
              body:  `Hola ${nombre.split(" ")[0]}, tu boleta de ${periodo} vence en 3 días (${vencimiento}). ¡No te olvides de pagarla!`,
            },
            data:     { tipo:"alerta-vencimiento", boletaId:boletaDoc.id },
            android:  { priority:"high", notification:{ channelId:"aldia_main", sound:"default", color:"#f59e0b" } },
            apns:     { payload: { aps: { badge:1, sound:"default" } } },
            webpush:  {
              notification: { icon:"/icons/notification-icon.png", badge:"/icons/notification-icon.png", vibrate:[200,100,200] },
              fcmOptions:   { link:"/" },
            },
          });
          enviados++;
        }
        batch.update(boletaDoc.ref, {
          alertaEnviada: true,
          alertaTs:      admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch(e) {
        console.warn(`[Alerta] Usuario ${usuarioId}:`, e.code || e.message);
      }
    }

    await batch.commit();
    console.log(`[Alertas] ${f3} → ${enviados} notificados`);
    res.json({ success:true, enviados, total:snap.size, fecha:f3 });

  } catch(e) { handleError(res, e, "alertas-vencimiento"); }
});

// ════════════════════════════════════════════════════
//  SMS — verificación de celular
// ════════════════════════════════════════════════════

/** POST /sms/enviar */
app.post("/sms/enviar", auth, async (req, res) => {
  const errs = validate(req.body, {
    celular: { required:true, pattern:/^\d{8,15}$/, msg:"celular: 8-15 dígitos" },
  });
  if (errs.length) return res.status(400).json({ errors:errs });

  const { celular } = req.body;
  const codigo = String(Math.floor(1000 + Math.random()*9000));

  try {
    // Guardar código con TTL 10 min
    await db.collection("sms_codigos").add({
      celular, codigo, usada: false,
      expiraEn: admin.firestore.Timestamp.fromDate(new Date(Date.now() + 10*60*1000)),
      creadoEn: admin.firestore.FieldValue.serverTimestamp(),
    });

    // En producción: enviar via Twilio
    // const twilio = require("twilio")(process.env.TWILIO_SID, process.env.TWILIO_TOKEN);
    // await twilio.messages.create({
    //   from: process.env.TWILIO_FROM,
    //   to:   `+54${celular}`,
    //   body: `Tu código AlDía: ${codigo}. Válido 10 minutos.`,
    // });

    console.log(`[SMS] Código → +54${celular.substring(0,4)}****`);
    const body = { success:true, msg:"Código enviado" };
    if (process.env.NODE_ENV !== "production") body.demo_codigo = codigo;
    res.json(body);

  } catch(e) { handleError(res, e, "sms/enviar"); }
});

/** POST /sms/verificar */
app.post("/sms/verificar", auth, async (req, res) => {
  const { celular, codigo } = req.body;
  if (!celular || !codigo) return res.status(400).json({ error:"celular y codigo requeridos" });

  try {
    const ahora = admin.firestore.Timestamp.now();
    const snap  = await db.collection("sms_codigos")
      .where("celular",  "==", celular)
      .where("codigo",   "==", String(codigo))
      .where("usada",    "==", false)
      .where("expiraEn", ">",  ahora)
      .limit(1).get();

    if (snap.empty) return res.status(400).json({ error:"Código incorrecto o expirado" });
    await snap.docs[0].ref.update({ usada:true });
    res.json({ success:true, verificado:true });

  } catch(e) { handleError(res, e, "sms/verificar"); }
});

/** POST /reset-password */
app.post("/reset-password", auth, async (req, res) => {
  const { celular, nuevaPassword } = req.body;
  if (!celular || !nuevaPassword || nuevaPassword.length < 6)
    return res.status(400).json({ error:"celular y nuevaPassword (mín 6 chars) requeridos" });

  try {
    const snap = await db.collection("usuarios").where("celular","==",celular).limit(1).get();
    if (snap.empty) return res.status(404).json({ error:"Usuario no encontrado" });
    // Producción: hashear con bcrypt
    await snap.docs[0].ref.update({ password:nuevaPassword });
    res.json({ success:true, msg:"Contraseña actualizada" });
  } catch(e) { handleError(res, e, "reset-password"); }
});

// ════════════════════════════════════════════════════
//  USUARIOS — helpers para el panel admin
// ════════════════════════════════════════════════════

/** POST /usuarios/:id/activar */
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

    // Push de activación
    const { fcmToken, nombre="Cliente" } = snap.data();
    console.log(`[Activar] ${nombre} | fcmToken: ${fcmToken?.substring(0,20) || "NO TOKEN"}... | largo: ${fcmToken?.length}`);
    if (fcmToken && fcmToken !== "no-token" && fcmToken.length > 50) {
      try {
        const msgId = await messaging.send({
          token: fcmToken,
          notification: {
            title: "✅ Cuenta activada",
            body:  `¡Hola ${nombre.split(" ")[0]}! Tu cuenta ya está activa. Podés ver y descargar tus boletas de luz.`,
          },
          android:  { priority:"high", notification:{ channelId:"aldia_main", sound:"default", color:"#39ff8f" } },
          apns:     { payload: { aps: { badge:1, sound:"default" } } },
          webpush: {
            notification: { icon:"/icons/notification-icon.png", badge:"/icons/notification-icon.png", vibrate:[200,100,200] },
            fcmOptions: { link:"/" },
          },
          data: { tipo:"cuenta-activada" },
        });
        console.log(`[Push OK] Cuenta activada enviada: ${msgId.substring(0,20)}...`);
      } catch(pushErr) {
        console.error("[Push ERROR activar]", pushErr.code, pushErr.message);
      }
    } else {
      console.warn(`[Push SKIP] Token inválido para ${nombre}: "${fcmToken}"`);
    }

    res.json({ success:true, usuarioId:id, estado:"activo" });
  } catch(e) { handleError(res, e, "usuarios/activar"); }
});

// ════════════════════════════════════════════════════
//  ERROR HANDLERS
// ════════════════════════════════════════════════════

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

// ─── GET /usuario/:id — obtener estado actualizado ──
app.get("/usuario/:id", async (req, res) => {
  const { id } = req.params;
  if (!id || id.length > 100) return res.status(400).json({ error:"ID inválido" });
  try {
    const snap = await db.collection("usuarios").doc(id).get();
    if (!snap.exists) return res.status(404).json({ error:"Usuario no encontrado" });
    const data = snap.data();
    // No devolver la contraseña
    const { password, ...resto } = data;
    res.json({ success:true, usuario:{ id:snap.id, ...resto } });
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
          notification: {
            title: "📋 Nuevo cliente registrado",
            body:  `${nombre} (DNI: ${dni}) se registró y está esperando activación de su cuenta.`,
          },
          android:  { priority:"high", notification:{ channelId:"aldia_main", sound:"default", color:"#00c2ff" } },
          apns:     { payload: { aps: { badge:1, sound:"default" } } },
          webpush: {
            notification: { icon:"/icons/notification-icon.png", badge:"/icons/notification-icon.png" },
            fcmOptions: { link: "/admin.html" }
          },
          data: { tipo: "nuevo-registro", usuarioId: ref.id },
        }).catch(e => console.warn("[Push admin]", e.code));
      }
    } catch(e) { /* silencioso si no hay config admin */ }

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
            notification: {
              title: `${icono} ${titulo}`,
              body:  cuerpo.substring(0, 200),
            },
            android:  { priority:"high", notification:{ channelId:"aldia_main", sound:"default", color:"#f59e0b" } },
            apns:     { payload: { aps: { badge:1, sound:"default" } } },
            webpush: {
              notification: {
                icon:    "/icons/notification-icon.png",
                badge:   "/icons/notification-icon.png",
                vibrate: [200, 100, 200],
              },
              fcmOptions: { link: "/" },
            },
            data: { tipo: tipo || "aviso", ts: Date.now().toString() },
          });
          enviados += resp.successCount;
          console.log(`[Push Aviso] Lote ${i/500+1}: ${resp.successCount} OK, ${resp.failureCount} fail`);
        } catch(pushErr) {
          console.error("[Push Aviso Error]", pushErr.message);
        }
      }
      console.log(`[Aviso] Push enviado a ${enviados}/${tokens.length} clientes`);
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
