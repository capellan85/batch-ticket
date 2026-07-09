// Firebase auth + Firestore sync layer for Batch Ticket.
// Loaded as a module; exposes a small `window.Cloud` API and fires DOM events
// (`cloud-ready`, `cloud-auth-changed`) that app.js listens to. Recipes for a
// signed-in user live in a single doc: users/{uid} => { recipes: [...] }.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js";
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBBgbraTfHKgi_5ro2WtZE0mOPMEjdD7F0",
  authDomain: "batch-ticket.firebaseapp.com",
  projectId: "batch-ticket",
  storageBucket: "batch-ticket.firebasestorage.app",
  messagingSenderId: "194571699798",
  appId: "1:194571699798:web:df2859e49dfe70ef5b9df7",
  measurementId: "G-ZL3YK49C5F"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;

function userDocRef() {
  return doc(db, 'users', currentUser.uid);
}

window.Cloud = {
  get user() { return currentUser; },

  async signIn() {
    await signInWithPopup(auth, provider);
  },

  async signOut() {
    await signOut(auth);
  },

  // Returns an array of recipes, or null when the account has no saved doc yet.
  // Throws on network/permission errors so the caller can fall back to cache.
  async loadRecipes() {
    if (!currentUser) return null;
    const snap = await getDoc(userDocRef());
    if (!snap.exists()) return null;
    const data = snap.data();
    return Array.isArray(data.recipes) ? data.recipes : [];
  },

  async saveRecipes(recipes) {
    if (!currentUser) throw new Error('Not signed in');
    await setDoc(userDocRef(), { recipes, updatedAt: Date.now() });
  }
};

let booted = false;
onAuthStateChanged(auth, (user) => {
  currentUser = user;
  const detail = user
    ? { uid: user.uid, email: user.email, name: user.displayName, photo: user.photoURL }
    : null;
  const type = booted ? 'cloud-auth-changed' : 'cloud-ready';
  booted = true;
  window.dispatchEvent(new CustomEvent(type, { detail }));
});
