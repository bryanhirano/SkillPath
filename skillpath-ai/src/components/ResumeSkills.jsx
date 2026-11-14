import { getFunctions, httpsCallable } from "firebase/functions";
import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import "../backend/firebase.jsx"; // makes sure the Firebase app is initialized

/**
 * Skills page: shows the skills identified in the signed-in user's uploaded resume.
 *
 * Pass a new `refreshKey` (e.g. a timestamp) after a fresh upload to re-run it,
 * or use the Refresh button.
 */
const ResumeSkills = ({ refreshKey }) => {
	const uid = useSelector((state) => state.authedUser);
	const [skills, setSkills] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const [reloadCount, setReloadCount] = useState(0);

	const refresh = useCallback(() => setReloadCount((n) => n + 1), []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refreshKey and reloadCount intentionally trigger a reload.
	useEffect(() => {
		if (!uid) {
			setSkills([]);
			return;
		}

		let cancelled = false;
		setLoading(true);
		setError("");

		httpsCallable(getFunctions(), "identify_resume_skills")()
			.then(({ data }) => {
				if (!cancelled) setSkills(data?.skills ?? []);
			})
			.catch((err) => {
				if (!cancelled) {
					setSkills([]);
					setError(err.message);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [uid, refreshKey, reloadCount]);

	return (
		<div className="container mt-4 mb-5">
			<h2 className="text-center mb-4">My Skills</h2>
			<div className="card shadow-sm mx-auto" style={{ maxWidth: 750 }}>
				<div className="card-header d-flex justify-content-between align-items-center">
					<span>
						Identified Skills
						{!loading && skills.length > 0 && ` (${skills.length})`}
					</span>
					{uid && (
						<button
							type="button"
							className="btn btn-sm btn-outline-primary"
							onClick={refresh}
							disabled={loading}
						>
							Refresh
						</button>
					)}
				</div>
				<div className="card-body">
					{!uid ? (
						<p className="text-muted mb-0">
							Please sign in to see your skills.
						</p>
					) : loading ? (
						<p className="text-muted mb-0">Identifying skills…</p>
					) : error ? (
						<div className="alert alert-danger py-2 mb-0" role="alert">
							{error}
						</div>
					) : skills.length > 0 ? (
						<div>
							{skills.map((skill) => (
								<span
									key={skill.skillId}
									className="badge bg-primary me-2 mb-2 fs-6 fw-normal"
								>
									{skill.name}
								</span>
							))}
						</div>
					) : (
						<p className="text-muted mb-0">
							No skills identified. Upload your resume first, then press
							Refresh.
						</p>
					)}
				</div>
			</div>
		</div>
	);
};

export default ResumeSkills;
