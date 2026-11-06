import { useState } from "react";
import { useSelector } from "react-redux";
import { saveResumeText, uploadResume } from "../backend/firebase";

const ResumeUpload = () => {
	const uid = useSelector((state) => state.authedUser);
	const [mode, setMode] = useState("file");
	const [file, setFile] = useState(null);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");

	const handleFileChange = (e) => {
		const selected = e.target.files[0];
		if (!selected) return;

		// Validate file type (PDF or DOCX)
		if (
			selected.type === "application/pdf" ||
			selected.name.endsWith(".pdf") ||
			selected.type ===
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
			selected.name.endsWith(".docx")
		) {
			setFile(selected);
			setError("");
		} else {
			setFile(null);
			setError("Please select a valid PDF or DOCX file.");
			e.target.value = null; // Clear the input
		}
	};

	const handleSubmit = (e) => {
		e.preventDefault();
		setError("");
		setMessage("");

		if (mode === "file") {
			if (!file) {
				setError("Please select a file to upload.");
				return;
			}
			setBusy(true);
			uploadResume(uid, file)
				.then(() => setMessage("Resume uploaded successfully!"))
				.catch((err) => setError(`Failed·to·upload·file:·${err.message}`))
				.finally(() => setBusy(false));
		} else {
			if (text.trim() === "") {
				setError("Please type or paste your resume text.");
				return;
			}
			setBusy(true);
			saveResumeText(uid, text)
				.then(() => setMessage("Resume text saved successfully!"))
				.catch((err) => setError(`Failed·to·save·text:·${err.message}`))
				.finally(() => setBusy(false));
		}
	};

	return (
		<div className="container mt-4">
			<div className="card shadow-sm mx-auto" style={{ maxWidth: 600 }}>
				<div className="card-header">Upload or Type Your Resume</div>
				<div className="card-body">
					{error && <div className="alert alert-danger py-2">{error}</div>}
					{message && <div className="alert alert-success py-2">{message}</div>}

					{/* Toggle between File and Text modes */}
					<fieldset className="btn-group w-100 mb-4 border-0 p-0">
						<legend className="visually-hidden">
							Choose resume input method
						</legend>
						<input
							type="radio"
							className="btn-check"
							id="btn-file"
							autoComplete="off"
							checked={mode === "file"}
							onChange={() => setMode("file")}
						/>
						<label className="btn btn-outline-primary" htmlFor="btn-file">
							Upload File
						</label>

						<input
							type="radio"
							className="btn-check"
							id="btn-text"
							autoComplete="off"
							checked={mode === "text"}
							onChange={() => setMode("text")}
						/>
						<label className="btn btn-outline-primary" htmlFor="btn-text">
							Type Resume
						</label>
					</fieldset>

					<form onSubmit={handleSubmit}>
						{mode === "file" ? (
							<div className="mb-3">
								<label htmlFor="resumeFile" className="form-label">
									Select PDF or DOCX
								</label>
								<input
									className="form-control"
									type="file"
									id="resumeFile"
									accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
									onChange={handleFileChange}
								/>
							</div>
						) : (
							<div className="mb-3">
								<label htmlFor="resumeText" className="form-label">
									Paste or Type Resume
								</label>
								<textarea
									className="form-control"
									id="resumeText"
									rows="10"
									value={text}
									onChange={(e) => setText(e.target.value)}
									placeholder="Paste your resume contents here..."
								></textarea>
							</div>
						)}

						<button
							type="submit"
							className="btn btn-primary w-100"
							disabled={busy}
						>
							{busy ? "Saving..." : "Save Resume"}
						</button>
					</form>
				</div>
			</div>
		</div>
	);
};

export default ResumeUpload;
