import { ref as dbRef, get, getDatabase, set } from "firebase/database";
import { uploadBytesResumable } from "firebase/storage";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useLocation, useNavigate } from "react-router-dom";
import {
	deleteResumeFile,
	RESUME_PATH_KEY,
	resumeFileRef,
} from "../backend/resumeStorage.js";

/**
 * Resume upload page: upload a PDF or Word file, or type/paste the resume.
 *
 * Matches what the Cloud Functions in functions/main.py read:
 * - uploaded file -> Storage object `resume/{uid}` (no extension; the server
 *   detects PDF or DOCX from the file contents)
 * - typed resume  -> Realtime Database `users/{uid}/resumeText`
 *
 * A user has one resume at a time. Submitting a new one deletes the old one:
 * - new file  -> overwrites `resume/{uid}` and deletes any typed resume
 * - new text  -> saved, then the uploaded file `resume/{uid}` is deleted
 * The old resume is only removed once the new one is safely stored, so a
 * failed upload never leaves the user with no resume at all.
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024; // server rejects files of 5 MB or more
const MAX_TEXT_CHARS = 100_000; // server limit for typed resumes
const MIN_TEXT_CHARS = 50;
const ACCEPT =
	".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const formatSize = (bytes) =>
	bytes < 1024 * 1024
		? `${Math.max(1, Math.round(bytes / 1024))} KB`
		: `${(bytes / (1024 * 1024)).toFixed(1)} MB`;

// Returns an error message, or "" if the file is acceptable.
const validateFile = (file) => {
	if (!file) return "Choose a file to upload.";
	const name = file.name.toLowerCase();
	if (!name.endsWith(".pdf") && !name.endsWith(".docx")) {
		return "Upload a PDF or Word (.docx) file. Older .doc files aren't supported.";
	}
	if (file.size >= MAX_FILE_BYTES) {
		return `That file is ${formatSize(file.size)}. Resumes must be smaller than 5 MB.`;
	}
	if (file.size === 0) return "That file is empty.";
	return "";
};

const ResumeUpload = () => {
	const uid = useSelector((state) => state.authedUser);
	const navigate = useNavigate();
	// The dashboard's "Update resume" button deletes the old resume first,
	// then opens this page with { replaced: true }.
	const replaced = useLocation().state?.replaced === true;

	const [mode, setMode] = useState("file"); // "file" | "text"
	const [file, setFile] = useState(null);
	const [dragging, setDragging] = useState(false);
	const [text, setText] = useState("");
	const [progress, setProgress] = useState(null); // 0-100 while uploading
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	// Pre-fill a previously typed resume so the user can edit it.
	useEffect(() => {
		if (!uid) return;
		let cancelled = false;
		get(dbRef(getDatabase(), `users/${uid}/resumeText`))
			.then((snap) => {
				const saved = snap.val();
				if (!cancelled && typeof saved === "string" && saved.trim()) {
					setText(saved);
					setMode("text");
				}
			})
			.catch(() => {
				/* nothing saved, or not readable: start empty */
			});
		return () => {
			cancelled = true;
		};
	}, [uid]);

	const pickFile = (picked) => {
		setError(validateFile(picked));
		setFile(picked ?? null);
	};

	const handleDrop = (event) => {
		event.preventDefault();
		setDragging(false);
		if (!saving) pickFile(event.dataTransfer.files?.[0]);
	};

	const uploadFile = async () => {
		const problem = validateFile(file);
		if (problem) {
			setError(problem);
			return;
		}
		setSaving(true);
		setError("");
		setProgress(0);
		try {
			// Uploading to the same path replaces (deletes) the previous file.
			const task = uploadBytesResumable(resumeFileRef(uid), file, {
				contentType: file.type || undefined,
				customMetadata: { originalName: file.name },
			});
			await new Promise((resolve, reject) => {
				task.on(
					"state_changed",
					(snap) =>
						setProgress(
							Math.round((snap.bytesTransferred / snap.totalBytes) * 100),
						),
					reject,
					resolve,
				);
			});
			// Delete the typed resume too; the server would otherwise keep using it.
			await set(dbRef(getDatabase(), `users/${uid}/resumeText`), null);
			await set(
				dbRef(getDatabase(), `users/${uid}/${RESUME_PATH_KEY}`),
				`resume/${uid}`,
			);
			navigate("/dashboard");
		} catch (err) {
			setError(
				err?.code === "storage/unauthorized"
					? "You don't have permission to upload this file. Try signing out and back in."
					: err?.message || "Upload failed. Please try again.",
			);
			setSaving(false);
			setProgress(null);
		}
	};

	const saveText = async () => {
		const trimmed = text.trim();
		if (trimmed.length < MIN_TEXT_CHARS) {
			setError("Paste your full resume (at least a few lines).");
			return;
		}
		setSaving(true);
		setError("");
		try {
			await set(dbRef(getDatabase(), `users/${uid}/resumeText`), trimmed);
		} catch (err) {
			setError(err?.message || "Saving failed. Please try again.");
			setSaving(false);
			return;
		}
		try {
			// New text is saved, so the old uploaded file and its path key can go.
			await deleteResumeFile(uid);
			await set(dbRef(getDatabase(), `users/${uid}/${RESUME_PATH_KEY}`), null);
		} catch (err) {
			setError(
				"Your new resume was saved, but the old uploaded file couldn't be deleted" +
					(err?.code ? ` (${err.code})` : "") +
					". Try again, or continue to the dashboard.",
			);
			setSaving(false);
			return;
		}
		navigate("/dashboard");
	};

	const handleSubmit = (event) => {
		event.preventDefault();
		if (saving) return;
		if (mode === "file") uploadFile();
		else saveText();
	};

	if (!uid) {
		return (
			<div className="container mt-4 mb-5">
				<h2 className="mb-3">My Resume</h2>
				<p className="text-muted">Please sign in to upload your resume.</p>
			</div>
		);
	}

	const fileError = mode === "file" ? validateFile(file) : "";
	const canSubmit =
		!saving &&
		(mode === "file" ? !fileError : text.trim().length >= MIN_TEXT_CHARS);

	return (
		<div className="container mt-4 mb-5">
			<h2 className="text-center mb-2">My Resume</h2>
			<p className="text-center text-muted mb-4">
				Upload your resume or paste it below. We'll identify your skills from
				it.
			</p>

			{replaced && (
				<div
					className="alert alert-info mx-auto"
					style={{ maxWidth: 750 }}
					role="status"
				>
					Your previous resume was deleted. Upload or type your new one.
				</div>
			)}

			<div className="card shadow-sm mx-auto" style={{ maxWidth: 750 }}>
				<div className="card-header">
					<ul className="nav nav-tabs card-header-tabs">
						<li className="nav-item">
							<button
								type="button"
								className={`nav-link ${mode === "file" ? "active" : ""}`}
								onClick={() => {
									setMode("file");
									setError("");
								}}
								disabled={saving}
							>
								Upload a file
							</button>
						</li>
						<li className="nav-item">
							<button
								type="button"
								className={`nav-link ${mode === "text" ? "active" : ""}`}
								onClick={() => {
									setMode("text");
									setError("");
								}}
								disabled={saving}
							>
								Type or paste
							</button>
						</li>
					</ul>
				</div>

				<form className="card-body" onSubmit={handleSubmit}>
					{mode === "file" ? (
						<>
							<label
								htmlFor="resume-file"
								className={`d-block border border-2 rounded p-4 text-center mb-3 ${
									dragging
										? "border-primary bg-light"
										: "border-secondary-subtle"
								}`}
								style={{
									borderStyle: "dashed",
									cursor: saving ? "default" : "pointer",
								}}
								onDragOver={(e) => {
									e.preventDefault();
									setDragging(true);
								}}
								onDragLeave={() => setDragging(false)}
								onDrop={handleDrop}
							>
								{file ? (
									<>
										<div className="fw-semibold">{file.name}</div>
										<div className="text-muted small">
											{formatSize(file.size)} · click to choose a different file
										</div>
									</>
								) : (
									<>
										<div className="fw-semibold">
											Drag your resume here, or click to choose a file
										</div>
										<div className="text-muted small">
											PDF or Word (.docx), smaller than 5 MB
										</div>
									</>
								)}
							</label>
							<input
								id="resume-file"
								type="file"
								accept={ACCEPT}
								className="d-none"
								disabled={saving}
								onChange={(e) => {
									pickFile(e.target.files?.[0]);
									e.target.value = ""; // allow re-picking the same file
								}}
							/>
							{progress !== null && (
								<div
									className="progress mb-3"
									role="progressbar"
									aria-label="Upload progress"
									aria-valuenow={progress}
									aria-valuemin={0}
									aria-valuemax={100}
								>
									<div
										className="progress-bar"
										style={{ width: `${progress}%` }}
									>
										{progress}%
									</div>
								</div>
							)}
							<p className="text-muted small">
								Scanned PDFs (photos of paper) have no readable text. If yours
								is one, use "Type or paste" instead.
							</p>
						</>
					) : (
						<div className="mb-3">
							<label htmlFor="resume-text" className="form-label">
								Resume text
							</label>
							<textarea
								id="resume-text"
								className="form-control"
								rows={14}
								maxLength={MAX_TEXT_CHARS}
								placeholder="Paste your resume here: experience, education and skills"
								value={text}
								onChange={(e) => setText(e.target.value)}
								disabled={saving}
							/>
							<div className="form-text">
								{text.length.toLocaleString()} /{" "}
								{MAX_TEXT_CHARS.toLocaleString()} characters. Saving this
								deletes any uploaded resume file.
							</div>
						</div>
					)}

					{error && (
						<div className="alert alert-danger py-2" role="alert">
							{error}
						</div>
					)}

					<div className="d-flex justify-content-between align-items-center">
						<button
							type="submit"
							className="btn btn-primary"
							disabled={!canSubmit}
						>
							{saving
								? mode === "file"
									? "Uploading…"
									: "Saving…"
								: mode === "file"
									? "Upload resume"
									: "Save resume"}
						</button>
					</div>
				</form>
			</div>
		</div>
	);
};

export default ResumeUpload;
