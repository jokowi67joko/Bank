// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-app.js";
import { 
  getAuth, 
  GoogleAuthProvider, 
  setPersistence, 
  browserLocalPersistence 
} from "https://www.gstatic.com/firebasejs/10.13.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.1/firebase-firestore.js";

// GANTI DENGAN KONFIGURASI FIREBASE PROJECT ANDA
const firebaseConfig = {
  apiKey: "AIzaSyDMGqB6pDvh4sYgplUuLrc1MCusOslHYC0",
  authDomain: "bankbendahara-e7c17.firebaseapp.com",
  databaseURL: "https://bankbendahara-e7c17-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "bankbendahara-e7c17",
  storageBucket: "bankbendahara-e7c17.firebasestorage.app",
  messagingSenderId: "536907833967",
  appId: "1:536907833967:web:c638d0818d0292a129239a"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Pastikan session login tersimpan secara persistent di browser
setPersistence(auth, browserLocalPersistence).catch((error) => {
  console.error("Gagal mengatur persistence auth:", error);
});

export { app, auth, db, googleProvider };
