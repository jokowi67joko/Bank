// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { 
  getAuth, 
  setPersistence, 
  browserLocalPersistence 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

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
const storage = getStorage(app);

setPersistence(auth, browserLocalPersistence).catch((err) => {
  console.error("Persistence error:", err);
});

export { app, auth, db, storage };
