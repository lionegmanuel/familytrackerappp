// firebase-config.js es generado en build time por generate-config.js
// Nunca existe en el repositorio — solo en el servidor de Netlify durante el deploy.
// Para desarrollo local: copiá firebase-config.example.js → firebase-config.js y completá.
import { firebaseConfig } from "./firebase-config.js";

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  onSnapshot,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Init Firebase ──
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── Estado global ──
let map, currentUser, watchId;
const markers = {}; // uid → Leaflet marker
const colors = [
  "#38bdf8",
  "#a78bfa",
  "#fb923c",
  "#34d399",
  "#f472b6",
  "#facc15",
];
const uidColor = {}; // uid → color index

// ══════════════════════════════════════════════
//  UTILIDADES
// ══════════════════════════════════════════════
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function timeAgo(ts) {
  if (!ts) return "Sin datos";
  const now = Date.now();
  const sec = Math.floor((now - ts.toMillis()) / 1000);
  if (sec < 10) return "Ahora mismo";
  if (sec < 60) return `Hace ${sec}s`;
  if (sec < 3600) return `Hace ${Math.floor(sec / 60)}min`;
  return `Hace ${Math.floor(sec / 3600)}h`;
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getColor(uid) {
  if (uidColor[uid] === undefined) {
    const taken = Object.values(uidColor);
    let idx = 0;
    while (taken.includes(idx)) idx++;
    uidColor[uid] = idx % colors.length;
  }
  return { idx: uidColor[uid], hex: colors[uidColor[uid]] };
}

// ══════════════════════════════════════════════
//  MAPA — Leaflet + OpenStreetMap
// ══════════════════════════════════════════════
function initMap() {
  if (map) return;
  map = L.map("map", {
    center: [-34.6037, -58.3816], // Argentina por defecto
    zoom: 12,
    zoomControl: true,
    attributionControl: false,
  });

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);

  // Atribución pequeña
  L.control
    .attribution({ prefix: false })
    .addAttribution('© <a href="https://openstreetmap.org">OSM</a>')
    .addTo(map);
}

function createMarkerIcon(name, colorHex) {
  const ini = initials(name);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="54" viewBox="0 0 44 54">
    <filter id="sh"><feDropShadow dx="0" dy="3" stdDeviation="3" flood-color="rgba(0,0,0,0.4)"/></filter>
    <ellipse cx="22" cy="50" rx="8" ry="3" fill="rgba(0,0,0,0.25)"/>
    <path d="M22 2C12.06 2 4 10.06 4 20c0 14.25 18 34 18 34S40 34.25 40 20C40 10.06 31.94 2 22 2z"
      fill="${colorHex}" filter="url(#sh)"/>
    <circle cx="22" cy="19" r="10" fill="rgba(0,0,0,0.25)"/>
    <text x="22" y="23.5" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif"
      font-size="10" font-weight="800" fill="white">${ini}</text>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: "",
    iconSize: [44, 54],
    iconAnchor: [22, 52],
    popupAnchor: [0, -50],
  });
}

function upsertMarker(uid, data) {
  if (!data.lat || !data.lng) return;
  const { hex } = getColor(uid);
  const icon = createMarkerIcon(data.displayName || "?", hex);
  const timeStr = timeAgo(data.lastSeen);
  const popupHtml = `
    <div class="popup-name">${data.displayName || "Familiar"}</div>
    <div class="popup-time">📍 ${timeStr}</div>`;

  if (markers[uid]) {
    markers[uid].setLatLng([data.lat, data.lng]);
    markers[uid].setIcon(icon);
    markers[uid].setPopupContent(popupHtml);
  } else {
    markers[uid] = L.marker([data.lat, data.lng], { icon })
      .addTo(map)
      .bindPopup(popupHtml);
  }
}

function removeMarker(uid) {
  if (markers[uid]) {
    map.removeLayer(markers[uid]);
    delete markers[uid];
  }
}

function flyToMember(uid) {
  if (markers[uid]) {
    map.flyTo(markers[uid].getLatLng(), 15, { duration: 1.2 });
    markers[uid].openPopup();
  } else {
    showToast("📍 No hay ubicación disponible aún");
  }
}

// ══════════════════════════════════════════════
//  FIRESTORE — USUARIOS
// ══════════════════════════════════════════════
async function loadUserProfile(uid) {
  const ref = doc(db, "users", uid);
  const snap = await getDoc(ref);
  return snap.exists() ? snap.data() : null;
}

async function updateMyLocation(lat, lng) {
  if (!currentUser) return;
  await setDoc(
    doc(db, "users", currentUser.uid),
    {
      lat,
      lng,
      lastSeen: serverTimestamp(),
      sharing: true,
    },
    { merge: true },
  );
}

async function setSharing(enabled) {
  if (!currentUser) return;
  const update = { sharing: enabled };
  if (!enabled) {
    update.lat = null;
    update.lng = null;
  }
  await setDoc(doc(db, "users", currentUser.uid), update, { merge: true });
}

// ══════════════════════════════════════════════
//  GEOLOCALIZACIÓN
// ══════════════════════════════════════════════
function startTracking() {
  if (!navigator.geolocation) {
    showToast("⚠️ Tu navegador no soporta GPS");
    return;
  }
  stopTracking();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      updateMyLocation(lat, lng);
      // Actualizar propio marcador inmediatamente
      upsertMarker(currentUser.uid, {
        lat,
        lng,
        displayName: currentUser._displayName,
        lastSeen: { toMillis: () => Date.now() },
      });
    },
    (err) => {
      console.warn("GPS error:", err);
      showToast("⚠️ No se pudo obtener la ubicación");
    },
    { enableHighAccuracy: true, maximumAge: 10000 },
  );
  document.getElementById("my-status-dot").classList.add("active");
  document.getElementById("my-status-text").textContent =
    "Compartiendo en tiempo real";
  showToast("📍 Ubicación activada");
}

function stopTracking() {
  if (watchId !== undefined) {
    navigator.geolocation.clearWatch(watchId);
    watchId = undefined;
  }
  removeMarker(currentUser?.uid);
  document.getElementById("my-status-dot").classList.remove("active");
  document.getElementById("my-status-text").textContent =
    "Inactiva — no visible";
  setSharing(false);
}

// ══════════════════════════════════════════════
//  PANEL FAMILIA — render en tiempo real
// ══════════════════════════════════════════════
let unsubFamily = null;

function listenFamily() {
  if (unsubFamily) unsubFamily();
  const colRef = collection(db, "users");
  unsubFamily = onSnapshot(colRef, (snapshot) => {
    const list = document.getElementById("family-list");
    let onlineCount = 0;
    const cards = [];

    snapshot.forEach((docSnap) => {
      const uid = docSnap.id;
      const data = docSnap.data();
      if (!data.displayName) return;

      const isMe = uid === currentUser.uid;
      const isOnline = data.sharing && data.lat && data.lng;
      if (isOnline) onlineCount++;

      // Actualizar marcador en mapa
      if (isOnline && !isMe) upsertMarker(uid, data);
      else if (!isOnline && !isMe) removeMarker(uid);

      const { idx, hex } = getColor(uid);
      const timeStr = timeAgo(data.lastSeen);
      const card = `
        <div class="member-card" onclick="flyToMember('${uid}')">
          <div class="member-avatar color-${idx}">${initials(data.displayName)}</div>
          <div class="member-info">
            <div class="member-name">${data.displayName}${isMe ? " (Yo)" : ""}</div>
            <div class="member-time">${isOnline ? "📍 " + timeStr : "Sin ubicación activa"}</div>
          </div>
          <div class="member-status-icon ${isOnline ? "on" : "off"}"></div>
          ${isOnline && !isMe ? `<button class="member-locate-btn" onclick="event.stopPropagation();flyToMember('${uid}')">Ver</button>` : ""}
        </div>`;
      cards.push({ isMe, card });
    });

    // Yo primero
    cards.sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0));
    list.innerHTML = cards.length
      ? cards.map((c) => c.card).join("")
      : `<div class="empty-state">Invitá a tu familia a registrarse</div>`;

    document.getElementById("online-count").textContent =
      `${onlineCount} activo${onlineCount !== 1 ? "s" : ""}`;
  });
}

// ══════════════════════════════════════════════
//  AUTH — LOGIN / REGISTRO
// ══════════════════════════════════════════════
document.getElementById("btn-login").addEventListener("click", async () => {
  const email = document.getElementById("inp-email").value.trim();
  const pass = document.getElementById("inp-pass").value;
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    errEl.textContent = translateError(e.code);
    errEl.style.display = "block";
  }
});

document.getElementById("btn-register").addEventListener("click", async () => {
  const name = document.getElementById("inp-name").value.trim();
  const email = document.getElementById("inp-reg-email").value.trim();
  const pass = document.getElementById("inp-reg-pass").value;
  const errEl = document.getElementById("reg-error");
  errEl.style.display = "none";

  if (!name) {
    errEl.textContent = "Por favor ingresá tu nombre.";
    errEl.style.display = "block";
    return;
  }

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    // Crear perfil en Firestore
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: name,
      email,
      sharing: false,
      lat: null,
      lng: null,
      lastSeen: serverTimestamp(),
    });
  } catch (e) {
    errEl.textContent = translateError(e.code);
    errEl.style.display = "block";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  stopTracking();
  if (unsubFamily) unsubFamily();
  await signOut(auth);
  showScreen("screen-login");
});

document
  .getElementById("btn-show-register")
  .addEventListener("click", () => showScreen("screen-register"));
document
  .getElementById("btn-show-login")
  .addEventListener("click", () => showScreen("screen-login"));

// Toggle compartir
document.getElementById("toggle-sharing").addEventListener("change", (e) => {
  if (e.target.checked) startTracking();
  else stopTracking();
});

// ── Auth state ──
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    showScreen("screen-login");
    return;
  }

  const profile = await loadUserProfile(user.uid);
  const displayName = profile?.displayName || user.email.split("@")[0];
  currentUser = { ...user, _displayName: displayName };

  // Header
  document.getElementById("user-name-header").textContent = displayName;
  const avEl = document.getElementById("user-avatar-header");
  avEl.textContent = initials(displayName);
  const { idx } = getColor(user.uid);
  avEl.className = `user-avatar color-${idx}`;

  showScreen("screen-app");
  initMap();
  listenFamily();

  // Restaurar estado si ya estaba compartiendo
  if (profile?.sharing) {
    document.getElementById("toggle-sharing").checked = true;
    startTracking();
  }
});

// ── Exponer flyToMember globalmente (para onclick en HTML dinámico) ──
window.flyToMember = flyToMember;

// ── Traducir errores Firebase ──
function translateError(code) {
  const map = {
    "auth/invalid-email": "Email inválido.",
    "auth/user-not-found": "No existe una cuenta con ese email.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese email.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos.",
  };
  return map[code] || "Error inesperado. Intentá de nuevo.";
}
