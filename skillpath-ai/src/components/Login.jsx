import { useState } from "react";
import { Link } from "react-router-dom";
import {
  authErrorMessage,
  signInUser,
  signInWithGoogle,
} from "../backend/firebase";
 
// After a successful sign-in, the auth listener in backend/firebase.js updates
// Redux and App.js swaps these pages for the dashboard. No navigation needed here.
const Login = () => {
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
 
  const logIn = (e) => {
    e.preventDefault();
    setError("");
 
    if (email.trim() === "" || pass === "") {
      setError("Enter your email and password.");
      return;
    }
 
    setBusy(true);
    signInUser(email.trim(), pass)
      .catch((err) => setError(authErrorMessage(err)))
      .finally(() => setBusy(false));
  };
 
  const googleLogIn = () => {
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
        <div className="card shadow-sm mx-auto mt-5" style={{ maxWidth: 420 }}>
          <div className="card-header">Log in to SkillPath</div>
          <div className="card-body">
            {error && (
              <div className="alert alert-danger py-2" role="alert">
                {error}
              </div>
            )}
 
            <form onSubmit={logIn} noValidate>
              <div className="mb-3">
                <label htmlFor="email" className="form-label">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  className="form-control"
                  autoComplete="email"
                  autoFocus
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
                  autoComplete="current-password"
                  value={pass}
                  onChange={(e) => setPass(e.target.value)}
                />
              </div>
 
              <button
                type="submit"
                className="btn btn-primary w-100"
                disabled={busy}
              >
                {busy ? "Logging in…" : "Log in"}
              </button>
            </form>
 
            <div className="text-center text-secondary small my-3">or</div>
 
            <button
              type="button"
              className="btn btn-outline-secondary w-100"
              onClick={googleLogIn}
              disabled={busy}
            >
              Continue with Google
            </button>
 
            <div className="d-flex justify-content-between small mt-3">
              <Link to="/reset">Forgot your password?</Link>
              <Link to="/new">Create an account</Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
 
export default Login;