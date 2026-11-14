import "../App.css";
import { Navigate, Route, Routes } from "react-router-dom";
import "bootstrap";
import "bootstrap/dist/css/bootstrap.css";
import "../layout.css"; // after App.css and Bootstrap: full-width page, fixed toolbar
import { library } from "@fortawesome/fontawesome-svg-core";
import { faBars } from "@fortawesome/free-solid-svg-icons";
import { onAuthStateChanged } from "firebase/auth";
import { useEffect } from "react";
import { connect } from "react-redux";
import { setAuthedUser } from "../actions/authedUsers.jsx";
import { setLoaded } from "../actions/loaded.jsx";
import { handleInitialData } from "../actions/shared.jsx";
import { auth } from "../backend/firebase.jsx";
import Login from "./Login.jsx";
import NewUser from "./NewUser.jsx";
import ResumeDashboard from "./ResumeDashboard.jsx";
import ResumeSkills from "./ResumeSkills.jsx";
import ResumeUpload from "./ResumeUpload.jsx";
import Toolbar from "./Toolbar.jsx";
import Training from "./Training.jsx";

library.add(faBars);

// authedUser: null when logged out, the Firebase uid when logged in.
// loaded:     null until Firebase reports the login state; then
//             true  = nothing to wait for (logged out, or user data loaded)
//             false = logged in, user data still loading
function App({ authedUser, loaded, dispatch }) {
	useEffect(() => {
		// We removed const auth = getAuth() from here because it is now imported from firebase.jsx!

		const unsubscribe = onAuthStateChanged(auth, (user) => {
			if (user) {
				dispatch(setAuthedUser(user.uid));
				dispatch(setLoaded(false)); // Start the loading screen while data fetches
			} else {
				dispatch(setAuthedUser(null));
				dispatch(setLoaded(true)); // Stop loading so the login screen appears
			}
		});

		return () => unsubscribe();
	}, [dispatch]);

	// 2. Fetch the user's data from the database once they are logged in
	useEffect(() => {
		if (authedUser) {
			dispatch(handleInitialData(authedUser));
		}
	}, [authedUser, dispatch]);

	// Firebase hasn't said yet whether someone is logged in
	if (authedUser === null && !loaded) {
		return (
			<Routes>
				<Route path="/login" element={<Login />} />
				<Route path="/new" element={<NewUser />} />
				<Route path="*" element={<Navigate to="/login" replace />} />
			</Routes>
		);
	}

	// Logged out: only the login, sign-up and reset pages are reachable
	if (authedUser === null) {
		return (
			<div className="App">
				<Routes>
					<Route path="/login" element={<Login />} />
					<Route path="/new" element={<NewUser />} />
					<Route path="*" element={<Navigate to="/login" replace />} />
				</Routes>
			</div>
		);
	}

	// Logged in
	return (
		<div className="App">
			<Toolbar></Toolbar>
			<Routes>
				<Route path="/resume" element={<ResumeUpload />} />
				<Route path="/skills" element={<ResumeSkills />} />
				<Route path="/dashboard" element={<ResumeDashboard />} />
				<Route path="/training" element={<Training />} />
				<Route path="*" element={<Navigate to="/dashboard" replace />} />
			</Routes>
		</div>
	);
}

const mapStateToProps = ({ authedUser, loaded }) => {
	return {
		authedUser,
		loaded,
	};
};

export default connect(mapStateToProps)(App);