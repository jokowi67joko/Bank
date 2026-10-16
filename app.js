// app.js
import { auth, db, storage } from "./firebase-config.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy,
  limit,
  serverTimestamp,
  runTransaction,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

// STATE GLOBAL APLIKASI
let currentUser = null;
let currentUserData = null;
let isAdmin = false;

let kasSettings = {
  balance: 0,
  feeAmount: 2000,
  scheduleMode: "weekly", // "weekly" | "daily"
  feeHistory: []
};

let periodOffset = 0; // 0 = minggu/hari berjalan
let membersCache = [];
let paymentsCache = {};
let usersDirectoryCache = {};
let selectedLogIds = new Set();
let pendingPhotoFile = null;

// SVG BADGES
const ADMIN_BADGE_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="#1d4ed8" style="vertical-align:middle"><path d="M12 2l2.4 2.4 3.4-.4.8 3.3 3.1 1.5-1.1 3.2 1.1 3.2-3.1 1.5-.8 3.3-3.4-.4L12 22l-2.4-2.4-3.4.4-.8-3.3-3.1-1.5 1.1-3.2-1.1-3.2 3.1-1.5.8-3.3 3.4.4L12 2zm-1.1 13.4l6-6-1.4-1.4-4.6 4.6-2.2-2.2-1.4 1.4 3.6 3.6z"/></svg>`;
const USER_BADGE_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" style="vertical-align:middle"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

// HELPER FORMAT RUPIAH
function formatRupiah(num) {
  return "Rp " + Number(num || 0).toLocaleString("id-ID");
}

// HELPER TOAST
function showToast(msg, isError = false) {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast ${isError ? "error" : ""}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

// HELPER RENDER AVATAR (FOTO PROFIL ATAU INISIAL HURUF)
function renderAvatarElement(containerEl, name, photoURL) {
  if (!containerEl) return;
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  if (photoURL) {
    containerEl.innerHTML = `<img src="${photoURL}" alt="${name}" />`;
  } else {
    containerEl.textContent = initial;
  }
}

function createAvatarHTML(name, photoURL, sizeClass = "avatar-sm") {
  const initial = (name || "U").trim().charAt(0).toUpperCase();
  if (photoURL) {
    return `<div class="avatar ${sizeClass}"><img src="${photoURL}" alt="${name}" /></div>`;
  }
  return `<div class="avatar ${sizeClass}">${initial}</div>`;
}

// =====================================================
// 1. INISIALISASI CUSTOM DROPDOWN (PENGGANTI <select>)
// =====================================================
function initCustomDropdowns() {
  const dropdowns = document.querySelectorAll(".custom-dropdown");

  dropdowns.forEach((dropdown) => {
    const trigger = dropdown.querySelector(".dropdown-trigger");
    const label = dropdown.querySelector(".dropdown-label");
    const items = dropdown.querySelectorAll(".dropdown-item");

    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains("open");
      closeAllDropdowns();
      if (!isOpen) dropdown.classList.add("open");
    });

    items.forEach((item) => {
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        const val = item.getAttribute("data-value");
        const text = item.textContent;

        dropdown.setAttribute("data-value", val);
        label.textContent = text;

        items.forEach((i) => i.classList.remove("selected"));
        item.classList.add("selected");
        dropdown.classList.remove("open");

        dropdown.dispatchEvent(new CustomEvent("change", { detail: { value: val, label: text } }));
      });
    });
  });

  document.addEventListener("click", closeAllDropdowns);
}

function closeAllDropdowns() {
  document.querySelectorAll(".custom-dropdown.open").forEach((d) => d.classList.remove("open"));
}

function setDropdownValue(dropdownId, value) {
  const dropdown = document.getElementById(dropdownId);
  if (!dropdown) return;
  const label = dropdown.querySelector(".dropdown-label");
  const items = dropdown.querySelectorAll(".dropdown-item");
  items.forEach((item) => {
    if (item.getAttribute("data-value") === value) {
      item.classList.add("selected");
      dropdown.setAttribute("data-value", value);
      if (label) label.textContent = item.textContent;
    } else {
      item.classList.remove("selected");
    }
  });
}

function getDropdownValue(dropdownId) {
  const dropdown = document.getElementById(dropdownId);
  return dropdown ? dropdown.getAttribute("data-value") : "";
}

// =====================================================
// 2. MODAL KONFIRMASI HAPUS
// =====================================================
let confirmCallback = null;
const confirmModal = document.getElementById("confirm-modal");

function openConfirmModal(title, message, onConfirm) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  confirmCallback = onConfirm;
  confirmModal.classList.remove("hidden");
}

document.getElementById("confirm-cancel-btn").addEventListener("click", () => {
  confirmModal.classList.add("hidden");
  confirmCallback = null;
});

document.getElementById("confirm-ok-btn").addEventListener("click", async () => {
  confirmModal.classList.add("hidden");
  if (typeof confirmCallback === "function") {
    await confirmCallback();
    confirmCallback = null;
  }
});

// =====================================================
// 3. SISTEM PERIODE (MINGGUAN 6 HARI vs HARIAN SENIN-SABTU)
// =====================================================
function getActiveSchoolDate(offsetDays = 0) {
  const now = new Date();
  // Jika hari ini Minggu (0), geser ke Sabtu kemarin
  if (now.getDay() === 0) {
    now.setDate(now.getDate() - 1);
  }
  // Geser berdasarkan offset hari sekolah (lompati hari Minggu)
  let steps = offsetDays;
  const dir = steps >= 0 ? 1 : -1;
  steps = Math.abs(steps);
  while (steps > 0) {
    now.setDate(now.getDate() + dir);
    if (now.getDay() !== 0) {
      steps--;
    }
  }
  return now;
}

function getActivePeriodInfo() {
  if (kasSettings.scheduleMode === "daily") {
    const d = getActiveSchoolDate(periodOffset);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const dayNames = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    return {
      key: `DAILY_${yyyy}-${mm}-${dd}`,
      label: `${dayNames[d.getDay()]}, ${dd}/${mm}/${yyyy}`
    };
  } else {
    // Mode Mingguan (Senin - Sabtu dalam minggu tersebut)
    const now = new Date();
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday + periodOffset * 7);

    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);

    const yyyy = monday.getFullYear();
    const mm = String(monday.getMonth() + 1).padStart(2, "0");
    const dd = String(monday.getDate()).padStart(2, "0");

    const satDd = String(saturday.getDate()).padStart(2, "0");
    const satMm = String(saturday.getMonth() + 1).padStart(2, "0");

    return {
      key: `WEEKLY_${yyyy}-${mm}-${dd}`,
      label: `Senin ${dd}/${mm} – Sabtu ${satDd}/${satMm}/${yyyy}`
    };
  }
}

// =====================================================
// 4. AUTHENTICATION & NORMALISASI KELAS (10, 11, 12)
// =====================================================
function normalizeKelas(rawKelas) {
  if (!rawKelas) return "Kelas 10";
  if (rawKelas.startsWith("Kelas 11")) return "Kelas 11";
  if (rawKelas.startsWith("Kelas 12")) return "Kelas 12";
  return "Kelas 10";
}

onAuthStateChanged(auth, async (user) => {
  const loadingOverlay = document.getElementById("loading-overlay");
  const authView = document.getElementById("auth-view");
  const appView = document.getElementById("app-view");

  if (!user) {
    currentUser = null;
    currentUserData = null;
    authView.classList.remove("hidden");
    appView.classList.add("hidden");
    loadingOverlay.classList.add("hidden");
    return;
  }

  currentUser = user;
  const userRef = doc(db, "users", user.uid);
  const snap = await getDoc(userRef);

  if (!snap.exists()) {
    const defaultName = user.displayName || user.email.split("@")[0];
    const newDoc = {
      nama: defaultName,
      email: user.email,
      kelas: "Kelas 10",
      role: "user",
      photoURL: user.photoURL || "",
      createdAt: serverTimestamp()
    };
    await setDoc(userRef, newDoc);
    currentUserData = newDoc;
  } else {
    const data = snap.data();
    const fixedKelas = normalizeKelas(data.kelas);
    if (fixedKelas !== data.kelas) {
      await updateDoc(userRef, { kelas: fixedKelas });
    }
    currentUserData = { ...data, kelas: fixedKelas };
  }

  isAdmin = currentUserData.role === "admin";
  setupAppUI();
  startRealtimeListeners();

  authView.classList.add("hidden");
  appView.classList.remove("hidden");
  loadingOverlay.classList.add("hidden");
});

function setupAppUI() {
  // Tampilkan tab khusus Admin jika role === admin
  document.querySelectorAll(".admin-only").forEach((el) => {
    if (isAdmin) el.classList.remove("hidden");
    else el.classList.add("hidden");
  });

  // Update Header & Profile
  document.getElementById("header-username").textContent = currentUserData.nama;
  document.getElementById("header-kelas-badge").textContent = currentUserData.kelas;
  document.getElementById("header-role-icon").innerHTML = isAdmin ? ADMIN_BADGE_SVG : USER_BADGE_SVG;
  renderAvatarElement(document.getElementById("header-avatar"), currentUserData.nama, currentUserData.photoURL);

  document.getElementById("profile-display-name").textContent = currentUserData.nama;
  document.getElementById("profile-email-text").textContent = currentUserData.email;
  document.getElementById("profile-badge-icon").innerHTML = isAdmin ? ADMIN_BADGE_SVG : USER_BADGE_SVG;
  document.getElementById("profile-role-tag").textContent = `ROLE: ${(currentUserData.role || "user").toUpperCase()}`;
  document.getElementById("profile-name-input").value = currentUserData.nama;
  setDropdownValue("dropdown-profile-kelas", currentUserData.kelas);
  renderAvatarElement(document.getElementById("profile-avatar-preview"), currentUserData.nama, currentUserData.photoURL);
}

// =====================================================
// 5. REAL-TIME FIRESTORE LISTENERS
// =====================================================
function startRealtimeListeners() {
  // 5.1 Listener Pengaturan Kas & Saldo Utama
  onSnapshot(doc(db, "app_config", "kas_main"), async (snap) => {
    if (!snap.exists()) {
      const initialConfig = {
        balance: 0,
        feeAmount: 2000,
        scheduleMode: "weekly",
        feeHistory: [
          {
            amount: 2000,
            mode: "weekly",
            changedAt: new Date().toISOString(),
            changedBy: "Sistem"
          }
        ]
      };
      await setDoc(doc(db, "app_config", "kas_main"), initialConfig);
      return;
    }

    const data = snap.data();
    kasSettings = {
      balance: Number(data.balance || 0),
      feeAmount: Number(data.feeAmount || 2000),
      scheduleMode: data.scheduleMode || "weekly",
      feeHistory: Array.isArray(data.feeHistory) ? data.feeHistory : []
    };

    document.getElementById("total-kas-amount").textContent = formatRupiah(kasSettings.balance);
    const modeText = kasSettings.scheduleMode === "daily" ? "Hari Sekolah (Senin–Sabtu)" : "Minggu (6 Hari Sekolah)";
    document.getElementById("kas-schedule-info").textContent = `Iuran: ${formatRupiah(kasSettings.feeAmount)} / ${modeText}`;

    // Update form pengaturan di tab Atur Saldo
    document.getElementById("fee-amount-input").value = kasSettings.feeAmount;
    setDropdownValue("dropdown-fee-schedule", kasSettings.scheduleMode);
    renderFeeHistory();
    renderMembersChecklist();
  });

  // 5.2 Listener Log Transaksi
  const logsQuery = query(collection(db, "transactions"), orderBy("createdAt", "desc"), limit(50));
  onSnapshot(logsQuery, (snap) => {
    const logs = [];
    snap.forEach((d) => logs.push({ id: d.id, ...d.data() }));
    renderLogsList(logs);
  });

  // 5.3 Listener Anggota Kelas
  const membersQuery = query(collection(db, "members"), orderBy("name", "asc"));
  onSnapshot(membersQuery, (snap) => {
    membersCache = [];
    snap.forEach((d) => membersCache.push({ id: d.id, ...d.data() }));
    renderMembersChecklist();
  });

  // 5.4 Listener Data Pembayaran Anggota
  onSnapshot(collection(db, "member_payments"), (snap) => {
    paymentsCache = {};
    snap.forEach((d) => {
      paymentsCache[d.id] = d.data();
    });
    renderMembersChecklist();
  });

  // 5.5 Listener Direktori Pengguna
  onSnapshot(collection(db, "users"), (snap) => {
    usersDirectoryCache = {};
    const list = [];
    snap.forEach((d) => {
      const u = { id: d.id, ...d.data(), kelas: normalizeKelas(d.data().kelas) };
      usersDirectoryCache[d.id] = u;
      list.push(u);
    });
    renderRegisteredUsers(list);
  });

  // 5.6 Listener Pesan Chat
  const chatQuery = query(collection(db, "chats"), orderBy("createdAt", "asc"), limit(100));
  onSnapshot(chatQuery, (snap) => {
    const msgs = [];
    snap.forEach((d) => msgs.push({ id: d.id, ...d.data() }));
    renderChatMessages(msgs);
  });
}

// =====================================================
// 6. RENDER & KELOLA LOG TRANSAKSI (SINGLE & BULK DELETE)
// =====================================================
function renderLogsList(logs) {
  const container = document.getElementById("logs-list");
  const lastUpdateEl = document.getElementById("kas-last-update");

  if (logs.length === 0) {
    container.innerHTML = `<p class="empty-state">Belum ada riwayat transaksi Uang Kas.</p>`;
    lastUpdateEl.textContent = "Belum ada mutasi";
    return;
  }

  const newest = logs[0];
  lastUpdateEl.textContent = `Update: ${newest.description || "Transaksi baru"}`;

  container.innerHTML = "";
  logs.forEach((log) => {
    const isPlus = log.type === "add";
    const checked = selectedLogIds.has(log.id) ? "checked" : "";
    const dateStr = log.createdAt?.toDate
      ? log.createdAt.toDate().toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
      : "Baru saja";

    const row = document.createElement("div");
    row.className = "log-item";
    row.innerHTML = `
      <div class="log-left">
        ${isAdmin ? `<input type="checkbox" class="log-checkbox" data-id="${log.id}" ${checked} />` : ""}
        <div>
          <div class="log-desc">${log.description}</div>
          <div class="log-time">${dateStr} • Oleh ${log.actorName || "Admin"}</div>
        </div>
      </div>
      <div class="log-right">
        <span class="log-amount ${isPlus ? "plus" : "minus"}">
          ${isPlus ? "+" : "-"} ${formatRupiah(log.amount)}
        </span>
        ${isAdmin ? `<button type="button" class="btn btn-danger-outline btn-sm delete-single-log-btn" data-id="${log.id}">Hapus</button>` : ""}
      </div>
    `;
    container.appendChild(row);
  });

  // Event checkbox pilih log
  container.querySelectorAll(".log-checkbox").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-id");
      if (e.target.checked) selectedLogIds.add(id);
      else selectedLogIds.delete(id);
      updateBulkDeleteButtonState();
    });
  });

  // Event hapus 1 log
  container.querySelectorAll(".delete-single-log-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-id");
      openConfirmModal(
        "Hapus Log Transaksi",
        "Apakah Anda yakin ingin menghapus catatan riwayat transaksi ini secara permanen?",
        async () => {
          await deleteDoc(doc(db, "transactions", id));
          selectedLogIds.delete(id);
          updateBulkDeleteButtonState();
          showToast("Log transaksi berhasil dihapus.");
        }
      );
    });
  });
}

function updateBulkDeleteButtonState() {
  const btn = document.getElementById("delete-selected-logs-btn");
  if (!btn) return;
  btn.textContent = `Hapus Terpilih (${selectedLogIds.size})`;
  btn.disabled = selectedLogIds.size === 0;
}

document.getElementById("select-all-logs-btn")?.addEventListener("click", () => {
  const checkboxes = document.querySelectorAll(".log-checkbox");
  const allSelected = selectedLogIds.size === checkboxes.length && checkboxes.length > 0;
  selectedLogIds.clear();
  checkboxes.forEach((cb) => {
    cb.checked = !allSelected;
    if (!allSelected) selectedLogIds.add(cb.getAttribute("data-id"));
  });
  updateBulkDeleteButtonState();
});

document.getElementById("delete-selected-logs-btn")?.addEventListener("click", () => {
  if (selectedLogIds.size === 0) return;
  openConfirmModal(
    "Hapus Banyak Log Sekaligus",
    `Anda akan menghapus ${selectedLogIds.size} riwayat transaksi yang dipilih secara permanen. Lanjutkan?`,
    async () => {
      const batch = writeBatch(db);
      selectedLogIds.forEach((id) => {
        batch.delete(doc(db, "transactions", id));
      });
      await batch.commit();
      selectedLogIds.clear();
      updateBulkDeleteButtonState();
      showToast(" Seluruh log terpilih berhasil dihapus.");
    }
  );
});

// =====================================================
// 7. CHECKLIST ANGGOTA & HAPUS ANGGOTA BESERTA DATANYA
// =====================================================
function renderMembersChecklist() {
  const container = document.getElementById("members-checklist-container");
  if (!container) return;

  const period = getActivePeriodInfo();
  document.getElementById("current-period-label").textContent = period.label;
  document.getElementById("checklist-subtitle").textContent =
    kasSettings.scheduleMode === "daily"
      ? `Mode: Per Hari Sekolah (Senin–Sabtu) • Nominal Saat Ini: ${formatRupiah(kasSettings.feeAmount)}`
      : `Mode: Per Minggu (1x dalam 6 hari sekolah) • Nominal Saat Ini: ${formatRupiah(kasSettings.feeAmount)}`;

  if (membersCache.length === 0) {
    container.innerHTML = `<p class="empty-state">Belum ada anggota kelas. Tambahkan anggota melalui form di atas.</p>`;
    return;
  }

  container.innerHTML = "";
  membersCache.forEach((member) => {
    const paymentDocId = `${period.key}_${member.id}`;
    const paymentRecord = paymentsCache[paymentDocId];
    const isPaid = Boolean(paymentRecord?.paid);
    const recordedAmount = paymentRecord?.amount || kasSettings.feeAmount;

    const row = document.createElement("div");
    row.className = "member-row";
    row.innerHTML = `
      <div class="member-info">
        <span class="member-name">${member.name}</span>
        <span class="member-sub">${normalizeKelas(member.kelas)} • ${
      isPaid ? `Sudah bayar (${formatRupiah(recordedAmount)})` : `Belum bayar (${formatRupiah(kasSettings.feeAmount)})`
    }</span>
      </div>
      <div class="member-actions">
        ${isPaid ? `<span class="status-paid-badge">Lunas</span>` : ""}
        <button type="button" class="btn ${isPaid ? "btn-secondary" : "btn-primary"} btn-sm toggle-pay-btn">
          ${isPaid ? "Batalkan Centang" : "✓ Tandai Lunas"}
        </button>
        <button type="button" class="btn btn-danger btn-sm delete-member-btn">Hapus Anggota</button>
      </div>
    `;

    // Tombol Toggle Bayar / Uncheck (menyimpan & mengembalikan sesuai nominal saat transaksi)
    row.querySelector(".toggle-pay-btn").addEventListener("click", async () => {
      await toggleMemberPayment(member, period, isPaid, recordedAmount);
    });

    // Tombol Hapus Anggota beserta riwayat checklist pembayarannya
    row.querySelector(".delete-member-btn").addEventListener("click", () => {
      openConfirmModal(
        "Hapus Anggota Kelas",
        `Apakah Anda yakin ingin menghapus "${member.name}" beserta seluruh data checklist pembayarannya?`,
        async () => {
          const batch = writeBatch(db);
          batch.delete(doc(db, "members", member.id));

          Object.keys(paymentsCache).forEach((key) => {
            if (paymentsCache[key]?.memberId === member.id) {
              batch.delete(doc(db, "member_payments", key));
            }
          });

          await batch.commit();
          showToast(`Anggota ${member.name} dan data checklist-nya telah dihapus.`);
        }
      );
    });

    container.appendChild(row);
  });
}

async function toggleMemberPayment(member, period, currentlyPaid, recordedAmount) {
  const paymentDocId = `${period.key}_${member.id}`;
  const paymentRef = doc(db, "member_payments", paymentDocId);
  const configRef = doc(db, "app_config", "kas_main");

  try {
    const activeFee = Number(kasSettings.feeAmount || 2000);
    const deltaAmount = currentlyPaid ? Number(recordedAmount) : activeFee;

    await runTransaction(db, async (transaction) => {
      const configSnap = await transaction.get(configRef);
      const currentBal = Number(configSnap.data()?.balance || 0);
      const newBal = currentlyPaid ? Math.max(0, currentBal - deltaAmount) : currentBal + deltaAmount;

      transaction.update(configRef, { balance: newBal });

      if (currentlyPaid) {
        transaction.delete(paymentRef);
      } else {
        transaction.set(paymentRef, {
          memberId: member.id,
          memberName: member.name,
          periodKey: period.key,
          periodLabel: period.label,
          paid: true,
          amount: activeFee,
          paidAt: serverTimestamp()
        });
      }
    });

    await addDoc(collection(db, "transactions"), {
      type: currentlyPaid ? "subtract" : "add",
      amount: deltaAmount,
      description: currentlyPaid
        ? `Pembatalan iuran: ${member.name} (${period.label})`
        : `Iuran kas lunas: ${member.name} (${period.label})`,
      actorName: currentUserData.nama,
      createdAt: serverTimestamp()
    });

    showToast(
      currentlyPaid
        ? `Pembayaran ${member.name} dibatalkan (-${formatRupiah(deltaAmount)})`
        : `${member.name} ditandai lunas (+${formatRupiah(deltaAmount)})`
    );
  } catch (err) {
    showToast("Gagal memperbarui pembayaran: " + err.message, true);
  }
}

document.getElementById("prev-period-btn")?.addEventListener("click", () => {
  periodOffset -= 1;
  renderMembersChecklist();
});

document.getElementById("next-period-btn")?.addEventListener("click", () => {
  periodOffset += 1;
  renderMembersChecklist();
});

document.getElementById("add-member-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("member-name-input");
  const name = nameInput.value.trim();
  const kelas = getDropdownValue("dropdown-member-kelas");
  if (!name) return;

  await addDoc(collection(db, "members"), {
    name,
    kelas,
    createdAt: serverTimestamp()
  });
  nameInput.value = "";
  showToast(`Anggota "${name}" berhasil ditambahkan.`);
});

// =====================================================
// 8. PENGATURAN IURAN & PENYESUAIAN SALDO MANUAL
// =====================================================
function renderFeeHistory() {
  const container = document.getElementById("fee-history-list");
  if (!container) return;
  const history = kasSettings.feeHistory || [];
  if (history.length === 0) {
    container.innerHTML = `<p class="empty-state-sm">Belum ada riwayat perubahan nominal.</p>`;
    return;
  }

  container.innerHTML = "";
  [...history].reverse().slice(0, 8).forEach((item) => {
    const modeLabel = item.mode === "daily" ? "Per Hari (Senin–Sabtu)" : "Per Minggu (6 Hari Sekolah)";
    const dateText = item.changedAt
      ? new Date(item.changedAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" })
      : "-";
    const div = document.createElement("div");
    div.className = "fee-history-item";
    div.innerHTML = `
      <span><strong>${formatRupiah(item.amount)}</strong> • ${modeLabel}</span>
      <span>${dateText} (${item.changedBy || "Admin"})</span>
    `;
    container.appendChild(div);
  });
}

document.getElementById("fee-settings-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const newFee = Number(document.getElementById("fee-amount-input").value);
  const newMode = getDropdownValue("dropdown-fee-schedule");

  if (!newFee || newFee < 500) {
    showToast("Nominal iuran minimal Rp 500.", true);
    return;
  }

  const updatedHistory = [
    ...(kasSettings.feeHistory || []),
    {
      amount: newFee,
      mode: newMode,
      changedAt: new Date().toISOString(),
      changedBy: currentUserData.nama
    }
  ];

  await updateDoc(doc(db, "app_config", "kas_main"), {
    feeAmount: newFee,
    scheduleMode: newMode,
    feeHistory: updatedHistory
  });

  periodOffset = 0;
  showToast("Pengaturan nominal iuran & jadwal berhasil disimpan.");
});

document.getElementById("manual-balance-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const type = getDropdownValue("dropdown-adjust-type");
  const amount = Number(document.getElementById("adjust-amount-input").value);
  const note = document.getElementById("adjust-note-input").value.trim();

  if (!amount || amount <= 0 || !note) return;

  const configRef = doc(db, "app_config", "kas_main");
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(configRef);
    const cur = Number(snap.data()?.balance || 0);
    const next = type === "add" ? cur + amount : Math.max(0, cur - amount);
    tx.update(configRef, { balance: next });
  });

  await addDoc(collection(db, "transactions"), {
    type,
    amount,
    description: note,
    actorName: currentUserData.nama,
    createdAt: serverTimestamp()
  });

  document.getElementById("adjust-amount-input").value = "";
  document.getElementById("adjust-note-input").value = "";
  showToast("Penyesuaian saldo uang kas berhasil disimpan.");
});

// =====================================================
// 9. UPLOAD FOTO PROFIL (FIREBASE STORAGE + VALIDASI)
// =====================================================
const photoInput = document.getElementById("profile-photo-input");
const choosePhotoBtn = document.getElementById("choose-photo-btn");
const uploadPhotoBtn = document.getElementById("upload-photo-btn");
const fileHintEl = document.getElementById("selected-file-name");

choosePhotoBtn?.addEventListener("click", () => photoInput.click());

photoInput?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const validTypes = ["image/jpeg", "image/png", "image/webp"];
  if (!validTypes.includes(file.type)) {
    showToast("Format file harus berupa gambar JPG, PNG, atau WebP.", true);
    photoInput.value = "";
    return;
  }

  const maxSizeBytes = 2 * 1024 * 1024; // 2 MB
  if (file.size > maxSizeBytes) {
    showToast("Ukuran gambar maksimal 2 MB.", true);
    photoInput.value = "";
    return;
  }

  pendingPhotoFile = file;
  fileHintEl.textContent = `Terpilih: ${file.name} (${(file.size / 1024).toFixed(0)} KB)`;
  uploadPhotoBtn.classList.remove("hidden");
});

// Helper kompresi gambar agar hemat kuota & cepat dimuat di Chat
function compressImageToDataURL(file, maxDim = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        let w = img.width;
        let h = img.height;
        if (w > h && w > maxDim) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else if (h > maxDim) {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = ev.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

uploadPhotoBtn?.addEventListener("click", async () => {
  if (!pendingPhotoFile || !currentUser) return;
  uploadPhotoBtn.disabled = true;
  uploadPhotoBtn.textContent = "Mengupload...";

  try {
    let finalPhotoURL = "";
    try {
      const fileRef = storageRef(storage, `profile_photos/${currentUser.uid}_${Date.now()}`);
      await uploadBytes(fileRef, pendingPhotoFile);
      finalPhotoURL = await getDownloadURL(fileRef);
    } catch {
      // Fallback otomatis jika Firebase Storage belum diaktifkan di konsol
      finalPhotoURL = await compressImageToDataURL(pendingPhotoFile, 240);
    }

    await updateDoc(doc(db, "users", currentUser.uid), {
      photoURL: finalPhotoURL
    });

    currentUserData.photoURL = finalPhotoURL;
    setupAppUI();
    uploadPhotoBtn.classList.add("hidden");
    fileHintEl.textContent = "Foto profil berhasil diperbarui!";
    pendingPhotoFile = null;
    showToast("Foto profil berhasil diupload.");
  } catch (err) {
    showToast("Gagal mengupload foto: " + err.message, true);
  } finally {
    uploadPhotoBtn.disabled = false;
    uploadPhotoBtn.textContent = "Upload Foto";
  }
});

// Simpan Perubahan Nama & Kelas di Profile
document.getElementById("profile-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const newName = document.getElementById("profile-name-input").value.trim();
  const newKelas = getDropdownValue("dropdown-profile-kelas");
  if (!newName) return;

  await updateDoc(doc(db, "users", currentUser.uid), {
    nama: newName,
    kelas: newKelas
  });

  currentUserData.nama = newName;
  currentUserData.kelas = newKelas;
  setupAppUI();
  showToast("Profil berhasil diperbarui.");
});

// =====================================================
// 10. CHAT REAL-TIME DENGAN FOTO PROFIL
// =====================================================
function renderChatMessages(messages) {
  const container = document.getElementById("chat-messages");
  if (!container) return;

  if (messages.length === 0) {
    container.innerHTML = `<p class="empty-state">Belum ada pesan diskusi. Mulailah percakapan!</p>`;
    return;
  }

  container.innerHTML = "";
  messages.forEach((msg) => {
    const isMine = msg.uid === currentUser?.uid;
    const senderProfile = usersDirectoryCache[msg.uid];
    const senderName = senderProfile?.nama || msg.senderName || "User";
    const senderPhoto = senderProfile?.photoURL || msg.senderPhoto || "";
    const senderIsAdmin = (senderProfile?.role || msg.senderRole) === "admin";

    const timeStr = msg.createdAt?.toDate
      ? msg.createdAt.toDate().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
      : "";

    const item = document.createElement("div");
    item.className = `chat-item ${isMine ? "mine" : ""}`;
    item.innerHTML = `
      ${createAvatarHTML(senderName, senderPhoto, "avatar-sm")}
      <div class="chat-bubble">
        <div class="chat-sender">
          <span>${senderName}</span>
          ${senderIsAdmin ? ADMIN_BADGE_SVG : USER_BADGE_SVG}
        </div>
        <div class="chat-text"></div>
        <div class="chat-time">${timeStr}</div>
      </div>
    `;
    item.querySelector(".chat-text").textContent = msg.text;
    container.appendChild(item);
  });

  container.scrollTop = container.scrollHeight;
}

document.getElementById("chat-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const text = input.value.trim();
  if (!text || !currentUser) return;

  input.value = "";
  await addDoc(collection(db, "chats"), {
    uid: currentUser.uid,
    senderName: currentUserData.nama,
    senderPhoto: currentUserData.photoURL || "",
    senderRole: currentUserData.role || "user",
    text,
    createdAt: serverTimestamp()
  });
});

// =====================================================
// 11. DIREKTORI PENGGUNA TERDAFTAR
// =====================================================
function renderRegisteredUsers(users) {
  const container = document.getElementById("registered-users-list");
  if (!container) return;

  container.innerHTML = "";
  users.forEach((u) => {
    const uAdmin = u.role === "admin";
    const item = document.createElement("div");
    item.className = "user-dir-item";
    item.innerHTML = `
      <div class="user-dir-left">
        ${createAvatarHTML(u.nama, u.photoURL, "avatar-sm")}
        <div>
          <div style="font-weight:600; display:flex; align-items:center; gap:5px;">
            <span>${u.nama}</span>
            ${uAdmin ? ADMIN_BADGE_SVG : USER_BADGE_SVG}
          </div>
          <div style="font-size:12px; color:#64748b;">${u.kelas}</div>
        </div>
      </div>
      <div style="display:flex; align-items:center; gap:8px;">
        <span class="role-chip">${(u.role || "user").toUpperCase()}</span>
        <button type="button" class="btn btn-secondary btn-sm detail-user-btn">Detail</button>
      </div>
    `;

    item.querySelector(".detail-user-btn").addEventListener("click", () => {
      const modal = document.getElementById("user-detail-modal");
      document.getElementById("user-detail-body").innerHTML = `
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:14px;">
          ${createAvatarHTML(u.nama, u.photoURL, "avatar-lg")}
          <div>
            <div style="font-size:16px; font-weight:700;">${u.nama} ${uAdmin ? ADMIN_BADGE_SVG : USER_BADGE_SVG}</div>
            <div style="font-size:13px; color:#64748b;">${u.email || "-"}</div>
            <div style="margin-top:4px;"><span class="badge-kelas">${u.kelas}</span></div>
          </div>
        </div>
      `;
      modal.classList.remove("hidden");
    });

    container.appendChild(item);
  });
}

document.getElementById("close-user-detail-btn")?.addEventListener("click", () => {
  document.getElementById("user-detail-modal").classList.add("hidden");
});

// =====================================================
// 12. NAVIGASI TAB & AUTH EVENTS
// =====================================================
document.querySelectorAll(".nav-tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".nav-tab").forEach((t) => t.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.add("hidden"));

    tab.classList.add("active");
    const target = tab.getAttribute("data-target");
    document.getElementById(target)?.classList.remove("hidden");
  });
});

document.getElementById("tab-login")?.addEventListener("click", () => {
  document.getElementById("tab-login").classList.add("active");
  document.getElementById("tab-register").classList.remove("active");
  document.getElementById("login-form").classList.remove("hidden");
  document.getElementById("register-form").classList.add("hidden");
});

document.getElementById("tab-register")?.addEventListener("click", () => {
  document.getElementById("tab-register").classList.add("active");
  document.getElementById("tab-login").classList.remove("active");
  document.getElementById("register-form").classList.remove("hidden");
  document.getElementById("login-form").classList.add("hidden");
});

document.getElementById("login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("login-email").value.trim();
  const pass = document.getElementById("login-password").value;
  try {
    await signInWithEmailAndPassword(auth, email, pass);
  } catch (err) {
    showToast("Gagal masuk: Periksa email atau kata sandi Anda.", true);
  }
});

document.getElementById("register-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nama = document.getElementById("reg-name").value.trim();
  const kelas = getDropdownValue("dropdown-reg-kelas");
  const email = document.getElementById("reg-email").value.trim();
  const pass = document.getElementById("reg-password").value;

  try {
    const cred = await createUserWithEmailAndPassword(auth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      nama,
      kelas,
      email,
      role: "user",
      photoURL: "",
      createdAt: serverTimestamp()
    });
  } catch (err) {
    showToast("Gagal mendaftar: " + err.message, true);
  }
});

document.getElementById("google-login-btn")?.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) {
    showToast("Login Google dibatalkan atau gagal.", true);
  }
});

document.getElementById("logout-btn")?.addEventListener("click", async () => {
  await signOut(auth);
  showToast("Anda telah keluar dari akun.");
});

// Jalankan inisialisasi dropdown custom saat DOM siap
initCustomDropdowns();
