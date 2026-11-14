import { getDatabase, ref as dbRef, remove } from "firebase/database";
import { deleteObject, getStorage, ref as storageRef } from "firebase/storage";
import "./firebase.jsx"; // makes sure the Firebase app is initialized

/**
 * Where a user's resume lives. These must match functions/main.py.
 * - uploaded file: Storage object `resume/{uid}`
 * - typed resume:  Realtime Database `users/{uid}/resumeText`
 * - RESUME_PATH_KEY: the database key under users/{uid} that stores the path
 *   of the uploaded file. Change it if your app uses a different key name.
 */
export const RESUME_PATH_KEY = "resumePath";

export const resumeFileRef = (uid) => storageRef(getStorage(), `resume/${uid}`);

/** Delete the uploaded resume file; succeeds if there was none. */
export const deleteResumeFile = async (uid) => {
	try {
		await deleteObject(resumeFileRef(uid));
	} catch (err) {
		if (err?.code !== "storage/object-not-found") throw err;
	}
};

/**
 * Delete the user's current resume, whichever kind it is: the uploaded file,
 * the database key that points to it, and any typed resume text.
 * Removing a key that doesn't exist is not an error.
 */
export const deleteCurrentResume = async (uid) => {
	const db = getDatabase();
	await deleteResumeFile(uid);
	await Promise.all([
		remove(dbRef(db, `users/${uid}/${RESUME_PATH_KEY}`)),
		remove(dbRef(db, `users/${uid}/resumeText`)),
	]);
};
