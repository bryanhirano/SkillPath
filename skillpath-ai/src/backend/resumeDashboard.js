import { get, getDatabase, ref } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import { auth } from "./firebase.jsx";

// Keep in sync with DASHBOARD_CACHE_VERSION in functions/main.py.
const CACHE_VERSION = 1;
const pendingAnalyses = new Map();

/** Apply the user's latest manual level choices to saved model estimates. */
export function applyDashboardLevels(skills, overrides) {
    const choices = overrides && typeof overrides === "object" ? overrides : {};
    return (skills ?? []).map((skill) => {
        const estimatedLevel = skill.estimatedLevel ?? skill.level;
        const chosen = choices[skill.skillId];
        const userSet = Number.isInteger(chosen) && chosen >= 0 && chosen <= 5;
        return {
            ...skill,
            estimatedLevel,
            level: userSet ? chosen : estimatedLevel,
            userSet,
        };
    }).sort((a, b) => b.level - a.level ||
        (b.confidence ?? 0) - (a.confidence ?? 0) || a.name.localeCompare(b.name));
}

/**
 * Read the saved analysis directly from Realtime Database. Only call the
 * expensive backend if there isn't a complete result for the current resume.
 * Explicit reanalysis uses force=true.
 */
export async function getSavedResumeDashboard(uid, { force = false } = {}) {
    if (!uid || auth.currentUser?.uid !== uid) {
        throw new Error("Please sign in to view your own dashboard.");
    }

    const database = getDatabase();
    const [revisionSnap, cacheSnap, overridesSnap] = await Promise.all([
        get(ref(database, `users/${uid}/resumeRevision`)),
        get(ref(database, `users/${uid}/resumeAnalysis`)),
        get(ref(database, `users/${uid}/skillLevels`)),
    ]);
    const revision = revisionSnap.val() || "legacy";
    const cached = cacheSnap.val();
    const valid = cached && cached.cacheVersion === CACHE_VERSION &&
        cached.resumeRevision === revision &&
        (cached.skills == null || Array.isArray(cached.skills)) &&
        cached.text && cached.analysis;

    if (valid && !force) {
        return {
            ...cached,
            skills: applyDashboardLevels(cached.skills, overridesSnap.val()),
            source: "saved",
        };
    }

    const key = `${uid}:${revision}:${force}`;
    if (!pendingAnalyses.has(key)) {
        const request = httpsCallable(
            getFunctions(undefined, "us-central1"),
            "get_resume_dashboard",
            { timeout: 300000 },
        )({ force }).then(({ data }) => data).finally(() => pendingAnalyses.delete(key));
        pendingAnalyses.set(key, request);
    }
    const generated = await pendingAnalyses.get(key);
    if (generated?.status !== "success") {
        throw new Error("Resume analysis didn't complete. Please try again.");
    }
    return {
        ...generated,
        source: generated.cached ? "saved" : "new",
    };
}
