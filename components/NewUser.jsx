import { useState } from "react";
import { Link } from "react-router-dom";
import {
  authErrorMessage,
  createAccount,
  signInWithGoogle
} from "../skillpath-ai/src/backend/firebase.jsx";
 
// Creating the account also signs the user in. The auth listener in
// backend/firebase.js then updates Redux and App.js shows the dashboard.
const NewUser = () => {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
 
  // Validates the form and creates the account.
  const saveUser = (e) => {
    e.preventDefault();
    setError("");
 
    if (
      firstName.trim() === "" ||
      lastName.trim() === "" ||
      email.trim() === "" ||
      password === "" ||
      confirmPassword === ""
    ) {
      setError("Please fill in all fields.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("The passwords do not match.");
      return;
    }
 
    setBusy(true);
    createAccount(email.trim(), password, {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
    }).catch((err) => {
      setError(authErrorMessage(err));
      setBusy(false);
    });
  };
 
  const googleSignUp = () => {
    setError("");
    setBusy(true);
    signInWithGoogle()
      .catch((err) => setError(authErrorMessage(err)))
      .finally(() => setBusy(false));
  };
 
  return (
    <div
      style={{ background: "#f1f1f1" }}
      className="d-flex min-vh-100 flex-column"
      id="content-wrapper"
    >
      <div className="container">
        <div className="card shadow-sm mx-auto mt-5" style={{ maxWidth: 480 }}>
          <div className="card-header">Create your SkillPath account</div>
          <div className="card-body">
            {error && (
              <div className="alert alert-danger py-2" role="alert">
                {error}
              </div>
            )}
 
            <form onSubmit={saveUser} noValidate>
              <div className="row">
                <div className="col-sm-6 mb-3">
                  <label htmlFor="firstName" className="form-label">
                    First name
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    className="form-control"
                    autoComplete="given-name"
                    autoFocus
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                  />
                </div>
                <div className="col-sm-6 mb-3">
                  <label htmlFor="lastName" className="form-label">
                    Last name
                  </label>
                  <input
                    id="lastName"
                    type="text"
                    className="form-control"
                    autoComplete="family-name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                  />
                </div>
              </div>
 
              <div className="mb-3">
                <label htmlFor="email" className="form-label">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className="form-control"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
 
              <div className="mb-3">
                <label htmlFor="password" className="form-label">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  className="form-control"
                  autoComplete="new-password"
                  aria-describedby="passwordHelp"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <div id="passwordHelp" className="form-text">
                  At least 6 characters.
                </div>
              </div>
 
              <div className="mb-3">
                <label htmlFor="confirmPassword" className="form-label">
                  Confirm password
                </label>
                <input
                  id="confirmPassword"
                  type="password"
                  className="form-control"
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
 
              <button
                type="submit"
                className="btn btn-primary w-100"
                disabled={busy}
              >
                {busy ? "Creating account…" : "Create account"}
              </button>
            </form>
 
            <div className="text-center text-secondary small my-3">or</div>
 
            <button
              type="button"
              className="btn btn-outline-secondary w-100"
              onClick={googleSignUp}
              disabled={busy}
            >
              Sign up with Google
            </button>
 
            <p className="small text-center mt-3 mb-0">
              Already have an account? <Link to="/login">Log in</Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
 
export default NewUser;

