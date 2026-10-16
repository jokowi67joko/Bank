// app.js
import { auth, db, googleProvider } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
  runTransaction,
  writeBatch,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// === IKON BADGE SVG (TANPA EMOJI) ===
const BADGE_ADMIN_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="#0052FF" aria-label="Verified Admin">
    <path d="M12 2L15.09 5.26L19.47 4.53L20.21 8.91L23.47 12L20.21 15.09L19.47 19.47L15.09 18.74L12 22L8.91 18.74L4.53 19.47L3.79 15.09L0.53 12L3.79 8.91L4.53 4.53L8.91 5.26L12 2Z"/>
    <path d="M9.5 12.5L11.2 14.2L15 10.4" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </svg>
`;

const BADGE_USER_SVG = `
  <svg viewBox="0 0 24 24" width="15" height="15" stroke="#52525B" stroke-width="2" fill="none" aria-label="User Badge">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
  </svg>
`;

// === STATE GLOBAL ===
let currentUser = null;
let currentUserProfile = null;
let unsubscribeListeners = [];
let allUsersCache = {};
let allAnggotaCache = [];
let selectedWeek = getCurrentISOWeek();

// === HELPER FORMAT RUPIAH & TANGGAL ===
function formatRupiah(nominal) {
  const angka = Number(nominal) || 0;
  const prefix = angka < 0 ? "-Rp " : "Rp ";
  return prefix + Math.abs(angka).toLocaleString("id-ID");
}

function getTodayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getCurrentISOWeek() {
  const date = new Date();
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target) / 604800000);
  return `${date.getFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

function getBadgeHTML(role) {
  return role === "admin" ? BADGE_ADMIN_SVG : BADGE_USER_SVG;
}

function showToast(message) {
  const toast = document.getElementById("toast-box");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

// === PROTEKSI GAMBAR DARI POPUP DOWNLOAD (BIARKAN TEKS BISA DISALIN) ===
document.addEventListener("contextmenu", (e) => {
  if (e.target.tagName === "IMG" || e.target.closest("svg")) {
    e.preventDefault();
  }
});

document.addEventListener("dragstart", (e) => {
  if (e.target.tagName === "IMG") {
    e.preventDefault();
  }
});

// === ELEMEN DOM ===
const authLoading = document.getElementById("auth-loading");
const authView = document.getElementById("auth-view");
const appView = document.getElementById("app-view");
const authForm = document.getElementById("auth-form");
const authAlert = document.getElementById("auth-alert");
const tabLogin = document.getElementById("tab-login");
const tabRegister = document.getElementById("tab-register");
const registerFields = document.getElementById("register-fields");
const btnSubmitAuth = document.getElementById("btn-submit-auth");

let isRegisterMode = false;

// Toggle Tab Masuk / Daftar
tabLogin.addEventListener("click", () => {
  isRegisterMode = false;
  tabLogin.classList.add("active");
  tabRegister.classList.remove("active");
  registerFields.classList.add("hidden");
  btnSubmitAuth.textContent = "Masuk ke Aplikasi";
  authAlert.classList.add("hidden");
});

tabRegister.addEventListener("click", () => {
  isRegisterMode = true;
  tabRegister.classList.add("active");
  tabLogin.classList.remove("active");
  registerFields.classList.remove("hidden");
  btnSubmitAuth.textContent = "Daftar Akun Baru";
  authAlert.classList.add("hidden");
});

// === PROSES LOGIN / REGISTER EMAIL & PASSWORD ===
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authAlert.classList.add("hidden");
  btnSubmitAuth.disabled = true;

  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  const namaInput = document.getElementById("auth-nama").value.trim();
  const kelasInput = document.getElementById("auth-kelas").value;

  try {
    if (isRegisterMode) {
      if (!namaInput) throw new Error("Nama lengkap wajib diisi.");
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      await ensureUserDocument(cred.user, namaInput, kelasInput);
    } else {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await ensureUserDocument(cred.user);
    }
    authForm.reset();
  } catch (err) {
    authAlert.textContent = terjemahkanErrorFirebase(err.code || err.message);
    authAlert.classList.remove("hidden");
  } finally {
    btnSubmitAuth.disabled = false;
  }
});

// === LOGIN DENGAN GOOGLE ===
document.getElementById("btn-google-login").addEventListener("click", async () => {
  authAlert.classList.add("hidden");
  try {
    const cred = await signInWithPopup(auth, googleProvider);
    await ensureUserDocument(cred.user);
  } catch (err) {
    authAlert.textContent = terjemahkanErrorFirebase(err.code || err.message);
    authAlert.classList.remove("hidden");
  }
});

function terjemahkanErrorFirebase(code) {
  if (code.includes("auth/invalid-credential") || code.includes("auth/wrong-password")) {
    return "Email atau kata sandi salah.";
  }
  if (code.includes("auth/email-already-in-use")) {
    return "Email sudah terdaftar. Silakan gunakan menu Masuk.";
  }
  if (code.includes("auth/popup-closed-by-user")) {
    return "Jendela login Google ditutup sebelum selesai.";
  }
  return code;
}

// === PASTIKAN DOKUMEN USER TERSIMPAN DI FIRESTORE ===
async function ensureUserDocument(user, customNama = null, customKelas = "Kelas 10-1") {
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    const defaultNama = customNama || user.displayName || user.email.split("@")[0];
    const newUserData = {
      nama: defaultNama,
      email: user.email,
      role: "user", // Default role adalah "user", ubah ke "admin" dari console Firestore untuk bendahara
      kelas: customKelas,
      badge: "user_verified",
      createdAt: serverTimestamp()
    };
    await setDoc(userRef, newUserData);
  }
}

// === LISTENER AUTH STATE ===
onAuthStateChanged(auth, async (user) => {
  clearAllListeners();

  if (!user) {
    currentUser = null;
    currentUserProfile = null;
    authLoading.classList.add("hidden");
    appView.classList.add("hidden");
    authView.classList.remove("hidden");
    return;
  }

  currentUser = user;
  await ensureUserDocument(user);
  startAppRealtimeListeners(user.uid);
});

function clearAllListeners() {
  unsubscribeListeners.forEach((unsub) => unsub());
  unsubscribeListeners = [];
}

// === INISIALISASI LISTENER REAL-TIME ===
function startAppRealtimeListeners(uid) {
  // 1. Listener Dokumen User Sendiri (Deteksi perubahan Role/Kelas secara real-time)
  const myUserRef = doc(db, "users", uid);
  const unsubMe = onSnapshot(myUserRef, (snap) => {
    if (!snap.exists()) return;
    currentUserProfile = { uid: snap.id, ...snap.data() };
    renderCurrentUserUI();
    authLoading.classList.add("hidden");
    authView.classList.add("hidden");
    appView.classList.remove("hidden");
  });
  unsubscribeListeners.push(unsubMe);

  // 2. Listener Real-time Uang Kas (kas/current)
  const kasRef = doc(db, "kas", "current");
  const unsubKas = onSnapshot(kasRef, (snap) => {
    const nominalEl = document.getElementById("display-uang-kas");
    const updatedEl = document.getElementById("kas-updated-at");

    if (snap.exists()) {
      const data = snap.data();
      nominalEl.textContent = formatRupiah(data.nominal || 0);
      if (data.updatedAt?.toDate) {
        updatedEl.textContent = data.updatedAt.toDate().toLocaleString("id-ID");
      } else {
        updatedEl.textContent = "Baru saja";
      }
    } else {
      nominalEl.textContent = "Rp 0";
      updatedEl.textContent = "Belum ada mutasi";
    }
  });
  unsubscribeListeners.push(unsubKas);

  // 3. Listener Log Transaksi (20 terbaru)
  const transaksiQuery = query(collection(db, "transaksi"), orderBy("timestamp", "desc"), limit(20));
  const unsubTransaksi = onSnapshot(transaksiQuery, (snap) => {
    const listEl = document.getElementById("transaksi-list");
    if (snap.empty) {
      listEl.innerHTML = `<p class="empty-state">Belum ada riwayat transaksi Uang Kas.</p>`;
      return;
    }

    listEl.innerHTML = "";
    snap.forEach((docSnap) => {
      const t = docSnap.data();
      const isPlus = t.aksi === "tambah";
      const waktu = t.timestamp?.toDate
        ? t.timestamp.toDate().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
        : "Baru saja";

      const judul = t.keterangan === "manual"
        ? `[Manual] ${escapeHTML(t.catatan || "Penyesuaian Uang Kas")}`
        : `Iuran Kas Mingguan — ${escapeHTML(t.nama || "Anggota")} (${escapeHTML(t.minggu || "-")})`;

      const item = document.createElement("div");
      item.className = "transaksi-item";
      item.innerHTML = `
        <div class="transaksi-info">
          <span class="transaksi-title">${judul}</span>
          <span class="transaksi-sub">${waktu}</span>
        </div>
        <span class="transaksi-nominal ${isPlus ? "nominal-plus" : "nominal-minus"}">
          ${isPlus ? "+" : "-"}${formatRupiah(t.nominal)}
        </span>
      `;
      listEl.appendChild(item);
    });
  });
  unsubscribeListeners.push(unsubTransaksi);

  // 4. Listener Daftar Anggota & Checklist Mingguan
  const anggotaQuery = query(collection(db, "anggota"), orderBy("nama", "asc"));
  const unsubAnggota = onSnapshot(anggotaQuery, (snap) => {
    allAnggotaCache = [];
    snap.forEach((d) => allAnggotaCache.push({ id: d.id, ...d.data() }));
    renderAnggotaChecklist();
  });
  unsubscribeListeners.push(unsubAnggota);

  // 5. Listener Direktori Semua User
  const usersQuery = query(collection(db, "users"));
  const unsubUsers = onSnapshot(usersQuery, (snap) => {
    allUsersCache = {};
    snap.forEach((d) => {
      allUsersCache[d.id] = { uid: d.id, ...d.data() };
    });
    renderUserDirectory();
  });
  unsubscribeListeners.push(unsubUsers);

  // 6. Listener Global/Kelas Chat (50 pesan terakhir)
  const chatQuery = query(collection(db, "chats"), orderBy("timestamp", "asc"), limit(50));
  const unsubChat = onSnapshot(chatQuery, (snap) => {
    renderChatMessages(snap);
  });
  unsubscribeListeners.push(unsubChat);

  // 7. Listener Kuota Chat Harian User Ini
  const todayKey = `${uid}_${getTodayDateString()}`;
  const limitRef = doc(db, "chatLimits", todayKey);
  const unsubLimit = onSnapshot(limitRef, (snap) => {
    const used = snap.exists() ? (snap.data().count || 0) : 0;
    const remaining = Math.max(0, 10 - used);
    document.getElementById("chat-limit-display").textContent = `${remaining} / 10`;
    const btnSend = document.getElementById("btn-send-chat");
    const inputChat = document.getElementById("input-chat");
    if (remaining <= 0) {
      btnSend.disabled = true;
      inputChat.disabled = true;
      inputChat.placeholder = "Batas 10 pesan hari ini telah habis.";
    } else {
      btnSend.disabled = false;
      inputChat.disabled = false;
      inputChat.placeholder = "Tulis pesan (maks. 100 karakter)...";
    }
  });
  unsubscribeListeners.push(unsubLimit);
}

// === RENDER TAMPILAN BERDASARKAN ROLE ("user" vs "admin") ===
function renderCurrentUserUI() {
  if (!currentUserProfile) return;
  const isAdmin = currentUserProfile.role === "admin";

  // Hotbar
  document.getElementById("header-user-name").textContent = currentUserProfile.nama;
  document.getElementById("header-kelas-pill").textContent = currentUserProfile.kelas || "Kelas 10-1";
  document.getElementById("header-user-badge").innerHTML = getBadgeHTML(currentUserProfile.role);

  // Tampilkan/Sembunyikan Menu Khusus Admin
  const navAnggota = document.getElementById("nav-admin-anggota");
  const navSaldo = document.getElementById("nav-admin-saldo");

  if (isAdmin) {
    navAnggota.classList.remove("hidden");
    navSaldo.classList.remove("hidden");
  } else {
    navAnggota.classList.add("hidden");
    navSaldo.classList.add("hidden");
  }

  // Isi Form Profile Sendiri
  document.getElementById("my-profile-avatar").textContent = (currentUserProfile.nama || "U")[0].toUpperCase();
  document.getElementById("my-profile-name").textContent = currentUserProfile.nama;
  document.getElementById("my-profile-badge").innerHTML = getBadgeHTML(currentUserProfile.role);
  document.getElementById("my-profile-email").textContent = currentUserProfile.email;
  document.getElementById("my-profile-role-label").textContent = `ROLE: ${currentUserProfile.role.toUpperCase()}`;
  document.getElementById("profile-input-nama").value = currentUserProfile.nama;
  document.getElementById("profile-select-kelas").value = currentUserProfile.kelas || "Kelas 10-1";
}

// === RENDER CHECKLIST ANGGOTA & RELASI OTOMATIS KE UANG KAS ===
const selectMingguEl = document.getElementById("select-minggu");
selectMingguEl.value = selectedWeek;
selectMingguEl.addEventListener("change", (e) => {
  if (e.target.value) {
    selectedWeek = e.target.value;
    renderAnggotaChecklist();
  }
});

function renderAnggotaChecklist() {
  const container = document.getElementById("anggota-checklist-container");
  const totalEl = document.getElementById("rekap-total-anggota");
  const sudahBayarEl = document.getElementById("rekap-sudah-bayar");
  const terkumpulEl = document.getElementById("rekap-terkumpul");

  totalEl.textContent = allAnggotaCache.length;

  if (allAnggotaCache.length === 0) {
    sudahBayarEl.textContent = "0";
    terkumpulEl.textContent = "Rp 0";
    container.innerHTML = `<p class="empty-state">Belum ada anggota kelas. Tambahkan anggota baru di atas.</p>`;
    return;
  }

  let countPaid = 0;
  container.innerHTML = "";

  allAnggotaCache.forEach((anggota) => {
    const isPaid = anggota.pembayaran && anggota.pembayaran[selectedWeek] === true;
    if (isPaid) countPaid++;

    const row = document.createElement("div");
    row.className = "anggota-row";
    row.innerHTML = `
      <div class="anggota-meta">
        <span class="anggota-nama">${escapeHTML(anggota.nama)}</span>
        <span class="anggota-kelas">${escapeHTML(anggota.kelas || "Kelas 10-1")}</span>
      </div>
      <label class="checklist-label ${isPaid ? "paid" : ""}">
        <input type="checkbox" data-id="${anggota.id}" ${isPaid ? "checked" : ""} />
        <span>${isPaid ? "Sudah Bayar (Rp 2.000)" : "Belum Bayar"}</span>
      </label>
    `;

    const checkbox = row.querySelector("input[type='checkbox']");
    checkbox.addEventListener("change", async (e) => {
      checkbox.disabled = true;
      await togglePembayaranMingguan(anggota.id, selectedWeek, e.target.checked);
      checkbox.disabled = false;
    });

    container.appendChild(row);
  });

  sudahBayarEl.textContent = `${countPaid} orang`;
  terkumpulEl.textContent = formatRupiah(countPaid * 2000);
}

// === TRANSAKSI ATOMIK CHECKLIST PEMBAYARAN -> UANG KAS (+/- Rp 2.000) ===
async function togglePembayaranMingguan(anggotaId, mingguKey, desiredState) {
  if (!currentUserProfile || currentUserProfile.role !== "admin") {
    showToast("Akses ditolak: Hanya Admin yang dapat mengubah checklist.");
    return;
  }

  const anggotaRef = doc(db, "anggota", anggotaId);
  const kasRef = doc(db, "kas", "current");
  const transaksiRef = doc(collection(db, "transaksi"));

  try {
    await runTransaction(db, async (transaction) => {
      const anggotaDoc = await transaction.get(anggotaRef);
      const kasDoc = await transaction.get(kasRef);

      if (!anggotaDoc.exists()) {
        throw new Error("Data anggota tidak ditemukan.");
      }

      const dataAnggota = anggotaDoc.data();
      const mapPembayaran = dataAnggota.pembayaran || {};
      const statusSebelumnya = mapPembayaran[mingguKey] === true;

      // Cegah double counting apabila status di database sudah sama dengan desiredState
      if (statusSebelumnya === desiredState) {
        return;
      }

      const nominalKasSekarang = kasDoc.exists() ? (Number(kasDoc.data().nominal) || 0) : 0;
      const selisih = desiredState ? 2000 : -2000;
      const nominalKasBaru = nominalKasSekarang + selisih;

      // 1. Update boolean pembayaran minggu tersebut pada dokumen anggota
      const pembayaranUpdated = { ...mapPembayaran, [mingguKey]: desiredState };
      transaction.update(anggotaRef, {
        pembayaran: pembayaranUpdated
      });

      // 2. Update nominal Uang Kas secara atomik
      transaction.set(kasRef, {
        nominal: nominalKasBaru,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      }, { merge: true });

      // 3. Catat log transaksi
      transaction.set(transaksiRef, {
        anggotaId: anggotaId,
        nama: dataAnggota.nama,
        minggu: mingguKey,
        aksi: desiredState ? "tambah" : "kurang",
        nominal: 2000,
        keterangan: "mingguan",
        oleh: currentUser.uid,
        timestamp: serverTimestamp()
      });
    });

    showToast(
      desiredState
        ? "Checklist disimpan: Uang Kas bertambah Rp 2.000"
        : "Checklist dibatalkan: Uang Kas dikurangi Rp 2.000"
    );
  } catch (err) {
    console.error("Gagal memproses transaksi checklist:", err);
    showToast("Gagal memperbarui status pembayaran.");
    renderAnggotaChecklist();
  }
}

// === TAMBAH ANGGOTA BARU (ADMIN) ===
document.getElementById("form-tambah-anggota").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUserProfile || currentUserProfile.role !== "admin") return;

  const inputNama = document.getElementById("input-nama-anggota");
  const inputKelas = document.getElementById("input-kelas-anggota");
  const nama = inputNama.value.trim();
  const kelas = inputKelas.value;

  if (!nama) return;

  try {
    const newAnggotaRef = doc(collection(db, "anggota"));
    await setDoc(newAnggotaRef, {
      nama,
      kelas,
      pembayaran: {},
      createdAt: serverTimestamp()
    });
    inputNama.value = "";
    showToast(`Anggota "${nama}" berhasil ditambahkan.`);
  } catch (err) {
    console.error(err);
    showToast("Gagal menambahkan anggota.");
  }
});

// === ATUR SALDO / UANG KAS MANUAL (ADMIN) ===
document.getElementById("form-atur-saldo").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUserProfile || currentUserProfile.role !== "admin") return;

  const aksi = document.getElementById("saldo-aksi").value;
  const nominalInput = Number(document.getElementById("saldo-nominal").value);
  const catatan = document.getElementById("saldo-catatan").value.trim();
  const btnSubmit = document.getElementById("btn-submit-saldo");

  if (!nominalInput || nominalInput <= 0 || !catatan) return;

  btnSubmit.disabled = true;
  const kasRef = doc(db, "kas", "current");
  const transaksiRef = doc(collection(db, "transaksi"));

  try {
    await runTransaction(db, async (transaction) => {
      const kasDoc = await transaction.get(kasRef);
      const currentNominal = kasDoc.exists() ? (Number(kasDoc.data().nominal) || 0) : 0;
      const delta = aksi === "tambah" ? nominalInput : -nominalInput;
      const updatedNominal = currentNominal + delta;

      transaction.set(kasRef, {
        nominal: updatedNominal,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid
      }, { merge: true });

      transaction.set(transaksiRef, {
        anggotaId: "-",
        nama: currentUserProfile.nama,
        minggu: "-",
        aksi: aksi,
        nominal: nominalInput,
        keterangan: "manual",
        catatan: catatan,
        oleh: currentUser.uid,
        timestamp: serverTimestamp()
      });
    });

    document.getElementById("form-atur-saldo").reset();
    showToast("Penyesuaian Uang Kas manual berhasil disimpan.");
  } catch (err) {
    console.error(err);
    showToast("Gagal menyimpan penyesuaian Uang Kas.");
  } finally {
    btnSubmit.disabled = false;
  }
});

// === FITUR CHAT DENGAN VALIDASI 100 KARAKTER & LIMIT 10 PESAN/HARI ===
const inputChatEl = document.getElementById("input-chat");
const charCountEl = document.getElementById("chat-char-count");

inputChatEl.addEventListener("input", () => {
  charCountEl.textContent = `${inputChatEl.value.length}/100`;
});

document.getElementById("form-chat").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser || !currentUserProfile) return;

  const pesan = inputChatEl.value.trim();
  if (!pesan || pesan.length > 100) return;

  const btnSend = document.getElementById("btn-send-chat");
  btnSend.disabled = true;

  const todayStr = getTodayDateString();
  const limitDocId = `${currentUser.uid}_${todayStr}`;
  const limitRef = doc(db, "chatLimits", limitDocId);
  const newChatRef = doc(collection(db, "chats"));

  try {
    await runTransaction(db, async (transaction) => {
      const limitSnap = await transaction.get(limitRef);
      const currentCount = limitSnap.exists() ? (Number(limitSnap.data().count) || 0) : 0;

      if (currentCount >= 10) {
        throw new Error("LIMIT_EXCEEDED");
      }

      // 1. Naikkan counter harian user
      transaction.set(limitRef, {
        uid: currentUser.uid,
        tanggal: todayStr,
        count: currentCount + 1
      });

      // 2. Simpan pesan chat beserta tanggal untuk diverifikasi oleh Firestore Security Rules
      transaction.set(newChatRef, {
        uid: currentUser.uid,
        nama: currentUserProfile.nama,
        role: currentUserProfile.role,
        kelas: currentUserProfile.kelas || "Kelas 10-1",
        pesan: pesan,
        tanggal: todayStr,
        timestamp: serverTimestamp()
      });
    });

    inputChatEl.value = "";
    charCountEl.textContent = "0/100";
  } catch (err) {
    if (err.message === "LIMIT_EXCEEDED") {
      showToast("Batas maksimal 10 pesan per hari telah tercapai.");
    } else {
      console.error(err);
      showToast("Gagal mengirim pesan.");
    }
  } finally {
    btnSend.disabled = false;
  }
});

function renderChatMessages(snap) {
  const box = document.getElementById("chat-messages");
  if (snap.empty) {
    box.innerHTML = `<p class="empty-state">Belum ada percakapan. Mulailah mengirim pesan!</p>`;
    return;
  }

  box.innerHTML = "";
  snap.forEach((docSnap) => {
    const c = docSnap.data();
    const isMine = currentUser && c.uid === currentUser.uid;
    const latestUser = allUsersCache[c.uid];
    const senderName = latestUser ? latestUser.nama : c.nama;
    const senderRole = latestUser ? latestUser.role : (c.role || "user");
    const senderKelas = latestUser ? latestUser.kelas : (c.kelas || "Kelas 10-1");

    const jam = c.timestamp?.toDate
      ? c.timestamp.toDate().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
      : "";

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isMine ? "mine" : ""}`;
    bubble.innerHTML = `
      <div class="chat-sender-bar" data-uid="${c.uid}">
        <span class="chat-sender-name">${escapeHTML(senderName)}</span>
        <span class="badge-slot">${getBadgeHTML(senderRole)}</span>
        <span class="chat-sender-kelas">(${escapeHTML(senderKelas)})</span>
      </div>
      <div class="chat-text">${escapeHTML(c.pesan)}</div>
      <span class="chat-time">${jam}</span>
    `;

    bubble.querySelector(".chat-sender-bar").addEventListener("click", () => {
      openUserProfileModal(c.uid);
    });

    box.appendChild(bubble);
  });

  box.scrollTop = box.scrollHeight;
}

// === UPDATE PROFIL & KELAS SENDIRI ===
document.getElementById("form-update-profile").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentUser) return;

  const namaBaru = document.getElementById("profile-input-nama").value.trim();
  const kelasBaru = document.getElementById("profile-select-kelas").value;
  if (!namaBaru) return;

  const btnSave = document.getElementById("btn-save-profile");
  btnSave.disabled = true;

  try {
    await updateDoc(doc(db, "users", currentUser.uid), {
      nama: namaBaru,
      kelas: kelasBaru
    });
    showToast("Profil dan kelas berhasil diperbarui.");
  } catch (err) {
    console.error(err);
    showToast("Gagal memperbarui profil.");
  } finally {
    btnSave.disabled = false;
  }
});

// === DIREKTORI & MODAL LIHAT PROFIL USER LAIN ===
function renderUserDirectory() {
  const listEl = document.getElementById("directory-user-list");
  const usersArr = Object.values(allUsersCache);

  if (usersArr.length === 0) {
    listEl.innerHTML = `<p class="empty-state">Belum ada pengguna.</p>`;
    return;
  }

  listEl.innerHTML = "";
  usersArr.forEach((u) => {
    const item = document.createElement("div");
    item.className = "directory-item";
    item.innerHTML = `
      <div class="directory-left">
        <div class="avatar-circle">${(u.nama || "U")[0].toUpperCase()}</div>
        <div>
          <div class="name-with-badge">
            <strong>${escapeHTML(u.nama)}</strong>
            ${getBadgeHTML(u.role)}
          </div>
          <span class="anggota-kelas">${escapeHTML(u.kelas || "Kelas 10-1")}</span>
        </div>
      </div>
      <span class="role-tag">${(u.role || "user").toUpperCase()}</span>
    `;
    item.addEventListener("click", () => openUserProfileModal(u.uid));
    listEl.appendChild(item);
  });
}

function openUserProfileModal(targetUid) {
  const userObj = allUsersCache[targetUid];
  if (!userObj) {
    showToast("Data profil pengguna tidak ditemukan.");
    return;
  }

  document.getElementById("modal-user-avatar").textContent = (userObj.nama || "U")[0].toUpperCase();
  document.getElementById("modal-user-name").textContent = userObj.nama;
  document.getElementById("modal-user-badge").innerHTML = getBadgeHTML(userObj.role);
  document.getElementById("modal-user-role").textContent = `ROLE: ${(userObj.role || "user").toUpperCase()}`;
  document.getElementById("modal-user-kelas").textContent = userObj.kelas || "Kelas 10-1";
  document.getElementById("modal-user-email").textContent = userObj.email || "-";
  document.getElementById("modal-user-badge-text").textContent =
    userObj.role === "admin" ? "Verified Bendahara (Centang Biru)" : "Anggota Kelas Terdaftar";

  document.getElementById("user-modal-overlay").classList.remove("hidden");
}

document.getElementById("btn-close-modal").addEventListener("click", () => {
  document.getElementById("user-modal-overlay").classList.add("hidden");
});

document.getElementById("user-modal-overlay").addEventListener("click", (e) => {
  if (e.target.id === "user-modal-overlay") {
    e.currentTarget.classList.add("hidden");
  }
});

// === NAVIGASI ANTAR MENU & DRAWER HAMBURGER ===
const navButtons = document.querySelectorAll(".nav-item");
const viewSections = document.querySelectorAll(".view-section");

function switchSection(targetId) {
  navButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.target === targetId);
  });
  viewSections.forEach((sec) => {
    sec.classList.toggle("hidden", sec.id !== targetId);
  });
}

navButtons.forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.target));
});

document.getElementById("hotbar-user-btn").addEventListener("click", () => {
  switchSection("section-profile");
});

// Hamburger Drawer
const sideDrawer = document.getElementById("side-drawer");
const drawerOverlay = document.getElementById("drawer-overlay");

function toggleDrawer(open) {
  sideDrawer.classList.toggle("open", open);
  drawerOverlay.classList.toggle("hidden", !open);
}

document.getElementById("btn-open-drawer").addEventListener("click", () => toggleDrawer(true));
document.getElementById("btn-close-drawer").addEventListener("click", () => toggleDrawer(false));
drawerOverlay.addEventListener("click", () => toggleDrawer(false));

// Logout
document.getElementById("btn-logout").addEventListener("click", async () => {
  toggleDrawer(false);
  await signOut(auth);
});

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
