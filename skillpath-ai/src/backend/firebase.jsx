
import { initializeApp } from "firebase/app";

import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable
} from "firebase/functions";

import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  browserSessionPersistence,
  setPersistence,
  signOut,
  deleteUser,
  signInWithPopup,
  getAdditionalUserInfo,
  updateProfile,
  GoogleAuthProvider,
  sendPasswordResetEmail
} from "firebase/auth";

import {
  getDatabase,
  connectDatabaseEmulator,
  ref,
  child,
  get,
  update
} from "firebase/database";

import {
  getStorage,
  connectStorageEmulator,
  ref as storageRefs,
  uploadBytesResumable,
  deleteObject
} from "firebase/storage";

// ============================================
// FIREBASE CONFIGURATION
// ============================================

const firebaseConfig = {

};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// ============================================
// FIREBASE AUTHENTICATION
// ============================================

export const auth = getAuth(app);

// Connect to the Authentication Emulator
if (import.meta.env.DEV) {
  connectAuthEmulator(
    auth,
    "http://127.0.0.1:9099"
  );
}

// ============================================
// FIREBASE REALTIME DATABASE
// ============================================

const data = getDatabase(app);

// ============================================
// FIREBASE STORAGE
// ============================================

const storage = getStorage(app);

// Connect Database and Storage to local emulators
if (import.meta.env.DEV) {
  connectDatabaseEmulator(
    data,
    "127.0.0.1",
    9000
  );

  connectStorageEmulator(
    storage,
    "127.0.0.1",
    9199
  );
}

const dbRef = ref(data);

// ============================================
// FIREBASE CLOUD FUNCTIONS
// ============================================

const functions = getFunctions(
  app,
  "us-central1"
);

if (import.meta.env.DEV) {
  connectFunctionsEmulator(
    functions,
    "127.0.0.1",
    5001
  );
}

// ============================================
// AUTHENTICATION PERSISTENCE
// ============================================

const persistenceReady = setPersistence(
  auth,
  browserSessionPersistence
).catch((error) => {
  console.error(
    "Could not set auth persistence:",
    error
  );
});

// ============================================
// AUTHENTICATION ERROR MESSAGES
// ============================================

export function authErrorMessage(error) {
  switch (error?.code) {

    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Wrong email or password.";

    case "auth/invalid-email":
      return "That email address is not valid.";

    case "auth/missing-password":
      return "Enter your password.";

    case "auth/user-disabled":
      return "This account has been disabled.";

    case "auth/too-many-requests":
      return "Too many attempts. Wait a moment and try again.";

    case "auth/email-already-in-use":
      return "An account with this email already exists.";

    case "auth/weak-password":
      return "Password must be at least 6 characters.";

    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return "";

    case "auth/popup-blocked":
      return "Your browser blocked the Google sign-in window.";

    case "auth/account-exists-with-different-credential":
      return "This email is already registered with another sign-in method.";

    case "auth/operation-not-allowed":
      return "This sign-in method is not enabled.";

    case "auth/unauthorized-domain":
      return "This domain is not authorized for sign-in.";

    case "auth/network-request-failed":
      return "Network error. Check your connection.";

    default:
      return "Something went wrong. Please try again.";
  }
}

// ============================================
// SAVE USER PROFILE
// ============================================

function saveProfile(uid, profile) {
  return update(
    ref(data, `users/${uid}`),
    profile
  ).catch((error) => {
    console.error(
      "Signed in, but the profile could not be saved.",
      error
    );
  });
}

// ============================================
// EMAIL AND PASSWORD LOGIN
// ============================================

export const signInUser = (email, password) => {
  return setPersistence(
    auth,
    browserSessionPersistence
  )
    .then(() =>
      signInWithEmailAndPassword(
        auth,
        email,
        password
      )
    )
    .then((userCredential) => {
      return userCredential.user;
    });
};

// ============================================
// GOOGLE LOGIN
// ============================================

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();

  provider.setCustomParameters({
    prompt: "select_account"
  });

  return signInWithPopup(auth, provider)
    .then((result) => {
      const { user } = result;

      if (getAdditionalUserInfo(result)?.isNewUser) {
        return saveProfile(user.uid, {
          name: user.displayName || "",
          email: user.email || ""
        }).then(() => user.uid);
      }

      return user.uid;
    });
}

// ============================================
// CREATE USER ACCOUNT
// ============================================

export function createAccount(
  email,
  password,
  profile = {}
) {
  return persistenceReady
    .then(() =>
      createUserWithEmailAndPassword(
        auth,
        email,
        password
      )
    )
    .then(({ user }) => {

      const name = [
        profile.firstName,
        profile.lastName
      ]
        .filter(Boolean)
        .join(" ");

      return Promise.all([
        updateProfile(user, {
          displayName: name
        }).catch((error) => {
          console.error(error);
        }),

        saveProfile(user.uid, {
          name,
          email
        })
      ]).then(() => user.uid);
    });
}

// ============================================
// PASSWORD RESET
// ============================================

export const resetPass = (email) => {
  return sendPasswordResetEmail(
    auth,
    email
  )
    .then(() => {
      alert("Password reset link sent");
    })
    .catch((error) => {
      console.error(error.message);
      throw error;
    });
};

// ============================================
// SIGN OUT
// ============================================

export const _signOut = () => {
  return signOut(auth).catch((error) => {
    console.error(error);
    throw error;
  });
};

// ============================================
// UPDATE USER INFORMATION
// ============================================

export function updateUserInfo(userInfo) {
  const updates = {};
  const location = `users/${userInfo.uid}/`;

  updates[location + "color"] = userInfo.color;
  updates[location + "phone"] = userInfo.phone;

  return update(ref(data), updates);
}

// ============================================
// GET DATABASE INFORMATION
// ============================================

export function getInfo(parent) {
  return get(child(dbRef, parent))
    .then((snapshot) => snapshot.val())
    .catch((error) => {
      console.error(error);
      throw error;
    });
}

// ============================================
// UPLOAD RESUME
// PDF AND DOCX
// ============================================

export function uploadResume(uid, file) {
  return new Promise((resolve, reject) => {

    const user = auth.currentUser;

    // Confirm user is authenticated
    if (!user || user.uid !== uid) {
      reject(
        new Error(
          "You must be signed in to upload your own resume."
        )
      );
      return;
    }

    if (!file) {
      reject(
        new Error("Please select a file.")
      );
      return;
    }

    // Allow only PDF and DOCX
    const fileName = file.name.toLowerCase();

    let contentType;

    if (fileName.endsWith(".pdf")) {
      contentType = "application/pdf";
    } else if (fileName.endsWith(".docx")) {
      contentType =
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    } else {
      reject(
        new Error(
          "Only PDF and DOCX resumes are supported."
        )
      );
      return;
    }

    // Maximum file size: 5 MB
    const maxFileSize = 5 * 1024 * 1024;

    if (file.size >= maxFileSize) {
      reject(
        new Error(
          "Resume must be smaller than 5 MB."
        )
      );
      return;
    }

    // Create a safe, unique filename
    const safeName = file.name
      .replace(/[^a-zA-Z0-9._-]/g, "_");

    const uniqueFileName =
      `${Date.now()}_${safeName}`;

    // Match existing Firebase Storage rules:
    // resumes/{uid}/{fileName}
    const filePath =
      `resumes/${uid}/${uniqueFileName}`;

    const storageRef = storageRefs(
      storage,
      filePath
    );

    const metadata = {
      contentType,
      customMetadata: {
        originalFileName: file.name
      }
    };

    const uploadTask = uploadBytesResumable(
      storageRef,
      file,
      metadata
    );

    uploadTask.on(
      "state_changed",

      // Upload progress
      (snapshot) => {
        const progress =
          (snapshot.bytesTransferred /
            snapshot.totalBytes) * 100;

        console.log(
          `Upload is ${progress.toFixed(1)}% done`
        );
      },

      // Upload error
      (error) => {
        console.error(
          "Resume upload failed:",
          error
        );

        reject(error);
      },

      // Upload completed
      async () => {
        try {

          // Store the secure file path.
          // Do not generate a download URL because
          // Storage rules prohibit client reads.
          const savedPath =
            uploadTask.snapshot.ref.fullPath;

          const updates = {};

          updates[
            `users/${uid}/resumePath`
          ] = savedPath;

          updates[
            `users/${uid}/resumeFileName`
          ] = file.name;

          updates[
            `users/${uid}/resumeContentType`
          ] = contentType;

          await update(
            ref(data),
            updates
          );

          console.log(
            "Resume uploaded successfully:",
            savedPath
          );

          resolve(savedPath);

        } catch (error) {
          console.error(
            "Resume metadata could not be saved:",
            error
          );

          reject(error);
        }
      }
    );
  });
}

// ============================================
// DELETE USER ACCOUNT
// ============================================

export const _deleteUser = () => {
  const user = auth.currentUser;

  if (!user) {
    return Promise.reject(
      new Error(
        "No authenticated user."
      )
    );
  }

  const uid = user.uid;

  return deleteUser(user)
    .then(async () => {
      const updates = {};

      updates[`users/${uid}`] = null;

      await update(
        ref(data),
        updates
      );

      // Existing image-cleanup behavior
      const uidImg = storageRefs(
        storage,
        `images/${uid}`
      );

      await deleteObject(uidImg)
        .catch((error) => {
          console.log(error);
        });

      alert(
        "Your account has been deleted"
      );
    })
    .catch((error) => {
      console.error(error);

      alert(
        "Account deletion failed. Please sign in again and retry."
      );
    });
};

// ============================================
// SAVE RESUME TEXT
// ============================================

export function saveResumeText(uid, text) {

  const user = auth.currentUser;

  if (!user || user.uid !== uid) {
    return Promise.reject(
      new Error(
        "You must be signed in to save your resume."
      )
    );
  }

  const updates = {};

  updates[
    `users/${uid}/resumeText`
  ] = text;

  return update(
    ref(data),
    updates
  );
}

// ============================================
// TEST PYTHON BACKEND CONNECTION
// ============================================

export async function testBackendConnection() {

  const user = auth.currentUser;

  if (!user) {
    throw new Error(
      "No authenticated Firebase user found."
    );
  }

  // Refresh authentication token
  await user.getIdToken(true);

  console.log(
    "Authenticated user:",
    user.uid
  );

  // Call Python Firebase Function
  const callable = httpsCallable(
    functions,
    "test_connection"
  );

  const result = await callable({});

  return result.data;
}

 // ============================================
 // EXTRACT RESUME TEXT USING PYTHON
 // ============================================

export async function extractResumeText() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please sign in first.");
  }

  // Confirm the user has an authentication token
  await user.getIdToken();

  // Call the Python resume extraction function
  const callable = httpsCallable(
    functions,
    "extract_resume_text"
  );

  const result = await callable({});

  return result.data;
}

export async function analyzeResume() {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("Please sign in first.");
  }

  await user.getIdToken();

  const callable = httpsCallable(
    functions,
    "analyze_resume"
  );

  const result = await callable({});

  return result.data;
}
