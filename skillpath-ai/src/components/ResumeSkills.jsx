import { getFunctions, httpsCallable } from "firebase/functions";
import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import "../backend/firebase.jsx"; // makes sure the Firebase app is initialized

const LEVEL_LABELS = [
	"None",
	"Awareness",
	"Beginner",
	"Intermediate",
	"Advanced",
	"Expert",
];
const MIN_JD_CHARS = 40; // matches gap.resolve_target

const call = (name, data) => httpsCallable(getFunctions(), name)(data);

const STATUS_BADGE = {
	missing: "bg-danger",
	partial: "bg-warning text-dark",
};

/**
 * Lets the user pick a prospective job (a catalog role or a pasted job
 * description) and shows how their identified skills compare to it.
 */
const TargetJobPicker = ({ uid, skills, skillsLoading }) => {
	const [roles, setRoles] = useState([]);
	const [rolesLoading, setRolesLoading] = useState(false);
	const [rolesError, setRolesError] = useState("");
	const [mode, setMode] = useState("role"); // "role" | "jd"
	const [roleId, setRoleId] = useState("");
	const [jdTitle, setJdTitle] = useState("");
	const [jdText, setJdText] = useState("");
	const [savedTarget, setSavedTarget] = useState(null);
	const [analysis, setAnalysis] = useState(null);
	const [saving, setSaving] = useState(false);
	const [saveError, setSaveError] = useState("");

	useEffect(() => {
		if (!uid) return;
		let cancelled = false;
		setRolesLoading(true);
		setRolesError("");
		call("list_target_roles")
			.then(({ data }) => {
				if (cancelled) return;
				setRoles(data?.roles ?? []);
				const saved = data?.savedTarget;
				setSavedTarget(saved ?? null);
				setAnalysis(data?.latestAnalysis ?? null);
				if (saved?.roleId) {
					setMode("role");
					setRoleId(saved.roleId);
				} else if (saved?.jobDescription) {
					setMode("jd");
					setJdTitle(saved.title ?? "");
					setJdText(saved.jobDescription);
				}
			})
			.catch((err) => {
				if (!cancelled) setRolesError(err.message);
			})
			.finally(() => {
				if (!cancelled) setRolesLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [uid]);

	const selectedRole = roles.find((r) => r.id === roleId);
	const canSubmit =
		!saving &&
		!skillsLoading &&
		(mode === "role" ? !!roleId : jdText.trim().length >= MIN_JD_CHARS);

	const handleSubmit = (event) => {
		event.preventDefault();
		if (!canSubmit) return;
		const target =
			mode === "role"
				? { roleId }
				: { title: jdTitle.trim(), jobDescription: jdText.trim() };
		setSaving(true);
		setSaveError("");
		call("select_target_role", {
			target,
			skills: skills.map(({ skillId, level }) => ({ skillId, level })),
		})
			.then(({ data }) => {
				setSavedTarget(data?.target ?? null);
				setAnalysis(data?.analysis ?? null);
			})
			.catch((err) => setSaveError(err.message))
			.finally(() => setSaving(false));
	};

	return (
		<div className="card shadow-sm mx-auto mt-4" style={{ maxWidth: 750 }}>
			<div className="card-header d-flex justify-content-between align-items-center">
				<span>Target Job</span>
				{savedTarget?.resolvedTitle && (
					<span className="badge bg-success fw-normal">
						Current: {savedTarget.resolvedTitle}
					</span>
				)}
			</div>
			<div className="card-body">
				{rolesError && (
					<div className="alert alert-danger py-2" role="alert">
						{rolesError}
					</div>
				)}

				<form onSubmit={handleSubmit}>
					<div className="btn-group mb-3" role="group" aria-label="Target type">
						<input
							type="radio"
							className="btn-check"
							name="target-mode"
							id="target-mode-role"
							checked={mode === "role"}
							onChange={() => setMode("role")}
						/>
						<label className="btn btn-outline-primary btn-sm" htmlFor="target-mode-role">
							Choose a job
						</label>
						<input
							type="radio"
							className="btn-check"
							name="target-mode"
							id="target-mode-jd"
							checked={mode === "jd"}
							onChange={() => setMode("jd")}
						/>
						<label className="btn btn-outline-primary btn-sm" htmlFor="target-mode-jd">
							Paste a job description
						</label>
					</div>

					{mode === "role" ? (
						<div className="mb-3">
							<label htmlFor="target-role" className="form-label">
								Which job are you aiming for?
							</label>
							<select
								id="target-role"
								className="form-select"
								value={roleId}
								onChange={(e) => setRoleId(e.target.value)}
								disabled={rolesLoading || roles.length === 0}
							>
								<option value="">
									{rolesLoading ? "Loading jobs…" : "Select a job"}
								</option>
								{roles.map((role) => (
									<option key={role.id} value={role.id}>
										{role.title}
									</option>
								))}
							</select>
							{selectedRole && (
								<div className="form-text">
									{selectedRole.onetCode &&
										`O*NET ${selectedRole.onetCode}${
											selectedRole.onetTitle ? ` · ${selectedRole.onetTitle}` : ""
										} · `}
									{selectedRole.requirementCount} required skills
								</div>
							)}
						</div>
					) : (
						<>
							<div className="mb-3">
								<label htmlFor="target-title" className="form-label">
									Job title
								</label>
								<input
									id="target-title"
									className="form-control"
									maxLength={80}
									placeholder="e.g. Junior Data Analyst"
									value={jdTitle}
									onChange={(e) => setJdTitle(e.target.value)}
								/>
							</div>
							<div className="mb-3">
								<label htmlFor="target-jd" className="form-label">
									Job description
								</label>
								<textarea
									id="target-jd"
									className="form-control"
									rows={6}
									maxLength={20000}
									placeholder="Paste the full job posting here"
									value={jdText}
									onChange={(e) => setJdText(e.target.value)}
								/>
								<div className="form-text">
									We pick out the skills the posting asks for. Paste at least a
									few sentences.
								</div>
							</div>
						</>
					)}

					<button type="submit" className="btn btn-primary" disabled={!canSubmit}>
						{saving
							? "Comparing…"
							: savedTarget
								? "Update target job"
								: "Set target job"}
					</button>
					{!skillsLoading && skills.length === 0 && (
						<span className="text-muted small ms-3">
							Upload a resume to compare your skills. You can still save a target.
						</span>
					)}
				</form>

				{saveError && (
					<div className="alert alert-danger py-2 mt-3 mb-0" role="alert">
						{saveError}
					</div>
				)}

				{analysis && !saving && <TargetComparison analysis={analysis} />}
			</div>
		</div>
	);
};

const TargetComparison = ({ analysis }) => {
	const gaps = analysis.gaps ?? [];
	const strengths = analysis.strengths ?? [];
	const readiness = Math.round(analysis.readiness ?? 0);

	return (
		<div className="mt-4">
			<div className="d-flex justify-content-between small mb-1">
				<span>Readiness for {analysis.target?.title}</span>
				<span className="fw-semibold">{readiness}%</span>
			</div>
			<div
				className="progress mb-3"
				style={{ height: 10 }}
				role="progressbar"
				aria-label="Readiness"
				aria-valuenow={readiness}
				aria-valuemin={0}
				aria-valuemax={100}
			>
				<div className="progress-bar bg-success" style={{ width: `${readiness}%` }} />
			</div>
			{analysis.summary && <p className="mb-3">{analysis.summary}</p>}

			{gaps.length > 0 && (
				<div className="table-responsive mb-3">
					<table className="table table-sm align-middle mb-0">
						<thead>
							<tr>
								<th>Skill to build</th>
								<th>You</th>
								<th>Needed</th>
								<th />
							</tr>
						</thead>
						<tbody>
							{gaps.map((gap) => (
								<tr key={gap.skillId}>
									<td>{gap.name}</td>
									<td className="text-muted">
										{gap.currentLabel ?? LEVEL_LABELS[gap.current]}
									</td>
									<td>{gap.requiredLabel ?? LEVEL_LABELS[gap.required]}</td>
									<td>
										<span className={`badge ${STATUS_BADGE[gap.status] ?? "bg-secondary"}`}>
											{gap.status}
										</span>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			)}

			{gaps.length > 0 && (
				<Link to="/training" className="btn btn-success mb-3">
					See where to train for these skills
				</Link>
			)}

			{strengths.length > 0 && (
				<div>
					<div className="small text-muted mb-1">Already meets the requirement</div>
					{strengths.map((s) => (
						<span
							key={s.skillId}
							className="badge bg-success-subtle text-success-emphasis me-2 mb-2 fw-normal"
						>
							{s.name}
						</span>
					))}
				</div>
			)}
		</div>
	);
};

/**
 * Skills page: shows the skills identified in the signed-in user's uploaded
 * resume and lets them choose the job they want to move into.
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

		call("identify_resume_skills")
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
									title={LEVEL_LABELS[skill.level]}
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

			{uid && (
				<TargetJobPicker uid={uid} skills={skills} skillsLoading={loading} />
			)}
		</div>
	);
};

export default ResumeSkills;