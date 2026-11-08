import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { getFunctions, httpsCallable } from "firebase/functions";
import "../backend/firebase.jsx"; // makes sure the Firebase app is initialized

/**
 * Shows only the skills identified in the signed-in user's uploaded resume.
 *
 * Pass a new `refreshKey` (e.g. a timestamp) after a fresh upload to re-run it.
 */
const ResumeSkills = ({ refreshKey }) => {
	const uid = useSelector((state) => state.authedUser);
	const [skills, setSkills] = useState([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

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
				if (!cancelled) setError(err.message);
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});

		return () => {
			cancelled = true;
		};
	}, [uid, refreshKey]);

	if (!uid) return null;

	return (
		<div className="container mt-4 mb-5">
			<div className="card shadow-sm mx-auto" style={{ maxWidth: 750 }}>
				<div className="card-header">Identified Skills</div>
				<div className="card-body">
					{loading ? (
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
						<p className="text-muted mb-0">No skills identified.</p>
					)}
				</div>
			</div>
		</div>
	);
};

export default ResumeSkills;
