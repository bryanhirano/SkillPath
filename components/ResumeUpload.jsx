
import { useState } from "react";
import { useSelector } from "react-redux";

import {
  uploadResume,
  saveResumeText,
  extractResumeText,
  analyzeResume
} from "../skillpath-ai/src/backend/firebase.jsx";

const ResumeUpload = () => {
  const uid = useSelector((state) => state.authedUser);

  const [mode, setMode] = useState("file");
  const [file, setFile] = useState(null);
  const [text, setText] = useState("");

  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);

  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const [extractedText, setExtractedText] = useState("");
  const [extractedFileName, setExtractedFileName] = useState("");

  const [analysis, setAnalysis] = useState(null);

  const isBusy = busy || extracting || analyzing;

  // ==========================================
  // SELECT RESUME FILE
  // ==========================================

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0];

    if (!selected) {
      setFile(null);
      return;
    }

    const name = selected.name.toLowerCase();

    if (name.endsWith(".pdf") || name.endsWith(".docx")) {
      setFile(selected);
      setError("");
      setMessage("");
      setExtractedText("");
      setExtractedFileName("");
      setAnalysis(null);
    } else {
      setFile(null);
      setError("Please select a valid PDF or DOCX file.");
      e.target.value = "";
    }
  };

  // ==========================================
  // SAVE RESUME
  // ==========================================

  const handleSubmit = async (e) => {
    e.preventDefault();

    setError("");
    setMessage("");

    if (!uid) {
      setError("Please sign in first.");
      return;
    }

    if (mode === "file" && !file) {
      setError("Please select a file to upload.");
      return;
    }

    if (mode === "text" && !text.trim()) {
      setError("Please type or paste your resume text.");
      return;
    }

    setBusy(true);

    try {
      if (mode === "file") {
        await uploadResume(uid, file);

        setMessage("Resume uploaded successfully!");
        setExtractedText("");
        setExtractedFileName("");
        setAnalysis(null);
      } else {
        await saveResumeText(uid, text);
        setMessage("Resume text saved successfully!");
        setAnalysis(null);
      }
    } catch (err) {
      setError(
        mode === "file"
          ? "Failed to upload file: " + err.message
          : "Failed to save text: " + err.message
      );
    } finally {
      setBusy(false);
    }
  };

  // ==========================================
  // EXTRACT TEXT USING PYTHON
  // ==========================================

  const handleExtract = async () => {
    setError("");
    setMessage("");
    setExtractedText("");
    setExtractedFileName("");
    setAnalysis(null);

    if (!uid) {
      setError("Please sign in first.");
      return;
    }

    setExtracting(true);

    try {
      const result = await extractResumeText();

      if (result.status !== "success") {
        throw new Error("Resume extraction was unsuccessful.");
      }

      setExtractedText(result.text || "");
      setExtractedFileName(result.fileName || "");
      setMessage("Resume text extracted successfully!");
    } catch (err) {
      setError("Failed to extract resume: " + err.message);
    } finally {
      setExtracting(false);
    }
  };

  // ==========================================
  // ANALYZE RESUME USING PYTHON
  // ==========================================

  const handleAnalyze = async () => {
    setError("");
    setMessage("");
    setAnalysis(null);

    if (!uid) {
      setError("Please sign in first.");
      return;
    }

    setAnalyzing(true);

    try {
      const result = await analyzeResume();

      if (result.status !== "success") {
        throw new Error("Resume analysis was unsuccessful.");
      }

      setAnalysis(result);
      setMessage("Resume analysis completed successfully!");
    } catch (err) {
      setError("Failed to analyze resume: " + err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <div className="container mt-4 mb-5">
      <div
        className="card shadow-sm mx-auto"
        style={{ maxWidth: 750 }}
      >
        <div className="card-header">
          Upload or Type Your Resume
        </div>

        <div className="card-body">
          {error && (
            <div className="alert alert-danger py-2" role="alert">
              {error}
            </div>
          )}

          {message && (
            <div className="alert alert-success py-2" role="status">
              {message}
            </div>
          )}

          {/* Upload or text mode */}
          <div className="btn-group w-100 mb-4" role="group">
            <input
              type="radio"
              className="btn-check"
              id="btn-file"
              autoComplete="off"
              checked={mode === "file"}
              onChange={() => setMode("file")}
              disabled={isBusy}
            />
            <label
              className="btn btn-outline-primary"
              htmlFor="btn-file"
            >
              Upload File
            </label>

            <input
              type="radio"
              className="btn-check"
              id="btn-text"
              autoComplete="off"
              checked={mode === "text"}
              onChange={() => setMode("text")}
              disabled={isBusy}
            />
            <label
              className="btn btn-outline-primary"
              htmlFor="btn-text"
            >
              Type Resume
            </label>
          </div>

          {/* Resume form */}
          <form onSubmit={handleSubmit}>
            {mode === "file" ? (
              <div className="mb-3">
                <label
                  htmlFor="resumeFile"
                  className="form-label"
                >
                  Select PDF or DOCX
                </label>
                <input
                  className="form-control"
                  type="file"
                  id="resumeFile"
                  accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={handleFileChange}
                  disabled={isBusy}
                />
              </div>
            ) : (
              <div className="mb-3">
                <label
                  htmlFor="resumeText"
                  className="form-label"
                >
                  Paste or Type Resume
                </label>
                <textarea
                  className="form-control"
                  id="resumeText"
                  rows="10"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Paste your resume contents here..."
                  disabled={isBusy}
                />
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary w-100"
              disabled={isBusy}
            >
              {busy ? "Saving..." : "Save Resume"}
            </button>
          </form>

          {/* Resume text extraction */}
          <hr className="my-4" />

          <h5>Resume Text Extraction</h5>

          <p className="text-muted">
            Extract text from your most recently
            uploaded PDF or DOCX resume using
            the Python backend.
          </p>

          <button
            type="button"
            className="btn btn-success w-100"
            onClick={handleExtract}
            disabled={isBusy}
          >
            {extracting
              ? "Extracting Resume Text..."
              : "Extract Resume Text"}
          </button>

          {extractedText && (
            <div className="mt-4">
              <h5>Extracted Resume</h5>

              {extractedFileName && (
                <p>
                  <strong>File:</strong>{" "}
                  {extractedFileName}
                </p>
              )}

              <div
                className="border rounded p-3 bg-light"
                style={{
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                  maxHeight: 400,
                  overflowY: "auto"
                }}
              >
                {extractedText}
              </div>

              <p className="text-muted mt-2">
                Characters extracted: {extractedText.length}
              </p>
            </div>
          )}

          {/* Structured resume analysis */}
          <hr className="my-4" />

          <h5>Resume Analysis</h5>

          <p className="text-muted">
            Identify skills, education, experience,
            and occupations from your most recently
            uploaded resume.
          </p>

          <button
            type="button"
            className="btn btn-primary w-100"
            onClick={handleAnalyze}
            disabled={isBusy}
          >
            {analyzing
              ? "Analyzing Resume..."
              : "Analyze Resume"}
          </button>

          {analysis && (
            <div className="mt-4">
              <h5>Analysis Results</h5>

              <p>
                <strong>File:</strong>{" "}
                {analysis.fileName}
              </p>

              <p>
                <strong>Analysis method:</strong>{" "}
                {analysis.analysisType === "rule-based"
                  ? "Rule-based prototype"
                  : analysis.analysisType || "Unknown"}
              </p>

              <p>
                <strong>Experience:</strong>{" "}
                {analysis.yearsExperience != null
                  ? `${analysis.yearsExperience} years mentioned`
                  : "Not identified"}
              </p>

              <h6>Identified Skills</h6>

              {analysis.skills?.length > 0 ? (
                <div className="mb-3">
                  {analysis.skills.map((skill) => (
                    <span
                      key={skill}
                      className="badge bg-secondary me-2 mb-2"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-muted">
                  No skills matched the current catalog.
                </p>
              )}

              <h6>Education Mentioned</h6>

              {analysis.education?.length > 0 ? (
                <ul>
                  {analysis.education.map((degree) => (
                    <li key={degree}>{degree}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">
                  No degree keywords identified.
                </p>
              )}

              <h6>Occupations Mentioned</h6>

              {analysis.possibleOccupations?.length > 0 ? (
                <ul>
                  {analysis.possibleOccupations.map(
                    (occupation) => (
                      <li key={occupation}>
                        {occupation}
                      </li>
                    )
                  )}
                </ul>
              ) : (
                <p className="text-muted">
                  No occupations matched the current catalog.
                </p>
              )}

              <div className="alert alert-info mt-3">
                This is preliminary keyword-based analysis,
                not an AI-generated career recommendation.
                Review the results for accuracy.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ResumeUpload;
