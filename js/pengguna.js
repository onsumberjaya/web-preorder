let allUsers = [];
let allCabangUser = [];
let presenceData = {}; // { uid: {online, last_active} }, dari Realtime Database -- lihat js/presence.js

window.onAuthReady = function () {
  listenUsers();
  listenCabangForUsers();
  listenPresence();
};

// Fitur "Karyawan Online". Kalau databaseURL belum dikonfigurasi (rtdb ===
// null, lihat js/firebase-config.js), lewati diam-diam -- tabel akun tetap
// tampil normal, cuma tanpa kolom status online/offline-nya.
function listenPresence() {
  if (!rtdb) return;
  rtdb.ref("presence").on("value", (snap) => {
    presenceData = snap.val() || {};
    renderUsers();
  });
}

// "Online" kalau flagnya true DAN denyut terakhirnya masih dalam 2 menit
// terakhir -- bukan cuma flagnya saja. onDisconnect() Firebase memang sudah
// otomatis membalik flag ini ke false begitu koneksi putus, tapi jaga-jaga
// kalau ada kondisi aneh (mis. proses browser dibunuh paksa tanpa sempat
// kirim sinyal apapun), batas waktu ini jadi pengaman kedua.
function isUserOnline(uid) {
  const p = presenceData[uid];
  if (!p || !p.online) return false;
  return Date.now() - p.last_active < 2 * 60 * 1000;
}

function formatLastActive(uid) {
  const p = presenceData[uid];
  if (!p || !p.last_active) return "Belum pernah online";
  const diffMin = Math.round((Date.now() - p.last_active) / 60000);
  if (diffMin < 1) return "Baru saja aktif";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffJam = Math.round(diffMin / 60);
  if (diffJam < 24) return `${diffJam} jam lalu`;
  return `${Math.round(diffJam / 24)} hari lalu`;
}

function listenUsers() {
  db.collection("users").orderBy("full_name").onSnapshot(
    (snap) => {
      allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderUsers();
    },
    (err) => {
      showToast("Gagal memuat akun: " + friendlyFirebaseError(err), "error");
    }
  );
}

function listenCabangForUsers() {
  db.collection("cabang")
    .orderBy("nama")
    .onSnapshot(
      (snap) => {
        allCabangUser = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        fillCabangSelect("user-cabang-id");
        fillCabangSelect("edit-user-cabang-id");
        renderUsers();
      },
      (err) => {
        showToast("Gagal memuat cabang: " + friendlyFirebaseError(err), "error");
      }
    );
}

function fillCabangSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML =
    '<option value="">Pilih Cabang</option>' +
    allCabangUser
      .filter((c) => c.is_active !== false)
      .map((c) => `<option value="${c.id}">${escapeHtml(c.nama)}</option>`)
      .join("");
  if (Array.from(select.options).some((o) => o.value === currentValue)) select.value = currentValue;
}

function cabangNamaUser(cabangId) {
  const c = allCabangUser.find((x) => x.id === cabangId);
  return c ? c.nama : "Cabang tidak ditemukan";
}

// Dipanggil dari onchange dropdown Role di kedua form (tambah & edit) untuk
// menampilkan/menyembunyikan field pilih Cabang -- hanya wajib untuk Karyawan.
function toggleUserCabangField(roleSelectId, fieldDivId) {
  const role = document.getElementById(roleSelectId).value;
  document.getElementById(fieldDivId).style.display = role === "karyawan" ? "block" : "none";
}

const ROLE_BADGE = { owner: "badge-green", admin_kasir: "badge-yellow", karyawan: "badge-gray" };

function renderUsers() {
  const container = document.getElementById("user-list");
  if (allUsers.length === 0) {
    container.innerHTML = `<div class="card empty-state">Belum ada akun.</div>`;
    return;
  }
  const jumlahOnline = rtdb ? allUsers.filter((u) => isUserOnline(u.id)).length : 0;
  container.innerHTML = `
    ${
      rtdb
        ? `<div class="card" style="padding:12px 16px; margin-bottom:14px; display:flex; align-items:center; gap:8px; font-size:13px; color:var(--gray-600);">
            <span style="width:8px; height:8px; border-radius:50%; background:var(--brand-500); display:inline-block;"></span>
            <strong>${jumlahOnline}</strong> dari ${allUsers.length} akun sedang online
          </div>`
        : ""
    }
    <div class="card" style="padding:0;">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Nama</th><th>Username</th><th>Role</th><th>Status Akun</th>${rtdb ? "<th>Online</th>" : ""}<th></th></tr></thead>
          <tbody>
            ${allUsers
              .map((u) => {
                const online = isUserOnline(u.id);
                return `
              <tr>
                <td>${escapeHtml(u.full_name)}</td>
                <td>@${escapeHtml(u.username)}</td>
                <td>
                  <span class="badge ${ROLE_BADGE[u.role] || "badge-gray"}">${roleLabel(u.role)}</span>
                  ${u.role === "karyawan" ? `<div style="font-size:11px; color:var(--gray-400); margin-top:2px;">${escapeHtml(cabangNamaUser(u.cabang_id))}</div>` : ""}
                </td>
                <td><span class="badge ${u.is_active !== false ? "badge-green" : "badge-red"}">${u.is_active !== false ? "Aktif" : "Nonaktif"}</span></td>
                ${
                  rtdb
                    ? `<td>
                        <div style="display:flex; align-items:center; gap:6px; font-size:12.5px; color:${online ? "var(--brand-ink)" : "var(--gray-400)"};">
                          <span style="width:8px; height:8px; border-radius:50%; background:${online ? "var(--brand-500)" : "var(--gray-300)"}; flex-shrink:0;"></span>
                          ${online ? "Online" : escapeHtml(formatLastActive(u.id))}
                        </div>
                      </td>`
                    : ""
                }
                <td style="text-align:right; white-space:nowrap;">
                  <button class="btn-secondary btn-sm" onclick="openEditUserModal('${u.id}')">
                    Edit
                  </button>
                  <button class="btn-secondary btn-sm" onclick="toggleUserActive('${u.id}', ${u.is_active === false})">
                    ${u.is_active === false ? "Aktifkan" : "Nonaktifkan"}
                  </button>
                </td>
              </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
    </div>`;
}

function openUserModal() {
  document.getElementById("user-form").reset();
  document.getElementById("user-form-alert").innerHTML = "";
  toggleUserCabangField("user-role", "user-cabang-field");
  document.getElementById("user-modal").style.display = "flex";
}
function closeUserModal() {
  document.getElementById("user-modal").style.display = "none";
}

function openEditUserModal(id) {
  const u = allUsers.find((x) => x.id === id);
  if (!u) return;
  document.getElementById("edit-user-id").value = u.id;
  document.getElementById("edit-user-fullname").value = u.full_name || "";
  document.getElementById("edit-user-role").value = u.role || "admin_kasir";
  document.getElementById("edit-user-cabang-id").value = u.cabang_id || "";
  toggleUserCabangField("edit-user-role", "edit-user-cabang-field");
  document.getElementById("edit-user-form-alert").innerHTML = "";
  document.getElementById("edit-user-modal").style.display = "flex";
}
function closeEditUserModal() {
  document.getElementById("edit-user-modal").style.display = "none";
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("edit-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = document.getElementById("edit-user-id").value;
    const fullName = document.getElementById("edit-user-fullname").value.trim();
    const role = document.getElementById("edit-user-role").value;
    const cabangId = document.getElementById("edit-user-cabang-id").value;
    const alertBox = document.getElementById("edit-user-form-alert");
    const btn = document.getElementById("edit-user-submit-btn");
    alertBox.innerHTML = "";

    if (window.currentUserProfile && window.currentUserProfile.uid === id && role !== "owner") {
      alertBox.innerHTML = `<div class="alert alert-error">Anda tidak bisa mengubah role akun Anda sendiri dari Owner ke role lain.</div>`;
      return;
    }
    if (role === "karyawan" && !cabangId) {
      alertBox.innerHTML = `<div class="alert alert-error">Pilih cabang untuk akun Karyawan ini.</div>`;
      return;
    }

    btn.disabled = true;
    try {
      await db.collection("users").doc(id).update({
        full_name: fullName,
        role,
        cabang_id: role === "karyawan" ? cabangId : null,
      });
      showToast("Akun berhasil diperbarui.", "success");
      closeEditUserModal();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
});

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fullName = document.getElementById("user-fullname").value.trim();
    const username = document.getElementById("user-username").value.trim().toLowerCase();
    const password = document.getElementById("user-password").value;
    const role = document.getElementById("user-role").value;
    const cabangId = document.getElementById("user-cabang-id").value;
    const alertBox = document.getElementById("user-form-alert");
    const btn = document.getElementById("user-submit-btn");
    alertBox.innerHTML = "";

    if (role === "karyawan" && !cabangId) {
      alertBox.innerHTML = `<div class="alert alert-error">Pilih cabang untuk akun Karyawan ini.</div>`;
      return;
    }

    btn.disabled = true;

    // Pakai instance Firebase KEDUA supaya sesi login Owner saat ini tidak
    // ikut tergantikan oleh akun baru yang baru dibuat (batasan Firebase Auth
    // client-side: createUser otomatis login sebagai user itu di instance yang dipakai).
    let secondaryApp;
    try {
      secondaryApp = firebase.apps.find((a) => a.name === "Secondary") ||
        firebase.initializeApp(firebaseConfig, "Secondary");
      const secondaryAuth = secondaryApp.auth();
      const cred = await secondaryAuth.createUserWithEmailAndPassword(usernameToEmail(username), password);
      await db.collection("users").doc(cred.user.uid).set({
        username,
        full_name: fullName,
        role,
        cabang_id: role === "karyawan" ? cabangId : null,
        is_active: true,
        created_at: firebase.firestore.FieldValue.serverTimestamp(),
      });
      await secondaryAuth.signOut();
      showToast("Akun berhasil dibuat.", "success");
      closeUserModal();
    } catch (err) {
      alertBox.innerHTML = `<div class="alert alert-error">${friendlyFirebaseError(err)}</div>`;
    } finally {
      btn.disabled = false;
    }
  });
});

async function toggleUserActive(id, makeActive) {
  if (window.currentUserProfile && window.currentUserProfile.uid === id && !makeActive) {
    showToast("Anda tidak bisa menonaktifkan akun Anda sendiri.", "error");
    return;
  }
  try {
    await db.collection("users").doc(id).update({ is_active: makeActive });
    showToast(makeActive ? "Akun diaktifkan." : "Akun dinonaktifkan.", "success");
  } catch (err) {
    showToast(friendlyFirebaseError(err), "error");
  }
}
