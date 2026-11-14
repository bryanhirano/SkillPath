import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { Link } from "react-router-dom";
import {
	analyzeResume,
	extractResumeText,
	identifyResumeSkills,
} from "../backend/firebase.jsx";
import Loading from "./Loading.jsx";

/**
 * Resume dashboard: runs extract_resume_text, identify_resume_skills and
 * analyze_resume together for the signed-in user and shows the results.
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
const EMPTY_RESULTS = { text: null, skills: null, analysis: null };

const formatCategory = (category) =>
	category ? category.charAt(0).toUpperCase() + category.slice(1) : "Other";

// Turn one Promise.allSettled entry into { value, error }.
const settle = (result, fallbackError) => {
	if (result.status === "rejected") {
		return { value: null, error: result.reason?.message || fallbackError };
	}
	if (result.value?.status !== "success") {
		return { value: null, error: fallbackError };
	}
	return { value: result.value, error: "" };
};

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

const ResumeDashboard = () => {
	const uid = useSelector((state) => state.authedUser);
	const [results, setResults] = useState(EMPTY_RESULTS);
	const [errors, setErrors] = useState({});
	// Start in the loading state so the page never flashes "No results" before the first run.
	const [loading, setLoading] = useState(true);
	const [reloadCount, setReloadCount] = useState(0);

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

		Promise.allSettled([
			extractResumeText(),
			identifyResumeSkills(),
			analyzeResume(),
		]).then(([textResult, skillsResult, analysisResult]) => {
			if (cancelled) return;
			const text = settle(textResult, "Resume text extraction failed.");
			const skills = settle(skillsResult, "Skill identification failed.");
			const analysis = settle(analysisResult, "Resume analysis failed.");

			setResults({
				text: text.value,
				skills: skills.value ? (skills.value.skills ?? []) : null,
				analysis: analysis.value,
			});
			setErrors({
				text: text.error,
				skills: skills.error,
				analysis: analysis.error,
			});
			setLoading(false);
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
	const highestDegree = DEGREE_ORDER.find((degree) =>
		analysis?.education?.includes(degree),
	);

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
					<Link
						to="/resume"
						state={{ replace: true }}
						className="btn btn-outline-secondary"
					>
						Update resume
					</Link>
					<button
						type="button"
						className="btn btn-outline-primary"
						onClick={() => setReloadCount((n) => n + 1)}
					>
						Refresh
					</button>
				</div>
			</div>

			{nothingLoaded ? (
				// All three failed (usually: no resume uploaded yet), so show one message.
				<>
					<SectionError
						message={
							errors.text || errors.skills || errors.analysis || "No results."
						}
					/>
					<Link
						to="/resume"
						state={{ replace: true }}
						className="btn btn-primary mt-3"
					>
						Upload or type a resume
					</Link>
				</>
			) : (
				<>
					{/* Summary tiles */}
					<div className="row g-3 mb-4">
						<StatCard label="Skills identified" value={skills?.length ?? "—"} />
						<StatCard
							label="Advanced or expert"
							value={skills ? advancedCount : "—"}
							hint="estimated"
						/>
						<StatCard
							label="Experience"
							value={
								analysis?.yearsExperience != null
									? `${analysis.yearsExperience} yrs`
									: "—"
							}
						/>
						<StatCard label="Highest education" value={highestDegree ?? "—"} />
					</div>

					{/* Skills */}
					<div className="card shadow-sm mb-4">
						<div className="card-header">Skills</div>
						<div className="card-body">
							{errors.skills ? (
								<SectionError message={errors.skills} />
							) : skills.length === 0 ? (
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
														<td title={skill.evidence?.join("\n")}>
															{skill.name}
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
										your resume. Hover over a skill to see where it was found.
									</p>
								</>
							)}
						</div>
					</div>

					{/* Education and occupations */}
					<div className="row g-3 mb-4">
						<div className="col-md-6">
							<div className="card shadow-sm h-100">
								<div className="card-header">Education Mentioned</div>
								<div className="card-body">
									{errors.analysis ? (
										<SectionError message={errors.analysis} />
									) : analysis.education?.length > 0 ? (
										<ul className="mb-0">
											{analysis.education.map((degree) => (
												<li key={degree}>{degree}</li>
											))}
										</ul>
									) : (
										<p className="text-muted mb-0">No degrees identified.</p>
									)}
								</div>
							</div>
						</div>
						<div className="col-md-6">
							<div className="card shadow-sm h-100">
								<div className="card-header">Occupations Mentioned</div>
								<div className="card-body">
									{errors.analysis ? (
										<SectionError message={errors.analysis} />
									) : analysis.possibleOccupations?.length > 0 ? (
										<ul className="mb-0">
											{analysis.possibleOccupations.map((occupation) => (
												<li key={occupation}>{occupation}</li>
											))}
										</ul>
									) : (
										<p className="text-muted mb-0">
											No occupations identified.
										</p>
									)}
								</div>
							</div>
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
										{text.text}
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
