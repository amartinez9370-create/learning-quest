// ============================================================
// FIREBASE INITIALIZATION
// ============================================================
// This file sets up the Firebase connection. It's intentionally kept
// separate from the game logic so auth/database concerns don't get
// tangled with gameplay code, and so this file can be swapped/debugged
// independently.

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBHvEqvymVdCbF9Tu9VBliWrWnlknw05jQ",
  authDomain: "learning-quest-8778a.firebaseapp.com",
  projectId: "learning-quest-8778a",
  storageBucket: "learning-quest-8778a.firebasestorage.app",
  messagingSenderId: "973520308627",
  appId: "1:973520308627:web:48c22f2daa7e528aae4066"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const googleProvider = new GoogleAuthProvider();

// Expose a small, deliberate API on window for the main game script to use.
// (The game script is a plain non-module <script>, so it can't `import` this
// module directly — this bridge keeps the integration surface explicit and small.)
window.LQFirebase = {
  auth,
  db,

  async signIn(){
    try {
      const result = await signInWithPopup(auth, googleProvider);
      return { ok:true, user: result.user };
    } catch (err) {
      console.error("Sign-in failed:", err);
      return { ok:false, error: err.message };
    }
  },

  async signOutUser(){
    try {
      await signOut(auth);
      return { ok:true };
    } catch (err) {
      console.error("Sign-out failed:", err);
      return { ok:false, error: err.message };
    }
  },

  onAuthChange(callback){
    return onAuthStateChanged(auth, callback);
  },

  async loadProgress(uid){
    try {
      const ref = doc(db, "users", uid);
      const snap = await getDoc(ref);
      if (snap.exists()) return { ok:true, data: snap.data() };
      return { ok:true, data: null }; // no doc yet — new user
    } catch (err) {
      console.error("Failed to load progress:", err);
      return { ok:false, error: err.message };
    }
  },

  async saveProgress(uid, { displayName, photoURL, progress, gender, playerName }){
    try {
      const totalStars = Object.values(progress).reduce(
        (sum, arr) => sum + arr.reduce((a,b)=>a+b, 0), 0
      );
      const ref = doc(db, "users", uid);
      // Only bump the tie-break timestamp when the star total actually goes up,
      // so two players tied at the same total are ranked by whoever reached it
      // first — not by whoever most recently touched their save file.
      const existing = await getDoc(ref);
      const prevTotal = existing.exists() ? (existing.data().totalStars || 0) : 0;
      const payload = {
        displayName: displayName || playerName || "Adventurer",
        photoURL: photoURL || null,
        playerName: playerName || displayName || "Adventurer",
        gender: gender || "male",
        progress,
        totalStars,
        lastActive: serverTimestamp()
      };
      if(totalStars > prevTotal || !existing.exists()){
        payload.starsAchievedAt = serverTimestamp();
      }
      await setDoc(ref, payload, { merge:true });
      return { ok:true };
    } catch (err) {
      console.error("Failed to save progress:", err);
      return { ok:false, error: err.message };
    }
  },

  async getLeaderboard(topN = 20){
    try {
      const q = query(collection(db, "users"), orderBy("totalStars", "desc"), orderBy("starsAchievedAt", "asc"), limit(topN));
      const snap = await getDocs(q);
      const rows = [];
      snap.forEach(d => rows.push({ uid: d.id, ...d.data() }));
      return { ok:true, rows };
    } catch (err) {
      console.error("Failed to load leaderboard:", err);
      return { ok:false, error: err.message };
    }
  }
};

// Let the rest of the app know Firebase is ready to use.
window.dispatchEvent(new Event("lq-firebase-ready"));
