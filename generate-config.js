// generate-config.js
// Corre en build time (Netlify). Lee variables de entorno y genera firebase-config.js
// Este archivo SÍ se commitea. firebase-config.js NO.

const fs = require("fs");

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
  console.error("❌ Variables de entorno faltantes:", missing.join(", "));
  process.exit(1);
}

const config = `// ⚠️  ARCHIVO GENERADO AUTOMÁTICAMENTE — NO EDITAR NI COMMITEAR
// Generado por generate-config.js en build time desde variables de entorno Netlify.

export const firebaseConfig = {
  apiKey:            "${process.env.FIREBASE_API_KEY}",
  authDomain:        "${process.env.FIREBASE_AUTH_DOMAIN}",
  projectId:         "${process.env.FIREBASE_PROJECT_ID}",
  storageBucket:     "${process.env.FIREBASE_STORAGE_BUCKET}",
  messagingSenderId: "${process.env.FIREBASE_MESSAGING_ID}",
  appId:             "${process.env.FIREBASE_APP_ID}",
};
`;

fs.mkdirSync("assets/js", { recursive: true });
fs.writeFileSync("assets/js/firebase-config.js", config);
console.log(
  "✅ assets/js/firebase-config.js generado correctamente desde variables de entorno.",
);
