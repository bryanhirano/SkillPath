
import '../skillpath-ai/src/App.css';

import { Route, Routes, Navigate } from 'react-router-dom';
import 'bootstrap/dist/css/bootstrap.css';
import { connect } from 'react-redux';
import { useEffect } from 'react';

import { library } from '@fortawesome/fontawesome-svg-core';
import { faBars } from '@fortawesome/free-solid-svg-icons';

import { onAuthStateChanged } from 'firebase/auth';

// Application components
import Login from './Login.jsx';
import Loading from './Loading.jsx';
import NewUser from './NewUser.jsx';
import ResumeUpload from './ResumeUpload.jsx';
import Toolbar from './Toolbar.jsx';
import BackendTest from '../skillpath-ai/src/backend/components/BackendTest.jsx';
// Redux actions
import { handleInitialData } from '../skillpath-ai/src/actions/shared.jsx';
import { setLoaded } from '../skillpath-ai/src/actions/loaded.jsx';
import { setAuthedUser } from '../skillpath-ai/src/actions/authedUsers.jsx';

// Firebase authentication
import { auth } from '../skillpath-ai/src/backend/firebase.jsx';
// FontAwesome configuration
library.add(faBars);

function App({ authedUser, loaded, dispatch }) {

  // Monitor Firebase authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        dispatch(setAuthedUser(user.uid));
        dispatch(setLoaded(false));
      } else {
        dispatch(setAuthedUser(null));
        dispatch(setLoaded(true));
      }
    });

    return () => unsubscribe();
  }, [dispatch]);

  // Retrieve user information after login
  useEffect(() => {
    if (authedUser) {
      dispatch(handleInitialData(authedUser));
    }
  }, [authedUser, dispatch]);

  // Display loading screen during initialization
  if (authedUser === null && !loaded) {
    return <Loading />;
  }

  // Routes for unauthenticated users
  if (authedUser === null) {
    return (
      <div className="App">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/new" element={<NewUser />} />
          <Route
            path="*"
            element={<Navigate to="/login" replace />}
          />
        </Routes>
      </div>
    );
  }

  // Routes for authenticated users
  return (
    <div className="App">
      <Toolbar />

      {/* Backend connection test */}
      <BackendTest />

      <Routes>
        <Route
          path="/resume"
          element={<ResumeUpload />}
        />

        <Route
          path="*"
          element={<Navigate to="/resume" replace />}
        />
      </Routes>
    </div>
  );
}

// Connect Redux state to the application
const mapStateToProps = ({ authedUser, loaded }) => ({
  authedUser,
  loaded,
});

export default connect(mapStateToProps)(App);
