// generate-config.js
// Corre en build time (Netlify). Lee variables de entorno y genera firebase-config.js
// Este archivo SÍ se commitea. firebase-config.js NO.

const fs = require("fs");
const path = require("path");

const required = [
  "FIREBASE_API_KEY",
  "FIREBASE_AUTH_DOMAIN",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_STORAGE_BUCKET",
  "FIREBASE_MESSAGING_ID",
  "FIREBASE_APP_ID",
];

// Verificar que todas las variables existan antes de generar
const missing = required.filter((k) => !process.env[k]);

if (missing.length) {
  const outputPath = path.join("assets", "js", "firebase-config.js");
  const alreadyExists = fs.existsSync(outputPath);

  if (alreadyExists) {
    console.warn("WARNING: Variables de entorno faltantes:", missing.join(", "));
    console.warn("WARNING: Se usara el firebase-config.js existente. Configura las env vars en Netlify.");
    process.exit(0);
  } else {
    console.error("ERROR: Variables de entorno faltantes:", missing.join(", "));
    console.error("ERROR: Configura estas variables en Netlify: Site settings > Environment variables");
    process.exit(1);
  }
}

const apiKey = process.env.FIREBASE_API_KEY;
const authDomain = process.env.FIREBASE_AUTH_DOMAIN;
const projectId = process.env.FIREBASE_PROJECT_ID;
const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;
const messagingSenderId = process.env.FIREBASE_MESSAGING_ID;
const appId = process.env.FIREBASE_APP_ID;

const config = [
  "// ARCHIVO GENERADO AUTOMATICAMENTE - NO EDITAR NI COMMITEAR",
  "// Generado por generate-config.js en build time desde variables de entorno Netlify.",
  "",
  "export const firebaseConfig = {",
  '  apiKey:            "' + apiKey + '",',
  '  authDomain:        "' + authDomain + '",',
  '  projectId:         "' + projectId + '",',
  '  storageBucket:     "' + storageBucket + '",',
  '  messagingSenderId: "' + messagingSenderId + '",',
  '  appId:             "' + appId + '",',
  "};",
  "",
].join("\n");

fs.mkdirSync("assets/js", { recursive: true });
fs.writeFileSync("assets/js/firebase-config.js", config);
console.log("OK: assets/js/firebase-config.js generado correctamente desde variables de entorno.");
