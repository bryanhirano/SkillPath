import { getFunctions, httpsCallable } from "firebase/functions";
import { useEffect, useMemo, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import "../backend/firebase.jsx"; // makes sure the Firebase app is initialized

/**
 * Training plan for the user's target job.
 *
 * Reads the latest analysis saved by `select_target_role` (via
 * `list_target_roles`). Its `pathway` comes from skillpath/pathway.py: ordered,
 * prerequisite-aware steps, each with curated resources from resources.json and
 * a hands-on project. Changing the study preferences re-runs
 * `select_target_role` with the user's current resume skills.
 */

const call = (name, data) =>
	httpsCallable(getFunctions(), name)(data).then(({ data: d }) => d);

const PACES = [
	{ id: "slow", label: "Relaxed" },
	{ id: "steady", label: "Steady" },
	{ id: "fast", label: "Fast" },
];
// Must match pathway.FORMATS.
const FORMATS = [
	{ id: "course", label: "Courses" },
	{ id: "interactive", label: "Interactive" },
	{ id: "docs", label: "Documentation" },
	{ id: "book", label: "Books" },
	{ id: "certification", label: "Certifications" },
	{ id: "project", label: "Projects" },
];
const DEFAULT_PREFS = {
	hoursPerWeek: 6,
	pace: "steady",
	formats: [],
	freeOnly: false,
};

// Course catalogs searched for every step, so each skill has somewhere to learn
// even when resources.json has no curated entry for it.
const SEARCH_SITES = [
	{ name: "Coursera", url: (q) => `https://www.coursera.org/search?query=${q}` },
	{ name: "edX", url: (q) => `https://www.edx.org/search?q=${q}` },
	{
		name: "YouTube",
		url: (q) => `https://www.youtube.com/results?search_query=${q}+tutorial`,
	},
];

const weeksLabel = (step) =>
	step.startWeek === step.endWeek
		? `Week ${step.endWeek}`
		: `Weeks ${step.startWeek}–${step.endWeek}`;

const ResourceItem = ({ resource }) => {
	const isProject = resource.format === "project" && !resource.url;
	return (
		<li className="list-group-item d-flex justify-content-between align-items-start gap-3">
			<div>
				{resource.url ? (
					<a href={resource.url} target="_blank" rel="noopener noreferrer">
						{resource.title}
					</a>
				) : (
					<span>{resource.title}</span>
				)}
				<div className="text-muted small">
					{resource.provider}
					{resource.hours ? ` · about ${resource.hours} h` : ""}
				</div>
			</div>
			<div className="text-nowrap">
				<span className="badge bg-secondary-subtle text-secondary-emphasis me-1">
					{isProject ? "hands-on" : resource.format}
				</span>
				<span
					className={`badge ${
						resource.cost === "free"
							? "bg-success-subtle text-success-emphasis"
							: "bg-warning-subtle text-warning-emphasis"
					}`}
				>
					{resource.cost === "free" ? "free" : resource.cost}
				</span>
			</div>
		</li>
	);
};

const StepCard = ({ step }) => {
	const resources = step.resources ?? [];
	const curated = resources.filter((r) => r.url);
	const query = encodeURIComponent(step.name);
	return (
		<div className="card shadow-sm mb-3">
			<div className="card-header d-flex flex-wrap justify-content-between align-items-center gap-2">
				<span>
					<span className="badge bg-primary me-2">{step.order}</span>
					<span className="fw-semibold">{step.name}</span>
					<span className="text-muted ms-2 small">
						{step.fromLabel} → {step.toLabel}
					</span>
				</span>
				<span className="text-muted small">
					{weeksLabel(step)} · {step.hours} h
				</span>
			</div>
			<div className="card-body">
				<p className="mb-3">{step.reason}</p>
				<div className="small text-muted mb-1">Where to train</div>
				<ul className="list-group mb-2">
					{resources.map((r) => (
						<ResourceItem key={r.id} resource={r} />
					))}
				</ul>
				<div className="small">
					<span className="text-muted">
						{curated.length === 0
							? "No curated course yet for this skill. Search: "
							: "More options: "}
					</span>
					{SEARCH_SITES.map((site, i) => (
						<span key={site.name}>
							{i > 0 && " · "}
							<a href={site.url(query)} target="_blank" rel="noopener noreferrer">
								{site.name}
							</a>
						</span>
					))}
				</div>
			</div>
		</div>
	);
};

const PreferencesForm = ({ initial, busy, onSubmit }) => {
	const [prefs, setPrefs] = useState(initial);
	useEffect(() => setPrefs(initial), [initial]);
	const hours = Number(prefs.hoursPerWeek);
	const valid = Number.isFinite(hours) && hours >= 1 && hours <= 40;

	const toggleFormat = (id) =>
		setPrefs((p) => ({
			...p,
			formats: p.formats.includes(id)
				? p.formats.filter((f) => f !== id)
				: [...p.formats, id],
		}));

	return (
		<form
			className="card shadow-sm mb-4"
			onSubmit={(e) => {
				e.preventDefault();
				if (valid && !busy) onSubmit({ ...prefs, hoursPerWeek: hours });
			}}
		>
			<div className="card-header">Study preferences</div>
			<div className="card-body">
				<div className="row g-3 align-items-end">
					<div className="col-sm-4">
						<label htmlFor="pref-hours" className="form-label">
							Hours per week
						</label>
						<input
							id="pref-hours"
							type="number"
							min={1}
							max={40}
							className={`form-control ${valid ? "" : "is-invalid"}`}
							value={prefs.hoursPerWeek}
							onChange={(e) =>
								setPrefs((p) => ({ ...p, hoursPerWeek: e.target.value }))
							}
						/>
						<div className="invalid-feedback">Between 1 and 40.</div>
					</div>
					<div className="col-sm-4">
						<label htmlFor="pref-pace" className="form-label">
							Learning pace
						</label>
						<select
							id="pref-pace"
							className="form-select"
							value={prefs.pace}
							onChange={(e) => setPrefs((p) => ({ ...p, pace: e.target.value }))}
						>
							{PACES.map((p) => (
								<option key={p.id} value={p.id}>
									{p.label}
								</option>
							))}
						</select>
					</div>
					<div className="col-sm-4">
						<div className="form-check">
							<input
								id="pref-free"
								type="checkbox"
								className="form-check-input"
								checked={prefs.freeOnly}
								onChange={(e) =>
									setPrefs((p) => ({ ...p, freeOnly: e.target.checked }))
								}
							/>
							<label htmlFor="pref-free" className="form-check-label">
								Free resources only
							</label>
						</div>
					</div>
				</div>
				<div className="mt-3">
					<div className="form-label mb-1">I prefer to learn with</div>
					{FORMATS.map((f) => (
						<div key={f.id} className="form-check form-check-inline">
							<input
								id={`pref-format-${f.id}`}
								type="checkbox"
								className="form-check-input"
								checked={prefs.formats.includes(f.id)}
								onChange={() => toggleFormat(f.id)}
							/>
							<label htmlFor={`pref-format-${f.id}`} className="form-check-label">
								{f.label}
							</label>
						</div>
					))}
				</div>
				<button type="submit" className="btn btn-primary mt-3" disabled={!valid || busy}>
					{busy ? "Building your plan…" : "Update training plan"}
				</button>
			</div>
		</form>
	);
};

const Training = () => {
	const uid = useSelector((state) => state.authedUser);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [savedTarget, setSavedTarget] = useState(null);
	const [analysis, setAnalysis] = useState(null);
	const [building, setBuilding] = useState(false);
	const [buildError, setBuildError] = useState("");

	useEffect(() => {
		if (!uid) return;
		let cancelled = false;
		setLoading(true);
		setError("");
		call("list_target_roles")
			.then((data) => {
				if (cancelled) return;
				const saved = data?.savedTarget ?? null;
				const latest = data?.latestAnalysis ?? null;
				setSavedTarget(saved);
				// Only use the plan if it was built for the job currently selected.
				setAnalysis(
					saved && latest?.target?.title === saved.resolvedTitle ? latest : null,
				);
			})
			.catch((err) => {
				console.error("list_target_roles failed:", err);
				if (!cancelled) setError("Your training plan couldn't be loaded. Please reload the page.");
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [uid]);

	// Re-run the analysis with the current resume skills and these preferences.
	const buildPlan = async (preferences) => {
		setBuilding(true);
		setBuildError("");
		try {
			const { skills = [] } = await call("identify_resume_skills");
			if (skills.length === 0) {
				throw new Error("No skills were found in your resume. Upload a resume first.");
			}
			const target = savedTarget.roleId
				? { roleId: savedTarget.roleId }
				: { title: savedTarget.title, jobDescription: savedTarget.jobDescription };
			const data = await call("select_target_role", {
				target,
				skills: skills.map(({ skillId, level }) => ({ skillId, level })),
				preferences,
			});
			setAnalysis(data?.analysis ?? null);
		} catch (err) {
			setBuildError(err?.message || "The training plan couldn't be built.");
		} finally {
			setBuilding(false);
		}
	};

	// Stable per analysis, so the form only resets when a new plan arrives.
	const initialPrefs = useMemo(() => {
		const saved = analysis?.preferences;
		return saved
			? {
					hoursPerWeek: saved.hoursPerWeek ?? DEFAULT_PREFS.hoursPerWeek,
					pace: saved.pace ?? DEFAULT_PREFS.pace,
					formats: saved.formats ?? [],
					freeOnly: !!saved.freeOnly,
				}
			: DEFAULT_PREFS;
	}, [analysis]);

	if (!uid) {
		return (
			<div className="container mt-4 mb-5">
				<h2>Training Plan</h2>
				<p className="text-muted">Please sign in to see your training plan.</p>
			</div>
		);
	}

	const pathway = analysis?.pathway;
	const steps = pathway?.steps ?? [];
	const milestones = pathway?.milestones ?? [];

	return (
		<div className="container mt-4 mb-5" style={{ maxWidth: 900 }}>
			<h2 className="mb-1">Training Plan</h2>
			{savedTarget && (
				<p className="text-muted mb-4">
					Your path to <strong>{savedTarget.resolvedTitle}</strong>.{" "}
					<Link to="/skills">Change target job</Link>
				</p>
			)}

			{loading ? (
				<p className="text-muted">Loading your training plan…</p>
			) : error ? (
				<div className="alert alert-danger" role="alert">
					{error}
				</div>
			) : !savedTarget ? (
				<div className="card shadow-sm">
					<div className="card-body">
						<p className="mb-3">
							Choose the job you want first. Your training plan is built from the
							skills that job needs and the skills on your resume.
						</p>
						<Link to="/skills" className="btn btn-primary">
							Choose a target job
						</Link>
					</div>
				</div>
			) : (
				<>
					<PreferencesForm
						initial={initialPrefs}
						busy={building}
						onSubmit={buildPlan}
					/>
					{buildError && (
						<div className="alert alert-danger" role="alert">
							{buildError}
						</div>
					)}

					{!analysis ? (
						<div className="card shadow-sm">
							<div className="card-body">
								<p className="mb-0">
									No training plan for this job yet. Set your preferences above and
									press <strong>Update training plan</strong> to build one.
								</p>
							</div>
						</div>
					) : steps.length === 0 ? (
						<div className="alert alert-success" role="status">
							You already meet every requirement for {savedTarget.resolvedTitle}.
							No training needed.
						</div>
					) : (
						<>
							<div className="row g-3 mb-4">
								{[
									["Readiness now", `${Math.round(analysis.readiness ?? 0)}%`],
									["Skills to build", steps.length],
									["Total time", `${pathway.totalHours} h`],
									[
										"Duration",
										`${pathway.totalWeeks} week${pathway.totalWeeks === 1 ? "" : "s"}`,
									],
								].map(([label, value]) => (
									<div key={label} className="col-6 col-lg-3">
										<div className="card h-100 shadow-sm text-center">
											<div className="card-body">
												<div className="text-muted small">{label}</div>
												<div className="fs-4 fw-semibold">{value}</div>
											</div>
										</div>
									</div>
								))}
							</div>
							{analysis.summary && <p className="mb-4">{analysis.summary}</p>}

							{milestones.map((m) => (
								<section key={m.title} className="mb-4">
									<div className="d-flex justify-content-between align-items-baseline border-bottom mb-3 pb-1">
										<h4 className="mb-0">{m.title}</h4>
										<span className="text-muted small">
											by week {m.week} · {Math.round(m.readiness)}% ready
										</span>
									</div>
									{steps
										.filter((s) => (m.stepOrders ?? []).includes(s.order))
										.map((s) => (
											<StepCard key={s.skillId} step={s} />
										))}
								</section>
							))}
						</>
					)}
				</>
			)}
		</div>
	);
};

export default Training;