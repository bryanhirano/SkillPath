import { ref as dbRef, getDatabase, set } from "firebase/database";
import { getFunctions, httpsCallable } from "firebase/functions";
import { useCallback, useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import "../backend/firebase.jsx"; // makes sure the Firebase app is initialized
import { getSavedResumeDashboard } from "../backend/resumeDashboard.js";

const LEVEL_LABELS = [
	"None",
	"Awareness",
	"Beginner",
	"Intermediate",
	"Advanced",
	"Expert",
];
const MIN_JD_CHARS = 40; // matches gap.resolve_target

const call = (name, data) =>
	httpsCallable(getFunctions(), name, { timeout: 300000 })(data);

const STATUS_BADGE = {
	missing: "bg-danger",
	partial: "bg-warning text-dark",
};

/**
 * Lets the user pick a prospective job (a catalog role or a pasted job
 * description) and shows how their identified skills compare to it.
 */
const TargetJobPicker = ({
	uid,
	skills,
	skillsLoading,
	levelsChanged,
	onAnalyzed,
}) => {
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
				onAnalyzed?.();
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
					<div className="btn-group mb-3">
						<input
							type="radio"
							className="btn-check"
							name="target-mode"
							id="target-mode-role"
							checked={mode === "role"}
							onChange={() => setMode("role")}
						/>
						<label
							className="btn btn-outline-primary btn-sm"
							htmlFor="target-mode-role"
						>
							Choose a job
						</label>
					</div>

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

					<button
						type="submit"
						className="btn btn-primary"
						disabled={!canSubmit}
					>
						{saving
							? "Comparing…"
							: savedTarget
								? "Update target job"
								: "Set target job"}
					</button>
					{!skillsLoading && skills.length === 0 && (
						<span className="text-muted small ms-3">
							Upload a resume to compare your skills. You can still save a
							target.
						</span>
					)}
				</form>

				{saveError && (
					<div className="alert alert-danger py-2 mt-3 mb-0" role="alert">
						{saveError}
					</div>
				)}

				{analysis && !saving && levelsChanged && (
					<div className="alert alert-warning py-2 mt-3 mb-0" role="status">
						You changed your skill levels. Press{" "}
						<strong>Update target job</strong> to refresh this comparison and
						your training plan.
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
				<div
					className="progress-bar bg-success"
					style={{ width: `${readiness}%` }}
				/>
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
										<span
											className={`badge ${STATUS_BADGE[gap.status] ?? "bg-secondary"}`}
										>
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
					<div className="small text-muted mb-1">
						Already meets the requirement
					</div>
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
 * One skill: its level (editable), where it came from, and how the estimate
 * was worked out. The user's own level is saved to users/{uid}/skillLevels
 * and applied by identify_resume_skills everywhere else in the app.
 */
const SkillLevelRow = ({ uid, skill, onChange }) => {
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const estimated = skill.estimatedLevel ?? skill.level;
	const reasons = skill.levelReasons ?? [];
	const evidence = skill.evidence ?? [];

	const save = async (level) => {
		// Picking the estimate again removes the override.
		const value = level === estimated ? null : level;
		const previous = skill;
		onChange({ ...skill, level, userSet: value !== null });
		setSaving(true);
		setError("");
		try {
			await set(
				dbRef(getDatabase(), `users/${uid}/skillLevels/${skill.skillId}`),
				value,
			);
		} catch (err) {
			onChange(previous);
			setError(
				`Couldn't save${err?.code ? ` (${err.code})` : ""}. Please try again.`,
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<li className="list-group-item">
			<div className="d-flex flex-wrap justify-content-between align-items-center gap-2">
				<div>
					<span className="fw-semibold">{skill.name}</span>
					<span
						className={`badge ms-2 fw-normal ${
							skill.userSet
								? "bg-primary-subtle text-primary-emphasis"
								: "bg-secondary-subtle text-secondary-emphasis"
						}`}
					>
						{skill.userSet
							? `Set by you · estimate was ${LEVEL_LABELS[estimated]}`
							: "Estimated from your resume"}
					</span>
				</div>
				<div className="d-flex align-items-center gap-2">
					<label className="visually-hidden" htmlFor={`level-${skill.skillId}`}>
						Your level in {skill.name}
					</label>
					<select
						id={`level-${skill.skillId}`}
						className="form-select form-select-sm"
						style={{ width: "auto" }}
						value={skill.level}
						disabled={saving}
						onChange={(e) => save(Number(e.target.value))}
					>
						{LEVEL_LABELS.map((label, level) => (
							<option key={label} value={level}>
								{level === 0
									? "None, I don't have this"
									: `${level} · ${label}`}
								{level === estimated ? " (estimate)" : ""}
							</option>
						))}
					</select>
					{skill.userSet && (
						<button
							type="button"
							className="btn btn-sm btn-link px-0"
							onClick={() => save(estimated)}
							disabled={saving}
						>
							Use estimate
						</button>
					)}
				</div>
			</div>
			<details className="mt-1">
				<summary className="small text-muted">
					How was {LEVEL_LABELS[estimated]} estimated?
				</summary>
				<div className="small mt-2">
					{reasons.length > 0 ? (
						<ol className="mb-2 ps-3">
							{reasons.map((r) => (
								<li key={r}>{r}</li>
							))}
						</ol>
					) : (
						<p className="mb-2">
							Estimated from how often and how strongly the skill is described
							in your resume.
						</p>
					)}
					{evidence.length > 0 && (
						<>
							<div className="text-muted">Where it appears:</div>
							{evidence.map((line) => (
								<div key={line} className="fst-italic">
									“{line}”
								</div>
							))}
						</>
					)}
					<p className="text-muted mb-0 mt-2">
						This is a starting point. If it's wrong, pick your real level above.
					</p>
				</div>
			</details>
			{error && <div className="text-danger small mt-1">{error}</div>}
		</li>
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
	// True once a level is changed after the comparison on screen was made.
	const [levelsChanged, setLevelsChanged] = useState(false);

	const updateSkill = useCallback((next) => {
		setSkills((all) => all.map((s) => (s.skillId === next.skillId ? next : s)));
		setLevelsChanged(true);
	}, []);

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

		getSavedResumeDashboard(uid, { force: reloadCount > 0 })
			.then((snapshot) => {
				if (!cancelled) setSkills(snapshot?.skills ?? []);
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
						<>
							<p className="text-muted small">
								Levels were estimated from your resume. Check each one and
								change any that are wrong. Your levels are used for your target
								job comparison and training plan.
							</p>
							<ul className="list-group">
								{skills.map((skill) => (
									<SkillLevelRow
										key={skill.skillId}
										uid={uid}
										skill={skill}
										onChange={updateSkill}
									/>
								))}
							</ul>
						</>
					) : (
						<p className="text-muted mb-0">
							No skills identified. Upload your resume first, then press
							Refresh.
						</p>
					)}
				</div>
			</div>

			{uid && (
				<TargetJobPicker
					uid={uid}
					skills={skills}
					skillsLoading={loading}
					levelsChanged={levelsChanged}
					onAnalyzed={() => setLevelsChanged(false)}
				/>
			)}
		</div>
	);
};

export default ResumeSkills;
