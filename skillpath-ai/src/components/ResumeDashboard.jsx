import { getDatabase, onValue, ref as dbRef } from "firebase/database";
import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Link, useNavigate } from "react-router-dom";
import { getSavedResumeDashboard } from "../backend/resumeDashboard.js";
import { deleteCurrentResume } from "../backend/resumeStorage.js";
import Loading from "./Loading.jsx";

/**
 * Resume dashboard: reads saved analysis from Realtime Database. The first
 * visit after a new resume runs a single callable and persists the results.
 * "Update resume" deletes the current resume before opening the upload page.
 */

const LEVEL_LABELS = [
	"None",
	"Awareness",
	"Beginner",
	"Intermediate",
	"Advanced",
	"Expert",
];
const DEGREE_ORDER = [
	"Doctorate",
	"Master's Degree",
	"Bachelor's Degree",
	"Associate Degree",
];
const EMPTY_RESULTS = { text: null, skills: null, analysis: null, unmapped: [], model: null };

const formatCategory = (category) =>
	category ? category.charAt(0).toUpperCase() + category.slice(1) : "Other";

const StatCard = ({ label, value, hint }) => (
	<div className="col-6 col-lg-3">
		<div className="card h-100 shadow-sm text-center">
			<div className="card-body">
				<div className="text-muted small">{label}</div>
				<div className="fs-4 fw-semibold">{value}</div>
				{hint && <div className="text-muted small">{hint}</div>}
			</div>
		</div>
	</div>
);

const SectionError = ({ message }) => (
	<div className="alert alert-danger py-2 mb-0" role="alert">
		{message}
	</div>
);

/**
 * Skill name that shows where the skill was found in the resume.
 * Opens on hover, keyboard focus, or tap (touch screens have no hover).
 * The popup is position: fixed so the table's scroll container can't clip it.
 */
const SkillEvidence = ({ name, evidence }) => {
	const anchor = useRef(null);
	const [pos, setPos] = useState(null); // where the popup sits while open
	const lines = (evidence ?? []).filter(Boolean);

	const open = () => {
		const rect = anchor.current?.getBoundingClientRect();
		if (!rect) return;
		const width = Math.min(360, window.innerWidth - 16);
		const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
		// Below the name, or above it when there isn't room underneath.
		const roomBelow = window.innerHeight - rect.bottom > 170;
		setPos(
			roomBelow
				? { left, width, top: rect.bottom + 6 }
				: { left, width, bottom: window.innerHeight - rect.top + 6 },
		);
	};
	const close = () => setPos(null);

	// Close when the page scrolls or resizes, since the popup is fixed in place.
	useEffect(() => {
		if (!pos) return undefined;
		window.addEventListener("scroll", close, true);
		window.addEventListener("resize", close);
		return () => {
			window.removeEventListener("scroll", close, true);
			window.removeEventListener("resize", close);
		};
	}, [pos]);

	return (
		<>
			<button
				ref={anchor}
				type="button"
				className="btn btn-link p-0 text-body text-decoration-none text-start align-baseline"
				style={{
					borderBottom: "1px dotted currentColor",
					borderRadius: 0,
					cursor: "help",
				}}
				aria-expanded={!!pos}
				onMouseEnter={open}
				onMouseLeave={close}
				onFocus={open}
				onBlur={close}
				onClick={() => (pos ? close() : open())}
				onKeyDown={(e) => e.key === "Escape" && close()}
			>
				{name}
			</button>
			{pos && (
				<div
					role="tooltip"
					className="bg-dark text-white rounded shadow p-2 small"
					style={{ position: "fixed", zIndex: 1080, pointerEvents: "none", ...pos }}
				>
					<div className="fw-semibold mb-1">Found in your resume</div>
					{lines.length > 0 ? (
						lines.map((line) => (
							<div key={line} className="mb-1 fst-italic">
								“{line}”
							</div>
						))
					) : (
						<div className="fst-italic">
							No example sentence was saved for this skill.
						</div>
					)}
				</div>
			)}
		</>
	);
};

const GAP_BADGE = { missing: "bg-danger", partial: "bg-warning text-dark" };

// The job the user is aiming for, chosen on the Skills page.
const TargetJobCard = ({ target, error }) => {
	const saved = target?.savedTarget;
	const latest = target?.latestAnalysis;
	const role = saved?.roleId
		? target.roles?.find((r) => r.id === saved.roleId)
		: null;
	const title = saved?.resolvedTitle || role?.title || saved?.title;
	// Only show the analysis if it was made for the job currently selected.
	const analysis =
		latest && title && latest.target?.title === title ? latest : null;
	const readiness = analysis ? Math.round(analysis.readiness ?? 0) : null;
	const gaps = analysis?.gaps ?? [];

	return (
		<div className="card shadow-sm mb-4">
			<div className="card-header d-flex justify-content-between align-items-center">
				<span>Target Job</span>
				<Link to="/skills" className="btn btn-sm btn-outline-primary">
					{saved ? "Change target job" : "Choose a target job"}
				</Link>
			</div>
			<div className="card-body">
				{error ? (
					<SectionError message={error} />
				) : !saved ? (
					<p className="text-muted mb-0">
						You haven't chosen a job to aim for yet. Pick one on the Skills
						page to see how your skills compare.
					</p>
				) : (
					<>
						<div className="d-flex flex-wrap justify-content-between align-items-baseline gap-2 mb-2">
							<div>
								<div className="fs-5 fw-semibold">{title}</div>
								<div className="text-muted small">
									{saved.custom
										? "From a pasted job description"
										: role?.onetCode
											? `O*NET ${role.onetCode}${role.onetTitle ? ` · ${role.onetTitle}` : ""}`
											: "SkillPath role"}
								</div>
							</div>
							{readiness !== null && (
								<div className="text-end">
									<div className="fs-4 fw-semibold">{readiness}%</div>
									<div className="text-muted small">ready</div>
								</div>
							)}
						</div>

						{analysis ? (
							<>
								<div
									className="progress mb-3"
									style={{ height: 8 }}
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
								{gaps.length > 0 ? (
									<>
										<div className="small text-muted mb-1">
											Skills to build
										</div>
										<ul className="list-unstyled mb-0">
											{gaps.slice(0, 5).map((gap) => (
												<li
													key={gap.skillId}
													className="d-flex justify-content-between border-bottom py-1"
												>
													<span>{gap.name}</span>
													<span className="small">
														<span className="text-muted me-2">
															{gap.currentLabel} → {gap.requiredLabel}
														</span>
														<span
															className={`badge ${GAP_BADGE[gap.status] ?? "bg-secondary"}`}
														>
															{gap.status}
														</span>
													</span>
												</li>
											))}
										</ul>
										{gaps.length > 5 && (
											<div className="small text-muted mt-2">
												+{gaps.length - 5} more on the Skills page
											</div>
										)}
									</>
								) : (
									<p className="mb-0">
										You meet every requirement for this job.
									</p>
								)}
							</>
						) : (
							<p className="text-muted mb-0">
								No comparison yet. Open the Skills page and press "Update
								target job" to compare your skills with this job.
							</p>
						)}
					</>
				)}
			</div>
		</div>
	);
};

const ResumeDashboard = () => {
	const uid = useSelector((state) => state.authedUser);
	const [results, setResults] = useState(EMPTY_RESULTS);
	const [errors, setErrors] = useState({});
	// Start in the loading state so the page never flashes "No results" before the first run.
	const [loading, setLoading] = useState(true);
	const [reloadCount, setReloadCount] = useState(0);
	const [target, setTarget] = useState(null);
	const [targetError, setTargetError] = useState("");
	const [resultSource, setResultSource] = useState(null);
	const navigate = useNavigate();
	const [confirmingDelete, setConfirmingDelete] = useState(false);
	const [deleting, setDeleting] = useState(false);
	const [deleteError, setDeleteError] = useState("");

	// "Update resume": delete the current resume (file, its path key and any
	// typed text), then go to the upload page for the new one.
	const replaceResume = async () => {
		setDeleting(true);
		setDeleteError("");
		try {
			await deleteCurrentResume(uid);
			navigate("/resume", { state: { replaced: true } });
		} catch (err) {
			setDeleteError(
				`Your current resume couldn't be deleted${err?.code ? ` (${err.code})` : ""}. Please try again.`,
			);
			setDeleting(false);
		}
	};

	// Target selection and gap analysis already live in Realtime Database.
	// Subscribe directly rather than calling list_target_roles each time.
	useEffect(() => {
		if (!uid) {
			setTarget(null);
			setTargetError("");
			return;
		}
		const database = getDatabase();
		let offAnalysis = () => {};
		const offProfile = onValue(
			dbRef(database, `users/${uid}/profile`),
			(snapshot) => {
				const profile = snapshot.val() ?? {};
				offAnalysis();
				setTargetError("");
				if (!profile.latestAnalysisId) {
					setTarget({ savedTarget: profile.target ?? null, latestAnalysis: null });
					return;
				}
				offAnalysis = onValue(
					dbRef(database, `users/${uid}/analyses/${profile.latestAnalysisId}`),
					(latest) => setTarget({
						savedTarget: profile.target ?? null,
						latestAnalysis: latest.val(),
					}),
					(error) => setTargetError(error.message),
				);
			},
			(error) => setTargetError(error.message),
		);
		return () => {
			offProfile();
			offAnalysis();
		};
	}, [uid]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reloadCount intentionally triggers a reload.
	useEffect(() => {
		if (!uid) {
			setResults(EMPTY_RESULTS);
			setErrors({});
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setErrors({});
		getSavedResumeDashboard(uid, { force: reloadCount > 0 })
			.then((snapshot) => {
				if (cancelled) return;
				setResults({
					text: snapshot.text,
					skills: snapshot.skills ?? [],
					unmapped: snapshot.unmapped ?? [],
					model: snapshot.model ?? null,
					analysis: snapshot.analysis,
				});
				setResultSource(snapshot.source);
			})
			.catch((error) => {
				if (cancelled) return;
				setResults(EMPTY_RESULTS);
				setErrors({ analysis: error?.message || "Resume analysis failed." });
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [uid, reloadCount]);

	if (!uid) {
		return (
			<div className="container mt-4 mb-5">
				<h2 className="mb-3">Resume Dashboard</h2>
				<p className="text-muted">Please sign in to see your dashboard.</p>
			</div>
		);
	}

	if (loading) {
		return (
			<Loading
				title="Building your dashboard…"
				detail="Reading your resume and identifying skills. This can take a minute the first time."
			/>
		);
	}

	const { text, skills, analysis } = results;
	const nothingLoaded = !text && !skills && !analysis;
	const advancedCount = skills?.filter((s) => s.level >= 4).length ?? 0;


	return (
		<div className="container mt-4 mb-5">
			<div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-4">
				<div>
					<h2 className="mb-0">Resume Dashboard</h2>
					{text && (
						<div className="text-muted small">
							{text.fileName} · {text.characterCount?.toLocaleString()}{" "}
							characters
						</div>
					)}
				</div>
				<div className="d-flex gap-2">
					<button
						type="button"
						className="btn btn-outline-secondary"
						onClick={() => setConfirmingDelete(true)}
						disabled={deleting || confirmingDelete}
					>
						Update resume
					</button>
					<button
						type="button"
						className="btn btn-outline-primary"
						onClick={() => setReloadCount((n) => n + 1)}
						disabled={deleting}
					>
						Reanalyze
					</button>
				</div>
			</div>

			{resultSource === "saved" && (
				<p className="text-muted small">Loaded saved analysis from Realtime Database.</p>
			)}

			{confirmingDelete && (
				<div
					className="alert alert-warning d-flex flex-wrap justify-content-between align-items-center gap-2"
					role="alert"
				>
					<span>
						Updating deletes your current resume. You'll then upload or type a
						new one.
					</span>
					<div className="d-flex gap-2">
						<button
							type="button"
							className="btn btn-sm btn-outline-secondary"
							onClick={() => {
								setConfirmingDelete(false);
								setDeleteError("");
							}}
							disabled={deleting}
						>
							Cancel
						</button>
						<button
							type="button"
							className="btn btn-sm btn-danger"
							onClick={replaceResume}
							disabled={deleting}
						>
							{deleting ? "Deleting…" : "Delete and continue"}
						</button>
					</div>
				</div>
			)}
			{deleteError && <SectionError message={deleteError} />}

			{nothingLoaded ? (
				// All three failed (usually: no resume uploaded yet), so show one message.
				<>
					<SectionError
						message={
							errors.text || errors.skills || errors.analysis || "No results."
						}
					/>
					<Link to="/resume" className="btn btn-primary mt-3">
						Upload or type a resume
					</Link>
				</>
			) : (
				<>
			
					

					<TargetJobCard target={target} error={targetError} />

					{/* Skills */}
					<div className="card shadow-sm mb-4">
						<div className="card-header">Skills</div>
						<div className="card-body">
							{errors.skills ? (
								<SectionError message={errors.skills} />
							) : (skills?.length ?? 0) === 0 ? (
								<p className="text-muted mb-0">No skills identified.</p>
							) : (
								<>
									<div className="table-responsive">
										<table className="table table-sm align-middle mb-0">
											<thead>
												<tr>
													<th>Skill</th>
													<th>Category</th>
													<th style={{ width: "45%" }}>Estimated level</th>
												</tr>
											</thead>
											<tbody>
												{skills.map((skill) => (
													<tr key={skill.skillId}>
														<td>
															<SkillEvidence
																name={skill.name}
																evidence={skill.evidence}
															/>
														</td>
														<td className="text-muted">
															{formatCategory(skill.category)}
														</td>
														<td>
															<div className="d-flex align-items-center gap-2">
																<div
																	className="progress flex-grow-1"
																	style={{ height: 8 }}
																	role="progressbar"
																	aria-label={`${skill.name} level`}
																	aria-valuenow={skill.level}
																	aria-valuemin={0}
																	aria-valuemax={5}
																>
																	<div
																		className="progress-bar"
																		style={{ width: `${skill.level * 20}%` }}
																	/>
																</div>
																<small
																	className="text-muted"
																	style={{ minWidth: 90 }}
																>
																	{LEVEL_LABELS[skill.level] ?? skill.level}
																</small>
															</div>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
									<p className="text-muted small mt-3 mb-0">
										Levels are estimated from how each skill is described in
										your resume. Hover over or tap a skill to see where it was found.
									</p>
								</>
							)}
						</div>
					</div>

				

					{/* Extracted text */}
					<div className="card shadow-sm">
						<div className="card-header">Resume Text</div>
						<div className="card-body">
							{errors.text ? (
								<SectionError message={errors.text} />
							) : (
								<details>
									<summary>Show extracted text</summary>
									<div
										className="border rounded p-3 bg-light mt-3"
										style={{
											whiteSpace: "pre-wrap",
											overflowWrap: "anywhere",
											maxHeight: 400,
											overflowY: "auto",
										}}
									>
										{text?.text}
									</div>
								</details>
							)}
						</div>
					</div>
				</>
			)}
		</div>
	);
};

export default ResumeDashboard;