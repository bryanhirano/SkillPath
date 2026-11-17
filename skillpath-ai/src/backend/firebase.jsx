import { initializeApp } from "firebase/app";
import {
	browserSessionPersistence,
	connectAuthEmulator,
	createUserWithEmailAndPassword,
	deleteUser,
	GoogleAuthProvider,
	getAdditionalUserInfo,
	getAuth,
	onAuthStateChanged,
	sendPasswordResetEmail,
	setPersistence,
	signInWithEmailAndPassword,
	signInWithPopup,
	signOut,
	updateProfile,
} from "firebase/auth";
import {
	child,
	connectDatabaseEmulator,
	get,
	getDatabase,
	onValue,
	ref,
	update,
} from "firebase/database";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import {
	connectStorageEmulator,
	deleteObject,
	getStorage,
	ref as storageRefs,
	uploadBytesResumable,
} from "firebase/storage";

const firebaseConfig = {
	apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
	authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
	databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
	projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
	storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
	messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
	appId: import.meta.env.VITE_FIREBASE_APP_ID,
	measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
const data = getDatabase(app);
const storage = getStorage(app);
export const auth = getAuth(app);
const functions = getFunctions(app, "us-central1");

// Use local services during development, never production services by accident.
if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true") {
	connectAuthEmulator(auth, "http://127.0.0.1:9099");
	connectDatabaseEmulator(data, "127.0.0.1", 9000);
	connectStorageEmulator(storage, "127.0.0.1", 9199);
	connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
const dbRef = ref(data);

const persistenceReady = setPersistence(auth, browserSessionPersistence).catch(
	(error) => console.error("Could not set auth persistence:", error),
);

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
			return "An account with this email already exists. Try logging in instead.";
		case "auth/weak-password":
			return "Password must be at least 6 characters.";
		case "auth/popup-closed-by-user":
		case "auth/cancelled-popup-request":
			return "";
		case "auth/popup-blocked":
			return "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.";
		case "auth/account-exists-with-different-credential":
			return "This email is already registered with a password. Log in with email and password instead.";
		case "auth/operation-not-allowed":
			return "This sign-in method is not enabled in the Firebase console yet.";
		case "auth/unauthorized-domain":
			return "This website's domain is not authorized for sign-in in the Firebase console.";
		case "auth/network-request-failed":
			return "Network error. Check your connection and try again.";
		default:
			return "Something went wrong. Please try again.";
	}
}

function saveProfile(uid, profile) {
	return update(ref(data, `users/${uid}`), profile).catch((error) =>
		console.error(
			"Signed in, but the profile could not be saved. Check the Realtime Database rules for users/<uid>.",
			error,
		),
	);
}

// Fixed: Now returns a Promise so the UI can dispatch to Redux
export const signInUser = (email, password) => {
	return setPersistence(auth, browserSessionPersistence)
		.then(() => signInWithEmailAndPassword(auth, email, password))
		.then((userCredential) => {
			return userCredential.user; // Return the user data to the caller
		});
};

export function signInWithGoogle() {
	const provider = new GoogleAuthProvider();
	provider.setCustomParameters({ prompt: "select_account" });

	return signInWithPopup(auth, provider).then((result) => {
		const { user } = result;
		if (getAdditionalUserInfo(result)?.isNewUser) {
			return saveProfile(user.uid, {
				name: user.displayName || "",
				email: user.email || "",
			}).then(() => user.uid);
		}
		return user.uid;
	});
}

export function createAccount(email, password, profile = {}) {
	return persistenceReady
		.then(() => createUserWithEmailAndPassword(auth, email, password))
		.then(({ user }) => {
			const name = [profile.firstName, profile.lastName]
				.filter(Boolean)
				.join(" ");

			return Promise.all([
				updateProfile(user, { displayName: name }).catch((error) =>
					console.error(error),
				),
				saveProfile(user.uid, { name, email }),
			]).then(() => user.uid);
		});
}

export const resetPass = (email) => {
	return sendPasswordResetEmail(auth, email)
		.then(() => {
			alert("Password reset link sent");
		})
		.catch((error) => {
			console.error(error.message);
		});
};

export const _signOut = () => {
	return signOut(auth).catch((error) => {
		console.error(error);
	});
};

export function updateUserInfo(userInfo) {
	return new Promise((resolve) => {
		const updates = {};
		const location = `users/${userInfo.uid}/`;
		updates[`${location}color`] = userInfo.color;
		updates[`${location}phone`] = userInfo.phone;

		update(ref(data), updates);
		setTimeout(() => resolve(null), 1000);
	});
}

export function getInfo(parent) {
	return new Promise((resolve, reject) => {
		get(child(dbRef, parent))
			.then((snapshot) => {
				resolve(snapshot.val());
			})
			.catch((error) => {
				reject(error);
			});
	});
}

export async function uploadResume(uid, file) {
	const user = auth.currentUser;
	if (!user || user.uid !== uid) {
		throw new Error("You must be signed in to upload your own resume.");
	}
	if (!file) {
		throw new Error("Please select a file.");
	}

	const fileName = file.name.toLowerCase();
	let contentType;
	if (fileName.endsWith(".pdf")) {
		contentType = "application/pdf";
	} else if (fileName.endsWith(".docx")) {
		contentType =
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document";
	} else {
		throw new Error("Only PDF and DOCX resumes are supported.");
	}

	if (file.size >= 5 * 1024 * 1024) {
		throw new Error("Resume must be smaller than 5 MB.");
	}

	const filePath = `resume/${uid}`;
	const storageRef = storageRefs(storage, filePath);
	const metadata = {
		contentType,
		customMetadata: {
			originalFileName: file.name,
		},
	};

	const snapshot = await uploadBytesResumable(storageRef, file, metadata);
	try {
		await update(ref(data), {
			[`users/${uid}/resumePath`]: snapshot.ref.fullPath,
			[`users/${uid}/resumeFileName`]: file.name,
			[`users/${uid}/resumeContentType`]: contentType,
			// The newest resume wins: drop any typed resume so the functions read this file.
			[`users/${uid}/resumeText`]: null,
			[`users/${uid}/resumeRevision`]: crypto.randomUUID(),
			[`users/${uid}/resumeAnalysis`]: null,
		});
	} catch (error) {
		await deleteObject(snapshot.ref).catch((cleanupError) => {
			console.error(
				"Could not remove the unrecorded resume upload.",
				cleanupError,
			);
		});
		throw error;
	}

	return snapshot.ref.fullPath;
}

export const _deleteUser = () => {
	const uid = auth.currentUser.uid;
	const uidImg = storageRefs(storage, `images/${uid}`);

	return deleteUser(auth.currentUser)
		.then(() => {
			var updates = {};
			updates[`users/${uid}`] = null;

			update(ref(data), updates);

			deleteObject(uidImg).catch((error) => {
				
			});

			alert("Your account has been deleted");
		})
		.catch((error) => {
			alert("Please log out, log in, and try again");
			
		});
};

export function saveResumeText(uid, text) {
	const user = auth.currentUser;
	if (!user || user.uid !== uid) {
		return Promise.reject(
			new Error("You must be signed in to save your resume."),
		);
	}
	if (typeof text !== "string" || text.length > 100000) {
		return Promise.reject(
			new Error("Resume text must be 100,000 characters or fewer."),
		);
	}

	const updates = {};
	updates[`users/${uid}/resumeText`] = text;
	updates[`users/${uid}/resumeRevision`] = crypto.randomUUID();
	updates[`users/${uid}/resumeAnalysis`] = null;

	return update(ref(data), updates);
}

export async function extractResumeText() {
	const user = auth.currentUser;
	if (!user) {
		throw new Error("Please sign in first.");
	}

	await user.getIdToken();
	const callable = httpsCallable(functions, "extract_resume_text");
	const result = await callable({});
	return result.data;
}

export async function identifyResumeSkills() {
	const user = auth.currentUser;
	if (!user) {
		throw new Error("Please sign in first.");
	}

	await user.getIdToken();
	const callable = httpsCallable(functions, "identify_resume_skills", {timeout: 300000});
	const result = await callable({});
	return result.data;
}

export async function analyzeResume() {
	const user = auth.currentUser;
	if (!user) {
		throw new Error("Please sign in first.");
	}

	await user.getIdToken();
	const callable = httpsCallable(functions, "analyze_resume");
	const result = await callable({});
	return result.data;
}

// NEW: list the jobs the user can choose on the Resume Dashboard.
// Calls the list_target_roles Cloud Function (functions/target_job.py), which
// reads the role catalog. Returns:
//   { status: "success",
//     roles: [{ id, title, onetCode, onetTitle, requirementCount }],  // sorted by title
//     savedTarget: { roleId, resolvedTitle, custom } | null,         // job chosen last time
//     latestAnalysis: <analysis from select_target_role> | null }   // its latest result
export async function listTargetRoles() {
	const user = auth.currentUser;
	if (!user) {
		throw new Error("Please sign in first.");
	}

	await user.getIdToken();
	const callable = httpsCallable(functions, "list_target_roles");
	const result = await callable({});
	return result.data;
}

// NEW: Identify if the user has a resume uploaded or typed in.
// Returns true if either resumePath or resumeText exists in the user's profile.
export async function userHasResumeUploaded() {
	const user = auth.currentUser;
	if (!user) {
		throw new Error("Please sign in first.");
	}

	await user.getIdToken();

	try {

		const [pathSnapshot, textSnapshot] = await Promise.all([
			get(child(dbRef, `users/${user.uid}/resumePath`)),
			get(child(dbRef, `users/${user.uid}/resumeText`)),
		]);
		const resumePath = pathSnapshot.val();
		const resumeText = textSnapshot.val();

		const hasFile = typeof resumePath === "string" && resumePath.trim() !== "";
		const hasText = typeof resumeText === "string" && resumeText.trim() !== "";
		return hasFile || hasText;
	} catch (error) {
		console.error("Could not check for a saved resume:", error);
		return false;
	}
}

// NEW: watch whether the signed-in user has a resume (uploaded or typed).
// onChange(hasResume) is called once with the current status and then only
// when the status actually flips - after an upload, a typed save, a delete,
// or a sign-in/sign-out. Nothing is called for re-renders or unrelated writes.
// Returns a function that stops watching; return it from a useEffect.
export function subscribeToResumeStatus(onChange) {
	const isFilled = (value) => typeof value === "string" && value.trim() !== "";
	let last;
	const emit = (hasResume) => {
		if (hasResume === last) return;
		last = hasResume;
		onChange(hasResume);
	};

	let stopData = () => {};
	const stopAuth = onAuthStateChanged(auth, (user) => {
		stopData();
		stopData = () => {};
		if (!user) {
			emit(false);
			return;
		}

		const values = {};
		const watch = (key) =>
			onValue(
				ref(data, `users/${user.uid}/${key}`),
				(snapshot) => {
					values[key] = snapshot.val();
					// Wait until both keys have loaded before reporting.
					if ("resumePath" in values && "resumeText" in values) {
						emit(isFilled(values.resumePath) || isFilled(values.resumeText));
					}
				},
				(error) => {
					console.error("Could not watch the saved resume:", error);
					emit(false);
				},
			);
		const stopPath = watch("resumePath");
		const stopText = watch("resumeText");
		stopData = () => {
			stopPath();
			stopText();
		};
	});

	return () => {
		stopAuth();
		stopData();
	};
}

// NEW: save the job the user chose and compare their skills with it.
// Calls the select_target_role Cloud Function, which looks up the skills the
// role requires in the catalog and runs the gap analysis.
//   roleId - an id from listTargetRoles().roles
//   skills - [{ skillId, level }], e.g. built from identifyResumeSkills()
// Returns { status: "success", target, analysisId, analysis }. analysis holds
// readiness (0-100), gaps (status "missing" or "partial"), strengths (skills
// already at the required level), summary and pathway. It is null when no
// skills are sent: the job is still saved, but there is nothing to compare.
export async function selectTargetRole(roleId, skills) {
	const user = auth.currentUser;
	if (!user) {
		throw new Error("Please sign in first.");
	}

	await user.getIdToken();
	const callable = httpsCallable(functions, "select_target_role");
	const result = await callable({ target: { roleId }, skills });
	return result.data;
}