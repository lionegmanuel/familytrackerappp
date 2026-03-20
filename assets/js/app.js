// firebase-config.js es generado en build time por generate-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

// ── Init ──
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ── Estado global ──
let map, currentUser, watchId;
const markers = {};
const colors = [
  "#38bdf8",
  "#a78bfa",
  "#fb923c",
  "#34d399",
  "#f472b6",
  "#facc15",
];
const uidColor = {};
let myGroupMemberUids = new Set(); // uids visibles (miembros de mis grupos aceptados)
let unsubListeners = []; // para cleanup

// ══════════════════════════════════════════════
//  UTILS
// ══════════════════════════════════════════════
function showScreen(id) {
  document
    .querySelectorAll(".screen")
    .forEach((s) => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

function showLoading(msg = "Cargando...") {
  document.getElementById("loading-label").textContent = msg;
  document.getElementById("loading-overlay").classList.add("active");
}

function hideLoading() {
  document.getElementById("loading-overlay").classList.remove("active");
}

function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2800);
}

function openModal(id) {
  document.getElementById(id).classList.add("open");
}
function closeModal(id) {
  document.getElementById(id).classList.remove("open");
}

function timeAgo(ts) {
  if (!ts) return "Sin datos";
  const sec = Math.floor((Date.now() - ts.toMillis()) / 1000);
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
//  MAPA
// ══════════════════════════════════════════════
function initMap() {
  if (map) return;
  map = L.map("map", {
    center: [-34.6037, -58.3816],
    zoom: 12,
    zoomControl: true,
    attributionControl: false,
  });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
  }).addTo(map);
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
    <path d="M22 2C12.06 2 4 10.06 4 20c0 14.25 18 34 18 34S40 34.25 40 20C40 10.06 31.94 2 22 2z" fill="${colorHex}" filter="url(#sh)"/>
    <circle cx="22" cy="19" r="10" fill="rgba(0,0,0,0.25)"/>
    <text x="22" y="23.5" text-anchor="middle" font-family="Plus Jakarta Sans,sans-serif" font-size="10" font-weight="800" fill="white">${ini}</text>
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
  const batteryStr = data.battery != null ? `🔋 ${data.battery}%` : "";
  const popup = `
    <div class="popup-name">${data.displayName || "Familiar"}</div>
    <div class="popup-time">📍 ${timeAgo(data.lastSeen)}</div>
    ${batteryStr ? `<div class="popup-battery">${batteryStr}</div>` : ""}`;

  if (markers[uid]) {
    markers[uid].setLatLng([data.lat, data.lng]);
    markers[uid].setIcon(icon);
    markers[uid].setPopupContent(popup);
  } else {
    markers[uid] = L.marker([data.lat, data.lng], { icon })
      .addTo(map)
      .bindPopup(popup);
  }
}

function removeMarker(uid) {
  if (markers[uid]) {
    map.removeLayer(markers[uid]);
    delete markers[uid];
  }
}

window.flyToMember = function (uid) {
  if (markers[uid]) {
    map.flyTo(markers[uid].getLatLng(), 15, { duration: 1.2 });
    markers[uid].openPopup();
  } else showToast("📍 No hay ubicación disponible aún");
};

// ══════════════════════════════════════════════
//  GEOLOCALIZACIÓN + DISPOSITIVO
// ══════════════════════════════════════════════
let lastGpsAccuracy = null;

function startTracking() {
  if (!navigator.geolocation) {
    showToast("⚠️ GPS no disponible");
    return;
  }
  stopTracking();
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      lastGpsAccuracy = accuracy;
      document.getElementById("dev-gps").textContent = accuracy
        ? `±${Math.round(accuracy)}m`
        : "--";
      updateMyLocation(lat, lng);
    },
    (err) => {
      console.warn("GPS:", err);
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

async function initDeviceInfo() {
  // Batería
  if ("getBattery" in navigator) {
    const bat = await navigator.getBattery();
    function updateBattery() {
      const pct = Math.round(bat.level * 100);
      document.getElementById("dev-battery").textContent = pct + "%";
      const fill = document.getElementById("battery-fill");
      fill.style.width = pct + "%";
      fill.className =
        "battery-fill" + (pct <= 15 ? " crit" : pct <= 30 ? " warn" : "");
      document.getElementById("dev-battery").style.color =
        pct <= 15
          ? "var(--red)"
          : pct <= 30
            ? "var(--orange)"
            : "var(--accent)";
      // Actualizar en Firestore
      if (currentUser)
        updateDoc(doc(db, "users", currentUser.uid), { battery: pct }).catch(
          () => {},
        );
    }
    updateBattery();
    bat.addEventListener("levelchange", updateBattery);
    bat.addEventListener("chargingchange", updateBattery);
  }

  // Red
  const conn =
    navigator.connection ||
    navigator.mozConnection ||
    navigator.webkitConnection;
  function updateNetwork() {
    if (!conn) {
      document.getElementById("dev-network").textContent = navigator.onLine
        ? "Online"
        : "Offline";
      document.getElementById("dev-net-icon").textContent = navigator.onLine
        ? "📶"
        : "❌";
      return;
    }
    const type = conn.effectiveType || conn.type || "desconocido";
    const down = conn.downlink ? ` · ${conn.downlink}Mbps` : "";
    document.getElementById("dev-network").textContent = type.toUpperCase();
    document.getElementById("dev-network-sub").textContent = down;
    document.getElementById("dev-net-icon").textContent =
      type.includes("4g") || type.includes("wifi") ? "📶" : "🔶";
  }
  updateNetwork();
  if (conn) conn.addEventListener("change", updateNetwork);
  window.addEventListener("online", updateNetwork);
  window.addEventListener("offline", updateNetwork);
}

// ══════════════════════════════════════════════
//  FIRESTORE — USUARIOS
// ══════════════════════════════════════════════
async function updateMyLocation(lat, lng) {
  if (!currentUser) return;
  await setDoc(
    doc(db, "users", currentUser.uid),
    { lat, lng, lastSeen: serverTimestamp(), sharing: true },
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

async function getUserByEmail(email) {
  const target = email.toLowerCase().trim();
  const snap = await getDocs(collection(db, "users"));
  const match = snap.docs.find(
    (d) => (d.data().email || "").toLowerCase() === target,
  );
  if (!match) return null;
  return { uid: match.id, ...match.data() };
}
// ══════════════════════════════════════════════
//  GRUPOS
// ══════════════════════════════════════════════
let currentInviteGroupId = null;
let foundUserForInvite = null;

function listenGroups() {
  let debounceTimer = null;
  const debouncedRender = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => renderGroups(), 120);
  };
  const qOwner = query(
    collection(db, "groups"),
    where("ownerId", "==", currentUser.uid),
  );
  const unsubOwner = onSnapshot(qOwner, debouncedRender);
  const qMember = query(
    collection(db, "groupMembers"),
    where("uid", "==", currentUser.uid),
  );
  const unsubMember = onSnapshot(qMember, debouncedRender);
  unsubListeners.push(unsubOwner, unsubMember);
}

async function renderGroups() {
  const list = document.getElementById("groups-list");
  list.innerHTML = "";
  myGroupMemberUids.clear();

  // Obtener grupos que creé
  const qOwner = query(
    collection(db, "groups"),
    where("ownerId", "==", currentUser.uid),
  );
  const ownerSnap = await getDocs(qOwner);

  // Obtener grupos donde soy miembro aceptado
  const qMember = query(
    collection(db, "groupMembers"),
    where("uid", "==", currentUser.uid),
    where("status", "==", "accepted"),
  );
  const memberSnap = await getDocs(qMember);
  const joinedGroupIds = memberSnap.docs.map((d) => d.data().groupId);

  const allGroups = [];

  // Mis grupos creados
  for (const gDoc of ownerSnap.docs) {
    allGroups.push({ id: gDoc.id, ...gDoc.data(), role: "owner" });
  }

  // Grupos a los que fui invitado y acepté
  for (const gid of joinedGroupIds) {
    // Evitar duplicados si soy owner y también miembro
    if (!allGroups.find((g) => g.id === gid)) {
      const gSnap = await getDoc(doc(db, "groups", gid));
      if (gSnap.exists())
        allGroups.push({ id: gid, ...gSnap.data(), role: "member" });
    }
  }

  if (allGroups.length === 0) {
    list.innerHTML = `<div class="empty-state">No tenés grupos. ¡Creá uno y empezá a agregar personas!</div>`;
    renderFamilyList([]);
    updateMsgRecipients([]);
    return;
  }

  const allMembers = [];

  for (const group of allGroups) {
    // Obtener miembros aceptados del grupo (excluir al usuario actual)
    const membersQ = query(
      collection(db, "groupMembers"),
      where("groupId", "==", group.id),
    );
    const membersSnap = await getDocs(membersQ);
    const members = membersSnap.docs
      .filter((d) => d.data().status === "accepted")
      .map((d) => ({ uid: d.data().uid, name: d.data().displayName }))
      .filter((m) => m.uid !== currentUser.uid);
    // Agregar uids visibles
    members.forEach((m) => myGroupMemberUids.add(m.uid));
    // Si soy miembro (no owner), agregar al owner como visible
    if (group.ownerId !== currentUser.uid) myGroupMemberUids.add(group.ownerId);
    // Acumular todos los miembros para el panel de mapa y mensajes
    members.forEach((m) => {
      if (!allMembers.find((x) => x.uid === m.uid)) allMembers.push(m);
    });

    // Render card del grupo
    const card = document.createElement("div");
    card.className = "group-card";

    const chipsHtml = members.length
      ? members
          .map((m) => {
            const { idx } = getColor(m.uid);
            return `<span class="group-member-chip"><span class="chip-dot color-${idx}"></span>${m.name || "?"}</span>`;
          })
          .join("")
      : `<span style="font-size:0.75rem;color:var(--muted)">Sin miembros aún</span>`;

    card.innerHTML = `
      <div class="group-card-header">
        <span class="group-card-name">${group.name}</span>
        <span class="group-card-count">${members.length} miembro${members.length !== 1 ? "s" : ""}</span>
      </div>
      <div class="group-members-preview">${chipsHtml}</div>
      <div class="group-actions">
        ${
          group.role === "owner"
            ? `<button class="btn-sm" onclick="openInviteModal('${group.id}','${group.name}')">+ Agregar miembro</button>
             <button class="btn-danger" onclick="deleteGroup('${group.id}')">Eliminar</button>`
            : `<button class="btn-danger" onclick="leaveGroup('${group.id}')">Salir del grupo</button>`
        }
      </div>`;
    list.appendChild(card);
    allMembers.forEach((m) => {
      if (!allMembers.find((x) => x.uid === m.uid)) allMembers.push(m);
    });
  }

  renderFamilyList(allMembers);
  updateMsgRecipients(allMembers);
}

window.openInviteModal = function (groupId, groupName) {
  currentInviteGroupId = groupId;
  foundUserForInvite = null;
  document.getElementById("invite-group-name").textContent = groupName;
  document.getElementById("inp-invite-email").value = "";
  document.getElementById("invite-result").innerHTML = "";
  document.getElementById("invite-result").className = "invite-result";
  document.getElementById("invite-confirm").style.display = "none";
  document.getElementById("btn-search-user").style.display = "block";
  openModal("modal-invite");
};

window.deleteGroup = async function (groupId) {
  if (!confirm("¿Seguro que querés eliminar este grupo?")) return;
  // Eliminar miembros
  const q = query(
    collection(db, "groupMembers"),
    where("groupId", "==", groupId),
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) await deleteDoc(d.ref);
  await deleteDoc(doc(db, "groups", groupId));
  showToast("Grupo eliminado");
};

window.leaveGroup = async function (groupId) {
  if (!confirm("¿Seguro que querés salir de este grupo?")) return;
  const q = query(
    collection(db, "groupMembers"),
    where("groupId", "==", groupId),
    where("uid", "==", currentUser.uid),
  );
  const snap = await getDocs(q);
  for (const d of snap.docs) await deleteDoc(d.ref);
  showToast("Saliste del grupo");
};

// Buscar usuario por email para invitar
document
  .getElementById("btn-search-user")
  .addEventListener("click", async () => {
    const email = document.getElementById("inp-invite-email").value.trim();
    const resultEl = document.getElementById("invite-result");
    const confirmEl = document.getElementById("invite-confirm");

    if (!email) {
      resultEl.textContent = "Ingresá un email.";
      resultEl.className = "invite-result error";
      return;
    }
    if (email === currentUser.email) {
      resultEl.textContent = "No podés invitarte a vos mismo.";
      resultEl.className = "invite-result error";
      return;
    }

    resultEl.textContent = "Buscando...";
    resultEl.className = "invite-result";
    confirmEl.style.display = "none";
    foundUserForInvite = null;

    const user = await getUserByEmail(email);

    if (!user) {
      resultEl.textContent = `❌ No existe ningún usuario registrado con el email "${email}". Pedile que se registre primero en GPSafe.`;
      resultEl.className = "invite-result error";
      return;
    }

    // Verificar si ya es miembro del grupo
    const existingQ = query(
      collection(db, "groupMembers"),
      where("groupId", "==", currentInviteGroupId),
      where("uid", "==", user.uid),
    );
    const existingSnap = await getDocs(existingQ);
    if (!existingSnap.empty) {
      resultEl.textContent = `⚠️ ${user.displayName} ya es miembro de este grupo.`;
      resultEl.className = "invite-result error";
      return;
    }

    // Verificar si ya hay invitación pendiente
    const pendingQ = query(
      collection(db, "invitations"),
      where("groupId", "==", currentInviteGroupId),
      where("toUid", "==", user.uid),
      where("status", "==", "pending"),
    );
    const pendingSnap = await getDocs(pendingQ);
    if (!pendingSnap.empty) {
      resultEl.textContent = `⚠️ Ya enviaste una invitación pendiente a ${user.displayName}.`;
      resultEl.className = "invite-result error";
      return;
    }

    // Encontrado — mostrar preview
    foundUserForInvite = user;
    const { idx } = getColor(user.uid);
    resultEl.textContent = "";
    document.getElementById("invite-user-preview").innerHTML = `
    <div class="preview-avatar color-${idx}">${initials(user.displayName)}</div>
    <div class="preview-info">
      <div class="preview-name">${user.displayName}</div>
      <div class="preview-email">${user.email}</div>
    </div>`;
    confirmEl.style.display = "block";
    document.getElementById("btn-search-user").style.display = "none";
  });

// Confirmar invitación
document
  .getElementById("btn-confirm-invite")
  .addEventListener("click", async () => {
    if (!foundUserForInvite || !currentInviteGroupId) return;
    const groupSnap = await getDoc(doc(db, "groups", currentInviteGroupId));
    const groupName = groupSnap.data()?.name || "Grupo";

    await addDoc(collection(db, "invitations"), {
      fromUid: currentUser.uid,
      fromName: currentUser._displayName,
      toUid: foundUserForInvite.uid,
      groupId: currentInviteGroupId,
      groupName,
      status: "pending",
      createdAt: serverTimestamp(),
    });

    showToast(`✅ Invitación enviada a ${foundUserForInvite.displayName}`);
    closeModal("modal-invite");
  });

// Crear grupo
document.getElementById("btn-create-group").addEventListener("click", () => {
  document.getElementById("inp-group-name").value = "";
  openModal("modal-group");
});

document
  .getElementById("btn-save-group")
  .addEventListener("click", async () => {
    const name = document.getElementById("inp-group-name").value.trim();
    if (!name) {
      showToast("Ingresá un nombre para el grupo");
      return;
    }

    const groupRef = await addDoc(collection(db, "groups"), {
      name,
      ownerId: currentUser.uid,
      createdAt: serverTimestamp(),
    });

    // El owner también queda como miembro aceptado automáticamente
    /*await addDoc(collection(db, "groupMembers"), {
      groupId: groupRef.id,
      uid: currentUser.uid,
      displayName: currentUser._displayName,
      status: "accepted",
      joinedAt: serverTimestamp(),
    });
*/
    showToast(`✅ Grupo "${name}" creado`);
    closeModal("modal-group");
  });

// ══════════════════════════════════════════════
//  INVITACIONES RECIBIDAS
// ══════════════════════════════════════════════
function listenInvitations() {
  const q = query(
    collection(db, "invitations"),
    where("toUid", "==", currentUser.uid),
    where("status", "==", "pending"),
  );
  const unsub = onSnapshot(q, (snap) => {
    const badge = document.getElementById("inv-badge");
    const count = snap.size;
    badge.textContent = count;
    badge.style.display = count > 0 ? "flex" : "none";
    renderInvitationsList(snap.docs);
  });
  unsubListeners.push(unsub);
}

function renderInvitationsList(invDocs) {
  const list = document.getElementById("invitations-list");
  if (!invDocs.length) {
    list.innerHTML = `<div class="empty-state">Sin invitaciones pendientes</div>`;
    return;
  }
  list.innerHTML = invDocs
    .map((d) => {
      const inv = d.data();
      return `
      <div class="inv-item">
        <div class="inv-from">👤 ${inv.fromName} te invitó a su grupo</div>
        <div class="inv-group">📁 ${inv.groupName}</div>
        <div class="inv-actions">
          <button class="btn-accept" onclick="acceptInvitation('${d.id}','${inv.groupId}','${inv.groupName}')">✓ Aceptar</button>
          <button class="btn-reject" onclick="rejectInvitation('${d.id}')">✗ Rechazar</button>
        </div>
      </div>`;
    })
    .join("");
}

window.acceptInvitation = async function (invId, groupId, groupName) {
  // Crear membresía
  await addDoc(collection(db, "groupMembers"), {
    groupId,
    uid: currentUser.uid,
    displayName: currentUser._displayName,
    status: "accepted",
    joinedAt: serverTimestamp(),
  });
  // Marcar invitación como aceptada
  await updateDoc(doc(db, "invitations", invId), { status: "accepted" });
  showToast(`✅ Ahora sos parte del grupo "${groupName}"`);
};

window.rejectInvitation = async function (invId) {
  await updateDoc(doc(db, "invitations", invId), { status: "rejected" });
  showToast("Invitación rechazada");
};

document
  .getElementById("btn-open-invitations")
  .addEventListener("click", () => openModal("modal-invitations"));

// ══════════════════════════════════════════════
//  PANEL MAPA — render miembros del grupo
// ══════════════════════════════════════════════
function listenGroupMembers() {
  // Escuchar cambios en tiempo real de usuarios visibles
  const unsub = onSnapshot(collection(db, "users"), (snap) => {
    let online = 0;
    const visibleMembers = [];

    snap.forEach((d) => {
      const uid = d.id;
      const data = d.data();
      if (!data.displayName) return;

      const isMe = uid === currentUser.uid;
      const isVisible = isMe || myGroupMemberUids.has(uid);
      if (!isVisible) return;

      const isOnline = data.sharing && data.lat && data.lng;
      if (isOnline) online++;

      if (isOnline && !isMe) upsertMarker(uid, data);
      else if (!isOnline && !isMe) removeMarker(uid);

      visibleMembers.push({ uid, data, isMe });
    });

    // Limpiar marcadores de miembros que ya no están en el grupo
    Object.keys(markers).forEach((uid) => {
      if (!myGroupMemberUids.has(uid)) removeMarker(uid);
    });

    document.getElementById("online-count").textContent =
      `${online} activo${online !== 1 ? "s" : ""}`;
    renderFamilyListFromData(visibleMembers);
  });
  unsubListeners.push(unsub);
}

function renderFamilyListFromData(members) {
  const list = document.getElementById("family-list");
  if (members.length <= 1 && members[0]?.isMe) {
    list.innerHTML = `<div class="empty-state">Invitá a tu grupo para ver su ubicación aquí</div>`;
    return;
  }
  list.innerHTML = members
    .sort((a, b) => (b.isMe ? 1 : 0) - (a.isMe ? 1 : 0))
    .map(({ uid, data, isMe }) => {
      const { idx } = getColor(uid);
      const isOnline = data.sharing && data.lat && data.lng;
      const batteryHtml =
        data.battery != null
          ? `<span class="member-battery">🔋${data.battery}%</span>`
          : "";
      return `
        <div class="member-card" onclick="flyToMember('${uid}')">
          <div class="member-avatar color-${idx}">${initials(data.displayName)}</div>
          <div class="member-info">
            <div class="member-name">${data.displayName}${isMe ? " (Yo)" : ""}</div>
            <div class="member-meta">
              <span>${isOnline ? "📍 " + timeAgo(data.lastSeen) : "Sin ubicación"}</span>
              ${batteryHtml}
            </div>
          </div>
          <div class="member-status-dot ${isOnline ? "on" : "off"}"></div>
          ${isOnline && !isMe ? `<button class="member-locate-btn" onclick="event.stopPropagation();flyToMember('${uid}')">Ver</button>` : ""}
        </div>`;
    })
    .join("");
}

// Fallback para renderGroups
function renderFamilyList(members) {
  const allUids = members.map((m) => m.uid);
  // Delegamos al snapshot listener — solo actualizamos los recipient dropdowns
  updateMsgRecipients(members);
}

function updateMsgRecipients(members) {
  const sel = document.getElementById("msg-recipient");
  const current = sel.value;
  sel.innerHTML = `<option value="">Seleccioná un miembro...</option>`;
  members
    .filter((m) => m.uid !== currentUser.uid)
    .forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.uid;
      opt.textContent = m.name || m.displayName || m.uid;
      sel.appendChild(opt);
    });
  if (current) sel.value = current;
}

// ══════════════════════════════════════════════
//  MENSAJES
// ══════════════════════════════════════════════
function listenMessages() {
  const q = query(
    collection(db, "messages"),
    where("toUid", "==", currentUser.uid),
    orderBy("createdAt", "desc"),
  );
  const unsub = onSnapshot(q, (snap) => {
    const unread = snap.docs.filter((d) => !d.data().read).length;
    const badge = document.getElementById("msg-badge");
    badge.textContent = unread;
    badge.style.display = unread > 0 ? "flex" : "none";

    const list = document.getElementById("messages-list");
    if (snap.empty) {
      list.innerHTML = `<div class="empty-state">Sin mensajes aún</div>`;
      return;
    }
    list.innerHTML = snap.docs
      .map((d) => {
        const m = d.data();
        const isAlert = m.type === "alert";
        const time = m.createdAt ? timeAgo(m.createdAt) : "";
        return `
        <div class="msg-item ${!m.read ? "unread" : ""} ${isAlert ? "alert-type" : ""}">
          <div class="msg-item-header">
            <span class="msg-from ${isAlert ? "alert-from" : ""}">${isAlert ? "🚨 " : "💬 "}${m.fromName}</span>
            <span class="msg-time">${time}</span>
            ${!m.read ? `<span class="msg-unread-dot"></span>` : ""}
          </div>
          <div class="msg-body">${m.text}</div>
        </div>`;
      })
      .join("");

    // Marcar como leídos al abrir la pestaña
    if (document.getElementById("tab-messages").classList.contains("active")) {
      markMessagesRead(snap.docs);
    }
  });
  unsubListeners.push(unsub);
}

async function markMessagesRead(docs) {
  for (const d of docs) {
    if (!d.data().read) await updateDoc(d.ref, { read: true });
  }
}

document
  .getElementById("btn-mark-all-read")
  .addEventListener("click", async () => {
    const q = query(
      collection(db, "messages"),
      where("toUid", "==", currentUser.uid),
      where("read", "==", false),
    );
    const snap = await getDocs(q);
    for (const d of snap.docs) await updateDoc(d.ref, { read: true });
    showToast("Todo marcado como leído");
  });

async function sendMessage(type) {
  const toUid = document.getElementById("msg-recipient").value;
  const text = document.getElementById("msg-text").value.trim();
  if (!toUid) {
    showToast("Seleccioná un destinatario");
    return;
  }
  if (!text) {
    showToast("Escribí un mensaje");
    return;
  }

  await addDoc(collection(db, "messages"), {
    fromUid: currentUser.uid,
    fromName: currentUser._displayName,
    toUid,
    text,
    type,
    read: false,
    createdAt: serverTimestamp(),
  });

  document.getElementById("msg-text").value = "";
  showToast(type === "alert" ? "🚨 Alerta enviada" : "💬 Mensaje enviado");
}

document
  .getElementById("btn-send-msg")
  .addEventListener("click", () => sendMessage("message"));
document
  .getElementById("btn-send-alert")
  .addEventListener("click", () => sendMessage("alert"));

// ══════════════════════════════════════════════
//  TABS
// ══════════════════════════════════════════════
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const tabId = btn.dataset.tab;
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(tabId).classList.add("active");
    // Marcar mensajes como leídos al abrir la pestaña
    if (tabId === "tab-messages") {
      const q = query(
        collection(db, "messages"),
        where("toUid", "==", currentUser.uid),
        where("read", "==", false),
      );
      getDocs(q).then((snap) => markMessagesRead(snap.docs));
    }
  });
});

// ══════════════════════════════════════════════
//  MODALES — cerrar
// ══════════════════════════════════════════════
document.querySelectorAll("[data-close]").forEach((btn) => {
  btn.addEventListener("click", () => closeModal(btn.dataset.close));
});
document.querySelectorAll(".modal-overlay").forEach((overlay) => {
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeModal(overlay.id);
  });
});

// ══════════════════════════════════════════════
//  AUTH
// ══════════════════════════════════════════════
document.getElementById("btn-login").addEventListener("click", async () => {
  const email = document.getElementById("inp-email").value.trim();
  const pass = document.getElementById("inp-pass").value;
  const errEl = document.getElementById("login-error");
  errEl.style.display = "none";
  showLoading("Iniciando sesión...");
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (e) {
    hideLoading();
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
    errEl.textContent = "Ingresá tu nombre.";
    errEl.style.display = "block";
    return;
  }
  showLoading("Creando tu cuenta...");
  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      displayName: name,
      email: email.toLowerCase(),
      sharing: false,
      lat: null,
      lng: null,
      lastSeen: serverTimestamp(),
      battery: null,
    });
  } catch (e) {
    hideLoading();
    errEl.textContent = translateError(e.code);
    errEl.style.display = "block";
  }
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  stopTracking();
  unsubListeners.forEach((fn) => fn());
  unsubListeners = [];
  await signOut(auth);
  showScreen("screen-login");
});

document
  .getElementById("btn-show-register")
  .addEventListener("click", () => showScreen("screen-register"));
document
  .getElementById("btn-show-login")
  .addEventListener("click", () => showScreen("screen-login"));

document.getElementById("toggle-sharing").addEventListener("change", (e) => {
  if (e.target.checked) startTracking();
  else stopTracking();
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    hideLoading();
    showScreen("screen-login");
    return;
  }

  showLoading("Cargando tu cuenta...");
  const profileSnap = await getDoc(doc(db, "users", user.uid));
  const profile = profileSnap.data() || {};
  const displayName = profile.displayName || user.email.split("@")[0];
  currentUser = { ...user, _displayName: displayName };

  // Header
  document.getElementById("user-name-header").textContent = displayName;
  const avEl = document.getElementById("user-avatar-header");
  avEl.textContent = initials(displayName);
  avEl.className = `user-avatar color-${getColor(user.uid).idx}`;

  showScreen("screen-app");
  initMap();
  initDeviceInfo();
  setTimeout(() => {
    map.invalidateSize();
  }, 100);
  // Primero cargar grupos (setea myGroupMemberUids), luego escuchar miembros
  //await renderGroups();
  listenGroups();
  listenGroupMembers();
  listenInvitations();
  listenMessages();

  if (profile.sharing) {
    document.getElementById("toggle-sharing").checked = true;
    startTracking();
  }

  hideLoading();
});

// ══════════════════════════════════════════════
//  ERRORES FIREBASE
// ══════════════════════════════════════════════
function translateError(code) {
  const map = {
    "auth/invalid-email": "Email inválido.",
    "auth/user-not-found": "No existe cuenta con ese email.",
    "auth/wrong-password": "Contraseña incorrecta.",
    "auth/email-already-in-use": "Ya existe una cuenta con ese email.",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres.",
    "auth/invalid-credential": "Email o contraseña incorrectos.",
    "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos.",
  };
  return map[code] || "Error inesperado. Intentá de nuevo.";
}
