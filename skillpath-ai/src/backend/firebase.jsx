import { initializeApp } from "firebase/app";
import {
	browserSessionPersistence,
	createUserWithEmailAndPassword,
	deleteUser,
	GoogleAuthProvider,
	getAdditionalUserInfo,
	getAuth,
	sendPasswordResetEmail,
	setPersistence,
	signInWithEmailAndPassword,
	signInWithPopup,
	signOut,
	updateProfile,
} from "firebase/auth";
import { child, get, getDatabase, ref, update } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import {
	deleteObject,
	getStorage,
	ref as storageRefs,
	uploadBytesResumable,
} from "firebase/storage";

const firebaseConfig = {
	apiKey: "AIzaSyCe3SDg7jbMIhKT_6XIMhyUeHxtwUU9AFA",
	authDomain: "mynotes-ae8c6.firebaseapp.com",
	databaseURL: "https://mynotes-ae8c6-default-rtdb.firebaseio.com",
	projectId: "mynotes-ae8c6",
	storageBucket: "mynotes-ae8c6.firebasestorage.app",
	messagingSenderId: "195557582263",
	appId: "1:195557582263:web:a303478baeb642b60af432",
	measurementId: "G-CDNQ1PFJDN",
};

const app = initializeApp(firebaseConfig);
const data = getDatabase(app);
const dbRef = ref(data);
const storage = getStorage(app);
export const auth = getAuth();
const functions = getFunctions(app, "us-central1");

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
				console.error(error);
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


	const filePath = `resumes/${uid}/`;
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
				console.log(error);
			});

			alert("Your account has been deleted");
		})
		.catch((error) => {
			alert("Please log out, log in, and try again");
			console.log(error);
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
